"""Alfie's tool in Assist (HA's LLM tools platform), when Voice's
`assist_tool` is on: any agent using Assist can then ask what's wrong without
ticking the Alfie API. The Alfie API itself lives in voice.py."""

from __future__ import annotations

from homeassistant.components.llm import LLMTools
from homeassistant.core import HomeAssistant, callback
from homeassistant.helpers.llm import LLM_API_ASSIST, LLMContext

from .const import DOMAIN
from .voice import WhatsWrongTool


@callback
def async_get_tools(hass: HomeAssistant, llm_context: LLMContext,
                    api_id: str) -> LLMTools | None:
    engine = hass.data.get(DOMAIN, {}).get("engine")
    if api_id != LLM_API_ASSIST or engine is None or not engine.config["voice"]["assist_tool"]:
        return None
    return LLMTools(tools=[WhatsWrongTool(engine)])
