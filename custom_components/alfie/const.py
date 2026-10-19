"""Constants for Alfie. Keys, URLs and defaults live here, not as magic strings."""

from __future__ import annotations

DOMAIN = "alfie"
VERSION = "0.1.0"           # keep equal to manifest.json (a test checks)

CONF_NAME = "name"
DEFAULT_NAME = "Alfie"

CONF_COMBINE = "combine"
CONF_IDLE_INTERVAL = "idle_interval"
CONF_MOTION_DEBOUNCE = "motion_debounce"
CONF_CELEBRATE = "celebrate_fix"

URL_BASE = "/alfie_static"
CARD_URL = f"{URL_BASE}/alfie-card.js"
FACE_FILE = "alfie-face.json"

# House modes for select.alfie_mode. "auto" follows the sleep entity; milestone
# 5 gives away/guests and user-defined modes their behaviour.
MODES = ["auto", "normal", "night", "away", "guests"]

EVENT_ANIMATION = "alfie_animation"   # fired whenever Alfie plays an animation
SCENE_VERSION = 1

# A card ignores an animation older than this (a reconnect must not replay it).
ANIMATION_FRESH = 5.0
