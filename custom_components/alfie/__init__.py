"""Alfie: a lively face that is the visible soul of the home."""

from __future__ import annotations

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant, ServiceCall
from homeassistant.exceptions import HomeAssistantError, ServiceValidationError
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .config import _Check as Check
from .const import DOMAIN
from .engine import AlfieEngine
from .frontend import async_register_frontend, async_remove_panel
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
from .websocket_api import async_register as async_register_ws

PLATFORMS: list[Platform] = [Platform.SENSOR]   # Platform.SELECT (house mode pick) hidden for now
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


def _icon_name(v: str) -> str:
    if not is_icon_name(v):
        raise vol.Invalid(f"{v!r} is not an icon name (like mdi:lightbulb)")
    return v


def _engine(hass: HomeAssistant) -> AlfieEngine:
    engine = hass.data.get(DOMAIN, {}).get("engine")
    if engine is None:
        raise HomeAssistantError("Alfie is not set up")
    return engine


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})

    async def set_expression(call: ServiceCall) -> None:
        try:
            _engine(hass).set_expression(call.data["expression"], call.data.get("duration"))
        except ValueError as e:
            raise ServiceValidationError(str(e)) from e

    async def play_animation(call: ServiceCall) -> None:
        try:
            _engine(hass).play(call.data["animation"], "Asked by a service call.", "service")
        except ValueError as e:
            raise ServiceValidationError(str(e)) from e

    async def show_screen(call: ServiceCall) -> None:
        try:
            # `seconds` is the field's old name, still accepted.
            _engine(hass).show_screen(call.data["screen"],
                                      call.data.get("duration", call.data.get("seconds", 20)))
        except ValueError as e:
            raise ServiceValidationError(str(e)) from e

    async def play_story(call: ServiceCall) -> None:
        try:
            _engine(hass).request_story(call.data["story"], priority=call.data["priority"],
                                        busy=call.data["busy"], trigger="service",
                                        reason="Asked by a service call.")
        except ValueError as e:
            raise ServiceValidationError(str(e)) from e

    async def stop_story(call: ServiceCall) -> None:
        _engine(hass).stop_story()

    async def show_icon(call: ServiceCall) -> None:
        ck = Check()
        icon = check_icon(dict(call.data), "show_icon", ck)
        if ck.errors:
            raise ServiceValidationError("; ".join(ck.errors))
        _engine(hass).show_icon(icon)

    async def clear_icons(call: ServiceCall) -> None:
        _engine(hass).clear_icons()

    hass.services.async_register(DOMAIN, "set_expression", set_expression, schema=vol.Schema({
        vol.Required("expression"): cv.string,
        vol.Optional("duration"): vol.Coerce(float),
    }))
    hass.services.async_register(DOMAIN, "play_animation", play_animation, schema=vol.Schema({
        vol.Required("animation"): cv.string,
    }))
    hass.services.async_register(DOMAIN, "show_screen", show_screen, schema=vol.Schema({
        vol.Required("screen"): cv.string,
        vol.Optional("duration"): vol.All(vol.Coerce(float), vol.Range(min=1, max=3600)),
        vol.Optional("seconds"): vol.All(vol.Coerce(float), vol.Range(min=1, max=3600)),
    }))
    hass.services.async_register(DOMAIN, "play_story", play_story, schema=vol.Schema({
        vol.Required("story"): cv.string,
        vol.Optional("priority", default=60): vol.All(vol.Coerce(int), vol.Range(min=0, max=100)),
        vol.Optional("busy", default="auto"): vol.In(BUSY),
    }))
    hass.services.async_register(DOMAIN, "stop_story", stop_story, schema=vol.Schema({}))
    hass.services.async_register(DOMAIN, "show_icon", show_icon, schema=vol.Schema({
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
    }))
    hass.services.async_register(DOMAIN, "clear_icons", clear_icons, schema=vol.Schema({}))
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    engine = AlfieEngine(hass, entry)
    await engine.async_start()
    hass.data[DOMAIN]["engine"] = engine
    entry.async_on_unload(engine.async_stop)

    await async_register_frontend(hass, engine.name)
    async_register_ws(hass)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_reload))
    return True


async def _async_reload(hass: HomeAssistant, entry: ConfigEntry) -> None:
    await hass.config_entries.async_reload(entry.entry_id)


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    unloaded = await hass.config_entries.async_unload_platforms(entry, PLATFORMS)
    if unloaded:
        hass.data[DOMAIN].pop("engine", None)
        async_remove_panel(hass)
    return unloaded
