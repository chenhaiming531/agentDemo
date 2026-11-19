from uuid import UUID

from app.auth.dependencies import CurrentUserDep
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse

from .rate_limit import bare_chat_rate_limit
from . import service as chat_service
from .schemas import ChatStreamResponse, Message, PromptInput

chat_router = APIRouter()


@chat_router.post("/")
async def simple_chat_stream(
    prompt_input: PromptInput,
    _rate_limited: None = Depends(bare_chat_rate_limit),
):
    # No auth / no tools / no memory - rate-limited by IP to stop LLM cost abuse.
    return StreamingResponse(
        chat_service.simple_chat_stream(prompt_input),
    )


@chat_router.post("/{thread_id}")
async def chat_stream(thread_id: UUID, prompt_input: PromptInput, current_user: CurrentUserDep):
    return ChatStreamResponse(
        await chat_service.chat_stream(thread_id, prompt_input, current_user.id),
    )


@chat_router.get("/{thread_id}", response_model=list[Message])
async def get_chat_history(thread_id: UUID, current_user: CurrentUserDep):
    return await chat_service.get_chat_history(thread_id, current_user.id)
