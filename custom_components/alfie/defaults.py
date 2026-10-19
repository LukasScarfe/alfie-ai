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

# Mood transitions that play an animation (from level -> to level; "*" any).
ON_CRITICAL = "startle"
ON_RECOVER = "nod"
