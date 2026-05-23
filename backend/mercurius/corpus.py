"""Corpus ingestion + BM25 retrieval for Mercurius.

- Reads the 6 markdown corpus files from /app/backend/corpus/
- Chunks them at paragraph level, attaching the nearest preceding section heading
- Indexes with BM25 (lowercased, lightly stemmed tokens)
- Stores chunks in MongoDB (collection: mercurius_chunks) — embedding-free
- Provides retrieve(query, k) returning top-k chunks with original casing

Rationale: the Emergent universal key does not expose embedding models, and the
corpus vocabulary (bicone, equator, π, persistence, metabolization, inversion,
ground, love, change, etc.) is sharp enough that BM25 retrieves very accurately
at this scale (44 chunks across 6 documents).
"""
from __future__ import annotations

import re
import logging
from pathlib import Path
from typing import List, Dict, Any, Optional

from rank_bm25 import BM25Okapi

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

# Tiny stopword list — keep it short so distinctive corpus terms always survive
STOPWORDS = {
    "the", "a", "an", "and", "or", "but", "of", "to", "in", "on", "at", "by",
    "for", "with", "as", "is", "are", "was", "were", "be", "been", "being",
    "it", "its", "this", "that", "these", "those", "i", "you", "we", "they",
    "he", "she", "him", "her", "them", "us", "our", "their", "your", "my",
    "me", "do", "does", "did", "have", "has", "had", "will", "would", "could",
    "should", "can", "may", "might", "must", "shall",
    "so", "if", "then", "else", "than", "too", "very", "just", "only",
    "not", "no", "yes", "all", "any", "some", "what", "which", "who", "whom",
    "whose", "where", "when", "why", "how", "there", "here", "from", "into",
    "about", "over", "under", "out", "up", "down", "off", "on",
}


def _light_stem(token: str) -> str:
    """Strip very common English suffixes. Lightweight; preserves stems for
    distinctive vocabulary (bicone, equator, π stay intact)."""
    if len(token) <= 4:
        return token
    for suf in ("ization", "izations", "isation", "tional", "ations", "ation",
                "ings", "ness", "ment", "ies", "ed", "es", "ing", "ly", "s"):
        if token.endswith(suf) and len(token) - len(suf) >= 3:
            return token[: -len(suf)]
    return token


_TOKEN_RE = re.compile(r"[A-Za-zπ]+(?:'[a-z]+)?", re.UNICODE)


def _tokenize(text: str) -> List[str]:
    out = []
    for raw in _TOKEN_RE.findall(text.lower()):
        if raw in STOPWORDS or len(raw) < 2:
            continue
        out.append(_light_stem(raw))
    return out


def _split_into_chunks(doc_text: str, doc_id: str, doc_title: str) -> List[Dict[str, Any]]:
    """Walk the markdown, accumulate paragraphs under the current section heading,
    then split each section into ~250-450-word chunks (never smaller than ~200,
    never larger than ~550). Section heading is prepended to every chunk so BM25
    queries against headings hit body chunks too."""
    lines = doc_text.split("\n")
    current_section = ""
    section_buf: List[str] = []

    def flush() -> List[Dict[str, Any]]:
        if not section_buf:
            return []
        body = "\n".join(section_buf).strip()
        if not body:
            return []
        # Break body into chunks by paragraph; aim for ~350 words/chunk
        paragraphs = [p.strip() for p in re.split(r"\n\s*\n", body) if p.strip()]
        chunks: List[Dict[str, Any]] = []
        buf_words = 0
        buf_paras: List[str] = []
        for p in paragraphs:
            w = len(p.split())
            if buf_words + w > 450 and buf_paras:
                chunks.append({"section": current_section, "paragraphs": buf_paras})
                buf_paras = [p]
                buf_words = w
            else:
                buf_paras.append(p)
                buf_words += w
        if buf_paras:
            chunks.append({"section": current_section, "paragraphs": buf_paras})
        return chunks

    all_chunks: List[Dict[str, Any]] = []
    for line in lines:
        m = re.match(r"^(#{1,3})\s+(.+)$", line)
        if m:
            # New heading; flush prior section
            all_chunks.extend(flush())
            level = len(m.group(1))
            heading = m.group(2).strip()
            if level >= 3:
                current_section = heading
            elif level == 2:
                # Subtitle line — fold into section context
                current_section = heading
            else:  # level 1 = doc title; reset
                current_section = ""
            section_buf = []
        else:
            section_buf.append(line)
    all_chunks.extend(flush())

    # Materialize chunks with section-prefixed text
    out: List[Dict[str, Any]] = []
    for idx, c in enumerate(all_chunks):
        body = "\n\n".join(c["paragraphs"])
        if c["section"]:
            full = f"### {c['section']}\n\n{body}"
        else:
            full = body
        # Index text = full chunk; display text preserves original casing
        out.append(
            {
                "doc_id": doc_id,
                "doc_title": doc_title,
                "section": c["section"],
                "chunk_index": idx,
                "text": full,
            }
        )
    return out


# In-process BM25 index + chunk metadata
_index: Dict[str, Any] = {"bm25": None, "chunks": [], "ready": False}


def _build_bm25(chunks: List[Dict[str, Any]]) -> BM25Okapi:
    tokenized = [_tokenize(c["text"]) for c in chunks]
    return BM25Okapi(tokenized)


async def ingest_corpus(db) -> Dict[str, Any]:
    """Idempotent: rebuild Mongo collection + in-process BM25 index from disk."""
    all_chunks: List[Dict[str, Any]] = []
    for filename, title in DOC_TITLES.items():
        path = CORPUS_DIR / filename
        if not path.exists():
            logger.warning("Corpus file missing: %s", path)
            continue
        text = path.read_text(encoding="utf-8")
        doc_id = filename.replace(".md", "")
        all_chunks.extend(_split_into_chunks(text, doc_id, title))

    if not all_chunks:
        return {"status": "no_corpus_found", "chunks": 0}

    existing = await db.mercurius_chunks.count_documents({})
    if existing != len(all_chunks):
        logger.info("Rebuilding corpus: %d chunks (was %d)", len(all_chunks), existing)
        await db.mercurius_chunks.drop()
        await db.mercurius_chunks.insert_many(all_chunks)
    else:
        logger.info("Corpus already ingested: %d chunks", existing)

    # Build BM25 in process
    _index["bm25"] = _build_bm25(all_chunks)
    _index["chunks"] = all_chunks
    _index["ready"] = True
    return {"status": "ok", "chunks": len(all_chunks)}


async def reload_cache(db) -> None:
    """Reload BM25 index from Mongo (used if a different process ingested)."""
    docs = await db.mercurius_chunks.find(
        {}, {"_id": 0, "doc_id": 1, "doc_title": 1, "section": 1, "chunk_index": 1, "text": 1}
    ).to_list(length=5000)
    docs.sort(key=lambda d: (d["doc_id"], d["chunk_index"]))
    if not docs:
        _index["bm25"] = None
        _index["chunks"] = []
        _index["ready"] = False
        return
    _index["bm25"] = _build_bm25(docs)
    _index["chunks"] = docs
    _index["ready"] = True
    logger.info("BM25 index loaded: %d chunks", len(docs))


async def retrieve(db, query: str, k: int = 5) -> List[Dict[str, Any]]:
    if not _index["ready"]:
        await reload_cache(db)
    if not _index["ready"] or not _index["chunks"]:
        return []
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []
    scores = _index["bm25"].get_scores(q_tokens)
    # Pair with indices, sort, take top-k
    scored = sorted(enumerate(scores), key=lambda x: -x[1])[:k]
    results: List[Dict[str, Any]] = []
    for idx, score in scored:
        if score <= 0:
            continue
        c = _index["chunks"][idx]
        results.append(
            {
                "doc_id": c["doc_id"],
                "doc_title": c["doc_title"],
                "section": c["section"],
                "text": c["text"],
                "score": float(score),
            }
        )
    return results
