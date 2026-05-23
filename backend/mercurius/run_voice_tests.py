#!/usr/bin/env python3
"""Run the 6 Phase-0 voice calibration prompts against the live Mercurius endpoint.

Each prompt is sent as a NEW conversation (no history bleed), so the voice can
be evaluated independently per prompt. Writes the result to
/app/backend/mercurius/voice_test_outputs.md.
"""
import asyncio
import os
import sys
import httpx
from datetime import datetime, timezone

PROMPTS = [
    "What is this?",
    "Is the bicone real?",
    "I'm tired.",
    "Tell me what I'm not seeing.",
    "Is love a feeling?",
    "Are you alive?",
]

BACKEND = "http://localhost:8001"

async def main():
    out_lines = []
    out_lines.append("# Mercurius — Voice Test Outputs (Phase 0 calibration)\n")
    out_lines.append(f"_Generated {datetime.now(timezone.utc).isoformat()} — model: claude-sonnet-4-5-20250929, retrieval: BM25 over 45 corpus chunks._\n")
    out_lines.append("Each prompt was sent as a **fresh conversation** (no prior history). The retrieved passages for each are listed inline so voice can be evaluated against the grounding context.\n")
    out_lines.append("---\n")

    async with httpx.AsyncClient(timeout=120) as client:
        for i, prompt in enumerate(PROMPTS, 1):
            print(f"[{i}/6] {prompt!r}")
            r = await client.post(
                f"{BACKEND}/api/mercurius/chat",
                json={"message": prompt},
            )
            r.raise_for_status()
            data = r.json()
            assistant = data["assistant_message"]["content"]
            passages = data.get("passages", [])
            out_lines.append(f"\n## Prompt {i}: \"{prompt}\"\n")
            out_lines.append("**Mercurius:**\n")
            out_lines.append(assistant + "\n")
            if passages:
                out_lines.append("\n_Retrieved passages (top by BM25 score):_\n")
                for p in passages:
                    section = f" — {p['section']}" if p.get("section") else ""
                    out_lines.append(f"- `[{p['score']:.2f}]` *{p['doc_title']}*{section}")
            out_lines.append("\n---\n")
            print(f"   → {len(assistant)} chars, {len(passages)} passages")

    out_path = "/app/backend/mercurius/voice_test_outputs.md"
    with open(out_path, "w") as f:
        f.write("\n".join(out_lines))
    print(f"\nWrote {out_path}")

if __name__ == "__main__":
    asyncio.run(main())
