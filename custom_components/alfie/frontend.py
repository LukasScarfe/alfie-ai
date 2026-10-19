"""Serve and auto-register the bundled card: installing the integration is
enough for `custom:alfie-card` to exist (no Lovelace resource to add).

The URL carries ?v=<version> so a release busts the frontend's cache.
"""

from __future__ import annotations

import os

from homeassistant.components.frontend import add_extra_js_url
from homeassistant.components.http import StaticPathConfig
from homeassistant.core import HomeAssistant

from .const import CARD_URL, DOMAIN, URL_BASE, VERSION


async def async_register_frontend(hass: HomeAssistant) -> None:
    """Idempotently expose the static dir and the card module."""
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("_static_registered"):
        return
    frontend_dir = os.path.join(os.path.dirname(__file__), "frontend")
    await hass.http.async_register_static_paths(
        [StaticPathConfig(URL_BASE, frontend_dir, cache_headers=False)]
    )
    add_extra_js_url(hass, f"{CARD_URL}?v={VERSION}")
    data["_static_registered"] = True
