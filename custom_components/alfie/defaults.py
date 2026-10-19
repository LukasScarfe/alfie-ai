"""Alfie's starter config: what a fresh install begins with.

Generic on purpose, so it means something in any house: the signals are
patterns over entity ids (a battery, a leak, a smoke alarm, an update), there
are no motion sensors yet, and Night is picked by hand until the panel's Get
started sets what tells Alfie it is night. Lukas's own house, which these
defaults used to be (see docs/design.md "Starter defaults"), is
devenv/house.json, loaded with `./dev house`.
"""

from __future__ import annotations

from .signals import Signal

SIGNALS: tuple[Signal, ...] = (
    Signal(id="low_battery", name="A battery is low", entities=("sensor.*_battery",),
           op="below", value=15, kind="bad", severity="major"),
    Signal(id="battery_warning", name="A battery-low warning is on",
           entities=("binary_sensor.*_battery_low",), op="is", value="on", kind="bad",
           severity="major"),
    Signal(id="water_leak", name="Water is leaking", entities=("binary_sensor.*leak*",),
           op="is", value="on", kind="bad", severity="critical"),
    Signal(id="smoke_alarm", name="A smoke or CO alarm is on",
           entities=("binary_sensor.*smoke*", "binary_sensor.*carbon_monoxide*"),
           op="is", value="on", kind="bad", severity="critical"),
    Signal(id="update", name="An update is available", entities=("update.*",),
           op="is", value="on", kind="bad", severity="minor"),
)

# The sleep entity a version 2 config had when it never set one (Lukas's,
# from before house modes); migrate_v2 turns it into the Night mode.
V2_SLEEP_ENTITY = "switch.global_sleep_switches"
SLEEP_EXPRESSION = "closed"

# Motion sensor -> what Alfie does when it turns on. "notice" picks one of
# NOTICE at random: someone is in the room he is in. Get started fills it.
MOTION_SENSORS: tuple[tuple[str, str], ...] = ()
NOTICE = ("glance_left", "glance_right", "look_around", "double_take")
MOTION_DEBOUNCE = 20.0          # seconds: a run of motion across rooms is one glance

IDLE_FIDGETS = ("squint", "eye_roll", "scan", "glance_left", "glance_right", "sigh",
                "look_around")
IDLE_INTERVAL = 180.0           # seconds between fidgets at content energy

# Stories and the triggers that play them (see stories.py, triggers.py). They
# reproduce M1's reactions (a startle when something turns critical, a nod
# when something is fixed, wake_up on waking) and add design.md's mood-change
# and bad-news stories. One change plays one story, the highest priority.
ON_CRITICAL = "startle"
ON_RECOVER = "nod"
ON_WAKE = "wake_up"
# What Alfie plays when he appears in a rotation (an Alfie step, or between
# screens): the bad story while something is wrong, otherwise the ok one.
APPEAR_STORY_BAD = "bad_news"
APPEAR_STORY_OK = "hello"


def _morph() -> list[dict]:
    """The visible mood change: the old mood's face, then a slow blend to the new."""
    return [{"kind": "expression", "name": "@old_mood", "hold": 1, "blend": 0},
            {"kind": "expression", "name": "@mood", "hold": 1.5, "blend": 1.5}]


def _screen(which: str) -> dict:
    return {"kind": "screen", "screen": which, "seconds": 12, "present": "card",
            "transition": ""}


def _anim(name: str) -> dict:
    return {"kind": "animation", "name": name, "wait": True}


SIMPLE = {"expression": "", "animation": "", "icon": "", "icon_style": "transform",
          "screen": "@why", "seconds": 15, "present": "card", "transition": "", "closing": ""}

STORIES: tuple[dict, ...] = (
    {"id": "alarm", "name": "Alarm", "form": "steps", "simple": dict(SIMPLE),
     "steps": [_anim(ON_CRITICAL), _screen("@wrong"), _anim("shake")]},
    {"id": "bad_news", "name": "Bad news", "form": "steps", "simple": dict(SIMPLE),
     "steps": [*_morph(), _screen("@wrong"), _anim("shake")]},
    {"id": "mood_change", "name": "Mood change", "form": "steps", "simple": dict(SIMPLE),
     "steps": [*_morph(), _screen("@why"), _anim("nod")]},
    {"id": "celebrate", "name": "Celebrate the fix", "form": "steps",
     "simple": dict(SIMPLE),
     "steps": [{"kind": "expression", "name": "happy", "hold": 0.5, "blend": 0},
               _anim(ON_RECOVER), _anim("laugh"), {"kind": "wait", "seconds": 1.5}]},
    {"id": "wake_up", "name": "Wake up", "form": "simple",
     "simple": {**SIMPLE, "animation": ON_WAKE, "screen": ""}, "steps": []},
    {"id": "hello", "name": "Hello", "form": "steps", "simple": dict(SIMPLE),
     "steps": [{"kind": "expression", "name": "@mood", "hold": 1.5, "blend": 0}, _screen("@why"),
               _anim("nod")]},
    {"id": "welcome_home", "name": "Welcome home", "form": "steps", "simple": dict(SIMPLE),
     "steps": [_anim(ON_WAKE), {"kind": "expression", "name": "happy", "hold": 1.5, "blend": 0},
               _anim("nod")]},
)


def _trigger(tid: str, name: str, kind: str, story: str, priority: int, **fields) -> dict:
    return {"id": tid, "name": name, "enabled": True, "kind": kind, "story": story,
            "priority": priority, "busy": "auto", "cooldown": 0, "while_asleep": False,
            "moods": [], **fields}


TRIGGERS: tuple[dict, ...] = (
    _trigger("critical", "Something turns critical", "mood", "alarm", 90,
             direction="worse", **{"from": [], "to": ["miserable"]}),
    _trigger("mood_worse", "Mood gets worse", "mood", "bad_news", 50,
             direction="worse", **{"from": [], "to": []}),
    _trigger("fixed", "Something bad is fixed", "signal", "celebrate", 45,
             signals=[], edge="recovers"),
    _trigger("mood_better", "Mood gets better", "mood", "mood_change", 40,
             direction="better", **{"from": [], "to": []}),
    _trigger("wake", "Waking up", "wake", "wake_up", 30, edge="wakes"),
    _trigger("welcome", "Welcome home", "mode", "welcome_home", 60, modes=["away"], edge="leave"),
)

# House modes (modes.py), first match wins. Night has no condition until Get
# started (or the user) gives it one; away is zone.home's count of people home
# dropping below 1, which every house has.
AWAY_ENTITY = "zone.home"


def _mode(mid: str, name: str, condition: dict | None, **over) -> dict:
    return {"id": mid, "name": name, "enabled": True, "condition": condition,
            "alfie": "awake", "wake": "critical", "hold_back": "none",
            "mood_floor": "", "mood_fixed": "", "personality": "", "energy_bias": None,
            "fidget_rate": None, "rotation": "", "triggers_off": [], **over}


def night_mode(entity: str = "") -> dict:
    cond = {"entities": [entity], "match": "any", "op": "is", "value": "on"} if entity else None
    return _mode("night", "Night", cond, alfie="asleep")


MODES: tuple[dict, ...] = (
    night_mode(),
    _mode("away", "Away", {"entities": [AWAY_ENTITY], "match": "any", "op": "below", "value": 1},
          alfie="quiet", triggers_off=["mood_worse", "fixed", "mood_better", "wake"]),
)
