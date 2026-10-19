"""Alfie's configuration in HA's Store (.storage/alfie.config).

The first load seeds it with Lukas's house (config.default_config) and the
milestone 1 options-flow values, once. A stored config that no longer
validates (say a newer face file dropped an expression) is logged and run
from the defaults, but not overwritten, so nothing the user made is lost
until they save again.
"""

from __future__ import annotations

import logging
from collections.abc import Mapping
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.helpers.storage import Store

from .config import ConfigError, default_config, migrate_options, validate

_LOGGER = logging.getLogger(__name__)

STORE_KEY = "alfie.config"
STORE_VERSION = 1
SAVE_DELAY = 1.0      # seconds: a burst of panel saves is one disk write


class AlfieStore:
    def __init__(self, hass: HomeAssistant) -> None:
        self._store: Store[dict[str, Any]] = Store(hass, STORE_VERSION, STORE_KEY)
        self._data: dict[str, Any] | None = None

    async def async_load(self, face: Mapping[str, Any],
                         options: Mapping[str, Any],
                         types: Mapping[str, Any] | None = None) -> dict[str, Any]:
        raw = await self._store.async_load()
        if raw is None:
            cfg = validate(migrate_options(default_config(), options), face, types)
            self.save(cfg)
            return cfg
        try:
            return validate(raw, face, types)
        except ConfigError as e:
            _LOGGER.error("Alfie's saved configuration is invalid (%s); running on the "
                          "defaults until it is saved again", e)
            return validate(default_config(), face, types)

    def save(self, cfg: dict[str, Any]) -> None:
        self._data = cfg
        self._store.async_delay_save(lambda: self._data or {}, SAVE_DELAY)
