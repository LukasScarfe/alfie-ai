"""Alfie's local answers, the Home Assistant side (design.md "Brain" → Local
answers): conversation.py hands over a command his sentences matched with its
slots; this finds the things named (finder.py's index, built once and again
only when a registry changes), reads their states, and history when the
question needs it (one recorder query, off the event loop), and answers.py
says the reply.

None means "not mine after all" (a name that names nothing, say), and the turn
goes on to the next tier.
"""

from __future__ import annotations

import logging
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from homeassistant.helpers import entity_registry as er

from . import answers, brain, finder, outside, reckon
from .const import DOMAIN
from .providers.forecast import raw_forecast

_LOGGER = logging.getLogger(__name__)

WHEN_DAYS = 7       # "when was the door last opened": how far back to look
SEARCH = 8          # finder hits weighed per name


@dataclass
class Reply:
    text: str
    detail: str = ""                      # the entity it was about, for the turn log
    choices: list[str] = field(default_factory=list)   # asked "which one?"
    unknown: bool = False                 # "I don't know a thing called ...": only
                                          # when no other reading answers


class LocalAnswers:
    def __init__(self, hass: HomeAssistant, engine: Any) -> None:
        self.hass, self.engine = hass, engine
        self._zones: dict[str, str] | None = None     # place -> IANA zone, read once
        self._tz: dict[str, Any] = {}                 # IANA zone -> tzinfo

    # ------------------------------------------------------------ finding

    async def _index(self) -> finder.Index | None:
        voice = self.hass.data.get(DOMAIN, {}).get("voice")
        return await voice.index() if voice else None

    def _usable(self, e: finder.Entry, s: dict[str, Any]) -> bool:
        return (e.exposed or not s["exposed_only"]) and self.hass.states.get(e.entity_id) is not None

    async def resolve(self, name: str, s: dict[str, Any]) -> tuple[str | None, list[str]]:
        """The entity a name means: (entity_id, []), or (None, choices) when
        two or more fit equally, or (None, []) when none fits well enough."""
        idx = await self._index()
        q = _clean(name)
        if idx is None or not q:
            return None, []
        hits = [(sc, e) for sc, e in idx.search(q, SEARCH) if self._usable(e, s)]
        if not hits or hits[0][0] < s["match_floor"]:
            return None, []
        top = [e for sc, e in hits if sc == hits[0][0]]
        if len(top) == 1:
            return top[0].entity_id, []
        # A tie often comes from a device's name: its main entity is the one
        # whose own name (or alias) is what was said.
        qk = finder._key(q)
        own = [e for e in top if qk in (finder._key(e.name), *(finder._key(a) for a in e.aliases))]
        if len(own) == 1:
            return own[0].entity_id, []
        return None, [e.entity_id for e in (own or top)][:4]

    def thing(self, entity_id: str) -> answers.Thing | None:
        st = self.hass.states.get(entity_id)
        if st is None:
            return None
        voice = self.hass.data.get(DOMAIN, {}).get("voice")
        idx = getattr(voice, "_index", None)
        entry = idx.by_id.get(entity_id) if idx else None
        return answers.Thing(entity_id, st.name, st.state, dict(st.attributes),
                             dt_util.as_local(st.last_changed), entry.area if entry else "")

    def _names(self, ids: list[str]) -> list[str]:
        return [(st.name if (st := self.hass.states.get(e)) else e) for e in ids]

    # ------------------------------------------------------------ answering

    async def answer(self, cmd: str, slots: dict[str, str], words: dict[str, Any],
                     entity_id: str | None = None) -> Reply | None:
        s = self.engine.config["brain"]
        if cmd in brain.RECKON:
            text = await self._reckon(cmd, slots, words, s)
            return Reply(text, detail=cmd) if text else None
        if cmd in brain.OUTSIDE:
            text = await self._outside(cmd, slots, words, s)
            return Reply(text, detail=cmd) if text else None
        if cmd == "entity_count":
            return await self._count(slots, words, s)
        attr = slots.get("attr", "")
        if entity_id is None:
            name = slots.get("name", "")
            entity_id, choices = None, []
            if cmd == "entity" and not attr:
                # "the Scope Echo's volume": a thing and one of its attributes,
                # when that thing has it; else the whole name is the thing.
                attr, rest = _split_attribute(name, words)
                if attr:
                    entity_id, choices = await self.resolve(rest, s)
                    t = self.thing(entity_id) if entity_id else None
                    unit = self.hass.config.units.temperature_unit
                    if t is None or answers.attribute(t, attr, unit) is None:
                        entity_id, choices, attr = None, [], ""
            if entity_id is None and not choices:
                entity_id, choices = await self.resolve(name, s)
            if entity_id is None:
                if choices and s["ask_which"]:
                    return Reply(answers.which_reply(self._names(choices), words),
                                 choices=choices)
                if cmd in brain.HOUSE_ONLY and s["say_unknown"] and _clean(name):
                    return Reply(answers.unknown_reply(_clean(name), words), unknown=True)
                return None
            if attr:
                slots = {**slots, "attr": attr}
        thing = self.thing(entity_id)
        if thing is None:
            return None
        now = dt_util.now()
        text = await self._about(cmd, thing, slots, words, now)
        return Reply(text, detail=entity_id) if text else None

    async def _about(self, cmd: str, t: answers.Thing, slots: dict[str, str],
                     words: dict[str, Any], now: datetime) -> str | None:
        if cmd == "entity":
            if slots.get("attr"):
                return answers.attribute_reply(t, slots["attr"], words,
                                               self.hass.config.units.temperature_unit)
            if slots.get("compare") and slots.get("value"):
                return answers.compare_reply(t, slots["compare"], slots["value"], words, now)
            if slots.get("state"):
                return answers.yes_no_reply(t, slots["state"], words, now)
            return answers.state_reply(t, words, now)
        if cmd == "entity_when":
            # A restart resets every state's last_changed: the history says
            # when it really changed.
            start = now - timedelta(days=WHEN_DAYS)
            changes = await self._history(t.entity_id, start, now)
            if changes:
                since = answers.settled_since(changes, t.state)
                t.last_changed, t.long_ago = (since, False) if since else (start, True)
            if slots.get("state"):           # how long has it been ...
                return answers.how_long_reply(t, slots["state"], words, now)
            asked = slots.get("event", "")
            got = answers.when_reply(t, asked, words, now)
            if got is not None:
                return got
            hits = answers.times_in(changes, asked, t, words, start)
            return answers.when_reply(t, asked, words, now, hits[-1] if hits else None, True)
        if cmd == "entity_history":
            period = slots.get("period") or "today"
            start, end = answers.period_span(period, now)
            changes = await self._history(t.entity_id, start, end)
            if slots.get("stat") or not slots.get("event"):
                return answers.stat_reply(t, slots.get("stat") or "max", period, changes, words,
                                          now, end)
            return answers.times_reply(t, slots["event"], period, changes, words, now, start,
                                       count="times" in slots.get("_text", ""))
        return None

    async def _count(self, slots: dict[str, str], words: dict[str, Any],
                     s: dict[str, Any]) -> Reply | None:
        idx = await self._index()
        if idx is None:
            return None
        area = _clean(slots.get("area", ""))
        reg, skip = er.async_get(self.hass), set(s["count_skip"])
        things = [t for e in idx.entries if (e.exposed or not s["exposed_only"])
                  and not (skip and (r := reg.async_get(e.entity_id)) and r.platform in skip)
                  and (t := self.thing(e.entity_id)) is not None]
        if area and not any(answers.in_area(t.area, area, t.name) for t in things):
            return None              # not a room he knows: maybe the delegate does
        text = slots.get("_text", "").lower()
        ask = "all" if " all " in f" {text} " else "count"
        return Reply(answers.count_reply(things, slots.get("thing", "anything"),
                                         slots.get("state", "on"), area, ask, words,
                                         dt_util.now()))

    # ------------------------------------------------------------ time, dates, sums

    async def _reckon(self, cmd: str, slots: dict[str, str], words: dict[str, Any],
                      s: dict[str, Any]) -> str | None:
        if cmd == "maths":
            return reckon.sum_reply(slots.get("expr", ""), words)
        if cmd == "convert":
            return reckon.convert_reply(slots.get("value", ""), slots.get("src", ""),
                                        slots.get("dst", ""), words, s["imperial"])
        now = dt_util.now()
        if cmd == "dates":
            ask = slots.get("ask", "")
            if ask in ("week", "year_left", "month_left", "leap"):
                return reckon.calendar_reply(ask, slots.get("date", ""), now.date(), words)
            named = reckon.holidays(words, s["dates"])
            return reckon.date_reply(ask, slots.get("date", ""), now.date(), words, named)
        if cmd == "world_time":
            tz = await self._zone(slots.get("place", ""), words)
            if tz is None:
                return None
            return reckon.world_reply(slots.get("wt", "time"), slots.get("place", ""), now,
                                      now.astimezone(tz), words)
        return None

    async def _zone(self, place: str, words: dict[str, Any]) -> Any:
        """The time zone a place names, or None. zoneinfo reads files: the
        list and each zone are read once, off the event loop."""
        from zoneinfo import ZoneInfo, available_timezones  # noqa: PLC0415
        if self._zones is None:
            zones = await self.hass.async_add_executor_job(available_timezones)
            self._zones = reckon.zone_names(zones)
        name = reckon.find_zone(place, self._zones, words)
        if name is None:
            return None
        if name not in self._tz:
            try:
                self._tz[name] = await self.hass.async_add_executor_job(ZoneInfo, name)
            except (ValueError, OSError):
                return None
        return self._tz[name]

    # ------------------------------------------------------------ outside

    async def _outside(self, cmd: str, slots: dict[str, str], words: dict[str, Any],
                       s: dict[str, Any]) -> str | None:
        now = dt_util.now()
        if cmd == "moon":
            return outside.moon_reply(slots.get("phase", "") if not slots.get("when") else "",
                                      slots.get("phase", "") if slots.get("when") else "",
                                      words, now)
        if cmd == "sun":
            return outside.sun_reply(self._sun_times(now), slots.get("sun_event", ""),
                                     slots.get("day", ""), slots.get("until", ""),
                                     slots.get("light", ""), words, now)
        place, span = _split_span(slots.get("place", ""), slots.get("span", ""), words)
        w = await self._weather(place, s, now, hourly=True, daily=cmd != "weather_gear")
        if w is None:
            return None
        if cmd == "weather_now":
            return outside.now_reply(w, slots.get("ask", ""), slots.get("aspect", ""), words, now, s)
        if cmd == "weather_gear":
            return outside.gear_reply(w, slots.get("gear", ""), span, words, now, s)
        return outside.forecast_reply(w, slots.get("ask", ""), span, slots.get("hilo", ""),
                                      slots.get("change", ""), words, now, s)

    def _weather_entity(self, place: str, s: dict[str, Any]) -> str | None:
        """The weather entity a place means, else the chosen one, else the
        house's: one named like home (met.no's default), else the first."""
        if place:
            voice = self.hass.data.get(DOMAIN, {}).get("voice")
            idx = getattr(voice, "_index", None)
            hit = idx.best(place, ("weather",), floor=50) if idx else None
            return hit.entity_id if hit else None
        if s["weather"] and self.hass.states.get(s["weather"]) is not None:
            return s["weather"]
        ids = sorted(self.hass.states.async_entity_ids("weather"))
        return next((e for e in ids if "home" in e), ids[0] if ids else None)

    async def _weather(self, place: str, s: dict[str, Any], now: datetime, hourly: bool,
                       daily: bool) -> outside.Weather | None:
        if place:
            await self._index()             # built once, then kept
        entity = self._weather_entity(place, s)
        st = self.hass.states.get(entity) if entity else None
        if st is None or st.state in answers.GONE:
            return None
        tz = now.tzinfo
        return outside.Weather(
            st.name, st.state, dict(st.attributes),
            outside.rows(await raw_forecast(self.hass, entity, "hourly"), tz) if hourly else [],
            outside.rows(await raw_forecast(self.hass, entity, "daily"), tz) if daily else [],
            place=place.title() if place else "")

    def _sun_times(self, now: datetime) -> dict[int, dict[str, datetime | None]]:
        """Dawn, sunrise, noon, sunset and dusk yesterday, today and tomorrow,
        from Home Assistant's own sun maths (no I/O)."""
        from homeassistant.helpers.sun import get_astral_event_date  # noqa: PLC0415
        out: dict[int, dict[str, datetime | None]] = {}
        for off in (-1, 0, 1, 2):
            day = now.date() + timedelta(days=off)
            got = {}
            for event in outside.SUN_EVENTS:
                try:
                    at = get_astral_event_date(self.hass, event, day)
                except ValueError:          # the sun doesn't rise or set that day
                    at = None
                got[event] = dt_util.as_local(at) if at else None
            out[off] = got
        return out

    async def _history(self, entity_id: str, start: datetime, end: datetime
                       ) -> list[answers.Change]:
        if "recorder" not in self.hass.config.components:
            return []
        # Imported here: the recorder is optional and its import is heavy.
        from homeassistant.components.recorder import get_instance, history  # noqa: PLC0415

        def read() -> list[Any]:
            return history.state_changes_during_period(
                self.hass, start, end, entity_id=entity_id, no_attributes=True,
                include_start_time_state=True).get(entity_id, [])
        try:
            states = await get_instance(self.hass).async_add_executor_job(read)
        except Exception:  # a broken recorder still gets an answer, without history
            _LOGGER.exception("Alfie couldn't read the history of %s", entity_id)
            return []
        return [(max(dt_util.as_local(st.last_changed), start), st.state) for st in states]


def _clean(text: str) -> str:
    t = " ".join(str(text or "").replace("’", "'").split()).strip(" ?.!,")
    for lead in ("the ", "my ", "our "):
        if t.lower().startswith(lead):
            t = t[len(lead):]
    return t


def _split_span(place: str, span: str, words: dict[str, Any]) -> tuple[str, str]:
    """("whistler tomorrow", "") -> ("whistler", "tomorrow"): a time said after
    the place lands in the place's wildcard."""
    p = _clean(place).lower()
    spans = (words.get("lists") or {}).get("span") or {}
    for phrase in sorted((k for k in spans if not k.startswith("_")), key=len, reverse=True):
        if p.endswith(" " + phrase):
            return p[:-len(phrase) - 1].strip(), span or spans[phrase]
    return p, span


def _split_attribute(name: str, words: dict[str, Any]) -> tuple[str, str]:
    """("kitchen light's brightness") -> ("brightness", "kitchen light")."""
    t = _clean(name).lower()
    attrs = ((words.get("lists") or {}).get("attr") or {})
    for phrase in sorted((p for p in attrs if not p.startswith("_")), key=len, reverse=True):
        for cut in (f"'s {phrase}", f" {phrase}"):
            if t.endswith(cut):
                return attrs[phrase], t[:-len(cut)]
    return "", t
