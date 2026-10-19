"""Alfie's WebSocket commands.

`alfie/subscribe` is the card's line to the engine. It is open to every
logged-in user (the wall tablet signs in as a non-admin), over the user's
normal HA connection, so it works on the LAN and through a tunnel alike. It
sends the full scene state now and on every change.

`alfie/config/*` are the admin panel's: read, save, reset and preview the
stored configuration (config.py). Saves apply live, with no reload.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .config import (
    CUSTOM,
    PERSONALITY,
    SECTIONS,
    ConfigError,
    default_config,
)
from .const import DOMAIN
from .mood import COMBINE_MODES, LEVELS
from .signals import OPERATORS, SEVERITIES


@callback
def async_register(hass: HomeAssistant) -> None:
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("_ws_registered"):
        return
    for cmd in (ws_subscribe, ws_config_get, ws_config_set, ws_config_reset, ws_config_preview):
        websocket_api.async_register_command(hass, cmd)
    data["_ws_registered"] = True


def _engine(hass: HomeAssistant, connection: websocket_api.ActiveConnection, msg_id: int):
    engine = hass.data.get(DOMAIN, {}).get("engine")
    if engine is None:
        connection.send_error(msg_id, "not_loaded", "Alfie is not set up")
    return engine


@websocket_api.websocket_command({vol.Required("type"): "alfie/subscribe"})
@callback
def ws_subscribe(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                 msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return

    @callback
    def forward(scene: dict[str, Any]) -> None:
        connection.send_message(websocket_api.event_message(msg["id"], scene))

    connection.subscriptions[msg["id"]] = engine.add_listener(forward)
    connection.send_result(msg["id"])
    forward(engine.scene())


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "alfie/config/get"})
@callback
def ws_config_get(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    face = engine.face
    connection.send_result(msg["id"], {
        "name": engine.name,
        "config": engine.config,
        "defaults": default_config(),
        "choices": {
            "expressions": list(face["expressions"]),
            "animations": list(face["animations"]),
            "personalities": {**face.get("personalities", {}), CUSTOM: None},
            "sliders": {k: {"default": d, "min": lo, "max": hi}
                        for k, (d, lo, hi) in PERSONALITY.items()},
            "levels": list(reversed(LEVELS)),      # best first, as the panel lists them
            "operators": list(OPERATORS),
            "severities": list(SEVERITIES),
            "combine": list(COMBINE_MODES),
            "sections": list(SECTIONS),
        },
    })


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "alfie/config/set",
                                  vol.Required("config"): dict})
@callback
def ws_config_set(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    try:
        cfg = engine.apply_config(msg["config"])
    except ConfigError as e:
        connection.send_error(msg["id"], "invalid_config", str(e))
        return
    connection.send_result(msg["id"], {"config": cfg})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "alfie/config/reset",
                                  vol.Optional("section"): vol.In(SECTIONS)})
@callback
def ws_config_reset(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                    msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    connection.send_result(msg["id"], {"config": engine.reset_config(msg.get("section"))})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "alfie/config/preview",
                                  vol.Required("config"): dict})
@callback
def ws_config_preview(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                      msg: dict[str, Any]) -> None:
    """A draft from the panel, unsaved. A draft mid-edit may be invalid: that
    is a normal answer (the errors), not a failed command."""
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    try:
        result = engine.preview(msg["config"])
    except ConfigError as e:
        connection.send_result(msg["id"], {"errors": e.errors})
        return
    connection.send_result(msg["id"], {"errors": [], **result})
