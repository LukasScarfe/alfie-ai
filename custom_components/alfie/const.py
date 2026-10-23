"""Constants for Alfie. Keys, URLs and defaults live here, not as magic strings."""

from __future__ import annotations

DOMAIN = "alfie"
VERSION = "0.16.1"           # keep equal to manifest.json (a test checks)

CONF_NAME = "name"
DEFAULT_NAME = "Alfie"

URL_BASE = "/alfie_static"
CARD_URL = f"{URL_BASE}/alfie-card.js"
PANEL_URL = f"{URL_BASE}/alfie-panel.js"
PANEL_PATH = "alfie"        # sidebar URL: /alfie
FACE_FILE = "alfie-face.json"

# House modes are switched off: no mode is ever chosen, select.alfie_mode and
# alfie.set_mode are gone and the panel hides them. Automations steer Alfie
# with the holds instead (alfie.show_rotation and friends), the newest call
# winning. The code stays; True brings them back.
HOUSE_MODES = False

EVENT_ANIMATION = "alfie_animation"   # fired whenever Alfie plays an animation
EVENT_STORY = "alfie_story"           # a story starts, ends or is interrupted
EVENT_ICON = "alfie_icon"             # an icon shows or ends (design.md "Icons")
EVENT_SIGNAL = "alfie_signal"         # a signal goes bad, good or clear
EVENT_VOICE = "alfie_voice"           # a satellite starts a phase (listening ... done)
SCENE_VERSION = 1

# A card ignores an animation older than this (a reconnect must not replay it).
ANIMATION_FRESH = 5.0
