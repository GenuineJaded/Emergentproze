"""Corpus loader + BM25 retrieval for Mercurius.

Stateless: reads the 6 markdown corpus files from disk at module import time,
chunks them at paragraph level with section-heading awareness, builds a BM25
index in-process. No database. The index lives in a module-level dict; on
serverless cold-start it gets rebuilt (~20ms for 45 chunks — negligible).

Why BM25 not embeddings: the corpus vocabulary (bicone, equator, π,
persistence, metabolization, inversion, ground, love, change) is sharp enough
that BM25 retrieves with high precision at this scale.
"""
from __future__ import annotations

import re
import logging
from pathlib import Path
from typing import List, Dict, Any

from rank_bm25 import BM25Okapi

logger = logging.getLogger(__name__)

CORPUS_DIR = Path(__file__).resolve().parent.parent.parent / "corpus"

DOC_TITLES = {
    "01_shifting_geometric_outline.md": "A Linguistic Sketch of the Shifting Geometric Outline of Actuality",
    "02_tensional_metabolization.md": "A Linguistic Sketch of the Tensional Metabolization Framework",
    "03_hidden_substrate_trinity.md": "The Hidden Substrate Trinity",
    "04_binary_solvent_distillation.md": "Binary Solvent Distillation",
    "05_stewarding_nascent_intelligence.md": "Stewarding Nascent Intelligence",
    "06_observing_novelty_uniqueness.md": "Observing Novelty and Uniqueness",
}

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
    lines = doc_text.split("\n")
    current_section = ""
    section_buf: List[str] = []

    def flush() -> List[Dict[str, Any]]:
        if not section_buf:
            return []
        body = "\n".join(section_buf).strip()
        if not body:
            return []
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
            all_chunks.extend(flush())
            level = len(m.group(1))
            heading = m.group(2).strip()
            if level >= 2:
                current_section = heading
            else:
                current_section = ""
            section_buf = []
        else:
            section_buf.append(line)
    all_chunks.extend(flush())

    out: List[Dict[str, Any]] = []
    for idx, c in enumerate(all_chunks):
        body = "\n\n".join(c["paragraphs"])
        if c["section"]:
            full = f"### {c['section']}\n\n{body}"
        else:
            full = body
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


_index: Dict[str, Any] = {"bm25": None, "chunks": [], "ready": False}


def _build() -> None:
    """Read corpus files from disk and build BM25. Called at import time and
    safe to call again to force rebuild."""
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
        _index["bm25"] = None
        _index["chunks"] = []
        _index["ready"] = False
        return

    tokenized = [_tokenize(c["text"]) for c in all_chunks]
    _index["bm25"] = BM25Okapi(tokenized)
    _index["chunks"] = all_chunks
    _index["ready"] = True
    logger.info("BM25 index built: %d chunks across %d docs", len(all_chunks), len(DOC_TITLES))


def chunk_count() -> int:
    return len(_index["chunks"])


def is_ready() -> bool:
    return _index["ready"]


def retrieve(query: str, k: int = 5) -> List[Dict[str, Any]]:
    if not _index["ready"]:
        _build()
    if not _index["ready"] or not _index["chunks"]:
        return []
    q_tokens = _tokenize(query)
    if not q_tokens:
        return []
    scores = _index["bm25"].get_scores(q_tokens)
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


# Build at import time so the first request is hot.
_build()
