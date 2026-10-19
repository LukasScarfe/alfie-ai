"""Lukas's house (devenv/house.json, what `./dev house` loads) for the tests
that check Alfie still reproduces the old Superintendent face on it."""

import json
import os

from alfie.signals import Signal

with open(os.path.join(os.path.dirname(__file__), "..", "devenv", "house.json")) as f:
    CONFIG = json.load(f)

SIGNALS = tuple(
    Signal(id=s["id"], name=s["name"], entities=tuple(s["entities"]), op=s["op"],
           value=s["value"], kind=s["kind"], severity=s["severity"], weight=s["weight"],
           screen=s["screen"], match=s["match"], enabled=s["enabled"])
    for s in CONFIG["signals"])
NAS_SENSORS = next(s for s in SIGNALS if s.id == "nas_drive").entities
MOTION_SENSORS = {m["entity"]: m["action"] for m in CONFIG["behaviour"]["motion_sensors"]}
