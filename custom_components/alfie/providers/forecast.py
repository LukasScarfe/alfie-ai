"""Weather forecast data for the weather screen (provider kind "forecast").

Calls `weather.get_forecasts` (the service that replaced the forecast
attribute) and boils the answer down to a few short arrays. The parsing is
pure (`parse_forecast`) so it is tested without Home Assistant.

Lazy and light: it runs only when a card asks, and then only calls the
service if the cached forecast is over an hour old, or the weather entity
changed (state or last_updated) and the last call was over MIN_GAP ago. The
provider's own ttl is short, because that just re-checks those two cheap
conditions.
"""

from __future__ import annotations

import time
from collections.abc import Callable
from datetime import datetime
from typing import Any

from . import Provider, register

MAX_AGE = 3600.0     # refetch at least this often
MIN_GAP = 600.0      # but never more often than this when the entity merely changes
SUN = "sun.sun"


def _num(v: Any, digits: int = 1) -> float | None:
    if isinstance(v, bool) or v is None:
        return None
    try:
        f = float(v)
    except (TypeError, ValueError):
        return None
    if f != f or f in (float("inf"), float("-inf")):
        return None
    return round(f, digits)


def _epoch(v: Any) -> int | None:
    """An ISO datetime (or epoch number) as epoch seconds."""
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return int(v)
    if not isinstance(v, str):
        return None
    try:
        d = datetime.fromisoformat(v.replace("Z", "+00:00"))
    except ValueError:
        return None
    if d.tzinfo is None:   # a naive time is the server's local time
        d = d.astimezone()
    return int(d.timestamp())


def parse_forecast(items: Any, kind: str, limit: int) -> dict[str, Any]:
    """The compact arrays for the first `limit` forecast entries.

    `pop` (precipitation probability, %) and `precip` (amount) are empty lists
    when no entry has them (met.no has no probability), so the screen can tell
    "no data" from "0%". `low` is the daily minimum, empty for hourly.
    """
    rows = [r for r in items if isinstance(r, dict)] if isinstance(items, list) else []
    rows = rows[:max(0, limit)]
    out: dict[str, Any] = {
        "type": kind,
        "times": [_epoch(r.get("datetime")) for r in rows],
        "temp": [_num(r.get("temperature")) for r in rows],
        "low": [_num(r.get("templow")) for r in rows],
        "pop": [_num(r.get("precipitation_probability"), 0) for r in rows],
        "precip": [_num(r.get("precipitation"), 1) for r in rows],
        "cond": [r.get("condition") if isinstance(r.get("condition"), str) else None for r in rows],
    }
    for k in ("low", "pop", "precip"):
        if all(v is None for v in out[k]):
            out[k] = []
    return out


def entity_stamp(state: Any) -> tuple | None:
    """What changing means a new forecast may exist."""
    if state is None:
        return None
    return (state.state, str(getattr(state, "last_updated", "")))


def now_block(weather: Any, sun: Any) -> dict[str, Any]:
    """The current conditions, as a fallback for a card that has no states."""
    a = getattr(weather, "attributes", None) or {}
    elev = _num((getattr(sun, "attributes", None) or {}).get("elevation"), 1)
    return {
        "temperature": _num(a.get("temperature")),
        "unit": a.get("temperature_unit"),
        "condition": getattr(weather, "state", None),
        "night": elev is not None and elev < -0.833,
    }


@register("forecast")
class ForecastProvider(Provider):
    ttl = 120.0
    clock: Callable[[], float] = staticmethod(time.monotonic)

    def __init__(self) -> None:
        super().__init__()
        # screen id -> (options signature, entity stamp, fetched at, data)
        self._last: dict[str, tuple[str, tuple | None, float, dict]] = {}

    async def fetch(self, hass: Any, screen: dict) -> dict[str, Any]:
        opts = screen.get("options") or {}
        entity = opts.get("weather")
        if not entity:
            raise ValueError("no weather entity chosen")
        want = "daily" if opts.get("forecast") == "daily" else "hourly"
        limit = int(opts.get("days", 5)) if want == "daily" else int(opts.get("hours", 24))
        sig = f"{entity}|{want}|{limit}"
        state = hass.states.get(entity)
        stamp = entity_stamp(state)
        now = self.clock()
        last = self._last.get(screen["id"])
        if last is not None and last[0] == sig:
            age = now - last[2]
            if age < MAX_AGE and (stamp == last[1] or age < MIN_GAP):
                return {**last[3], "now": now_block(state, hass.states.get(SUN))}

        data = await self._call(hass, entity, want, limit)
        if not data["times"] and want == "hourly":     # no hourly support: try daily
            data = await self._call(hass, entity, "daily", max(1, -(-limit // 24)))
        data["now"] = now_block(state, hass.states.get(SUN))
        data["unit"] = (state.attributes.get("temperature_unit") if state else None)
        self._last[screen["id"]] = (sig, stamp, now, data)
        return data

    @staticmethod
    async def _call(hass: Any, entity: str, kind: str, limit: int) -> dict[str, Any]:
        try:
            resp = await hass.services.async_call(
                "weather", "get_forecasts", {"entity_id": entity, "type": kind},
                blocking=True, return_response=True)
        except Exception as e:   # an unsupported type raises; the caller may fall back
            if kind == "hourly":
                return parse_forecast([], kind, limit)
            raise RuntimeError(f"{entity} gave no {kind} forecast: {e}") from e
        items = ((resp or {}).get(entity) or {}).get("forecast") or []
        return parse_forecast(items, kind, limit)
