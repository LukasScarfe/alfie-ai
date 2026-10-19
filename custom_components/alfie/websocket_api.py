"""The card's line to the engine: `alfie/subscribe`.

Open to every logged-in user (the wall tablet signs in as a non-admin), over
the user's normal HA connection, so it works on the LAN and through a tunnel
alike. Sends the full scene state now and on every change.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .const import DOMAIN


@callback
def async_register(hass: HomeAssistant) -> None:
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("_ws_registered"):
        return
    websocket_api.async_register_command(hass, ws_subscribe)
    data["_ws_registered"] = True


@websocket_api.websocket_command({vol.Required("type"): "alfie/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                 msg: dict[str, Any]) -> None:
    engine = hass.data.get(DOMAIN, {}).get("engine")
    if engine is None:
        connection.send_error(msg["id"], "not_loaded", "Alfie is not set up")
        return

    @callback
    def forward(scene: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], scene))

    connection.subscriptions[msg["id"]] = engine.add_listener(forward)
    connection.send_result(msg["id"])
    forward(engine.scene())
