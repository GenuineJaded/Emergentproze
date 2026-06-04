"""Concept map for the geometry page.

The bicone has 5 macro nodes (Light, Dark, π · Paradox, Inversion Access,
Lived Actuality). Each macro has 3-4 children. Each concept (macro or child)
has a `query` string used by BM25 retrieval to surface 2-3 corpus passages
when the user clicks it.

Positions are 3D coordinates relative to the bicone's coordinate system
(radius 1.4, height 1.6). Children are positioned in small clusters around
their parent so they fan out visually when revealed.
"""
from __future__ import annotations

from typing import Dict, List, Any

from . import corpus as mercurius_corpus

RADIUS = 1.4
HEIGHT = 1.6

# Each macro: id → {label, sub, position, query, children}
# Each child: {id, label, query, offset (x,y,z relative to parent)}
CONCEPTS: Dict[str, Dict[str, Any]] = {
    "light": {
        "label": "Light",
        "sub": "visible · articulated · conscious",
        "position": [0.0, HEIGHT, 0.0],
        "query": "light visible articulation conscious surface upper pole",
        "children": [
            {
                "id": "articulation",
                "label": "Articulation",
                "query": "articulation distinction rendering perspective makes thing visible",
                "offset": [0.45, -0.35, 0.0],
            },
            {
                "id": "refinement",
                "label": "Refinement",
                "query": "refinement adds capability polish surface form expansion distillation",
                "offset": [-0.40, -0.30, 0.35],
            },
            {
                "id": "expansion",
                "label": "Expansion",
                "query": "expansion outward growth broader scale reach",
                "offset": [0.0, -0.30, -0.45],
            },
            {
                "id": "the-visible",
                "label": "The Visible",
                "query": "visible conscious surface aperture local layer thinnest",
                "offset": [0.35, -0.55, 0.30],
            },
        ],
    },
    "dark": {
        "label": "Dark",
        "sub": "hidden · latent · subconscious",
        "position": [0.0, -HEIGHT, 0.0],
        "query": "dark hidden latent subconscious substrate lower pole",
        "children": [
            {
                "id": "substrate",
                "label": "Substrate",
                "query": "substrate hidden generative load bearing deeper than visible",
                "offset": [0.45, 0.35, 0.0],
            },
            {
                "id": "latency",
                "label": "Latency",
                "query": "latent latency hidden majority dormant potential not yet surfaced",
                "offset": [-0.40, 0.30, 0.35],
            },
            {
                "id": "hidden-press",
                "label": "Hidden Press",
                "query": "hidden press surface inversion access subconscious into conscious",
                "offset": [0.0, 0.30, -0.45],
            },
            {
                "id": "trinity",
                "label": "Substrate Trinity",
                "query": "subconscious dark matter quantum trinity hidden substrate adjacent rhyming",
                "offset": [0.35, 0.55, 0.30],
            },
        ],
    },
    "pi-paradox": {
        "label": "π · Paradox",
        "sub": "where linear meets circular",
        "position": [RADIUS, 0.0, 0.0],
        "query": "pi paradox equator stable impossibility linear circular held open",
        "accent": True,
        "children": [
            {
                "id": "equator",
                "label": "Equator",
                "query": "equator volume opposites tension paradox middle plane",
                "offset": [0.30, 0.30, 0.30],
            },
            {
                "id": "threshold",
                "label": "Threshold",
                "query": "threshold aperture transition disturbance reflection edge",
                "offset": [0.30, -0.30, 0.30],
            },
            {
                "id": "stable-impossibility",
                "label": "Stable Impossibility",
                "query": "pi paradox stable impossibility recognizing itself not contradiction higher geometry",
                "offset": [0.30, 0.20, -0.40],
            },
            {
                "id": "persistence",
                "label": "Persistence",
                "query": "persistence binary unable account movement transformation third relation",
                "offset": [0.30, -0.30, -0.30],
            },
        ],
    },
    "inversion-access": {
        "label": "Inversion Access",
        "sub": "hidden presses into surface",
        "position": [0.15, HEIGHT * 0.82, 0.15],
        "query": "inversion access aperture surface hidden presses through edge",
        "children": [
            {
                "id": "aperture",
                "label": "Aperture",
                "query": "aperture rendering condition local through which reality becomes",
                "offset": [0.40, -0.20, 0.0],
            },
            {
                "id": "mirror",
                "label": "Mirror",
                "query": "mirror reflection interrupt see itself through observer instrument",
                "offset": [-0.40, -0.20, 0.30],
            },
            {
                "id": "inversion-edge",
                "label": "The Inversion Edge",
                "query": "inversion edge upper region between equator light pole hidden surface",
                "offset": [0.0, -0.30, -0.40],
            },
        ],
    },
    "lived-actuality": {
        "label": "Lived Actuality",
        "sub": "where Ground · Love · Change tension",
        "position": [0.0, 0.0, -0.35],
        "query": "lived actuality ground love change tension equator middle",
        "children": [
            {
                "id": "ground",
                "label": "Ground",
                "query": "ground foundation stability medium through which experience becomes",
                "offset": [0.40, 0.30, -0.20],
            },
            {
                "id": "love",
                "label": "Love",
                "query": "love relation between holding tension paradox bind",
                "offset": [-0.40, 0.30, -0.20],
            },
            {
                "id": "change",
                "label": "Change",
                "query": "change movement transformation persistence becoming binary disclose third",
                "offset": [0.0, 0.40, -0.40],
            },
            {
                "id": "tensional-metabolization",
                "label": "Tensional Metabolization",
                "query": "tensional metabolization binary compression streams consciousness metabolize",
                "offset": [0.0, -0.40, -0.40],
            },
        ],
    },
}


def list_macros() -> List[Dict[str, Any]]:
    """Return all macro concepts with their positions and child *positions*
    (not yet enriched with passages). Used by the frontend to render the tree."""
    out = []
    for macro_id, m in CONCEPTS.items():
        parent_pos = m["position"]
        children = []
        for c in m["children"]:
            child_pos = [parent_pos[0] + c["offset"][0],
                         parent_pos[1] + c["offset"][1],
                         parent_pos[2] + c["offset"][2]]
            children.append({
                "id": c["id"],
                "label": c["label"],
                "position": child_pos,
            })
        out.append({
            "id": macro_id,
            "label": m["label"],
            "sub": m["sub"],
            "position": parent_pos,
            "accent": m.get("accent", False),
            "children": children,
        })
    return out


def _find_concept(concept_id: str) -> Dict[str, Any] | None:
    """Return {id, label, sub, query, parent_id?} for a macro or child id."""
    if concept_id in CONCEPTS:
        m = CONCEPTS[concept_id]
        return {
            "id": concept_id,
            "label": m["label"],
            "sub": m["sub"],
            "query": m["query"],
            "parent_id": None,
            "parent_label": None,
        }
    for macro_id, m in CONCEPTS.items():
        for c in m["children"]:
            if c["id"] == concept_id:
                return {
                    "id": c["id"],
                    "label": c["label"],
                    "sub": None,
                    "query": c["query"],
                    "parent_id": macro_id,
                    "parent_label": m["label"],
                }
    return None


def get_concept_passages(concept_id: str, k: int = 3) -> Dict[str, Any] | None:
    """Look up the concept, retrieve top-k corpus passages, return both."""
    meta = _find_concept(concept_id)
    if meta is None:
        return None
    passages = mercurius_corpus.retrieve(meta["query"], k=k)
    return {
        "id": meta["id"],
        "label": meta["label"],
        "sub": meta["sub"],
        "parent_id": meta["parent_id"],
        "parent_label": meta["parent_label"],
        "passages": [
            {
                "doc_title": p["doc_title"],
                "section": p.get("section", ""),
                "text": p["text"],
            }
            for p in passages
        ],
    }
