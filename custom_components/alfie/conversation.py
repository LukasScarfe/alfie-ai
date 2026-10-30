"""conversation.alfie (design.md "Brain"): Alfie as a voice assistant's
conversation agent. brain.py decides; this runs a turn through the tiers:

  1. an automation's sentence trigger;
  2. Alfie's own commands (what's wrong, how are you), matched with HA's
     sentence syntax (hassil, part of HA);
  3. Home Assistant's built-in intents, matched strictly against exposed
     entities; state questions stay local unless `brain.local_states` is off;
  4. the delegate (`brain.delegate`, any other conversation agent), run in the
     same chat log, so an LLM's reply still streams to text-to-speech.

With no delegate, the fallback reply. Each turn goes in the turn log
(`alfie/brain/turns`) and puts a badge by his face for the tier.
"""

from __future__ import annotations

import logging
import time
from collections.abc import Callable
from typing import Any, Literal

from homeassistant.components import conversation
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import MATCH_ALL
from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import intent
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from . import brain, tell
from .const import DOMAIN, VERSION
from .engine import AlfieEngine
from .voice import _lookup

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([AlfieAgent(hass.data[DOMAIN]["engine"])])


class AlfieAgent(conversation.ConversationEntity):
    _attr_has_entity_name = True
    _attr_name = None                   # the device's name: conversation.alfie
    _attr_supports_streaming = True     # the delegate's reply streams through
    _attr_supported_features = conversation.ConversationEntityFeature.CONTROL

    def __init__(self, engine: AlfieEngine) -> None:
        self.engine = engine
        entry_id = engine.entry.entry_id
        self._attr_unique_id = f"{entry_id}_brain"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)}, name=engine.name, manufacturer="Alfie",
            model="Face", sw_version=VERSION, entry_type=DeviceEntryType.SERVICE)
        self.log = brain.TurnLog(engine.config["brain"]["log_size"])
        self._listeners: list[Callable[[dict[str, Any]], None]] = []
        self._own: Any = None            # hassil Intents for Alfie's commands
        self._own_key: Any = None

    @property
    def supported_languages(self) -> list[str] | Literal["*"]:
        return MATCH_ALL

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.hass.data[DOMAIN]["brain"] = self
        self.engine.config_hooks.append(self._apply)   # the engine goes with the entry
        self.async_on_remove(lambda: self.hass.data[DOMAIN].pop("brain", None))

    @callback
    def _apply(self) -> None:
        self.log.resize(self.engine.config["brain"]["log_size"])

    # ------------------------------------------------------------ listeners

    @callback
    def add_listener(self, fn: Callable[[dict[str, Any]], None]) -> CALLBACK_TYPE:
        """`fn` hears each finished turn (the panel's live log)."""
        self._listeners.append(fn)
        return lambda: self._listeners.remove(fn) if fn in self._listeners else None

    # ------------------------------------------------------------ Alfie's own

    async def _own_intents(self, language: str) -> Any:
        """Alfie's commands as hassil Intents, rebuilt (off the loop) only when
        the language or the brain settings change."""
        s = self.engine.config["brain"]
        key = (language, s["own_sentences"], tuple(s["commands"]),
               repr(sorted(s["extra_sentences"].items())))
        if key != self._own_key:
            self._own_key = key
            self._own = await self.hass.async_add_executor_job(self._build_own, language, s)
        return self._own

    @staticmethod
    def _build_own(language: str, settings: dict[str, Any]) -> Any:
        from hassil import Intents   # noqa: PLC0415 (HA's conversation brings it)
        data = brain.own_intents(brain.load_language(language), settings, language)
        if data is None:
            return None
        try:
            return Intents.from_dict(data)
        except Exception:  # a bad extra sentence must not stop the agent
            _LOGGER.exception("Alfie couldn't read his own sentences")
            return None

    async def _match_own(self, text: str, language: str) -> str | None:
        own = await self._own_intents(language)
        if own is None:
            return None
        from hassil import recognize   # noqa: PLC0415
        result = recognize(text, own)
        return brain.command_of(result.intent.name) if result else None

    def _answer_own(self, cmd: str, language: str) -> str:
        mood = self.engine.mood
        if cmd == "whats_wrong":
            return tell.spoken(mood, _lookup(self.hass))
        reason = mood.reason if mood and (mood.bad or mood.good) else ""
        return brain.how_are_you(brain.load_language(language), mood.level if mood else "content",
                                 reason)

    # ------------------------------------------------------------ a turn

    async def _async_handle_message(self, user_input: conversation.ConversationInput,
                                    chat_log: conversation.ChatLog) -> conversation.ConversationResult:
        s = self.engine.config["brain"]
        start = time.monotonic()
        language = user_input.language or self.hass.config.language
        if not brain.language_ready(language):
            await self.hass.async_add_executor_job(brain.load_language, language)
        text = user_input.text.strip()
        turn = brain.Turn(said=text, satellite=user_input.satellite_id or "")

        def done(result: conversation.ConversationResult) -> conversation.ConversationResult:
            turn.reply = result.response.speech.get("plain", {}).get("speech", "")
            turn.ms = int((time.monotonic() - start) * 1000)
            self._finish(turn)
            return result

        # 1. an automation's sentence trigger
        said = await conversation.async_handle_sentence_triggers(self.hass, user_input, chat_log)
        if said is not None:
            turn.source, turn.why = "trigger", brain.why("trigger")
            return done(self._reply(said, language, chat_log))

        # 2. Alfie's own commands
        if (cmd := await self._match_own(text, language)) is not None:
            turn.source, turn.detail = "own", cmd
            turn.why = brain.why("own", cmd)
            return done(self._reply(self._answer_own(cmd, language), language, chat_log))

        # 3. Home Assistant's intents
        passed: list[str] = []
        if s["local_intents"]:
            def leave(result: Any) -> bool:
                name = result.intent.name
                if brain.leave_to_delegate(name, s):
                    passed.append(name)
                    return True
                return False
            response = await conversation.async_handle_intents(self.hass, user_input, chat_log,
                                                               intent_filter=leave)
            if response is not None:
                name = getattr(getattr(response, "intent", None), "intent_type", "") or "an"
                turn.source, turn.detail = "intent", name
                turn.why = brain.why("intent", name)
                speech = response.speech.get("plain", {}).get("speech", "")
                self._add_reply(speech, chat_log)
                return done(conversation.ConversationResult(
                    response=response, conversation_id=chat_log.conversation_id))

        # 4. the delegate
        delegate = s["delegate"]
        if delegate:
            st = self.hass.states.get(delegate)
            dname = st.name if st else delegate
            turn.detail = delegate
            self.engine.brain_badge(3)
            try:
                result = await conversation.async_converse(
                    self.hass, user_input.text, chat_log.conversation_id, user_input.context,
                    language=language, agent_id=delegate, device_id=user_input.device_id,
                    satellite_id=user_input.satellite_id,
                    extra_system_prompt=user_input.extra_system_prompt)
            except Exception as err:  # a missing or broken delegate still gets an answer
                _LOGGER.warning("Alfie's delegate %s failed: %s", delegate, err)
                turn.source = "error"
                turn.why = brain.why("error", delegate=dname, error=str(err) or type(err).__name__)
                return done(self._reply(brain.fallback(brain.load_language(language), s),
                                        language, chat_log))
            if result.response.response_type is intent.IntentResponseType.ERROR:
                turn.source = "error"
                turn.why = brain.why("error", delegate=dname,
                                     error=result.response.speech.get("plain", {}).get("speech", ""))
            else:
                turn.source = "delegate"
                turn.why = brain.why("delegate", delegate=dname, passed=passed)
            return done(conversation.ConversationResult(
                response=result.response, conversation_id=chat_log.conversation_id,
                continue_conversation=result.continue_conversation))

        turn.why = brain.why("none", passed=passed)
        return done(self._reply(brain.fallback(brain.load_language(language), s), language,
                                chat_log))

    def _add_reply(self, text: str, chat_log: conversation.ChatLog) -> None:
        chat_log.async_add_assistant_content_without_tools(
            conversation.AssistantContent(agent_id=self.entity_id, content=text))

    def _reply(self, text: str, language: str,
               chat_log: conversation.ChatLog) -> conversation.ConversationResult:
        response = intent.IntentResponse(language=language)
        response.async_set_speech(text)
        self._add_reply(text, chat_log)
        return conversation.ConversationResult(response=response,
                                               conversation_id=chat_log.conversation_id)

    @callback
    def _finish(self, turn: brain.Turn) -> None:
        self.log.add(turn)
        if turn.tier == 1:
            self.engine.brain_badge(1)
        _LOGGER.debug("brain: %s -> %s (%s)", turn.said, turn.source, turn.why)
        row = turn.as_dict()
        for fn in list(self._listeners):
            fn(row)
