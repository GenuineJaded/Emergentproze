"""Mercurius / The Living Sketch — stateless FastAPI entry.

Designed to run as a single Vercel Python serverless function. All routes
live under `/api/*`. No database — the corpus is built from disk at module
import time, conversation history flows up from the client per request.
"""
from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel
from typing import List, Optional

# Make repo root importable so we can pull in lib.mercurius regardless of how
# Vercel chooses to load this file.
import sys
sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from lib.mercurius import corpus as mercurius_corpus  # noqa: E402
from lib.mercurius import chat as mercurius_chat  # noqa: E402
from lib.mercurius import concepts as mercurius_concepts  # noqa: E402


logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Load .env for local development; on Vercel, env vars come from the platform.
load_dotenv(Path(__file__).parent / '.env')
load_dotenv(Path(__file__).parent.parent / '.env')

app = FastAPI(title="Mercurius / The Living Sketch")
api_router = APIRouter(prefix="/api")


# ---------------- Models ---------------- #

class HealthResponse(BaseModel):
    status: str
    corpus_chunks: int


class HistoryMessage(BaseModel):
    role: str  # 'user' or 'assistant'
    content: str


class CameraContext(BaseModel):
    azimuth: float
    elevation: float
    region: Optional[str] = None


class ChatRequest(BaseModel):
    message: str
    history: List[HistoryMessage] = []
    camera_context: Optional[CameraContext] = None
    openrouter_key: Optional[str] = None
    model: Optional[str] = None


class RetrievedPassage(BaseModel):
    doc_title: str
    section: str
    text: str
    score: float


class ChatResponse(BaseModel):
    assistant_message: str
    passages: List[RetrievedPassage]


# ---------------- Routes ---------------- #

@api_router.get("/")
async def root():
    return {"message": "Mercurius listens."}


@api_router.get("/health", response_model=HealthResponse)
async def health():
    return HealthResponse(
        status="ok" if mercurius_corpus.is_ready() else "no_corpus",
        corpus_chunks=mercurius_corpus.chunk_count(),
    )


# --- Geometry: concept tree + passages --- #

@api_router.get("/geometry/concepts")
async def list_concepts():
    return {"concepts": mercurius_concepts.list_macros()}


@api_router.get("/geometry/concepts/{concept_id}")
async def get_concept(concept_id: str):
    result = mercurius_concepts.get_concept_passages(concept_id, k=3)
    if result is None:
        raise HTTPException(status_code=404, detail="concept not found")
    return result


# --- Mercurius chat (non-streaming) --- #

@api_router.post("/mercurius/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    history = [m.model_dump() for m in req.history]
    try:
        passages = mercurius_corpus.retrieve(req.message, k=5)
    except Exception as e:
        logger.error("Retrieval failed: %s", e)
        passages = []

    try:
        assistant_text = await mercurius_chat.generate_response(
            user_text=req.message,
            retrieved_passages=passages,
            history=history,
            camera_context=req.camera_context.model_dump() if req.camera_context else None,
            api_key_override=req.openrouter_key,
            model_override=req.model,
        )
    except Exception as e:
        logger.exception("Mercurius generation failed")
        raise HTTPException(status_code=500, detail=f"generation failed: {e}")

    return ChatResponse(
        assistant_message=assistant_text,
        passages=[RetrievedPassage(**p) for p in passages],
    )


# --- Mercurius chat (streaming, SSE) --- #

@api_router.post("/mercurius/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """Server-Sent Events stream of Mercurius's reply.

    Event format (each line a separate event):
        data: {"type":"meta","passages":[...]}
        data: {"type":"token","content":"..."}     (many of these)
        data: {"type":"done","content":"<full text>"}
        data: {"type":"error","message":"..."}     (on failure)
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    history = [m.model_dump() for m in req.history]

    try:
        passages = mercurius_corpus.retrieve(req.message, k=5)
    except Exception as e:
        logger.error("Retrieval failed: %s", e)
        passages = []

    camera_dict = req.camera_context.model_dump() if req.camera_context else None

    async def event_gen():
        meta = {
            "type": "meta",
            "passages": [
                {
                    "doc_title": p["doc_title"],
                    "section": p.get("section", ""),
                    "text": p["text"],
                    "score": p["score"],
                }
                for p in passages
            ],
        }
        yield f"data: {json.dumps(meta)}\n\n"

        accumulated: List[str] = []
        try:
            async for token in mercurius_chat.generate_response_stream(
                user_text=req.message,
                retrieved_passages=passages,
                history=history,
                camera_context=camera_dict,
                api_key_override=req.openrouter_key,
                model_override=req.model,
            ):
                accumulated.append(token)
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
        except Exception as e:
            logger.exception("Stream generation failed")
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"
            return

        full_text = "".join(accumulated)
        yield f"data: {json.dumps({'type': 'done', 'content': full_text})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)
