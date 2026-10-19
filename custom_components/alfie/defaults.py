"""Lukas's house as Alfie's reference defaults, ported from the production
`sensor.superintendent_mood` ladder and the `Superintendent:` automations
(see docs/design.md "Defaults ported from Lukas's house").

Hard-coded for milestone 1. Milestone 2 moves signals and the gaze map into
the panel and HA's Store, with these as the seed.
"""

from __future__ import annotations

from .signals import Signal

NAS_SENSORS = (
    "binary_sensor.scarfe_218j_drive_1_exceeded_max_bad_sectors",
    "binary_sensor.scarfe_218j_drive_2_exceeded_max_bad_sectors",
    "binary_sensor.scarfe_218j_drive_1_below_min_remaining_life",
    "binary_sensor.scarfe_218j_drive_2_below_min_remaining_life",
    "binary_sensor.scarfe_218j_security_status",
)

SIGNALS: tuple[Signal, ...] = (
    Signal(id="nas_drive", label="The NAS is reporting a drive problem",
           entities=NAS_SENSORS, op="is", value="on", kind="bad", severity="critical"),
    Signal(id="plant_monstera", label="The Monstera is dry",
           entities=("sensor.fineoffset_wh51_0ee63f_moisture",), op="below", value=25,
           kind="bad", severity="major", screen="plants"),
    Signal(id="plant_ficus", label="The Ficus is dry",
           entities=("sensor.fineoffset_wh51_0ee64d_moisture",), op="below", value=25,
           kind="bad", severity="major", screen="plants"),
    Signal(id="motion_battery", label="A motion sensor battery is low",
           entities=("binary_sensor.bathroom_motion_sensor_battery_low",
                     "binary_sensor.hallway_motion_sensor_battery_low",
                     "binary_sensor.hallway_closet_motion_sensor_battery_low"),
           op="is", value="on", kind="bad", severity="major"),
    Signal(id="guests", label="Guests are over", entities=("input_boolean.guest_mode",),
           op="is", value="on", kind="good"),
)

# While this is on, Alfie sleeps (closed eyes, no fidgets) unless something
# critical is wrong. Milestone 5 turns it into the Night house mode.
SLEEP_ENTITY = "switch.global_sleep_switches"
SLEEP_EXPRESSION = "closed"

# Motion sensor -> what Alfie does when it turns on. "notice" picks one of
# NOTICE at random: someone is in the room he is in.
GAZE_MAP = {
    "binary_sensor.living_room_motion_sensor_occupancy": "notice",
    "binary_sensor.hallway_motion_sensor_occupancy": "glance_left",
    "binary_sensor.hallway_closet_motion_sensor_occupancy": "glance_left",
    "binary_sensor.bathroom_motion_sensor_occupancy": "glance_left",
    "binary_sensor.bedroom_light_motion_sensor_occupancy": "glance_left",
    "binary_sensor.dining_room_presence_motion_sensor_presence": "glance_right",
}
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


TEMPLATE = {"expression": "", "animation": "", "screen": "@why", "seconds": 15,
            "present": "card", "transition": "", "closing": ""}

STORIES: tuple[dict, ...] = (
    {"id": "alarm", "name": "Alarm", "mode": "steps", "template": dict(TEMPLATE),
     "steps": [_anim(ON_CRITICAL), _screen("@wrong"), _anim("shake")]},
    {"id": "bad_news", "name": "Bad news", "mode": "steps", "template": dict(TEMPLATE),
     "steps": [*_morph(), _screen("@wrong"), _anim("shake")]},
    {"id": "mood_change", "name": "Mood change", "mode": "steps", "template": dict(TEMPLATE),
     "steps": [*_morph(), _screen("@why"), _anim("nod")]},
    {"id": "celebrate", "name": "Celebrate the fix", "mode": "steps",
     "template": dict(TEMPLATE),
     "steps": [{"kind": "expression", "name": "happy", "hold": 0.5, "blend": 0},
               _anim(ON_RECOVER), _anim("laugh"), {"kind": "wait", "seconds": 1.5}]},
    {"id": "wake_up", "name": "Wake up", "mode": "template",
     "template": {**TEMPLATE, "animation": ON_WAKE, "screen": ""}, "steps": []},
    {"id": "hello", "name": "Hello", "mode": "steps", "template": dict(TEMPLATE),
     "steps": [{"kind": "expression", "name": "@mood", "hold": 1.5, "blend": 0}, _anim("nod")]},
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
)
