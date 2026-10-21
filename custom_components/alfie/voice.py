"""Alfie for voice agents (design.md "Voice"): the Alfie LLM API, its
alfie__whats_wrong tool, and a plain intent with sentences for HA's own agent.

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
from typing import Any

from homeassistant.core import CALLBACK_TYPE, HomeAssistant, callback
from homeassistant.helpers import intent, llm

from . import tell
from .const import DOMAIN
from .engine import AlfieEngine

_LOGGER = logging.getLogger(__name__)

API_ID = DOMAIN
INTENT = "AlfieWhatsWrong"


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
    return "\n".join(parts)


class AlfieAPI(llm.API):
    """The Alfie LLM API: tick it in a conversation agent beside Assist."""

    def __init__(self, hass: HomeAssistant, engine: AlfieEngine) -> None:
        super().__init__(hass=hass, id=API_ID, name=engine.name)
        self.engine = engine

    async def async_get_api_instance(self, llm_context: llm.LLMContext) -> llm.APIInstance:
        return llm.APIInstance(api=self, api_prompt=prompt(self.engine),
                               llm_context=llm_context, tools=[WhatsWrongTool(self.engine)])


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

    @callback
    def apply(self) -> None:
        v = self.engine.config["voice"]
        key = (v["intent"], tuple(v["sentences"]))
        if key == self._key:
            return
        self.stop()
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

    @callback
    def stop(self) -> None:
        for u in self._unsubs:
            try:
                u()
            except Exception:  # noqa: BLE001 - already gone is fine
                pass
        self._unsubs.clear()
        self._key = None
