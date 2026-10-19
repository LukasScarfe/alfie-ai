"""Get started's suggestions: signals, motion sensors and a sleep entity
picked from what the house has.

PURE (no HA import), so the tests run under plain python. `suggest` makes
one pass over the states it is given (the panel asks once when the Overview
opens) and skips whatever the config already covers.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from typing import Any

from .signals import matching

MAX_SIGNALS = 30
MOTION_CLASSES = ("motion", "occupancy", "presence")
OPENING_CLASSES = {"door": "door", "window": "window", "garage_door": "garage door"}
SLEEP_WORDS = ("sleep", "bed", "night")


def _name(entity_id: str, attrs: Mapping[str, Any]) -> str:
    name = str(attrs.get("friendly_name") or entity_id.split(".", 1)[-1].replace("_", " "))
    return name[:1].upper() + name[1:]


def _signal(entity_id: str, name: str, op: str, value: Any, severity: str,
            why: str) -> dict[str, Any]:
    return {"name": name, "entities": [entity_id], "op": op, "value": value, "kind": "bad",
            "severity": severity, "why": why}


def suggest(states: Iterable[tuple[str, str, Mapping[str, Any]]],
            config: Mapping[str, Any]) -> dict[str, list[dict[str, Any]]]:
    """`states` is (entity_id, state, attributes) for every entity."""
    states = list(states)
    ids = [e for e, _, _ in states]
    covered = set(matching([p for s in config.get("signals", []) for p in s["entities"]], ids))
    motion_have = {m["entity"] for m in config.get("behaviour", {}).get("motion_sensors", [])}
    sigs: list[dict[str, Any]] = []
    motion: list[dict[str, Any]] = []
    sleep: list[dict[str, Any]] = []
    for eid, _state, attrs in states:
        domain = eid.split(".", 1)[0]
        dc = attrs.get("device_class")
        name = _name(eid, attrs)
        if domain == "binary_sensor" and dc in MOTION_CLASSES and eid not in motion_have:
            motion.append({"entity": eid, "name": name})
        if domain in ("input_boolean", "switch") and any(
                w in f"{eid} {name}".lower() for w in SLEEP_WORDS):
            sleep.append({"entity": eid, "name": name})
        if eid in covered or len(sigs) >= MAX_SIGNALS:
            continue
        if domain == "sensor" and dc == "moisture":
            sigs.append(_signal(eid, f"{name} is low", "below", 20, "major", "moisture sensor"))
        elif domain == "sensor" and dc == "battery":
            sigs.append(_signal(eid, f"{name} is low", "below", 15, "major", "battery"))
        elif domain == "binary_sensor" and dc in OPENING_CLASSES:
            sigs.append(_signal(eid, f"{name} is open", "is", "on", "minor",
                                f"{OPENING_CLASSES[dc]} sensor"))
        elif domain == "binary_sensor" and dc == "problem":
            sigs.append(_signal(eid, f"{name} reports a problem", "is", "on", "major",
                                "problem sensor"))
    key = lambda d: d["name"].lower()   # noqa: E731
    return {"signals": sigs, "motion": sorted(motion, key=key), "sleep": sorted(sleep, key=key)}
