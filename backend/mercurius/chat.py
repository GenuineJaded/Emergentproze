"""Mercurius LLM chat module.

Uses emergentintegrations LlmChat with Claude Sonnet 4.5 via the Emergent universal key.
"""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import List, Dict

from emergentintegrations.llm.chat import LlmChat, UserMessage

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_PATH = Path(__file__).parent / "system_prompt.md"
MODEL_NAME = "claude-sonnet-4-5-20250929"


def _load_system_prompt() -> str:
    return SYSTEM_PROMPT_PATH.read_text(encoding="utf-8")


def _format_retrieved_passages(passages: List[Dict]) -> str:
    if not passages:
        return "## Retrieved corpus passages\n\n(no passages retrieved — speak from corpus vocabulary only, or acknowledge that the map runs out here)"
    lines = ["## Retrieved corpus passages\n"]
    for i, p in enumerate(passages, 1):
        section = f" — *{p['section']}*" if p.get("section") else ""
        lines.append(f"### Passage {i} (from *{p['doc_title']}*{section})")
        lines.append("")
        lines.append(p["text"])
        lines.append("")
    return "\n".join(lines)


async def generate_response(
    *,
    conversation_id: str,
    user_text: str,
    retrieved_passages: List[Dict],
    history: List[Dict[str, str]],
) -> str:
    """Generate a Mercurius response.

    history: list of {role, content} for prior turns (excluding the current user_text).
    """
    api_key = os.environ["EMERGENT_LLM_KEY"]
    system_prompt = _load_system_prompt()

    # Convert prior history into the initial_messages format that LlmChat expects.
    # The library will append messages to this list as the conversation goes.
    initial_messages: List[Dict[str, str]] = []
    for m in history:
        role = m.get("role")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            initial_messages.append({"role": role, "content": content})

    chat = LlmChat(
        api_key=api_key,
        session_id=conversation_id,
        system_message=system_prompt,
        initial_messages=initial_messages if initial_messages else None,
    ).with_model("anthropic", MODEL_NAME)

    grounded_text = (
        f"{user_text}\n\n"
        f"---\n\n"
        f"{_format_retrieved_passages(retrieved_passages)}"
    )
    msg = UserMessage(text=grounded_text)
    response = await chat.send_message(msg)
    return response
