"""Backend API tests for Mercurius / The Living Sketch — Phase 0."""
import os
import time
import pytest
import requests
from dotenv import load_dotenv
from pathlib import Path

load_dotenv(Path(__file__).resolve().parents[1] / ".env")
# Frontend public URL is the authoritative external endpoint
_FRONTEND_ENV = Path(__file__).resolve().parents[2] / "frontend" / ".env"
load_dotenv(_FRONTEND_ENV)

BASE_URL = os.environ["REACT_APP_BACKEND_URL"].rstrip("/")


@pytest.fixture(scope="session")
def api():
    s = requests.Session()
    s.headers.update({"Content-Type": "application/json"})
    return s


# --- Health & ingest --- #
class TestHealth:
    def test_health_ok(self, api):
        r = api.get(f"{BASE_URL}/api/health", timeout=15)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert data["corpus_chunks"] == 45

    def test_ingest_idempotent(self, api):
        r = api.post(f"{BASE_URL}/api/mercurius/ingest", timeout=30)
        assert r.status_code == 200
        data = r.json()
        assert data["status"] == "ok"
        assert data["chunks"] == 45
        # call again — still 45, still ok
        r2 = api.post(f"{BASE_URL}/api/mercurius/ingest", timeout=30)
        assert r2.status_code == 200
        assert r2.json()["chunks"] == 45


# --- Conversation CRUD --- #
class TestConversations:
    def test_list_conversations(self, api):
        r = api.get(f"{BASE_URL}/api/mercurius/conversations", timeout=15)
        assert r.status_code == 200
        assert isinstance(r.json(), list)

    def test_create_conversation(self, api):
        r = api.post(
            f"{BASE_URL}/api/mercurius/conversations",
            json={"title": "TEST_thread_alpha"},
            timeout=15,
        )
        assert r.status_code == 200
        conv = r.json()
        assert conv["title"] == "TEST_thread_alpha"
        for k in ("id", "title", "created_at", "updated_at"):
            assert k in conv
        # cleanup
        api.delete(f"{BASE_URL}/api/mercurius/conversations/{conv['id']}", timeout=15)

    def test_messages_empty_for_new_conv(self, api):
        r = api.post(
            f"{BASE_URL}/api/mercurius/conversations",
            json={"title": "TEST_empty"},
            timeout=15,
        )
        conv_id = r.json()["id"]
        r2 = api.get(
            f"{BASE_URL}/api/mercurius/conversations/{conv_id}/messages", timeout=15
        )
        assert r2.status_code == 200
        assert r2.json() == []
        api.delete(f"{BASE_URL}/api/mercurius/conversations/{conv_id}", timeout=15)

    def test_delete_cascades_messages(self, api):
        # Use chat to create a conv with messages
        r = api.post(
            f"{BASE_URL}/api/mercurius/chat",
            json={"message": "TEST_delete_cascade — what is the bicone?"},
            timeout=60,
        )
        assert r.status_code == 200
        conv_id = r.json()["conversation_id"]
        # Confirm messages exist
        msgs = api.get(
            f"{BASE_URL}/api/mercurius/conversations/{conv_id}/messages", timeout=15
        ).json()
        assert len(msgs) >= 2
        # Delete
        d = api.delete(
            f"{BASE_URL}/api/mercurius/conversations/{conv_id}", timeout=15
        )
        assert d.status_code == 200
        # Conv gone from list
        convs = api.get(f"{BASE_URL}/api/mercurius/conversations", timeout=15).json()
        assert all(c["id"] != conv_id for c in convs)
        # Messages gone
        after = api.get(
            f"{BASE_URL}/api/mercurius/conversations/{conv_id}/messages", timeout=15
        ).json()
        assert after == []


# --- Chat --- #
class TestChat:
    def test_chat_empty_message_400(self, api):
        r = api.post(
            f"{BASE_URL}/api/mercurius/chat", json={"message": "   "}, timeout=15
        )
        assert r.status_code == 400

    def test_chat_creates_conversation_with_passages(self, api):
        start = time.time()
        r = api.post(
            f"{BASE_URL}/api/mercurius/chat",
            json={"message": "What is the bicone?"},
            timeout=60,
        )
        latency = time.time() - start
        assert r.status_code == 200, r.text
        assert latency < 30, f"chat latency too high: {latency:.1f}s"
        data = r.json()
        assert "conversation_id" in data
        assert "assistant_message" in data
        am = data["assistant_message"]
        assert am["role"] == "assistant"
        assert isinstance(am["content"], str) and len(am["content"]) > 0
        # passages with score > 0
        assert isinstance(data["passages"], list) and len(data["passages"]) >= 1
        assert data["passages"][0]["score"] > 0
        # cleanup
        api.delete(
            f"{BASE_URL}/api/mercurius/conversations/{data['conversation_id']}",
            timeout=15,
        )

    def test_chat_with_existing_conversation_appends(self, api):
        # Create conv
        c = api.post(
            f"{BASE_URL}/api/mercurius/conversations",
            json={"title": "TEST_append"},
            timeout=15,
        ).json()
        conv_id = c["id"]
        try:
            r = api.post(
                f"{BASE_URL}/api/mercurius/chat",
                json={"conversation_id": conv_id, "message": "Where am I?"},
                timeout=60,
            )
            assert r.status_code == 200
            assert r.json()["conversation_id"] == conv_id
            # Should be 2 messages (user + assistant)
            msgs = api.get(
                f"{BASE_URL}/api/mercurius/conversations/{conv_id}/messages",
                timeout=15,
            ).json()
            assert len(msgs) == 2
            assert msgs[0]["role"] == "user"
            assert msgs[1]["role"] == "assistant"
        finally:
            api.delete(
                f"{BASE_URL}/api/mercurius/conversations/{conv_id}", timeout=15
            )

    def test_chat_voice_quality(self, api):
        r = api.post(
            f"{BASE_URL}/api/mercurius/chat",
            json={"message": "What is π doing at the equator?"},
            timeout=60,
        )
        assert r.status_code == 200
        data = r.json()
        content = data["assistant_message"]["content"]
        lower = content.lower()
        # Should mention something from corpus vocabulary
        assert any(t in lower for t in ["π", "pi ", "equator", "paradox", "bicone"]), (
            f"voice quality fail — no expected term in: {content[:300]}"
        )
        # No sycophancy
        for bad in ["great question", "happy to help", "i'd be happy"]:
            assert bad not in lower, f"sycophancy detected: '{bad}'"
        # Length
        assert len(content) < 2500
        # Grounded
        assert len(data["passages"]) >= 1
        api.delete(
            f"{BASE_URL}/api/mercurius/conversations/{data['conversation_id']}",
            timeout=15,
        )
