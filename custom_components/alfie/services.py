"""Alfie's actions (services), for automations: everything he can do.

Registered once in async_setup, so they exist before the config entry; each
finds the engine when called. `async_describe` lays the config's own names
(screens, stories, modes...) over services.yaml as dropdowns (automation.py),
again after every config change.
"""

from __future__ import annotations

import copy
import os
from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol

from homeassistant.core import HomeAssistant, ServiceCall, callback
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.service import async_set_service_schema
from homeassistant.util.yaml import load_yaml_dict

from .automation import choices
from .config import _Check as Check
from .const import DOMAIN, HOUSE_MODES
from .engine import AlfieEngine
from .stories import (
    ICON_COLORS,
    ICON_CORNERS,
    ICON_FILLS,
    ICON_PLACES,
    ICON_STYLES,
    ICON_TRANSFORMS,
    check_icon,
    is_icon_name,
)
from .triggers import BUSY

DURATION = vol.All(vol.Coerce(float), vol.Range(min=0, max=7 * 86400))   # 0: until changed


def _icon_name(v: str) -> str:
    if not is_icon_name(v):
        raise vol.Invalid(f"{v!r} is not an icon name (like mdi:lightbulb)")
    return v


def _engine(hass: HomeAssistant) -> AlfieEngine:
    engine = hass.data.get(DOMAIN, {}).get("engine")
    if engine is None:
        raise HomeAssistantError("Alfie is not set up")
    return engine


def _handler(hass: HomeAssistant, do: Callable[[AlfieEngine, dict[str, Any]], Any]
             ) -> Callable[[ServiceCall], Awaitable[None]]:
    """A service handler: `do(engine, data)`, its ValueErrors shown to the user."""
    async def handle(call: ServiceCall) -> None:
        try:
            do(_engine(hass), dict(call.data))
        except ValueError as e:
            raise ServiceValidationError(str(e)) from e
    return handle


def _show_icon(engine: AlfieEngine, data: dict[str, Any]) -> None:
    ck = Check()
    icon = check_icon(data, "show_icon", ck)
    if ck.errors:
        raise ValueError("; ".join(ck.errors))
    engine.show_icon(icon)


# name: (what it does, schema)
SERVICES: dict[str, tuple[Callable[[AlfieEngine, dict[str, Any]], Any], dict[Any, Any]]] = {
    "set_expression": (lambda e, d: e.set_expression(d["expression"], d.get("duration")), {
        vol.Required("expression"): cv.string,
        vol.Optional("duration"): vol.Coerce(float),
    }),
    "play_animation": (lambda e, d: e.play(d["animation"], "Asked by a service call.", "service"), {
        vol.Required("animation"): cv.string,
    }),
    # `seconds` is show_screen's old name for duration, still accepted.
    "show_screen": (lambda e, d: e.show_screen(d["screen"], d.get("duration", d.get("seconds", 20))), {
        vol.Required("screen"): cv.string,
        vol.Optional("duration"): vol.All(vol.Coerce(float), vol.Range(min=1, max=3600)),
        vol.Optional("seconds"): vol.All(vol.Coerce(float), vol.Range(min=1, max=3600)),
    }),
    "play_story": (lambda e, d: e.request_story(d["story"], priority=d["priority"], busy=d["busy"],
                                                trigger="service", reason="Asked by a service call."), {
        vol.Required("story"): cv.string,
        vol.Optional("priority", default=60): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("busy", default="auto"): vol.In(BUSY),
    }),
    "stop_story": (lambda e, d: e.stop_story(), {}),
    "show_icon": (_show_icon, {
        vol.Required("icon"): vol.All(cv.string, vol.Strip, _icon_name),
        vol.Optional("style", default="transform"): vol.In(ICON_STYLES),
        vol.Optional("transform", default="whole"): vol.In(ICON_TRANSFORMS),
        vol.Optional("seconds", default=5): vol.All(vol.Coerce(float), vol.Range(min=1, max=3600)),
        vol.Optional("transition", default=""): vol.Any("", vol.Match(r"^[a-z0-9_]+$")),
        vol.Optional("corner", default="card"): vol.In(ICON_CORNERS),
        vol.Optional("place", default="top_right"): vol.In(ICON_PLACES),
        vol.Optional("x", default=0): vol.All(vol.Coerce(float), vol.Range(min=-1, max=1)),
        vol.Optional("y", default=0): vol.All(vol.Coerce(float), vol.Range(min=-1, max=1)),
        vol.Optional("size", default=1): vol.All(vol.Coerce(float), vol.Range(min=0.3, max=2)),
        vol.Optional("color", default="line"): vol.In(ICON_COLORS),
        vol.Optional("fill", default="soft"): vol.In(ICON_FILLS),
    }),
    "clear_icons": (lambda e, d: e.clear_icons(), {}),
    # Say something out loud; with no speakers, Voice's (design.md "Voice").
    "say": (lambda e, d: e.speak(d["message"], d.get("speakers"), d.get("tts_entity", ""),
                                 d.get("language", "")), {
        vol.Required("message"): vol.All(cv.string, vol.Strip, vol.Length(min=1)),
        vol.Optional("speakers"): cv.entity_ids,
        vol.Optional("tts_entity"): cv.entity_id,
        vol.Optional("language"): cv.string,
    }),
    # Held overrides of the house mode (modes.with_holds); auto lets go.
    "set_mood": (lambda e, d: e.hold("mood", d["level"], d.get("duration")), {
        vol.Required("level"): cv.string, vol.Optional("duration"): DURATION,
    }),
    "set_alfie": (lambda e, d: e.hold("alfie", d["state"], d.get("duration")), {
        vol.Required("state"): cv.string, vol.Optional("duration"): DURATION,
    }),
    "show_rotation": (lambda e, d: e.hold("rotation", d["rotation"], d.get("duration")), {
        vol.Required("rotation"): cv.string, vol.Optional("duration"): DURATION,
    }),
    "set_personality": (lambda e, d: e.hold("personality", d["preset"], d.get("duration")), {
        vol.Required("preset"): cv.string, vol.Optional("duration"): DURATION,
    }),
    "set_mode": (lambda e, d: _set_mode(e, d["mode"], d.get("duration")), {
        vol.Required("mode"): cv.string, vol.Optional("duration"): DURATION,
    }),
    "set_enabled": (lambda e, d: e.set_enabled(d["item"], d["enabled"]), {
        vol.Required("item"): cv.string, vol.Required("enabled"): cv.boolean,
    }),
}


def _set_mode(engine: AlfieEngine, mode: str, duration: float | None) -> None:
    ok = ["auto", "normal", *(m["id"] for m in engine.config.get("modes", []))]
    if mode not in ok:
        raise ValueError(f"no house mode {mode!r}: one of {', '.join(ok)}")
    engine.set_mode(mode, duration)


async def async_setup_services(hass: HomeAssistant) -> None:
    for name, (do, schema) in SERVICES.items():
        if name == "set_mode" and not HOUSE_MODES:
            continue
        hass.services.async_register(DOMAIN, name, _handler(hass, do), schema=vol.Schema(schema))
    path = os.path.join(os.path.dirname(__file__), "services.yaml")
    hass.data[DOMAIN]["services_yaml"] = await hass.async_add_executor_job(load_yaml_dict, path)


@callback
def async_describe(hass: HomeAssistant, engine: AlfieEngine) -> None:
    """services.yaml with the config's own names in the dropdowns."""
    base = hass.data.get(DOMAIN, {}).get("services_yaml") or {}
    for service, fields in choices(engine.config, engine.face).items():
        if not hass.services.has_service(DOMAIN, service):
            continue
        desc = copy.deepcopy(base.get(service) or {})
        for field, selector in fields.items():
            desc.setdefault("fields", {}).setdefault(field, {})["selector"] = selector
        async_set_service_schema(hass, DOMAIN, service, desc)
