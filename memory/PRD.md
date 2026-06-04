# Mercurius / The Living Sketch — PRD

## Status
**Phase 1 (compressed) — `m`-shortcut + streaming added.** Voice tuned. Single-user contemplative instrument.

## Original problem statement (verbatim, condensed)
> Phase 0 is a **proof-of-concept** isolating the two risky pieces. Do not build the full atlas yet. Do not build full polish. Build just enough to prove these two things work:
> 1. A 3D bicone that demonstrates its own thesis — moving the camera changes what the shape is.
> 2. A grounded LLM companion ("Mercurius") whose voice does not sound generic.
> If either of these does not work, we course-correct before going further.

Full brief preserved verbatim in the conversation history; corpus saved to `/app/backend/corpus/`.

## Architecture (Phase 0)
- **Frontend**: React 19 (CRA + craco), `@react-three/fiber`, `@react-three/drei`, `three`. Routes: `/`, `/geometry`, `/mercurius` (also `/companion`).
- **Backend**: FastAPI as a single Vercel Python serverless function (`api/index.py`). Stateless — no database. Conversation history flows up from the client per request. LLM calls via `litellm` against OpenRouter's OpenAI-compatible endpoint. Module layout: `lib/mercurius/{system_prompt.md, corpus.py, chat.py, concepts.py, voice_test_outputs.md}`.
- **Retrieval**: BM25 over 45 chunks across the 6 corpus documents (`rank-bm25`), section-heading-aware paragraph chunking, light suffix-stemming + lowercase tokenization. Index is built in-process at module import time from disk (no DB).
- **Conversation persistence**: client-side localStorage. Each visitor's threads live in their browser; no accounts, no profiles, no server-side persistence.
- **No auth, no analytics, no third-party trackers.**

## Implemented (2026-05-23)
- Home page (`/`) — quiet typography, EB Garamond serif body, Inter Tight UI chrome, Fraunces italic wordmark.
- Geometry page (`/geometry`) — bicone (BufferGeometry, hand-built so equator sits exactly at y=0), warm/cool vertical-gradient surface, wireframe overlay, equator ring, polar axis, 5 labeled nodes (Light / Dark / π · Paradox / Inversion access / Lived Actuality), ambient breathing rotation (~60 s/rev, pauses on interact, resumes after 2.5 s idle), OrbitControls with damping, "orbit to change what this is" hint that fades on first interact. Camera-perspective thesis demonstrated: top-down → circle, side → diamond.
- Mercurius page (`/mercurius`) — chat UI, welcome message, 6-prompt starter dropdown, multi-thread sidebar with delete, light markdown rendering (blockquotes, italics, bold, code), optimistic user messages, breathing "listening" indicator, error surface.
- Backend endpoints:
  - `GET /api/health` → `{status, corpus_chunks}`
  - `POST /api/mercurius/ingest` → idempotent corpus rebuild
  - `GET /api/mercurius/conversations` → list (sorted by `updated_at` desc)
  - `POST /api/mercurius/conversations` → create
  - `GET /api/mercurius/conversations/{id}/messages` → list
  - `DELETE /api/mercurius/conversations/{id}` → cascade delete messages
  - `POST /api/mercurius/chat` → retrieves top-5 passages, sends to Claude with system prompt + history, persists user/assistant messages, returns assistant + passages
- System prompt (`/app/backend/mercurius/system_prompt.md`) — Hermes 60% / Trickster 25% / Nietzsche 15% blend, explicit do/don't list, 3 few-shot exemplars.
- Voice calibration outputs (`/app/backend/mercurius/voice_test_outputs.md`) — all 6 brief-specified prompts with full responses + retrieved-passage scoring.
- Corpus: 6 markdown documents in `corpus/`.

## Acceptance criteria (Phase 0) — status
- [x] Home page with two clear links
- [x] `/geometry` bicone, orbit, 5 labeled nodes
- [x] Top-down → circle silhouette; side → diamond silhouette (verified via screenshots)
- [x] Ambient breathing rotation, pauses on interact
- [x] `/mercurius` chat UI with welcome + 6 dropdown prompts
- [x] `POST /api/mercurius/chat` retrieves passages and returns a voiced response
- [x] All 6 voice test outputs saved
- [x] System prompt saved
- [x] All 6 corpus documents downloaded as text
- [x] No telemetry, no analytics, no third-party trackers
- [x] Aesthetic: dark/quiet/literary, not flashy

## Out of scope for Phase 0 (DO NOT BUILD)
- Full atlas with all concepts
- Inversion-view / failure-mode lens
- Editing the corpus through the UI
- User accounts, sharing, multi-user
- Mobile responsiveness beyond "doesn't break"
- Reading mode with hyperlinked passages

## Prioritized backlog (after Phase 0 review)
**P0 (only if Phase 0 voice/geometry passes review)**
- Inversion-view lens on the bicone (visual mode switch)
- Hyperlinked corpus reader at `/atlas` with passage navigation
- Passage-bound citations in Mercurius responses (link inline quotes to source location)

**P1**
- Atlas page enumerating all corpus concepts as a navigable map
- Streaming chat responses (SSE) for slower-than-3-seconds Claude calls
- Conversation export (markdown)
- Mobile responsive layout

**P2**
- Reading mode with cross-document concept-graph
- Editable corpus through the UI (with audit log)
- Conversation search

## Things to surface to the user in the finish summary
- Voice samples from the 6 prompts (in voice_test_outputs.md)
- Decision log: BM25 instead of embeddings — corpus vocabulary is sharp enough at this scale; no embedding model needed
- Decision log: visual-edits babel plugin disabled (it injects `x-*` props that break r3f and contradicts the no-trackers clause)
