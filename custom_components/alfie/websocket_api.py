"""Alfie's WebSocket commands.

`alfie/subscribe` is the card's line to the engine. It is open to every
logged-in user (the wall tablet signs in as a non-admin), over the user's
normal HA connection, so it works on the LAN and through a tunnel alike. It
sends the full scene state now and on every change.

`alfie/config/*` are the admin panel's: read, save, reset and preview the
stored configuration (config.py). Saves apply live, with no reload.

`alfie/story/play` plays a story (a saved one or the panel's unsaved draft)
on every display, and `alfie/triggers/status` says when each trigger last
fired and what came of it. Both are admin only.

`alfie/screens` and `alfie/screen_data` feed the cards the user's screens and
their server-side data. Like subscribe they are open to every logged-in user.
"""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.components import websocket_api
from homeassistant.core import HomeAssistant, callback

from .config import (
    STYLES,
    CUSTOM,
    PERSONALITY,
    SECTIONS,
    ConfigError,
    default_config,
)
from .config import _Check
from .const import DOMAIN
from .mood import COMBINE_MODES, LEVELS
from .signals import OPERATORS, SEVERITIES
from . import stories, triggers


@callback
def async_register(hass: HomeAssistant) -> None:
    data = hass.data.setdefault(DOMAIN, {})
    if data.get("_ws_registered"):
        return
    for cmd in (ws_subscribe, ws_config_get, ws_config_set, ws_config_reset, ws_config_preview,
                ws_screens, ws_screen_data, ws_story_play, ws_story_expand, ws_triggers_status):
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
            "styles": list(STYLES),
            "sections": list(SECTIONS),
            "screen_types": engine.types,
            "step_kinds": list(stories.STEP_KINDS),
            "steps": {k: stories.default_step(k) for k in stories.STEP_KINDS},
            "template": stories.default_template(),
            "presents": list(stories.PRESENTS),
            "places": [*stories.PLACES, "custom"],
            "trigger_kinds": list(triggers.KINDS),
            "triggers": {k: triggers.default_trigger(k) for k in triggers.KINDS},
            "busy": list(triggers.BUSY),
            "entity_ops": list(triggers.ENTITY_OPS),
            "directions": list(triggers.DIRECTIONS),
            "signal_edges": list(triggers.SIGNAL_EDGES),
            "wake_edges": list(triggers.WAKE_EDGES),
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


@websocket_api.websocket_command({vol.Required("type"): "alfie/screens"})
@callback
def ws_screens(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
               msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    connection.send_result(msg["id"], {
        "rev": engine.screens_rev,
        "screens": engine.config["screens"],
        "rotations": engine.config["rotations"],
        "types": engine.types,
        "stories": [{"id": st["id"], "name": st["name"]} for st in engine.config["stories"]],
    })


@websocket_api.websocket_command({vol.Required("type"): "alfie/screen_data",
                                  vol.Required("screen"): str})
@websocket_api.async_response
async def ws_screen_data(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                         msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    try:
        result = await engine.screen_data(msg["screen"])
    except ValueError as e:
        connection.send_error(msg["id"], "not_found", str(e))
        return
    connection.send_result(msg["id"], result)


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "alfie/story/play",
                                  vol.Optional("story"): str,
                                  vol.Optional("draft"): dict})
@callback
def ws_story_play(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                  msg: dict[str, Any]) -> None:
    """Play a saved story by id, or a draft from the panel, on every display.
    It interrupts whatever is playing: someone is watching for it."""
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    draft = None
    if "draft" in msg:
        ck = _Check()
        got = stories.validate_stories([msg["draft"]], ck, list(engine.expressions),
                                       list(engine.animations),
                                       {s["id"] for s in engine.config["screens"]})
        if ck.errors or not got:
            connection.send_error(msg["id"], "invalid_story", "; ".join(ck.errors))
            return
        draft = got[0]
    sid = draft["id"] if draft else msg.get("story", "")
    try:
        outcome = engine.request_story(sid, priority=100, busy="interrupt", trigger="panel",
                                       reason="Played from the panel.", story=draft)
    except ValueError as e:
        connection.send_error(msg["id"], "not_found", str(e))
        return
    connection.send_result(msg["id"], {"outcome": outcome})


@websocket_api.websocket_command({vol.Required("type"): "alfie/story/expand",
                                  vol.Optional("story"): str})
@callback
def ws_story_expand(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                    msg: dict[str, Any]) -> None:
    """A story's timed actions for one card to play by itself, when Alfie
    appears in its rotation. Without `story`, the most relevant one (mood-led).
    Read only: nothing plays on the other displays."""
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    sid = msg.get("story") or engine.appear_story()
    if not sid:
        connection.send_result(msg["id"], {"story": None, "actions": []})
        return
    try:
        actions = engine.expand_story(sid)
    except ValueError as e:
        connection.send_error(msg["id"], "not_found", str(e))
        return
    connection.send_result(msg["id"], {"story": sid, "actions": [
        {"kind": a.kind, "value": a.value, "seconds": a.seconds} for a in actions]})


@websocket_api.require_admin
@websocket_api.websocket_command({vol.Required("type"): "alfie/triggers/status"})
@callback
def ws_triggers_status(hass: HomeAssistant, connection: websocket_api.ActiveConnection,
                       msg: dict[str, Any]) -> None:
    if (engine := _engine(hass, connection, msg["id"])) is None:
        return
    st = engine.story
    connection.send_result(msg["id"], {
        "triggers": engine.trigger_status,
        "playing": {"id": st["id"], "trigger": st["trigger"], "step": st["step"],
                    "total": len(st["actions"])} if st else None,
        "queue": [{"story": q["story"], "trigger": q["trigger"]} for q in engine._queue],
    })
