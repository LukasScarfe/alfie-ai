"""Config flow: one Alfie per HA, named by the user. Options hold the engine
settings milestone 1 exposes; milestone 2's panel takes over the rest."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback
from homeassistant.helpers import selector

from . import defaults
from .const import (
    CONF_CELEBRATE,
    CONF_COMBINE,
    CONF_IDLE_INTERVAL,
    CONF_MOTION_DEBOUNCE,
    CONF_NAME,
    DEFAULT_NAME,
    DOMAIN,
)
from .mood import COMBINE_MODES


class AlfieConfigFlow(ConfigFlow, domain=DOMAIN):
    VERSION = 1

    async def async_step_user(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        await self.async_set_unique_id(DOMAIN)
        self._abort_if_unique_id_configured()
        if user_input is not None:
            name = (user_input.get(CONF_NAME) or DEFAULT_NAME).strip() or DEFAULT_NAME
            return self.async_create_entry(title=name, data={CONF_NAME: name})
        return self.async_show_form(step_id="user", data_schema=vol.Schema(
            {vol.Optional(CONF_NAME, default=DEFAULT_NAME): str}))

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return AlfieOptionsFlow()


class AlfieOptionsFlow(OptionsFlow):
    async def async_step_init(self, user_input: dict[str, Any] | None = None) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(data=user_input)
        o = self.config_entry.options
        return self.async_show_form(step_id="init", data_schema=vol.Schema({
            vol.Required(CONF_COMBINE, default=o.get(CONF_COMBINE, "worst")):
                selector.SelectSelector(selector.SelectSelectorConfig(
                    options=list(COMBINE_MODES), translation_key="combine",
                    mode=selector.SelectSelectorMode.LIST)),
            vol.Required(CONF_IDLE_INTERVAL,
                         default=o.get(CONF_IDLE_INTERVAL, defaults.IDLE_INTERVAL)):
                selector.NumberSelector(selector.NumberSelectorConfig(
                    min=10, max=3600, step=5, unit_of_measurement="s",
                    mode=selector.NumberSelectorMode.BOX)),
            vol.Required(CONF_MOTION_DEBOUNCE,
                         default=o.get(CONF_MOTION_DEBOUNCE, defaults.MOTION_DEBOUNCE)):
                selector.NumberSelector(selector.NumberSelectorConfig(
                    min=0, max=600, step=1, unit_of_measurement="s",
                    mode=selector.NumberSelectorMode.BOX)),
            vol.Required(CONF_CELEBRATE, default=o.get(CONF_CELEBRATE, True)): bool,
        }))
