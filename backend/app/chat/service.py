import json
import uuid
from collections.abc import AsyncGenerator, AsyncIterator
from uuid import UUID

from app.config import settings
from app.db.checkpointer import get_checkpointer
from langchain_core.messages import HumanMessage, RemoveMessage, SystemMessage
from langchain_core.runnables import RunnableConfig
from loguru import logger

from .langgraph_agent import build_retrival_graph, create_model
from .prompts import SUMMARIZE_PROMPT
from .schemas import Message, PromptInput


async def simple_chat_stream(prompt_input: PromptInput) -> AsyncGenerator:
    model = create_model(model_name=prompt_input.model_name, streaming=True)
    async for chunk in model.astream([HumanMessage(content=prompt_input.prompt)]):
        if content := chunk.content:
            response = {"type": "llm_chunk", "content": str(content)}
            yield json.dumps(response) + "\n"


async def _summarize_history(model, messages) -> str | None:
    """Compress old messages into one concise summary via the chat model."""
    try:
        response = await model.ainvoke([SystemMessage(content=SUMMARIZE_PROMPT), *messages])
        content = response.content
        if isinstance(content, list):
            content = "".join(
                part.get("text", "") if isinstance(part, dict) else str(part)
                for part in content
            )
        return str(content).strip() or None
    except Exception as exc:  # noqa: BLE001 - summarization is best-effort
        logger.warning(f"Summarization model call failed, skip: {exc}")
        return None


async def maybe_summarize_history(checkpointer, graph, config, model) -> None:
    """Compress long conversations: summarize old turns, keep recent turns verbatim.

    The summary is written back into the checkpoint as the first message, so the
    model still sees key context while token usage stops growing unboundedly.
    Any failure degrades gracefully - the chat continues with full history.
    """
    threshold = settings.summarize_threshold_turns
    keep = settings.summarize_keep_turns
    if threshold <= 0:
        return
    try:
        snapshot = await graph.aget_state(config)
        if snapshot is None:
            return
        messages = list(snapshot.values.get("messages") or [])
        human_indexes = [i for i, m in enumerate(messages) if isinstance(m, HumanMessage)]
        if len(human_indexes) < threshold:
            return
        split = human_indexes[-keep] if keep > 0 else len(messages)
        old_messages = messages[:split]
        keep_messages = messages[split:]

        summary_text = await _summarize_history(model, old_messages)
        if not summary_text:
            return

        summary_message = SystemMessage(content=summary_text, id=f"summary-{uuid.uuid4()}")
        # Fresh ids so add_messages appends them AFTER the summary instead of
        # keeping their original positions in the list.
        kept_fresh = [m.model_copy(update={"id": f"keep-{uuid.uuid4()}"}) for m in keep_messages]
        removes = [RemoveMessage(id=m.id) for m in messages if m.id]
        await graph.aupdate_state(
            config,
            {"messages": removes + [summary_message] + kept_fresh},
            as_node="__start__",
        )
        logger.info(
            f"Conversation summarized: {len(messages)} -> {1 + len(keep_messages)} messages"
            f" (threshold={threshold} turns, keep={keep})"
        )
    except Exception as exc:  # noqa: BLE001 - never block chat on summarization
        logger.warning(f"Conversation summarization skipped (fail-safe): {exc}")


async def chat_stream(thread_id: UUID, prompt_input: PromptInput, user_id: UUID) -> AsyncIterator:
    """
    Streams the agent's execution steps and final response.
    """
    config = RunnableConfig(configurable={"thread_id": str(thread_id), "user_id": str(user_id)})
    checkpointer = await get_checkpointer()
    graph = build_retrival_graph(checkpointer, prompt_input.model_name)

    # Compress long history before answering so token usage stays bounded.
    await maybe_summarize_history(checkpointer, graph, config, create_model(prompt_input.model_name))

    return graph.astream(
        input={"messages": [HumanMessage(content=prompt_input.prompt)], "retry_count": 0},
        config=config,
        stream_mode=["updates", "messages"],
    )


async def get_chat_history(thread_id: UUID, user_id: UUID) -> list[Message]:
    config = RunnableConfig(configurable={"thread_id": str(thread_id), "user_id": str(user_id)})
    checkpointer = await get_checkpointer()
    checkpoint = await checkpointer.aget(config)

    if checkpoint is None:
        # A brand-new thread has no checkpoint yet: return empty history instead of 404
        return []

    all_messages = checkpoint.get("channel_values", {}).get("messages", [])
    messages = [
        Message(role=message.type, content=message.content)
        for message in all_messages
        if message.content and message.type in ["human", "ai"]
    ]

    return messages
