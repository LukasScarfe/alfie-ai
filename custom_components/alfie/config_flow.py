"""Config flow: one Alfie per HA, named by the user. Everything else is set in
the Alfie sidebar panel and kept in the Store (store.py); the options flow only
points there."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import ConfigEntry, ConfigFlow, ConfigFlowResult, OptionsFlow
from homeassistant.core import callback

from .const import CONF_NAME, DEFAULT_NAME, DOMAIN


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
            # Keep milestone 1's options as they were: the Store migrated them once.
            return self.async_create_entry(data=dict(self.config_entry.options))
        return self.async_show_form(step_id="init", data_schema=vol.Schema({}))
