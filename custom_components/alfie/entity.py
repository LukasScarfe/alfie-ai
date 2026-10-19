"""What Alfie's entities share: one device, and updates from the engine."""

from __future__ import annotations

from typing import Any

from homeassistant.core import callback
from homeassistant.helpers.device_registry import DeviceEntryType, DeviceInfo
from homeassistant.helpers.entity import Entity

from .const import DOMAIN, VERSION
from .engine import AlfieEngine


class AlfieEntity(Entity):
    _attr_has_entity_name = True
    _attr_should_poll = False

    def __init__(self, engine: AlfieEngine, key: str) -> None:
        self.engine = engine
        entry_id = engine.entry.entry_id
        self._attr_translation_key = key
        self._attr_unique_id = f"{entry_id}_{key}"
        self._attr_device_info = DeviceInfo(
            identifiers={(DOMAIN, entry_id)}, name=engine.name, manufacturer="Alfie",
            model="Face", sw_version=VERSION, entry_type=DeviceEntryType.SERVICE)

    _written: tuple | None = None

    async def async_added_to_hass(self) -> None:
        self.async_on_remove(self.engine.add_listener(self._scene))

    @callback
    def _scene(self, scene: dict[str, Any]) -> None:
        # Animations push scenes often; only a real change of state is written.
        if scene.get("ended") or self.engine.state_key == self._written:
            return
        self._written = self.engine.state_key
        self.async_write_ha_state()
