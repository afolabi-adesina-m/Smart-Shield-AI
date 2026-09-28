"""Street names for turn-by-turn previews. Additive to the directions payload."""

from __future__ import annotations

import re

UNNAMED_ROAD = "Unnamed road"
_HIGHWAY_REF = re.compile(r"\d{1,4}[A-Z]?$")

_MODIFIERS = {
    "left": "Turn left onto",
    "right": "Turn right onto",
    "slight left": "Bear left onto",
    "slight right": "Bear right onto",
    "straight": "Continue on",
    "uturn": "Make a U-turn onto",
}


def road_label(name: str | None, ref: str | None = None) -> str:
    """Prefer the OSRM street name, then a highway ref, else a fixed fallback."""
    cleaned = (name or "").strip()
    if cleaned:
        return cleaned
    road_ref = (ref or "").strip()
    if _HIGHWAY_REF.fullmatch(road_ref):
        return f"Hwy {road_ref}"
    if road_ref:
        return road_ref
    return UNNAMED_ROAD


def step_instruction(kind: str | None, modifier: str | None, label: str) -> str:
    maneuver = (kind or "").replace("_", " ").replace("-", " ").strip().lower()
    turn = (modifier or "").strip().lower()
    if maneuver == "depart":
        return f"Head onto {label}"
    if maneuver == "arrive":
        return f"Arrive · {label}"
    lead = _MODIFIERS.get(turn)
    if lead:
        return f"{lead} {label}"
    return f"Continue on {label}"


def steps_from_route(route: dict) -> list[dict]:
    """Pull named maneuvers out of one OSRM route. Overview geometry is untouched."""
    steps: list[dict] = []
    for leg in route.get("legs") or []:
        for step in leg.get("steps") or []:
            maneuver = step.get("maneuver") or {}
            location = maneuver.get("location")
            if not (isinstance(location, list) and len(location) >= 2):
                location = None
            geometry = ((step.get("geometry") or {}).get("coordinates")) or []
            if not isinstance(geometry, list):
                geometry = []
            if location is None and geometry:
                location = geometry[0]
            if location is None and not geometry:
                continue
            label = road_label(step.get("name"), step.get("ref"))
            steps.append({
                "name": label,
                "distance": step.get("distance") or 0,
                "location": location,
                "geometry": geometry,
                "type": maneuver.get("type") or "",
                "modifier": maneuver.get("modifier") or "",
                "instruction": step_instruction(maneuver.get("type"), maneuver.get("modifier"), label),
            })
    return steps
