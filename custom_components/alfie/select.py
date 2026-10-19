"""select.alfie_mode: which house mode Alfie is in. "auto" follows the
modes' conditions (the first that holds wins), "normal" is no mode, and a
mode's id forces it. The options follow the modes in the config."""

from __future__ import annotations

from homeassistant.components.select import SelectEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.helpers.restore_state import RestoreEntity

from .const import DOMAIN
from .modes import AUTO, NORMAL
from .entity import AlfieEntity


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([AlfieModeSelect(hass.data[DOMAIN]["engine"], "mode")])


class AlfieModeSelect(AlfieEntity, SelectEntity, RestoreEntity):

    @property
    def options(self) -> list[str]:
        return [AUTO, NORMAL, *(m["id"] for m in self.engine.config.get("modes", []))]

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        last = await self.async_get_last_state()
        if last is not None and last.state in self.options and last.state != self.engine.mode:
            self.engine.set_mode(last.state)

    @property
    def current_option(self) -> str:
        return self.engine.mode

    async def async_select_option(self, option: str) -> None:
        self.engine.set_mode(option)
