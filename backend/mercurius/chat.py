"""Mercurius LLM chat module.

Non-streaming: uses emergentintegrations LlmChat with Claude Sonnet 4.5.
Streaming: bypasses LlmChat and calls litellm.acompletion(stream=True) directly
with the same Emergent-proxy parameters that LlmChat would set internally.
"""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import List, Dict, AsyncIterator

import litellm
from emergentintegrations.llm.chat import LlmChat, UserMessage
from emergentintegrations.llm.utils import get_integration_proxy_url

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_PATH = Path(__file__).parent / "system_prompt.md"
MODEL_NAME = "claude-sonnet-4-5-20250929"
PROVIDER = "anthropic"


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


def format_camera_note(camera: Dict | None) -> str | None:
    """Render a short italicized note describing the reader's current view.

    Expects {azimuth: float deg, elevation: float deg, region: str | None}.
    """
    if not camera:
        return None
    try:
        az = float(camera.get("azimuth"))
        el = float(camera.get("elevation"))
    except (TypeError, ValueError):
        return None
    region = camera.get("region") or ""

    # Build view phrase from elevation
    if el >= 70:
        view = "looking down the axis toward the Light pole — from here the bicone reads as a circle"
    elif el <= -70:
        view = "looking up the axis from below the Dark pole — from here the bicone also reads as a circle"
    elif el >= 45:
        view = "high above the equator, near the upper tip — the inversion edge"
    elif el <= -45:
        view = "well below the equator, near the lower tip"
    elif -10 <= el <= 10:
        if el > 3:
            lean = ", leaning slightly toward the Light pole"
        elif el < -3:
            lean = ", leaning slightly toward the Dark pole"
        else:
            lean = ", centered on the equator plane"
        view = f"looking across the equator{lean} — from here the bicone reads as a diamond"
    elif el > 0:
        view = "in the upper region, between the equator and the Light pole"
    else:
        view = "in the lower region, between the equator and the Dark pole"

    return (
        f"*(The reader is currently viewing the bicone from azimuth {az:.0f}°, "
        f"elevation {el:.0f}° — {view}. Closest named region: {region or 'unspecified'}.)*"
    )


def _build_messages(
    *,
    system_prompt: str,
    history: List[Dict[str, str]],
    user_text: str,
    retrieved_passages: List[Dict],
    camera_context: Dict | None,
) -> List[Dict[str, str]]:
    messages: List[Dict[str, str]] = [{"role": "system", "content": system_prompt}]
    for m in history:
        role = m.get("role")
        content = m.get("content", "")
        if role in ("user", "assistant") and content:
            messages.append({"role": role, "content": content})

    camera_note = format_camera_note(camera_context)
    user_block_parts = [user_text]
    if camera_note:
        user_block_parts.append("")
        user_block_parts.append(camera_note)
    user_block_parts.append("")
    user_block_parts.append("---")
    user_block_parts.append("")
    user_block_parts.append(_format_retrieved_passages(retrieved_passages))
    messages.append({"role": "user", "content": "\n".join(user_block_parts)})
    return messages


def _litellm_params(messages: List[Dict[str, str]], stream: bool) -> Dict:
    """Build params identical to what emergentintegrations.LlmChat would use,
    with our Emergent universal key routed through the integration proxy."""
    api_key = os.environ["EMERGENT_LLM_KEY"]
    params: Dict = {
        "model": MODEL_NAME,
        "messages": messages,
        "api_key": api_key,
        "stream": stream,
    }
    # Emergent universal keys go through the proxy as OpenAI-compatible.
    if api_key.startswith("sk-emergent-"):
        proxy_url = get_integration_proxy_url()
        params["api_base"] = proxy_url + "/llm"
        params["custom_llm_provider"] = "openai"
    return params


async def generate_response(
    *,
    conversation_id: str,
    user_text: str,
    retrieved_passages: List[Dict],
    history: List[Dict[str, str]],
    camera_context: Dict | None = None,
) -> str:
    """Non-streaming response (kept for backward-compat with /api/mercurius/chat).

    Uses LlmChat so existing behavior remains identical when no camera context
    is provided; falls back to direct litellm when camera context is present.
    """
    system_prompt = _load_system_prompt()

    # If camera context is present, we need to inject the note. Use direct
    # litellm path for consistency with the streaming endpoint.
    if camera_context is not None:
        messages = _build_messages(
            system_prompt=system_prompt,
            history=history,
            user_text=user_text,
            retrieved_passages=retrieved_passages,
            camera_context=camera_context,
        )
        params = _litellm_params(messages, stream=False)
        response = await litellm.acompletion(**params)
        return response.choices[0].message.content or ""

    # Default LlmChat path (unchanged)
    api_key = os.environ["EMERGENT_LLM_KEY"]
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
    ).with_model(PROVIDER, MODEL_NAME)

    grounded_text = (
        f"{user_text}\n\n---\n\n{_format_retrieved_passages(retrieved_passages)}"
    )
    return await chat.send_message(UserMessage(text=grounded_text))


async def generate_response_stream(
    *,
    user_text: str,
    retrieved_passages: List[Dict],
    history: List[Dict[str, str]],
    camera_context: Dict | None = None,
) -> AsyncIterator[str]:
    """Yield assistant tokens as they arrive from Claude.

    Each yielded value is a string token (may be empty). Callers should
    accumulate to get the full response and persist it once the iterator
    is exhausted.
    """
    system_prompt = _load_system_prompt()
    messages = _build_messages(
        system_prompt=system_prompt,
        history=history,
        user_text=user_text,
        retrieved_passages=retrieved_passages,
        camera_context=camera_context,
    )
    params = _litellm_params(messages, stream=True)
    response = await litellm.acompletion(**params)
    async for chunk in response:
        try:
            delta = chunk.choices[0].delta
        except (AttributeError, IndexError):
            continue
        token = getattr(delta, "content", None)
        if token:
            yield token
