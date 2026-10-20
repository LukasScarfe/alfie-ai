"""What an automation can pick in Alfie's actions, from the config.

PURE (no HA import). services.py lays these over services.yaml with
async_set_service_schema whenever the config changes, so the automation
editor offers your own screens, stories, rotations, modes, signals and
triggers by name in a dropdown. Every list takes a typed value too
(custom_value), so templates still work.
"""

from __future__ import annotations

from collections.abc import Mapping
from typing import Any

from .mood import LEVELS
from .modes import ALFIE_STATES, AUTO, NORMAL, PAUSE


def _human(s: str) -> str:
    t = s.replace("_", " ")
    return t[:1].upper() + t[1:]


def _named(items: Any, name_key: str) -> list[dict[str, str]]:
    return [{"value": x["id"], "label": f"{x.get(name_key) or x['id']} ({x['id']})"} for x in items]


def _select(options: list[dict[str, str]]) -> dict[str, Any]:
    return {"select": {"options": options, "custom_value": True, "mode": "dropdown"}}


def choices(cfg: Mapping[str, Any], face: Mapping[str, Any]) -> dict[str, dict[str, Any]]:
    """{service: {field: selector}} for every field whose options come from
    the config or the face."""
    auto = [{"value": AUTO, "label": "Auto (let go)"}]
    plain = lambda xs: [{"value": x, "label": _human(x)} for x in xs]   # noqa: E731
    switchable = [{"value": f"{k}.{x['id']}", "label": f"{label}: {x.get('name') or x['id']}"}
                  for k, sec, label in (("signal", "signals", "Signal"), ("trigger", "triggers", "Trigger"))
                  for x in cfg.get(sec, [])]
    return {
        "set_expression": {"expression": _select(auto + plain(sorted(face.get("expressions", {}))))},
        "play_animation": {"animation": _select(plain(sorted(face.get("animations", {}))))},
        "show_screen": {"screen": _select(_named(cfg.get("screens", []), "title"))},
        "play_story": {"story": _select(_named(cfg.get("stories", []), "name"))},
        "set_mode": {"mode": _select([{"value": AUTO, "label": "Auto (follow the conditions)"},
                                      {"value": NORMAL, "label": "Normal (no mode)"},
                                      *_named(cfg.get("modes", []), "name")])},
        "show_rotation": {"rotation": _select([{"value": AUTO, "label": "Auto (the cards' own)"},
                                               {"value": PAUSE, "label": "Pause (hold the current step)"},
                                               *_named(cfg.get("rotations", []), "name")])},
        "set_mood": {"level": _select(auto + plain(reversed(LEVELS)))},
        "set_alfie": {"state": _select(auto + plain(ALFIE_STATES))},
        "set_personality": {"preset": _select(auto + plain(sorted(face.get("personalities") or {})))},
        "set_enabled": {"item": _select(switchable)},
    }
