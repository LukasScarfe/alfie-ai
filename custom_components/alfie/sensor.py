"""sensor.alfie_mood: his mood level, with the why as attributes."""

from __future__ import annotations

from typing import Any

from homeassistant.components.sensor import SensorDeviceClass, SensorEntity
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant
from homeassistant.helpers.entity_platform import AddEntitiesCallback

from .const import DOMAIN
from .entity import AlfieEntity
from .mood import LEVELS


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry,
                            async_add_entities: AddEntitiesCallback) -> None:
    async_add_entities([AlfieMoodSensor(hass.data[DOMAIN]["engine"], "mood")])


class AlfieMoodSensor(AlfieEntity, SensorEntity):
    _attr_device_class = SensorDeviceClass.ENUM
    _attr_options = list(LEVELS)
    # The detail stays live on the entity but out of the recorder's database.
    # Animations are deliberately absent: they never write state (see
    # engine._push); the alfie_animation event and the WS carry them.
    _unrecorded_attributes = frozenset({"signals", "energy", "score"})

    @property
    def native_value(self) -> str | None:
        m = self.engine.mood
        return m.level if m else None

    @property
    def extra_state_attributes(self) -> dict[str, Any]:
        s = self.engine.scene()
        return {
            "expression": s["expression"],
            "energy": s["mood"]["energy"],
            "score": s["mood"]["score"],
            "asleep": s["asleep"],
            "mode": s["mode"],
            "mode_why": s["mode_info"]["why"],
            "reason": s["reason"],
            "bad": [x["name"] for x in s["signals"] if x["kind"] == "bad"],
            "good": [x["name"] for x in s["signals"] if x["kind"] == "good"],
            "signals": s["signals"],
        }
