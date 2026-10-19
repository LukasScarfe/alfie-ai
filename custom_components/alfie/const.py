"""Constants for Alfie. Keys, URLs and defaults live here, not as magic strings."""

from __future__ import annotations

DOMAIN = "alfie"
VERSION = "0.8.2"           # keep equal to manifest.json (a test checks)

CONF_NAME = "name"
DEFAULT_NAME = "Alfie"

URL_BASE = "/alfie_static"
CARD_URL = f"{URL_BASE}/alfie-card.js"
PANEL_URL = f"{URL_BASE}/alfie-panel.js"
PANEL_PATH = "alfie"        # sidebar URL: /alfie
FACE_FILE = "alfie-face.json"

# House modes for select.alfie_mode. "auto" follows the sleep entity; milestone
# 5 gives away/guests and user-defined modes their behaviour.

EVENT_ANIMATION = "alfie_animation"   # fired whenever Alfie plays an animation
EVENT_STORY = "alfie_story"           # a story starts, ends or is interrupted
EVENT_ICON = "alfie_icon"             # an icon shows or ends (design.md "Icons")
SCENE_VERSION = 1

# A card ignores an animation older than this (a reconnect must not replay it).
ANIMATION_FRESH = 5.0
