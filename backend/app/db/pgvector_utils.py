from pathlib import Path
from uuid import UUID, uuid4

from langchain_openai import OpenAIEmbeddings
from langchain.text_splitter import RecursiveCharacterTextSplitter
from langchain_community.document_loaders import Docx2txtLoader, PyPDFLoader, TextLoader
from langchain_community.document_loaders.base import BaseLoader
from langchain_core.documents import Document
from langchain_postgres import PGVector
from loguru import logger
from sqlalchemy import text

from app.config import settings

embeddings = OpenAIEmbeddings(
    model=settings.embeddings_model_name,
    base_url=settings.embeddings_base_url,
    api_key=settings.api_key,
    check_embedding_ctx_length=False,
)


vector_store = PGVector(
    embeddings=embeddings,  # type: ignore
    connection=settings.pgvector_connection,
    collection_name=settings.pgvector_collection_name,
    use_jsonb=True,
    async_mode=True,
)


text_splitter = RecursiveCharacterTextSplitter(
    chunk_size=1000,
    chunk_overlap=200,
    length_function=len,
)


DOCUMENT_LOADER_MAPPING: dict[str, type[BaseLoader]] = {
    ".pdf": PyPDFLoader,
    ".docx": Docx2txtLoader,
    ".txt": TextLoader,
}

allowd_extensions = list(DOCUMENT_LOADER_MAPPING.keys())


async def _load_and_split_documents(file_path: Path) -> list[Document]:
    """
    Load and split documents based on file extension.
    Raises:
        UnsupportedFileTypeError: If the file extension is not supported.
        Exception: For other loading or splitting errors.
    """

    file_extension = file_path.suffix.lower()
    if file_extension not in DOCUMENT_LOADER_MAPPING:
        raise ValueError(f"Unsupported file type: {file_extension}, Allowed types: {', '.join(allowd_extensions)}")
    loader = DOCUMENT_LOADER_MAPPING[file_extension](file_path)  # type: ignore
    documents = await loader.aload()
    splits = text_splitter.split_documents(documents)
    logger.info(f"Successfully loaded and split {file_path} into {len(splits)} chunks.")

    return splits


async def index_document_to_pgvector(file_path: Path, document_id: UUID, thread_id: UUID, user_id: UUID) -> list[str]:
    """Index a document to PGVector."""

    logger.info(f"Starting indexing for document: {file_path} with document_id: {document_id}")
    splits = await _load_and_split_documents(file_path)
    for split in splits:
        split.metadata["id"] = str(uuid4())
        split.metadata["file_name"] = file_path.name
        split.metadata["document_id"] = str(document_id)
        split.metadata["thread_id"] = str(thread_id)
        split.metadata["user_id"] = str(user_id)

    try:
        doc_ids = await vector_store.aadd_documents(splits, ids=[split.metadata["id"] for split in splits])
        logger.info(
            f"Successfully indexed {len(splits)} chunks for document {file_path} (document_id: {document_id}) to PGVector."
        )
        return doc_ids
    except Exception as e:
        logger.error("Error adding documents to PGVector: {}", e)
        raise


async def search_documents_in_pgvector(query: str = "", k: int = 1, filter: dict | None = None) -> list[Document]:
    """Search documents in PGVector based on query, k and filter."""

    logger.info(f"Search documents with query: {query}, k: {k}, filter: {filter} in PGVector.")
    documents = await vector_store.asimilarity_search(query, k=k, filter=filter)
    if not documents:
        logger.info(f"No documents found for query: {query} and filter: {filter} in PGVector.")
    else:
        logger.info(f"Found {len(documents)} document chunks for query: {query} and filter: {filter} in PGVector.")
    return documents


async def delete_document_from_pgvector(document_ids: list[str]) -> None:
    """Delete documents from PGVector based on Document ID"""

    logger.info(f"Attempting to delete {len(document_ids)} document chunks from PGVector.")
    await vector_store.adelete(ids=document_ids)
    logger.info(f"Successfully deleted {len(document_ids)} document chunks from PGVector.")


async def delete_documents_by_metadata(metadata: dict[str, str]) -> int:
    """Delete document chunks from PGVector by metadata key-value pairs, without embedding.

    Useful when the caller only has a filter (e.g. thread_id / document_id) but no query text.
    Returns the number of deleted chunks.
    """
    if not metadata:
        logger.warning("delete_documents_by_metadata called with empty metadata, skip.")
        return 0

    allowed_keys = {"thread_id", "document_id", "user_id"}
    if not set(metadata).issubset(allowed_keys):
        raise ValueError(f"Unsupported metadata keys: {set(metadata) - allowed_keys}")

    await vector_store.__apost_init__()
    conditions = " AND ".join(f"cmetadata->>'{key}' = :{key}" for key in metadata)
    statement = text(
        "DELETE FROM langchain_pg_embedding "
        "WHERE collection_id = (SELECT uuid FROM langchain_pg_collection WHERE name = :collection_name) "
        f"AND {conditions}"
    )
    async with vector_store._async_engine.begin() as conn:
        result = await conn.execute(
            statement,
            {**metadata, "collection_name": settings.pgvector_collection_name},
        )
    logger.info(f"Deleted {result.rowcount} document chunks from PGVector with metadata filter: {metadata}.")
    return result.rowcount
