"""conversation.alfie (design.md "Brain"): Alfie as a voice assistant's
conversation agent. brain.py decides; this runs a turn through the tiers:

  1. an automation's sentence trigger;
  2. Alfie's own commands (what's wrong, how are you, when did the door
     open...), matched with HA's sentence syntax (hassil, part of HA) and
     answered by local.py;
  3. Home Assistant's built-in intents, matched strictly against exposed
     entities; state questions stay local unless `brain.local_states` is off;
     then his own answers a built-in intent may know better (`brain.LATE`:
     any entity's state, how many lights are on);
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

from . import brain, fun, tell
from .const import DOMAIN, VERSION
from .engine import AlfieEngine
from .local import LocalAnswers
from .voice import _lookup

_LOGGER = logging.getLogger(__name__)

# The order his matched commands are tried in: the more particular first.
ORDER = ("whats_wrong", "how_are_you", "run", "repeat", "help", "coin", "dice", "number", "pick",
         "joke", "chat", "moon", "sun", "weather_gear", "weather_forecast",
         "weather_now", "world_time", "people", "media", "lists", "calendar", "dates", "convert",
         "maths", "entity_when", "entity_history", "entity_count", "entity", "wiki")
TRIES = 4           # readings of one command tried (hassil splits a sentence several ways)
WHICH_FOR = 60.0    # seconds a "which one?" waits for its answer


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
        self.local = LocalAnswers(engine.hass, engine)
        # conversation id -> (command, slots, choices, monotonic asked at)
        self._which: dict[str, tuple[str, dict[str, str], list[str], float]] = {}
        # satellite ("" none) -> (his last reply there, monotonic said at): "say that again"
        self._said: dict[str, tuple[str, float]] = {}

    @property
    def supported_languages(self) -> list[str] | Literal["*"]:
        return MATCH_ALL

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.hass.data[DOMAIN]["brain"] = self
        self.engine.config_hooks.append(self._apply)   # the engine goes with the entry
        self.async_on_remove(lambda: self.hass.data[DOMAIN].pop("brain", None))
        self.async_on_remove(self.local.close)        # its calendar watch
        self.local.ensure_label(self.engine.config["brain"])

    @callback
    def _apply(self) -> None:
        self.log.resize(self.engine.config["brain"]["log_size"])
        self.local.ensure_label(self.engine.config["brain"])

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
        key = (language, s["own_sentences"], tuple(s["off_commands"]),
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

    async def _match_own(self, text: str, language: str) -> list[tuple[str, dict[str, str]]]:
        """Every reading of the text by his commands, as (command, slots), in
        `ORDER`; a few per command."""
        own = await self._own_intents(language)
        if own is None:
            return []
        from hassil import recognize_all   # noqa: PLC0415
        found: dict[str, list[dict[str, str]]] = {}
        for result in recognize_all(text, own):
            cmd = brain.command_of(result.intent.name)
            if cmd is None:
                continue
            slots = {k: str(v.value) for k, v in result.entities.items()}
            if not brain.whole_words(slots, text):
                continue        # "the mean{ing of life}": a wildcard cut a word
            slots["_text"] = text
            got = found.setdefault(cmd, [])
            if slots not in got:
                got.append(slots)
        # The reading that understood most of the sentence leaves the least to
        # the wildcards: "front door", not "front door last".
        def loose(x: dict[str, str]) -> int:
            return sum(len(x.get(w, "")) for w in brain.WILDCARDS)
        return [(c, sl) for c in ORDER for sl in sorted(found.get(c, []), key=loose)[:TRIES]]

    async def _answer_own(self, cmd: str, slots: dict[str, str], language: str,
                          satellite: str = "") -> tuple[str, str, list[str], bool] | None:
        """(reply, detail, choices, unknown), or None when the command can't
        answer this after all (the turn goes on)."""
        mood = self.engine.mood
        if cmd == "repeat":
            return self._repeat(satellite, language), cmd, [], False
        if cmd == "help":
            return self._help(language), cmd, [], False
        if cmd == "whats_wrong":
            return tell.spoken(mood, _lookup(self.hass)), cmd, [], False
        if cmd == "how_are_you":
            reason = mood.reason if mood and (mood.bad or mood.good) else ""
            return brain.how_are_you(brain.load_language(language),
                                     mood.level if mood else "content", reason), cmd, [], False
        try:
            got = await self.local.answer(cmd, slots, brain.load_language(language) or {})
        except Exception:  # one bad answer must not stop the turn
            _LOGGER.exception("Alfie couldn't answer %s locally", cmd)
            return None
        return None if got is None else (got.text, got.detail or cmd, got.choices, got.unknown)

    async def _try_own(self, matches: list[tuple[str, dict[str, str]]], language: str,
                       turn: brain.Turn, chat_log: conversation.ChatLog,
                       held: list[Any], last: bool = True) -> conversation.ConversationResult | None:
        """The first of his commands that answers. "Which one?" and "I don't
        know a thing called …" are weak: they are `held` while any command
        after them (`last` False: the late ones are still to come) may answer
        properly, "which" before "don't know"."""
        for cmd, slots in matches:
            got = await self._answer_own(cmd, slots, language, turn.satellite)
            if got is None:
                continue
            text, detail, choices, unknown = got
            if choices or unknown:
                rank = 0 if choices else 1
                if not held or rank < held[0][0]:
                    held[:] = [(rank, cmd, slots, text, detail, choices)]
                continue
            return self._own_reply(cmd, slots, text, detail, [], language, turn, chat_log)
        if last and held:
            _rank, cmd, slots, text, detail, choices = held.pop()
            return self._own_reply(cmd, slots, text, detail, choices, language, turn, chat_log)
        return None

    def _own_reply(self, cmd: str, slots: dict[str, str], text: str, detail: str,
                   choices: list[str], language: str, turn: brain.Turn,
                   chat_log: conversation.ChatLog) -> conversation.ConversationResult:
        turn.source, turn.detail = "own", detail
        turn.why = brain.why("own", cmd)
        result = self._reply(text, language, chat_log)
        if choices:
            now = time.monotonic()
            self._which = {k: v for k, v in self._which.items() if now - v[3] < WHICH_FOR}
            self._which[chat_log.conversation_id] = (cmd, slots, choices, now)
            result.continue_conversation = True
        return result

    def _repeat(self, satellite: str, language: str) -> str:
        """His last reply on this satellite (or anywhere, from none), while
        `repeat_minutes` lasts."""
        words = brain.load_language(language) or {}
        keep = self.engine.config["brain"]["repeat_minutes"] * 60
        now = time.monotonic()
        got = self._said.get(satellite)
        if (got is None or now - got[1] > keep) and not satellite and self._said:
            got = max(self._said.values(), key=lambda x: x[1])
        if got is None or now - got[1] > keep:
            return fun._t(words, "nothing_said")
        return got[0]

    def _help(self, language: str) -> str:
        s = self.engine.config["brain"]
        delegate = ""
        if s["delegate"]:
            st = self.hass.states.get(s["delegate"])
            delegate = st.name if st else ""
        return fun.help_reply(brain.commands_on(s) if s["own_sentences"] else [],
                              brain.load_language(language) or {}, delegate)

    async def _answer_which(self, text: str, language: str, turn: brain.Turn,
                            chat_log: conversation.ChatLog) -> conversation.ConversationResult | None:
        """The answer to "which one?": a name among the choices."""
        asked = self._which.pop(chat_log.conversation_id, None)
        if asked is None or time.monotonic() - asked[3] > WHICH_FOR:
            return None
        cmd, slots, choices, _at = asked
        from .finder import Entry, Index   # noqa: PLC0415
        entries = [Entry(e, (st.name if (st := self.hass.states.get(e)) else e)) for e in choices]
        hit = Index(entries).best(text, floor=30)
        if hit is None:
            return None
        words = brain.load_language(language) or {}
        got = await self.local.answer(cmd, slots, words, entity_id=hit.entity_id)
        if got is None:
            return None
        turn.source, turn.detail = "own", hit.entity_id
        turn.why = brain.why("own", cmd)
        return self._reply(got.text, language, chat_log)

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

        # 2. Alfie's own commands (and the answer to his "which one?")
        if self._which and (result := await self._answer_which(text, language, turn, chat_log)):
            return done(result)
        matches = await self._match_own(text, language)
        early = [m for m in matches if m[0] not in brain.LATE]
        late = [m for m in matches if m[0] in brain.LATE]
        held: list[Any] = []
        if early and (result := await self._try_own(early, language, turn, chat_log, held,
                                                    last=not late)):
            return done(result)

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

        if late and (result := await self._try_own(late, language, turn, chat_log, held)):
            return done(result)

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
        if turn.reply and turn.detail != "repeat":
            self._said[turn.satellite] = (turn.reply, time.monotonic())
        self.log.add(turn)
        if turn.tier == 1:
            self.engine.brain_badge(1)
        _LOGGER.debug("brain: %s -> %s (%s)", turn.said, turn.source, turn.why)
        row = turn.as_dict()
        for fn in list(self._listeners):
            fn(row)
