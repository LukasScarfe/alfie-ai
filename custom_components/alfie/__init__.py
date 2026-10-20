"""Alfie: a lively face that is the visible soul of the home."""

from __future__ import annotations

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import Platform
from homeassistant.core import HomeAssistant
from homeassistant.helpers import config_validation as cv
from homeassistant.helpers.typing import ConfigType

from .const import DOMAIN
from .engine import AlfieEngine
from .frontend import async_register_frontend, async_remove_panel
from .services import async_describe, async_setup_services
from .websocket_api import async_register as async_register_ws

PLATFORMS: list[Platform] = [Platform.SENSOR, Platform.SELECT]
CONFIG_SCHEMA = cv.config_entry_only_config_schema(DOMAIN)


async def async_setup(hass: HomeAssistant, config: ConfigType) -> bool:
    hass.data.setdefault(DOMAIN, {})
    await async_setup_services(hass)
    return True


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    engine = AlfieEngine(hass, entry)
    await engine.async_start()
    hass.data[DOMAIN]["engine"] = engine
    # The actions' dropdowns list this config's screens, stories, modes...
    async_describe(hass, engine)
    engine.config_hooks.append(lambda: async_describe(hass, engine))
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
