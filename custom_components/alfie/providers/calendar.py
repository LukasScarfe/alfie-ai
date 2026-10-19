"""Calendar events for the text screen: today, or the next few days.

Calls `calendar.get_events` (return_response) for the screen's calendars.
The answer stays fresh until the next local midnight, and a calendar entity
changing state (an event starting or ending, or the calendar being edited)
makes the next ask fetch again. That is a state-change listener on just the
chosen calendars, never a timer.
"""

from __future__ import annotations

import logging
from datetime import date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo

from . import Provider, register

_LOGGER = logging.getLogger(__name__)

MAX_EVENTS = 60
MIN_TTL = 60.0


def local_midnights(now: datetime, days: int) -> tuple[datetime, datetime]:
    """Midnight starting `now`'s local day, and midnight `days` days later."""
    start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    # Calendar arithmetic on the date, so a DST day is not 23 or 25 fixed hours off.
    end = datetime.combine(start.date() + timedelta(days=days), datetime.min.time(), tzinfo=now.tzinfo)
    return start, end


def seconds_to_midnight(now: datetime) -> float:
    nxt = datetime.combine(now.date() + timedelta(days=1), datetime.min.time(), tzinfo=now.tzinfo)
    return max(MIN_TTL, (nxt - now).total_seconds())


def parse_events(response: Any, today: date, tz: ZoneInfo | None = None) -> list[dict]:
    """The `get_events` response as [{t, s, a, d, c}], sorted: all-day first
    within a day. `t` title, `s` start as given, `a` all-day, `d` days from
    today, `c` the calendar entity. The same title on the same day is kept once."""
    out, seen = [], set()
    for entity, body in (response or {}).items():
        for ev in (body or {}).get("events") or []:
            title = str(ev.get("summary") or "").strip()
            start = str(ev.get("start") or "")
            if not title or not start:
                continue
            all_day = "T" not in start and " " not in start
            try:
                if all_day:
                    day = date.fromisoformat(start)
                else:
                    dt = datetime.fromisoformat(start)
                    day = (dt.astimezone(tz) if tz and dt.tzinfo else dt).date()
            except ValueError:
                continue
            d = (day - today).days
            if (title, d) in seen:
                continue
            seen.add((title, d))
            out.append({"t": title, "s": start, "a": all_day, "d": d, "c": entity})
    out.sort(key=lambda e: (e["d"], not e["a"], e["s"]))
    return out[:MAX_EVENTS]


@register("calendar")
class CalendarProvider(Provider):
    ttl = 3600.0

    def __init__(self) -> None:
        super().__init__()
        self._watch: dict[str, tuple[tuple[str, ...], Any]] = {}   # screen id -> (entities, unsub)

    def _now(self, hass: Any) -> datetime:
        return datetime.now(ZoneInfo(hass.config.time_zone or "UTC"))

    def invalidate(self, screen_id: str) -> None:
        """Make the next ask for this screen fetch again."""
        for key, entry in self.cache._entries.items():
            if key[0] == screen_id:
                entry.fresh_until = 0.0

    def _track(self, hass: Any, screen_id: str, entities: tuple[str, ...]) -> None:
        old = self._watch.get(screen_id)
        if old and old[0] == entities:
            return
        if old and old[1]:
            old[1]()
        unsub = None
        if entities:
            from homeassistant.helpers.event import async_track_state_change_event
            unsub = async_track_state_change_event(
                hass, list(entities), lambda _e: self.invalidate(screen_id))
        self._watch[screen_id] = (entities, unsub)

    async def get(self, hass: Any, screen: dict) -> dict:
        # The ttl is "until midnight", which moves: set it before the cache decides.
        self.ttl = seconds_to_midnight(self._now(hass))
        return await super().get(hass, screen)

    async def fetch(self, hass: Any, screen: dict) -> dict:
        o = screen.get("options") or {}
        cals = tuple(o.get("calendars") or [])
        self._track(hass, screen["id"], cals)
        now = self._now(hass)
        if not cals:
            return {"events": [], "day": now.date().isoformat()}
        days = max(1, min(14, int(o.get("days") or 1)))
        start, end = local_midnights(now, days)
        resp = await hass.services.async_call(
            "calendar", "get_events",
            {"entity_id": list(cals), "start_date_time": start.isoformat(),
             "end_date_time": end.isoformat()},
            blocking=True, return_response=True)
        return {"events": parse_events(resp, now.date(), now.tzinfo), "day": now.date().isoformat()}
