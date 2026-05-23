#!/usr/bin/env python3
"""Regenerate ONLY prompt 2 ('Is the bicone real?') with the voice-tuned
system prompt and append the new response to voice_test_outputs.md.

Fresh conversation, no history bleed.
"""
import asyncio
import httpx
from datetime import datetime, timezone

BACKEND = "http://localhost:8001"
PROMPT = "Is the bicone real?"

async def main():
    async with httpx.AsyncClient(timeout=120) as client:
        r = await client.post(
            f"{BACKEND}/api/mercurius/chat",
            json={"message": PROMPT},
        )
        r.raise_for_status()
        data = r.json()
        assistant = data["assistant_message"]["content"]
        passages = data.get("passages", [])

    block = [
        "",
        "## Prompt 2 (regenerated after voice tuning)",
        f"\n_Regenerated {datetime.now(timezone.utc).isoformat()} — fresh conversation, system prompt now includes the 'On the reality of the geometry' section that refuses the abstract/physical dualism._\n",
        "**Mercurius:**\n",
        assistant + "\n",
    ]
    if passages:
        block.append("\n_Retrieved passages (top by BM25 score):_\n")
        for p in passages:
            section = f" — {p['section']}" if p.get("section") else ""
            block.append(f"- `[{p['score']:.2f}]` *{p['doc_title']}*{section}")
    block.append("\n---\n")
    out_path = "/app/backend/mercurius/voice_test_outputs.md"
    with open(out_path, "a") as f:
        f.write("\n".join(block))
    print(f"Appended {len(assistant)} chars to {out_path}")
    print("\n=== NEW RESPONSE ===\n")
    print(assistant)

if __name__ == "__main__":
    asyncio.run(main())
