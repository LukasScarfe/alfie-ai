"""tts.alfie_voice (design.md "Brain", Speech): a TTS engine that rewrites the
text the way a person says it (speech.py), then hands it to another engine,
`speech.engine` ("" the first other one). Put it in a voice pipeline in place
of that engine and every answer is spoken naturally: HA's own intents, any LLM
agent, announcements.

A streamed reply is cut into finished sentences and each is rewritten as it
arrives, so an engine that streams (Piper) still starts talking early. The
engine's languages, voices and options are passed through; the speech rules
go into the cache key (`ALFIE_RULES`), so changing them never replays stale
audio.
"""

from __future__ import annotations

import hashlib
import json
import logging
from collections.abc import AsyncGenerator
from typing import Any

from homeassistant.components.tts import (
    TextToSpeechEntity,
    TTSAudioRequest,
    TTSAudioResponse,
)
from homeassistant.components.tts.helper import get_engine_instance
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_HOMEASSISTANT_STARTED
from homeassistant.core import CoreState, Event, HomeAssistant, callback
from homeassistant.exceptions import HomeAssistantError
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import dt as dt_util

from . import speech
from .const import DOMAIN, VERSION
from .engine import AlfieEngine

_LOGGER = logging.getLogger(__name__)

ALFIE_RULES = "alfie_rules"   # an option only for the cache key; never passed on
FALLBACK_LANGUAGES = ["en", "en-US", "en-GB"]


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([AlfieVoice(hass.data[DOMAIN]["engine"])])


class AlfieVoice(TextToSpeechEntity):
    _attr_has_entity_name = True
    _attr_translation_key = "voice"

    def __init__(self, engine: AlfieEngine) -> None:
        self.engine = engine
        entry_id = engine.entry.entry_id
        self._attr_unique_id = f"{entry_id}_voice"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)}, name=engine.name, manufacturer="Alfie",
            model="Face", sw_version=VERSION, entry_type=DeviceEntryType.SERVICE)
        self._attr_supported_languages = list(FALLBACK_LANGUAGES)
        self._attr_default_language = "en"
        self._attr_supported_options = [ALFIE_RULES]
        self._attr_default_options = {ALFIE_RULES: ""}

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self._refresh()
        self.engine.config_hooks.append(self._refresh)   # the engine goes with the entry
        if self.hass.state is not CoreState.running:
            # The engine it wraps may set up after Alfie.
            self.async_on_remove(self.hass.bus.async_listen_once(
                EVENT_HOMEASSISTANT_STARTED, self._started))

    @callback
    def _started(self, _event: Event) -> None:
        self._refresh()

    # ------------------------------------------------------------ the engine

    def _inner_id(self) -> str:
        chosen = self.engine.config["speech"]["engine"]
        if chosen:
            return chosen
        return next((e for e in self.hass.states.async_entity_ids("tts")
                     if e != self.entity_id), "")

    def _inner(self) -> Any:
        eid = self._inner_id()
        inner = get_engine_instance(self.hass, eid) if eid else None
        return None if inner is self else inner

    @callback
    def _refresh(self) -> None:
        """Take on the wrapped engine's languages and options, and the rules' hash."""
        rules = json.dumps(self.engine.config["speech"], sort_keys=True)
        self._attr_default_options = {ALFIE_RULES: hashlib.sha1(rules.encode()).hexdigest()[:12]}
        inner = self._inner()
        if inner is not None:
            langs = list(inner.supported_languages or [])
            self._attr_supported_languages = langs or list(FALLBACK_LANGUAGES)
            self._attr_default_language = inner.default_language or self._attr_supported_languages[0]
            self._attr_supported_options = [*(inner.supported_options or []), ALFIE_RULES]
        # Languages the rules speak need their words file; read it off the loop.
        for lang in {self._attr_default_language, self.hass.config.language}:
            if not speech.language_ready(lang):
                self.hass.async_add_executor_job(speech.load_language, lang)
        self.async_write_ha_state()

    @callback
    def async_get_supported_voices(self, language: str) -> Any:
        inner = self._inner()
        if inner is None or not hasattr(inner, "async_get_supported_voices"):
            return None
        return inner.async_get_supported_voices(language)

    # ------------------------------------------------------------ speaking

    def _say(self, text: str, language: str) -> str:
        return self.engine.spoken(text, language)

    async def async_stream_tts_audio(self, request: TTSAudioRequest) -> TTSAudioResponse:
        inner = self._inner()
        if inner is None:
            raise HomeAssistantError(f"Alfie's voice has no TTS engine to speak with "
                                     f"({self._inner_id() or 'none set up'})")
        options = {k: v for k, v in request.options.items() if k != ALFIE_RULES}
        language = request.language

        async def sentences() -> AsyncGenerator[str]:
            buffer = ""
            async for chunk in request.message_gen:
                buffer += chunk
                ready, buffer = speech.split_ready(buffer)
                if ready.strip():
                    yield self._say(ready, language) + " "
            if buffer.strip():
                yield self._say(buffer, language)

        if isinstance(inner, TextToSpeechEntity) and inner.async_supports_streaming_input():
            return await inner.internal_async_stream_tts_audio(
                TTSAudioRequest(language, options, sentences()))
        text = "".join([s async for s in sentences()])
        if isinstance(inner, TextToSpeechEntity):
            ext, data = await inner.async_internal_get_tts_audio(text, language, options)
        else:   # a legacy provider
            ext, data = await inner.async_get_tts_audio(text, language, options)
        if ext is None or data is None:
            raise HomeAssistantError(f"No TTS from {self._inner_id()} for {text!r}")

        async def audio() -> AsyncGenerator[bytes]:
            yield data
        return TTSAudioResponse(ext, audio())

    async def async_get_tts_audio(self, message: str, language: str,
                                  options: dict[str, Any]) -> tuple[str | None, bytes | None]:
        async def one() -> AsyncGenerator[str]:
            yield message
        got = await self.async_stream_tts_audio(TTSAudioRequest(language, options, one()))
        return got.extension, b"".join([c async for c in got.data_gen])
