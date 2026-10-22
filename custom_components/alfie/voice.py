"""Alfie for voice agents (design.md "Voice"): the Alfie LLM API, its
alfie__whats_wrong and alfie__find_entity tools, a plain intent with sentences
for HA's own agent, and voice screens (design.md "Voice screens": a screen
made from what each voice turn did or was asked about).

All of it is opt-in from the panel's Voice section, so installing Alfie
changes no one's voice assistant:
  - the Alfie LLM API is ticked in an agent's settings (next to Assist); it
    brings the tool, plus the persona and his mood when those are on;
  - `assist_tool` also adds the tool to Assist itself (llm.py);
  - `intent` registers AlfieWhatsWrong and its sentences with HA's agent.
What they answer comes from tell.py.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

import voluptuous as vol

from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later
from homeassistant.helpers import (
    area_registry as ar,
    config_validation as cv,
    device_registry as dr,
    entity_registry as er,
    intent,
    llm,
)

from . import converse, finder, tell
from .config import ConfigError
from .const import DOMAIN
from .engine import AlfieEngine
from .screen_types import validate_options

_LOGGER = logging.getLogger(__name__)

API_ID = DOMAIN
INTENT = "AlfieWhatsWrong"
TURNS_KEPT = 8      # conversations followed at once; older ones are dropped
# An LLM agent's finished turn is read from HA's stored chat log: looked for
# this often while a turn is open, for at most this long (then forgotten).
CHECK_EVERY = 0.4
CHECK_FOR = 30.0


def _lookup(hass: HomeAssistant) -> tell.Lookup:
    def get(entity_id: str) -> tuple[str, str, str] | None:
        st = hass.states.get(entity_id)
        if st is None:
            return None
        return st.name, st.state, str(st.attributes.get("unit_of_measurement") or "")
    return get


def whats_wrong(engine: AlfieEngine) -> dict[str, Any]:
    # _bad_since is monotonic; minutes only need the difference.
    return tell.whats_wrong(engine.mood, _lookup(engine.hass), engine._bad_since,
                            time.monotonic())


class WhatsWrongTool(llm.Tool):
    name = f"{DOMAIN}__whats_wrong"
    title = "What's wrong at home"
    description = ("What is wrong in the house right now, worst first, with the entities "
                   "behind each problem and their states, and the house's overall mood. "
                   "Use it when asked whether anything is wrong, needs attention, or how the "
                   "house is.")
    annotations = llm.ToolAnnotations(read_only=True, destructive=False, idempotent=True,
                                      open_world=False)
    integration = DOMAIN

    def __init__(self, engine: AlfieEngine) -> None:
        self.engine = engine

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput,
                         llm_context: llm.LLMContext) -> llm.ToolResult:
        return llm.ToolResult(data=whats_wrong(self.engine))


class FindEntityTool(llm.Tool):
    name = f"{DOMAIN}__find_entity"
    title = "Find a thing in the house"
    description = ("Find any device or sensor in the house by the name someone uses for it, "
                   "including ones not in your list, with its state. Use it when a thing "
                   "someone asks about isn't among the home's entities you were given.")
    parameters = vol.Schema({
        vol.Required("name", description="What the person called it, e.g. 'printer' or "
                                         "'office plant'"): cv.string,
        vol.Optional("domain", description="Only this kind, e.g. light, sensor, switch"): cv.string,
    })
    annotations = llm.ToolAnnotations(read_only=True, destructive=False, idempotent=True,
                                      open_world=False)
    integration = DOMAIN

    def __init__(self, index: Callable[[], Awaitable[finder.Index]]) -> None:
        self.index = index

    async def async_call(self, hass: HomeAssistant, tool_input: llm.ToolInput,
                         llm_context: llm.LLMContext) -> llm.ToolResult:
        args = tool_input.tool_args
        idx = await self.index()
        dom = [args["domain"]] if args.get("domain") else []
        hits = idx.search(str(args.get("name") or ""), finder.LIMIT, dom)

        def state_of(eid: str) -> tuple[str, str] | None:
            st = hass.states.get(eid)
            return None if st is None else (st.state,
                                            str(st.attributes.get("unit_of_measurement") or ""))
        return llm.ToolResult(data=finder.result(hits, state_of))


def prompt(engine: AlfieEngine) -> str:
    v = engine.config["voice"]
    parts = []
    if v["persona"]:
        parts.append(v["persona_prompt"].replace("Alfie", engine.name))
    else:
        parts.append(f"{engine.name} is the face of this home. Call {WhatsWrongTool.name} "
                     "when asked whether anything is wrong or how the house is.")
    if v["mood_aware"]:
        parts.append(tell.mood_line(engine.name, engine.mood, v["persona"]))
    if v["find_entity"]:
        parts.append(f"For a thing in the house that isn't in your list, call "
                     f"{FindEntityTool.name} with what it was called.")
    return "\n".join(parts)


class AlfieAPI(llm.API):
    """The Alfie LLM API: tick it in a conversation agent beside Assist."""

    def __init__(self, hass: HomeAssistant, engine: AlfieEngine) -> None:
        super().__init__(hass=hass, id=API_ID, name=engine.name)
        self.engine = engine

    async def async_get_api_instance(self, llm_context: llm.LLMContext) -> llm.APIInstance:
        tools: list[llm.Tool] = [WhatsWrongTool(self.engine)]
        hub = self.hass.data.get(DOMAIN, {}).get("voice")
        if self.engine.config["voice"]["find_entity"] and hub is not None:
            tools.append(FindEntityTool(hub.index))
        return llm.APIInstance(api=self, api_prompt=prompt(self.engine),
                               llm_context=llm_context, tools=tools)


class WhatsWrongIntent(intent.IntentHandler):
    intent_type = INTENT
    description = "Says what is wrong in the house, according to Alfie"
    platforms = {DOMAIN}

    def __init__(self, engine: AlfieEngine) -> None:
        self.engine = engine

    async def async_handle(self, intent_obj: intent.Intent) -> intent.IntentResponse:
        response = intent_obj.create_response()
        response.async_set_speech(tell.spoken(self.engine.mood, _lookup(self.engine.hass)))
        return response


class Voice:
    """Registers and unregisters what Voice's settings ask for, again after
    each config change (engine.config_hooks)."""

    def __init__(self, hass: HomeAssistant, engine: AlfieEngine) -> None:
        self.hass, self.engine = hass, engine
        self._unsubs: list[CALLBACK_TYPE] = []
        self._key: Any = None
        # The name index (finder.py): built when first needed, again only
        # after a registry changes. The chat log watcher, when screens are on.
        self._index: finder.Index | None = None
        self._index_dirty = True
        self._index_unsubs: list[CALLBACK_TYPE] = []
        self._watch_unsub: CALLBACK_TYPE | None = None
        self._turns: dict[str, converse.Turn] = {}
        self._checks: dict[str, CALLBACK_TYPE] = {}   # conversation id -> its next look
        self._deadline: dict[str, float] = {}          # conversation id -> monotonic give-up
        self.last: dict[str, Any] | None = None    # the last voice screen, for the panel

    @callback
    def apply(self) -> None:
        self._apply_screens()
        v = self.engine.config["voice"]
        key = (v["intent"], tuple(v["sentences"]), v["find_entity"])
        if key == self._key:
            return
        self._stop_api()
        self._key = key
        self._unsubs.append(llm.async_register_api(self.hass, AlfieAPI(self.hass, self.engine)))
        if v["intent"]:
            intent.async_register(self.hass, WhatsWrongIntent(self.engine))
            self._unsubs.append(lambda: intent.async_remove(self.hass, INTENT))
            if v["sentences"]:
                self._register_sentences(v["sentences"])

    def _register_sentences(self, sentences: list[str]) -> None:
        """Sentences for HA's own agent, the way a conversation trigger adds
        them (an internal API: if it moves, the intent still works by name)."""
        try:
            from homeassistant.components.conversation.agent_manager import (  # noqa: PLC0415
                get_agent_manager,
            )
        except ImportError:
            _LOGGER.warning("Alfie can't add sentences to the voice assistant on this HA")
            return
        engine = self.engine

        async def answer(_input: Any, _result: Any) -> str:
            return tell.spoken(engine.mood, _lookup(engine.hass))
        try:
            self._unsubs.append(get_agent_manager(self.hass).register_trigger(sentences, answer))
        except Exception:  # an HA change must not break Alfie's setup
            _LOGGER.exception("Alfie couldn't add his sentences to the voice assistant")

    # ------------------------------------------------------------ the index

    async def index(self) -> finder.Index:
        """The name index, rebuilt first if a registry changed since."""
        if self._index is None or self._index_dirty:
            self._index_dirty = False
            rows = self._rows()
            self._index = await self.hass.async_add_executor_job(
                lambda: finder.Index(finder.Entry(*r) for r in rows))
        if not self._index_unsubs:
            for ev in (er.EVENT_ENTITY_REGISTRY_UPDATED, dr.EVENT_DEVICE_REGISTRY_UPDATED,
                       ar.EVENT_AREA_REGISTRY_UPDATED):
                self._index_unsubs.append(self.hass.bus.async_listen(ev, self._stale))
        return self._index

    @callback
    def _stale(self, _event: Event) -> None:
        self._index_dirty = True

    def _rows(self) -> list[tuple[str, str, tuple[str, ...], str, str, bool]]:
        """(entity_id, name, aliases, device, area, exposed) of every entity a
        person could mean: not hidden, not disabled. Read in the event loop
        (one pass, only when the index is stale); the phrases are made in an
        executor."""
        from homeassistant.components.homeassistant.exposed_entities import (  # noqa: PLC0415
            async_should_expose,
        )
        ents, devs, areas = er.async_get(self.hass), dr.async_get(self.hass), ar.async_get(self.hass)
        rows = []
        for st in self.hass.states.async_all():
            e = ents.async_get(st.entity_id)
            if e is not None and (e.hidden_by or e.disabled_by):
                continue
            dev = devs.async_get(e.device_id) if e and e.device_id else None
            area_id = (e.area_id if e else None) or (dev.area_id if dev else None)
            area = areas.async_get_area(area_id) if area_id else None
            rows.append((st.entity_id, st.name,
                         tuple(a for a in (e.aliases if e else ()) if isinstance(a, str)),
                         (dev.name_by_user or dev.name or "") if dev else "",
                         area.name if area else "",
                         async_should_expose(self.hass, "conversation", st.entity_id)))
        return rows

    # ---------------------------------------------------------- the watcher

    @callback
    def _apply_screens(self) -> None:
        v = self.engine.config["voice"]
        want = bool(v["enabled"] and v["screens"])
        if want and self._watch_unsub is None:
            try:
                from homeassistant.components.conversation.chat_log import (  # noqa: PLC0415
                    async_subscribe_chat_logs,
                )
                from homeassistant.components.conversation.const import (  # noqa: PLC0415
                    ChatLogEventType,
                )
            except ImportError:
                _LOGGER.warning("Alfie can't follow voice turns on this HA: no voice screens")
                return
            self._events = ChatLogEventType
            self._watch_unsub = async_subscribe_chat_logs(self.hass, self._on_chat)
        elif not want and self._watch_unsub is not None:
            self._watch_unsub()
            self._watch_unsub = None
            self._turns.clear()
            self._stop_checks()

    @callback
    def _on_chat(self, conversation_id: str, event_type: Any, data: dict[str, Any]) -> None:
        cid, ev = conversation_id, self._events
        _LOGGER.debug("voice turn %s: %s %s", cid, event_type,
                      (data.get("content") or {}).get("role") if isinstance(data, dict) else "")
        if event_type == ev.DELETED:
            self._turns.pop(cid, None)
            self._stop_checks(cid)
            return
        if event_type == ev.UPDATED and isinstance(data.get("chat_log"), dict):
            # A conversation that goes on: HA hands over its whole log at the turn's end.
            self._finish(cid, data["chat_log"].get("content") or [])
            return
        if event_type != ev.CONTENT_ADDED or not isinstance(data.get("content"), dict):
            return
        turn = self._turns.pop(cid, None) or converse.Turn()
        self._turns[cid] = turn          # most recent last
        while len(self._turns) > TURNS_KEPT:
            old = next(iter(self._turns))
            self._turns.pop(old)
            self._stop_checks(old)
        try:
            turn.feed(data["content"])
        except Exception:  # an HA change in the log's shape must not break voice
            _LOGGER.exception("Alfie couldn't read a voice turn")
            return
        if turn.done:
            self._show_once(cid, turn)       # HA's own agent: its reply is logged as it goes
        elif cid not in self._checks:
            self._deadline[cid] = time.monotonic() + CHECK_FOR
            self._checks[cid] = async_call_later(self.hass, CHECK_EVERY, self._checker(cid))

    def _checker(self, cid: str) -> Callable[[Any], None]:
        @callback
        def check(_now: Any) -> None:
            self._checks.pop(cid, None)
            turn = self._turns.get(cid)
            if turn is None or turn.shown:
                return
            logs = self.hass.data.get("conversation_chat_logs") or {}
            log = logs.get(cid)
            _LOGGER.debug("voice turn %s: log %s", cid,
                          None if log is None else [c.role for c in log.content][-4:])
            if log is not None:
                try:
                    if self._finish(cid, [c.as_dict() for c in log.content]):
                        return
                except Exception:  # noqa: BLE001 - an HA change: give up on this turn
                    _LOGGER.debug("Alfie couldn't read the chat log", exc_info=True)
                    return
            if time.monotonic() < self._deadline.get(cid, 0):
                self._checks[cid] = async_call_later(self.hass, CHECK_EVERY, self._checker(cid))
            else:
                self._deadline.pop(cid, None)
        return check

    @callback
    def _finish(self, cid: str, contents: list[Any]) -> bool:
        """Read the finished turn from a whole log; True once it is shown."""
        turn = self._turns.get(cid)
        full = converse.last_turn([c for c in contents if isinstance(c, dict)])
        if not full.done or (turn is not None and (turn.shown or (turn.said and full.said != turn.said))):
            return False
        self._turns[cid] = full
        self._show_once(cid, full)
        return True

    @callback
    def _show_once(self, cid: str, turn: converse.Turn) -> None:
        if turn.shown:
            return
        turn.shown = True
        self._stop_checks(cid)
        self.hass.async_create_task(self._show(turn), eager_start=True)

    @callback
    def _stop_checks(self, cid: str | None = None) -> None:
        for k in [cid] if cid is not None else list(self._checks):
            self._deadline.pop(k, None)
            if (unsub := self._checks.pop(k, None)) is not None:
                unsub()

    async def _show(self, turn: converse.Turn) -> None:
        engine, v = self.engine, self.engine.config["voice"]
        if not (v["enabled"] and v["screens"]):
            return
        kind, ids = converse.subject(turn, await self.index())

        def state_of(eid: str) -> tuple[str, dict[str, Any]] | None:
            st = self.hass.states.get(eid)
            return None if st is None else (st.state, dict(st.attributes))
        scr = converse.screen_for(kind, ids, state_of, v, turn.froms)
        self.last = {"at": time.time(), "said": turn.said, "reply": turn.reply, "kind": kind,
                     "entities": ids, "screen": scr["type"] if scr else None}
        meta = engine.types.get(scr["type"]) if scr else None
        if scr is None or meta is None:
            return
        try:
            scr["options"] = validate_options(meta, scr["options"])
        except ConfigError as e:
            _LOGGER.debug("voice screen not shown: %s", e)
            return
        engine.show_voice_screen(scr, v["linger_seconds"] + converse.speech_seconds(turn.reply),
                                 hold=bool(engine.voice))

    @callback
    def stop(self) -> None:
        if self._watch_unsub is not None:
            self._watch_unsub()
            self._watch_unsub = None
        self._stop_checks()
        for u in self._index_unsubs:
            u()
        self._index_unsubs.clear()
        self._stop_api()

    @callback
    def _stop_api(self) -> None:
        for u in self._unsubs:
            try:
                u()
            except Exception:  # noqa: BLE001 - already gone is fine
                pass
        self._unsubs.clear()
        self._key = None
