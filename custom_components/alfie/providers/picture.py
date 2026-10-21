"""The Picture screen's SVG, from the pictures folder (pictures.py).

The file only changes when the user uploads, replaces or deletes it, and the
engine clears this cache when they do (`pictures_changed`), so the answer
stays fresh for a day and the card fetches it once.
"""

from __future__ import annotations

from typing import Any

from ..pictures import PictureStore, rev_of
from . import Provider, register


def store_for(hass: Any) -> PictureStore:
    return PictureStore(hass.config.path("alfie", "pictures"))


@register("picture")
class PictureProvider(Provider):
    ttl = 86400.0

    async def fetch(self, hass: Any, screen: dict) -> dict:
        pid = (screen.get("options") or {}).get("picture") or ""
        if not pid:
            raise ValueError("no picture chosen")
        text = await hass.async_add_executor_job(store_for(hass).read, pid)
        return {"id": pid, "svg": text, "rev": rev_of(text)}
