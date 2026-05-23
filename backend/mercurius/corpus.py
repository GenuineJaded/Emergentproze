"""Corpus ingestion + retrieval for Mercurius.

- Reads the 6 markdown corpus files from /app/backend/corpus/
- Chunks them by section + sliding window
- Embeds each chunk via OpenAI text-embedding-3-small through the Emergent proxy
- Stores chunks + embeddings in MongoDB (collection: mercurius_chunks)
- Provides a retrieve(query, k) function that returns top-k chunks by cosine similarity

The Emergent universal key (sk-emergent-*) routes through
https://integrations.emergentagent.com/llm which is an OpenAI-compatible proxy.
"""
from __future__ import annotations

import os
import re
import asyncio
import logging
from pathlib import Path
from typing import List, Dict, Any

import numpy as np
from openai import AsyncOpenAI

logger = logging.getLogger(__name__)

CORPUS_DIR = Path(__file__).parent.parent / "corpus"

DOC_TITLES = {
    "01_shifting_geometric_outline.md": "A Linguistic Sketch of the Shifting Geometric Outline of Actuality",
    "02_tensional_metabolization.md": "A Linguistic Sketch of the Tensional Metabolization Framework",
    "03_hidden_substrate_trinity.md": "The Hidden Substrate Trinity",
    "04_binary_solvent_distillation.md": "Binary Solvent Distillation",
    "05_stewarding_nascent_intelligence.md": "Stewarding Nascent Intelligence",
    "06_observing_novelty_uniqueness.md": "Observing Novelty and Uniqueness",
}

EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_DIM = 1536


def _get_openai_client() -> AsyncOpenAI:
    key = os.environ["EMERGENT_LLM_KEY"]
    base_url = os.environ.get(
        "INTEGRATION_PROXY_URL", "https://integrations.emergentagent.com"
    ).rstrip("/") + "/llm"
    return AsyncOpenAI(api_key=key, base_url=base_url)


def _chunk_markdown(text: str, doc_id: str, doc_title: str) -> List[Dict[str, Any]]:
    """Chunk a markdown document by ### sections, then split long sections into ~600-word windows."""
    chunks: List[Dict[str, Any]] = []
    # Split by '### ' headings (subsections); keep heading attached.
    parts = re.split(r"\n(?=### )", text)
    for part in parts:
        part = part.strip()
        if not part:
            continue
        # Extract section heading if present
        heading_match = re.match(r"^(#{1,3})\s+(.+?)(?:\n|$)", part)
        section = heading_match.group(2).strip() if heading_match else ""

        words = part.split()
        if len(words) <= 700:
            chunks.append({"text": part, "section": section})
        else:
            # Sliding window: 600 words with 100-word overlap
            step = 500
            window = 600
            i = 0
            while i < len(words):
                window_words = words[i : i + window]
                if not window_words:
                    break
                chunk_text = " ".join(window_words)
                chunks.append({"text": chunk_text, "section": section})
                i += step

    out = []
    for idx, c in enumerate(chunks):
        out.append(
            {
                "doc_id": doc_id,
                "doc_title": doc_title,
                "section": c["section"],
                "chunk_index": idx,
                "text": c["text"],
            }
        )
    return out


async def _embed_batch(client: AsyncOpenAI, texts: List[str]) -> List[List[float]]:
    response = await client.embeddings.create(
        model=EMBEDDING_MODEL,
        input=texts,
        encoding_format="float",
    )
    return [item.embedding for item in response.data]


async def ingest_corpus(db) -> Dict[str, Any]:
    """Idempotent ingestion. Drops & rebuilds mercurius_chunks if corpus changed.

    Returns a summary dict.
    """
    # Build chunks from disk
    all_chunks: List[Dict[str, Any]] = []
    for filename, title in DOC_TITLES.items():
        path = CORPUS_DIR / filename
        if not path.exists():
            logger.warning("Corpus file missing: %s", path)
            continue
        text = path.read_text(encoding="utf-8")
        doc_id = filename.replace(".md", "")
        all_chunks.extend(_chunk_markdown(text, doc_id, title))

    if not all_chunks:
        return {"status": "no_corpus_found", "chunks": 0}

    # Check if already ingested with same chunk count
    existing = await db.mercurius_chunks.count_documents({})
    if existing == len(all_chunks):
        logger.info("Corpus already ingested: %d chunks", existing)
        return {"status": "already_ingested", "chunks": existing}

    # Re-ingest: drop and rebuild
    logger.info("Ingesting %d chunks (was %d)", len(all_chunks), existing)
    await db.mercurius_chunks.drop()

    client = _get_openai_client()
    # Batch embeddings (OpenAI handles up to ~2048 inputs per request; we have <100)
    texts = [c["text"] for c in all_chunks]
    batch_size = 32
    embeddings: List[List[float]] = []
    for i in range(0, len(texts), batch_size):
        batch = texts[i : i + batch_size]
        embs = await _embed_batch(client, batch)
        embeddings.extend(embs)
        logger.info("Embedded %d/%d chunks", min(i + batch_size, len(texts)), len(texts))

    # Insert
    docs = []
    for chunk, emb in zip(all_chunks, embeddings):
        docs.append({**chunk, "embedding": emb})
    await db.mercurius_chunks.insert_many(docs)
    logger.info("Inserted %d chunks into mercurius_chunks", len(docs))

    return {"status": "ingested", "chunks": len(docs)}


# In-memory cache of embeddings matrix for fast cosine sim
_cache: Dict[str, Any] = {"matrix": None, "meta": None, "count": 0}


async def _load_cache(db) -> None:
    docs = await db.mercurius_chunks.find(
        {}, {"embedding": 1, "text": 1, "doc_id": 1, "doc_title": 1, "section": 1, "_id": 0}
    ).to_list(length=10_000)
    if not docs:
        _cache["matrix"] = None
        _cache["meta"] = []
        _cache["count"] = 0
        return
    matrix = np.array([d["embedding"] for d in docs], dtype=np.float32)
    # Normalize for cosine similarity
    norms = np.linalg.norm(matrix, axis=1, keepdims=True)
    norms[norms == 0] = 1.0
    matrix = matrix / norms
    _cache["matrix"] = matrix
    _cache["meta"] = [
        {"text": d["text"], "doc_id": d["doc_id"], "doc_title": d["doc_title"], "section": d["section"]}
        for d in docs
    ]
    _cache["count"] = len(docs)
    logger.info("Loaded embedding cache: %d chunks", len(docs))


async def retrieve(db, query: str, k: int = 5) -> List[Dict[str, Any]]:
    """Embed the query and return top-k chunks by cosine similarity."""
    if _cache["matrix"] is None or _cache["count"] == 0:
        await _load_cache(db)

    if _cache["matrix"] is None:
        return []

    client = _get_openai_client()
    q_embs = await _embed_batch(client, [query])
    q = np.array(q_embs[0], dtype=np.float32)
    q_norm = np.linalg.norm(q)
    if q_norm == 0:
        return []
    q = q / q_norm

    sims = _cache["matrix"] @ q  # cosine similarity (both normalized)
    top_idx = np.argsort(-sims)[:k]
    results = []
    for i in top_idx:
        meta = _cache["meta"][int(i)]
        results.append({**meta, "score": float(sims[int(i)])})
    return results


async def reload_cache(db) -> None:
    """Force-reload the in-memory cache (call after ingestion)."""
    await _load_cache(db)
