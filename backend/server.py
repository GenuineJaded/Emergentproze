from fastapi import FastAPI, APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from dotenv import load_dotenv
from starlette.middleware.cors import CORSMiddleware
from motor.motor_asyncio import AsyncIOMotorClient
import os
import json
import logging
from pathlib import Path
from pydantic import BaseModel, Field, ConfigDict
from typing import List, Optional
import uuid
from datetime import datetime, timezone

from mercurius import corpus as mercurius_corpus
from mercurius import chat as mercurius_chat
from mercurius import concepts as mercurius_concepts

# Configure logging
logging.basicConfig(
    level=logging.INFO,
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

# MongoDB connection
mongo_url = os.environ['MONGO_URL']
client = AsyncIOMotorClient(mongo_url)
db = client[os.environ['DB_NAME']]

# Create the main app without a prefix
app = FastAPI(title="Mercurius / The Living Sketch — Phase 0")

# Create a router with the /api prefix
api_router = APIRouter(prefix="/api")


# ---------------- Models ---------------- #

class HealthResponse(BaseModel):
    status: str
    corpus_chunks: int


class Conversation(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    title: str = "Untitled"
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))
    updated_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class ConversationCreate(BaseModel):
    title: Optional[str] = None


class Message(BaseModel):
    model_config = ConfigDict(extra="ignore")
    id: str = Field(default_factory=lambda: str(uuid.uuid4()))
    conversation_id: str
    role: str  # 'user' or 'assistant'
    content: str
    created_at: datetime = Field(default_factory=lambda: datetime.now(timezone.utc))


class CameraContext(BaseModel):
    azimuth: float
    elevation: float
    region: Optional[str] = None


class ChatRequest(BaseModel):
    conversation_id: Optional[str] = None
    message: str
    camera_context: Optional[CameraContext] = None
    use_latest_conversation: bool = False  # if true & no conversation_id, attach to most recent


class RetrievedPassage(BaseModel):
    doc_title: str
    section: str
    text: str
    score: float


class ChatResponse(BaseModel):
    conversation_id: str
    assistant_message: Message
    passages: List[RetrievedPassage]


# ---------------- Helpers ---------------- #

def _doc_to_conv(doc: dict) -> Conversation:
    if isinstance(doc.get("created_at"), str):
        doc["created_at"] = datetime.fromisoformat(doc["created_at"])
    if isinstance(doc.get("updated_at"), str):
        doc["updated_at"] = datetime.fromisoformat(doc["updated_at"])
    return Conversation(**doc)


def _doc_to_msg(doc: dict) -> Message:
    if isinstance(doc.get("created_at"), str):
        doc["created_at"] = datetime.fromisoformat(doc["created_at"])
    return Message(**doc)


# ---------------- Routes ---------------- #

@api_router.get("/")
async def root():
    return {"message": "Mercurius listens."}


@api_router.get("/health", response_model=HealthResponse)
async def health():
    count = await db.mercurius_chunks.count_documents({})
    return HealthResponse(status="ok", corpus_chunks=count)


@api_router.post("/mercurius/ingest")
async def ingest():
    """Ingest the corpus (idempotent). Safe to call multiple times."""
    result = await mercurius_corpus.ingest_corpus(db)
    await mercurius_corpus.reload_cache(db)
    return result


# --- Geometry: concept tree + passages --- #

@api_router.get("/geometry/concepts")
async def list_concepts():
    """Return the macro concept tree with positions (no passages)."""
    return {"concepts": mercurius_concepts.list_macros()}


@api_router.get("/geometry/concepts/{concept_id}")
async def get_concept(concept_id: str):
    """Return a single concept's metadata + top corpus passages."""
    await _ensure_corpus()
    result = await mercurius_concepts.get_concept_passages(db, concept_id, k=3)
    if result is None:
        raise HTTPException(status_code=404, detail="concept not found")
    return result


# --- Conversations --- #

@api_router.get("/mercurius/conversations", response_model=List[Conversation])
async def list_conversations():
    docs = await db.mercurius_conversations.find({}, {"_id": 0}).sort("updated_at", -1).to_list(200)
    return [_doc_to_conv(d) for d in docs]


@api_router.post("/mercurius/conversations", response_model=Conversation)
async def create_conversation(input: ConversationCreate):
    conv = Conversation(title=input.title or "New thread")
    doc = conv.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    await db.mercurius_conversations.insert_one(doc)
    return conv


@api_router.get("/mercurius/conversations/{conv_id}/messages", response_model=List[Message])
async def list_messages(conv_id: str):
    docs = await db.mercurius_messages.find(
        {"conversation_id": conv_id}, {"_id": 0}
    ).sort("created_at", 1).to_list(2000)
    return [_doc_to_msg(d) for d in docs]


@api_router.delete("/mercurius/conversations/{conv_id}")
async def delete_conversation(conv_id: str):
    await db.mercurius_messages.delete_many({"conversation_id": conv_id})
    result = await db.mercurius_conversations.delete_one({"id": conv_id})
    return {"deleted": result.deleted_count}


# --- Chat helpers --- #

async def _resolve_conversation(req: ChatRequest) -> "Conversation":
    """Resolve the conversation for a chat request:
    - explicit conversation_id → load it (404 if missing)
    - use_latest_conversation=True → pick most recently updated; create if none
    - otherwise create a new conversation titled from the message
    """
    if req.conversation_id:
        conv_doc = await db.mercurius_conversations.find_one(
            {"id": req.conversation_id}, {"_id": 0}
        )
        if not conv_doc:
            raise HTTPException(status_code=404, detail="conversation not found")
        return _doc_to_conv(conv_doc)

    if req.use_latest_conversation:
        latest = await db.mercurius_conversations.find({}, {"_id": 0}).sort(
            "updated_at", -1
        ).limit(1).to_list(1)
        if latest:
            return _doc_to_conv(latest[0])

    # Create a new conversation
    title = req.message.strip().split("\n")[0][:60] or "New thread"
    conv = Conversation(title=title)
    doc = conv.model_dump()
    doc["created_at"] = doc["created_at"].isoformat()
    doc["updated_at"] = doc["updated_at"].isoformat()
    await db.mercurius_conversations.insert_one(doc)
    return conv


async def _ensure_corpus():
    count = await db.mercurius_chunks.count_documents({})
    if count == 0:
        await mercurius_corpus.ingest_corpus(db)
        await mercurius_corpus.reload_cache(db)


async def _load_history(conv_id: str, exclude_msg_id: str | None = None) -> List[dict]:
    query = {"conversation_id": conv_id}
    if exclude_msg_id:
        query["id"] = {"$ne": exclude_msg_id}
    docs = await db.mercurius_messages.find(
        query, {"_id": 0, "role": 1, "content": 1, "created_at": 1}
    ).sort("created_at", 1).to_list(2000)
    return [{"role": d["role"], "content": d["content"]} for d in docs]


# --- Chat (non-streaming) --- #

@api_router.post("/mercurius/chat", response_model=ChatResponse)
async def chat_endpoint(req: ChatRequest):
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    await _ensure_corpus()
    conv = await _resolve_conversation(req)

    # Persist user message
    user_msg = Message(conversation_id=conv.id, role="user", content=req.message)
    udoc = user_msg.model_dump()
    udoc["created_at"] = udoc["created_at"].isoformat()
    await db.mercurius_messages.insert_one(udoc)

    history = await _load_history(conv.id, exclude_msg_id=user_msg.id)

    try:
        passages = await mercurius_corpus.retrieve(db, req.message, k=5)
    except Exception as e:
        logger.error("Retrieval failed: %s", e)
        passages = []

    try:
        assistant_text = await mercurius_chat.generate_response(
            conversation_id=conv.id,
            user_text=req.message,
            retrieved_passages=passages,
            history=history,
            camera_context=req.camera_context.model_dump() if req.camera_context else None,
        )
    except Exception as e:
        logger.exception("Mercurius generation failed")
        raise HTTPException(status_code=500, detail=f"generation failed: {e}")

    # Persist assistant message
    assistant_msg = Message(conversation_id=conv.id, role="assistant", content=assistant_text)
    adoc = assistant_msg.model_dump()
    adoc["created_at"] = adoc["created_at"].isoformat()
    await db.mercurius_messages.insert_one(adoc)

    # Update conversation updated_at
    await db.mercurius_conversations.update_one(
        {"id": conv.id},
        {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
    )

    return ChatResponse(
        conversation_id=conv.id,
        assistant_message=assistant_msg,
        passages=[RetrievedPassage(**p) for p in passages],
    )


# --- Chat (streaming, SSE) --- #

@api_router.post("/mercurius/chat/stream")
async def chat_stream_endpoint(req: ChatRequest):
    """Server-Sent Events stream of Mercurius's reply.

    Event format (each line a separate event):
        data: {"type":"meta","conversation_id":"...","assistant_message_id":"...","passages":[...]}
        data: {"type":"token","content":"..."}     (many of these)
        data: {"type":"done","content":"<full text>"}
        data: {"type":"error","message":"..."}     (on failure)
    """
    if not req.message or not req.message.strip():
        raise HTTPException(status_code=400, detail="message must not be empty")

    await _ensure_corpus()
    conv = await _resolve_conversation(req)

    # Persist user message immediately so refreshes / reconnects see it
    user_msg = Message(conversation_id=conv.id, role="user", content=req.message)
    udoc = user_msg.model_dump()
    udoc["created_at"] = udoc["created_at"].isoformat()
    await db.mercurius_messages.insert_one(udoc)

    history = await _load_history(conv.id, exclude_msg_id=user_msg.id)

    try:
        passages = await mercurius_corpus.retrieve(db, req.message, k=5)
    except Exception as e:
        logger.error("Retrieval failed: %s", e)
        passages = []

    # Pre-create assistant message ID so the client can reference it
    assistant_msg = Message(conversation_id=conv.id, role="assistant", content="")

    camera_dict = req.camera_context.model_dump() if req.camera_context else None

    async def event_gen():
        # Initial meta event
        meta = {
            "type": "meta",
            "conversation_id": conv.id,
            "user_message_id": user_msg.id,
            "assistant_message_id": assistant_msg.id,
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

        accumulated_parts: List[str] = []
        try:
            async for token in mercurius_chat.generate_response_stream(
                user_text=req.message,
                retrieved_passages=passages,
                history=history,
                camera_context=camera_dict,
            ):
                accumulated_parts.append(token)
                yield f"data: {json.dumps({'type': 'token', 'content': token})}\n\n"
        except Exception as e:
            logger.exception("Stream generation failed")
            err = {"type": "error", "message": str(e)}
            yield f"data: {json.dumps(err)}\n\n"
            return

        full_text = "".join(accumulated_parts)
        # Persist assistant message + bump conversation timestamp
        try:
            assistant_msg.content = full_text
            adoc = assistant_msg.model_dump()
            adoc["created_at"] = adoc["created_at"].isoformat()
            await db.mercurius_messages.insert_one(adoc)
            await db.mercurius_conversations.update_one(
                {"id": conv.id},
                {"$set": {"updated_at": datetime.now(timezone.utc).isoformat()}},
            )
        except Exception as e:
            logger.exception("Failed to persist assistant message")
            yield f"data: {json.dumps({'type': 'error', 'message': f'persist failed: {e}'})}\n\n"
            return

        yield f"data: {json.dumps({'type': 'done', 'content': full_text})}\n\n"

    return StreamingResponse(
        event_gen(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",  # disable buffering for nginx-style proxies
            "Connection": "keep-alive",
        },
    )


# Include the router in the main app
app.include_router(api_router)

app.add_middleware(
    CORSMiddleware,
    allow_credentials=True,
    allow_origins=os.environ.get('CORS_ORIGINS', '*').split(','),
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.on_event("startup")
async def startup_ingest():
    """Ingest corpus once at startup so first chat is fast."""
    try:
        result = await mercurius_corpus.ingest_corpus(db)
        logger.info("Corpus ingestion: %s", result)
        await mercurius_corpus.reload_cache(db)
    except Exception as e:
        logger.exception("Corpus ingestion at startup failed: %s", e)


@app.on_event("shutdown")
async def shutdown_db_client():
    client.close()
