"""Serve and auto-register the bundled card and the admin panel: installing
the integration is enough for `custom:alfie-card` to exist (no Lovelace
resource to add) and for the Alfie editor to appear in the sidebar.

The URLs carry ?v=<version> so a release busts the frontend's cache.
"""

from __future__ import annotations

import os

from homeassistant.components import frontend, panel_custom
from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import CARD_URL, DOMAIN, PANEL_PATH, PANEL_URL, URL_BASE, VERSION


async def async_register_frontend(hass: HomeAssistant, name: str) -> None:
    """Idempotently expose the static dir, the card module and the panel."""
    data = hass.data.setdefault(DOMAIN, {})
    if not data.get("_static_registered"):
        frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
        await hass.http.async_register_static_paths(
            [StaticPathConfig(URL_BASE, frontend_dir, cache_headers=False)]
        )
        add_extra_js_url(hass, f"{CARD_URL}?v={VERSION}")
        data["_static_registered"] = True

    if not data.get("_panel_registered"):
        await panel_custom.async_register_panel(
            hass,
            frontend_url_path=PANEL_PATH,
            webcomponent_name="alfie-panel",
            module_url=f"{PANEL_URL}?v={VERSION}",
            sidebar_title=name,
            sidebar_icon="mdi:robot-happy-outline",
            require_admin=True,
        )
        data["_panel_registered"] = True


def async_remove_panel(hass: HomeAssistant) -> None:
    if hass.data.get(DOMAIN, {}).get("_panel_registered"):
        frontend.async_remove_panel(hass, PANEL_PATH)
        hass.data[DOMAIN]["_panel_registered"] = False
