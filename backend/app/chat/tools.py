from app.config import settings
from app.db.pgvector_utils import vector_store
from langchain_community.tools.tavily_search import TavilySearchResults
from langchain_core.runnables import RunnableConfig
from langchain_core.tools import tool
from langgraph.types import interrupt
from loguru import logger

import httpx

tavily = TavilySearchResults(
    tavily_api_key=settings.tavily_api_key,
    max_results=3,
    include_answer=False,
    include_raw_content=False,
    include_images=False,
)

# DashScope native rerank endpoint (model: qwen3-rerank)
RERANK_URL = "https://dashscope.aliyuncs.com/api/v1/services/rerank/text-rerank/text-rerank"
RERANK_TOP_N = 3


async def rerank_documents(query: str, docs: list) -> list:
    """Rerank candidate chunks with Bailian qwen3-rerank, return top-N docs by score."""
    payload = {
        "model": settings.rerank_model,
        "input": {
            "query": query,
            "documents": [d.page_content for d in docs],
        },
        "parameters": {"top_n": RERANK_TOP_N, "return_documents": False},
    }
    headers = {
        "Authorization": f"Bearer {settings.api_key.get_secret_value()}",
        "Content-Type": "application/json",
    }
    async with httpx.AsyncClient(timeout=30) as client:
        resp = await client.post(RERANK_URL, json=payload, headers=headers)
        resp.raise_for_status()
        data = resp.json()

    results = sorted(
        data.get("output", {}).get("results", []),
        key=lambda r: r.get("relevance_score", 0),
        reverse=True,
    )
    ordered = [docs[r["index"]] for r in results if 0 <= r["index"] < len(docs)]
    logger.info(f"Rerank finished: {len(ordered)} docs selected from {len(docs)} candidates.")
    return ordered


@tool
async def retrieve_user_documents(query: str, config: RunnableConfig) -> str:
    """
    Use this tool to answer questions about the user's uploaded documents.
    It will automatically retrieve documents relevant to the current user and thread.
    """
    user_id = config["configurable"].get("user_id")  # type: ignore
    thread_id = config["configurable"].get("thread_id")  # type: ignore
    logger.info(f"Retrieving documents for user_id: {user_id} and thread_id: {thread_id}")

    # Fail closed: without BOTH scope keys we cannot prove ownership, so never
    # fall back to an unfiltered (cross-user) similarity search.
    if not user_id or not thread_id:
        logger.warning("Missing user_id/thread_id in retrieval config; refusing to retrieve.")
        return "No relevant documents"

    # coarse recall 10 then rerank to top-3; without rerank config, keep top-3
    retrieve_k = 10 if settings.rerank_model else 3
    retriever = vector_store.as_retriever(
        search_kwargs={"k": retrieve_k, "filter": {"thread_id": str(thread_id), "user_id": str(user_id)}}
    )
    result_docs = await retriever.ainvoke(query)

    if not result_docs:
        return "No relevant documents"

    if settings.rerank_model and len(result_docs) > RERANK_TOP_N:
        try:
            ranked = await rerank_documents(query, result_docs)
            if ranked:
                result_docs = ranked
        except Exception as e:
            # fallback to similarity top-3 on any rerank failure
            logger.warning(f"Rerank failed, fallback to similarity Top-3: {e}")
            result_docs = result_docs[:RERANK_TOP_N]

    return "\n\n".join([doc.page_content for doc in result_docs[:RERANK_TOP_N]])


@tool
def ask_human(question: str, options: list[str] | None = None) -> str:
    """Ask the user a clarifying multiple-choice question when the request is
    ambiguous or missing key information. Call this ONLY when you cannot answer
    confidently: e.g. the user refers to "这份合同/这个文档" but several documents
    exist and you cannot tell which one, or a required detail (a date, a document
    name, a threshold, which field) is missing. Provide a short question and 2-4
    concrete options. The user will pick one or type their own answer, and their
    answer is returned to you so you can continue. Never use this for general
    knowledge questions - use tavily for those."""
    answer = interrupt({"question": question, "options": options or []})
    # Frontend normally resumes with a plain string; tolerate a dict as well.
    if isinstance(answer, dict):
        return str(answer.get("answer", answer))
    return str(answer)


tools = [retrieve_user_documents, tavily, ask_human]
