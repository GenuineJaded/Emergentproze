"""Mercurius LLM chat module.

Both streaming and non-streaming go through litellm.acompletion directly.
The chat is stateless — the caller passes in conversation history (the client
keeps it in localStorage). No server-side persistence.

Provider selection:
- If OPENROUTER_API_KEY is set, route through OpenRouter's OpenAI-compatible
  endpoint. MERCURIUS_MODEL should be an OpenRouter slug like
  "anthropic/claude-sonnet-4.5" or a ":free" tier model id.
- Else if EMERGENT_LLM_KEY is set (starts with sk-emergent-), route through
  the Emergent integration proxy (legacy / dev-only).
"""
from __future__ import annotations

import os
import logging
from pathlib import Path
from typing import List, Dict, AsyncIterator

import litellm

logger = logging.getLogger(__name__)

SYSTEM_PROMPT_PATH = Path(__file__).parent / "system_prompt.md"
DEFAULT_MODEL = os.environ.get("MERCURIUS_MODEL", "claude-sonnet-4-5-20250929")


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
    if not camera:
        return None
    try:
        az = float(camera.get("azimuth"))
        el = float(camera.get("elevation"))
    except (TypeError, ValueError):
        return None
    region = camera.get("region") or ""

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
    params: Dict = {
        "model": DEFAULT_MODEL,
        "messages": messages,
        "stream": stream,
    }

    openrouter_key = os.environ.get("OPENROUTER_API_KEY")
    emergent_key = os.environ.get("EMERGENT_LLM_KEY")

    if openrouter_key:
        params["api_key"] = openrouter_key
        params["api_base"] = "https://openrouter.ai/api/v1"
        params["custom_llm_provider"] = "openai"
        return params

    if emergent_key and emergent_key.startswith("sk-emergent-"):
        from emergentintegrations.llm.utils import get_integration_proxy_url
        params["api_key"] = emergent_key
        params["api_base"] = get_integration_proxy_url() + "/llm"
        params["custom_llm_provider"] = "openai"
        return params

    raise RuntimeError(
        "No LLM key configured. Set OPENROUTER_API_KEY or EMERGENT_LLM_KEY."
    )


async def generate_response(
    *,
    user_text: str,
    retrieved_passages: List[Dict],
    history: List[Dict[str, str]],
    camera_context: Dict | None = None,
) -> str:
    """Non-streaming response."""
    system_prompt = _load_system_prompt()
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


async def generate_response_stream(
    *,
    user_text: str,
    retrieved_passages: List[Dict],
    history: List[Dict[str, str]],
    camera_context: Dict | None = None,
) -> AsyncIterator[str]:
    """Yield assistant tokens as they arrive."""
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
