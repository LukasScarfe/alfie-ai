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

import asyncio
import logging
import random
import time
from collections import OrderedDict
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

import aiohttp
from homeassistant.core import HomeAssistant
from homeassistant.util import dt as dt_util

from homeassistant.helpers import entity_registry as er
from homeassistant.helpers.aiohttp_client import async_get_clientsession

from . import answers, brain, finder, fun, household, openmeteo, outside, reckon, wiki
from .const import DOMAIN, VERSION
from .providers.forecast import raw_forecast

_LOGGER = logging.getLogger(__name__)

WHEN_DAYS = 7       # "when was the door last opened": how far back to look
CALENDAR_DAYS = 366 # events read ahead, so a birthday months away is found
SEARCH = 8          # finder hits weighed per name
WIKI_CACHE = 200    # Wikipedia answers kept (and names with no article)
PLACES = 300        # places looked up kept (and names that aren't one)
FORECASTS = 50      # places' forecasts kept


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
        self._events: list[household.Event] = []
        self._events_until = 0.0                      # monotonic; 0 means fetch again
        self._events_of: tuple[str, ...] = ()         # the calendars read, and watched
        self._unwatch: Any = None
        self._rng = random.Random()
        self._jokes = fun.JokeBag()
        self._books: dict[tuple[str, str], str] = {}   # (url, wanted) -> kiwix book
        self._wiki: OrderedDict[tuple[Any, ...], str] = OrderedDict()   # "" no article
        self._places: OrderedDict[tuple[str, str], dict[str, Any] | None] = OrderedDict()
        self._forecasts: OrderedDict[tuple[Any, ...], tuple[float, dict[str, Any]]] = OrderedDict()
        self._pasts: OrderedDict[tuple[Any, ...], tuple[float, dict[str, Any]]] = OrderedDict()

    def close(self) -> None:
        if self._unwatch:
            self._unwatch()
            self._unwatch = None

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
        if cmd == "run":
            return await self._run(slots, words, s, entity_id)
        if cmd in brain.RECKON:
            text = await self._reckon(cmd, slots, words, s)
            return Reply(text, detail=cmd) if text else None
        if cmd in brain.HOUSEHOLD:
            text = await self._household(cmd, slots, words, s)
            return Reply(text, detail=cmd) if text else None
        if cmd == "wiki":
            text = await self._wiki_answer(slots.get("topic", ""), words, s)
            return Reply(text, detail=cmd) if text else None
        if cmd in brain.FUN:
            text = self._fun(cmd, slots, words, s)
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
            text, today = slots.get("date", ""), now.date()
            own = reckon.holidays({}, s["dates"])
            named = {**reckon.holidays(words), **own}
            key, _way, year = reckon.date_key(text)
            # A date the calendar names beats the language's rule for it
            # (the calendar knows this year's), never the user's own.
            if s["calendar_dates"] and ask != "since" and key and key not in own and \
                    reckon.parse_when(text, today, {}) is None:
                got = household.event_date(key, await self._calendar(), today)
                if got and (not year or got[0].year == year):
                    named[key] = reckon.When(fixed=got[0], name=got[1])
            return reckon.date_reply(ask, text, today, words, named)
        if cmd == "world_time":
            tz = await self._zone(slots.get("place", ""), words)
            if tz is None:
                return None
            return reckon.world_reply(slots.get("wt", "time"), slots.get("place", ""), now,
                                      now.astimezone(tz), words)
        return None

    def _fun(self, cmd: str, slots: dict[str, str], words: dict[str, Any],
             s: dict[str, Any]) -> str | None:
        value, rng = slots.get("value", ""), self._rng
        if cmd == "coin":
            return fun.coin_reply(words, rng)
        if cmd == "dice":
            return fun.dice_reply(value or "a die", words, rng)
        if cmd == "number":
            return fun.number_reply(value, words, rng, s["random_max"])
        if cmd == "pick":
            return fun.pick_reply(fun.with_commas(value, slots.get("_text", "")), words, rng)
        if cmd == "joke":
            text = fun.joke_reply(self._jokes, words, s["jokes"], s["builtin_jokes"], rng)
            self.engine.joke_reaction()
            return text
        if cmd == "chat":
            made = getattr(self.engine.entry, "created_at", None)
            days = (dt_util.now() - made).days if made else None
            return fun.chat_reply(slots.get("ask", ""), words, rng, self.engine.name, days,
                                  VERSION)
        return None

    # ------------------------------------------------------------ Wikipedia

    async def _wiki_answer(self, name: str, words: dict[str, Any], s: dict[str, Any]) -> str | None:
        """The lead of the article called `name`, from kiwix-serve; None for no
        such article (or a disambiguation page), and the turn goes on."""
        url = s["wiki_url"].rstrip("/")
        if not url or not wiki.asks_about(name, words):
            return None
        key = (url, s["wiki_book"], wiki.clean_name(name).lower(), s["wiki_sentences"],
               s["wiki_brackets"])
        if key in self._wiki:
            self._wiki.move_to_end(key)
            got = self._wiki[key]
        else:
            got = await self._wiki_fetch(url, name, s)
            if got is None:          # kiwix down: ask again next time
                return None
            self._wiki[key] = got
            while len(self._wiki) > WIKI_CACHE:
                self._wiki.popitem(last=False)
        if not got:
            return None
        return wiki.say(words, "credit", text=got) if s["wiki_credit"] else got

    async def _wiki_fetch(self, url: str, name: str, s: dict[str, Any]) -> str | None:
        """"" for no article, None when kiwix-serve can't be asked."""
        session = async_get_clientsession(self.hass)
        timeout = aiohttp.ClientTimeout(total=s["wiki_seconds"])
        try:
            book = self._books.get((url, s["wiki_book"]))
            if book is None:
                async with session.get(f"{url}/catalog/v2/entries?count=100", timeout=timeout) as r:
                    book = wiki.book_of(await r.text(), s["wiki_book"]) if r.status == 200 else None
                if book is None:
                    _LOGGER.warning("Alfie found no book %s at %s", s["wiki_book"] or "", url)
                    return None
                self._books[(url, s["wiki_book"])] = book
            for title in wiki.titles_for(name):
                page = await self._wiki_page(session, url + wiki.path_of(book, title), timeout)
                if page is None:
                    continue
                _title, paras, disamb = await self.hass.async_add_executor_job(wiki.read_lead, page)
                if disamb:
                    continue    # "the meaning of life" is one; "Meaning of life" isn't
                return wiki.lead_reply(paras, s["wiki_sentences"], s["wiki_brackets"]) or ""
        except (aiohttp.ClientError, asyncio.TimeoutError) as err:
            _LOGGER.debug("Alfie couldn't ask kiwix-serve at %s: %s", url, err)
            return None
        return ""

    @staticmethod
    async def _wiki_page(session: Any, url: str, timeout: Any) -> str | None:
        """An article's HTML up to its first section (redirects followed), or
        None when there's no such article."""
        async with session.get(url, timeout=timeout) as r:
            if r.status != 200:
                return None
            buf = bytearray()
            end = wiki.END.encode()
            async for chunk in r.content.iter_chunked(65536):
                tail = len(buf)
                buf += chunk
                if end in buf[max(0, tail - len(end)):] or len(buf) >= wiki.ENOUGH:
                    break
        return buf.decode("utf-8", "replace")

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

    # ------------------------------------------------------------ voice actions

    def actions(self, s: dict[str, Any]) -> list[str]:
        """What carries the voice label and can be started: scripts,
        automations, scenes and buttons. The registry keeps an index by label,
        so this is cheap and always current."""
        from homeassistant.helpers import label_registry as lr  # noqa: PLC0415
        name = s["voice_label"]
        label = lr.async_get(self.hass).async_get_label_by_name(name) if name else None
        if label is None:
            return []
        return sorted(e.entity_id for e in er.async_entries_for_label(er.async_get(self.hass),
                                                                      label.label_id)
                      if e.domain in brain.RUNNABLE and not e.disabled_by)

    def ensure_label(self, s: dict[str, Any]) -> None:
        """Create the voice label when it doesn't exist, so it shows in Home
        Assistant's editors."""
        from homeassistant.helpers import label_registry as lr  # noqa: PLC0415
        name, reg = s["voice_label"], lr.async_get(self.hass)
        if name and reg.async_get_label_by_name(name) is None:
            try:
                reg.async_create(name, icon="mdi:account-voice", description=(
                    f"{self.engine.name} starts these by voice: \"turn on\" or \"run\" "
                    "and the name, or the name alone."))
            except ValueError:            # made meanwhile
                pass

    async def _run(self, slots: dict[str, str], words: dict[str, Any], s: dict[str, Any],
                   entity_id: str | None) -> Reply | None:
        if entity_id is None:
            ids = self.actions(s)
            if not ids:
                return None
            name = _clean(slots.get("name", ""))
            if not name:
                return None
            await self._index()
            voice = self.hass.data.get(DOMAIN, {}).get("voice")
            idx = getattr(voice, "_index", None)
            entries = [(idx.by_id.get(e) if idx else None) or
                       finder.Entry(e, (st.name if (st := self.hass.states.get(e)) else e))
                       for e in ids]
            # Said alone, a name must be one of the thing's names, whole.
            if _clean(slots.get("_text", "")).lower() == name.lower():
                if not s["run_bare"]:
                    return None
                key = finder._key(name)
                exact = [e for e in entries
                         if key in (finder._key(e.name), *(finder._key(a) for a in e.aliases))]
                if len(exact) != 1:
                    return None
                entity_id = exact[0].entity_id
            else:
                hits = finder.Index(entries).search(name, SEARCH)
                if not hits or hits[0][0] < s["match_floor"]:
                    return None
                top = [e for sc, e in hits if sc == hits[0][0]]
                if len(top) > 1:
                    if s["ask_which"]:
                        ids = [e.entity_id for e in top][:4]
                        return Reply(answers.which_reply(self._names(ids), words), choices=ids)
                    return None
                entity_id = top[0].entity_id
        st = self.hass.states.get(entity_id)
        domain = entity_id.split(".", 1)[0]
        if st is None or domain not in brain.RUNNABLE:
            return None
        service_domain, service = brain.RUNNABLE[domain]
        data: dict[str, Any] = {"entity_id": entity_id}
        if domain == "automation":
            data["skip_condition"] = not s["run_conditions"]
        try:
            # Not blocking: a long script (wake the PC, wait for the TV) runs on
            # while he answers.
            await self.hass.services.async_call(service_domain, service, data, blocking=False)
        except Exception:  # noqa: BLE001 (a bad action still gets an answer)
            _LOGGER.exception("Alfie couldn't start %s", entity_id)
            return Reply(household.run_reply(st.name, words, "", failed=True), detail=entity_id)
        return Reply(household.run_reply(st.name, words, s["run_reply"]), detail=entity_id)

    # ------------------------------------------------------------ people, media, calendar, lists

    async def _household(self, cmd: str, slots: dict[str, str], words: dict[str, Any],
                         s: dict[str, Any]) -> str | None:
        now = dt_util.now()
        ask, name = slots.get("ask", ""), _clean(slots.get("name", ""))
        if cmd == "people":
            return await self._people(ask, name, words, s, now)
        if cmd == "media":
            players = self._players(s)
            named = None
            if name:
                named = self._pick(name, "media_player", s)
                if named is None:
                    return None
            return household.media_reply(ask, players, words, named and household.Player(
                named.entity_id, named.name, named.state, dict(named.attributes)))
        if cmd == "calendar":
            events = await self._calendar()
            span = slots.get("span", "")
            if ask == "when":
                asked = _clean(slots.get("what", ""))
                if not asked or asked.lower() in reckon.holidays({}, s["dates"]):
                    return None
                return household.when_reply(asked, events, words, now, span)
            if s["calendars"]:
                events = [e for e in events if e.calendar in s["calendars"]]
            return household.events_reply(ask, span, events, words, now, s["event_max"])
        if cmd == "lists":
            if ask in ("shop", "has_shop") or not name or name.lower() in ("to do", "todo", "to-do"):
                st = self._default_list(s)
            else:
                st = self._pick_list(name, s)
            if st is None:
                return household.no_list(name, words) if name else None
            items = await self._items(st.entity_id)
            if items is None:
                return None
            ask = {"shop": "items", "has_shop": "has"}.get(ask, ask)
            return household.list_reply(ask, st.name, items, words, slots.get("item", ""),
                                        s["list_max"])
        return None

    def _pick(self, name: str, domain: str, s: dict[str, Any]) -> Any:
        """The state of the one `domain` entity a name means, or None."""
        voice = self.hass.data.get(DOMAIN, {}).get("voice")
        idx = getattr(voice, "_index", None)
        hit = idx.best(name, (domain,), floor=s["match_floor"]) if idx else None
        if hit is not None and (hit.exposed or not s["exposed_only"]):
            return self.hass.states.get(hit.entity_id)
        states = self.hass.states.async_all(domain)
        got = household.best_match(name, states, lambda st: st.name)
        return got[0] if got else None

    async def _people(self, ask: str, name: str, words: dict[str, Any], s: dict[str, Any],
                      now: datetime) -> str | None:
        await self._index()
        people = [household.Person(st.entity_id, st.name, st.state,
                                   last_changed=dt_util.as_local(st.last_changed))
                  for st in sorted(self.hass.states.async_all("person"), key=lambda x: x.name)]
        if ask in ("who", "anyone", "everyone"):
            return household.people_reply(ask, people, None, words, now)
        st = self._pick(name, "person", s) if name else None
        if st is None:
            return None
        who = next(p for p in people if p.entity_id == st.entity_id)
        if ask in ("how_long", "arrived", "left"):
            who.start = now - timedelta(days=WHEN_DAYS)
            who.changes = await self._history(who.entity_id, who.start, now)
        return household.people_reply(ask, people, who, words, now)

    def _players(self, s: dict[str, Any]) -> list[household.Player]:
        """The players "what's playing" looks at: the chosen ones, else every
        one but Music Assistant groups and the skipped integrations'."""
        if s["media_players"]:
            states = [st for e in s["media_players"] if (st := self.hass.states.get(e))]
        else:
            reg, skip = er.async_get(self.hass), set(s["media_skip"])
            voice = self.hass.data.get(DOMAIN, {}).get("voice")
            idx = getattr(voice, "_index", None)
            states = []
            for st in self.hass.states.async_all("media_player"):
                if st.attributes.get("mass_player_type") == "group":
                    continue
                if skip and (r := reg.async_get(st.entity_id)) and r.platform in skip:
                    continue
                if s["exposed_only"] and idx and not getattr(idx.by_id.get(st.entity_id), "exposed", False):
                    continue
                states.append(st)
        return [household.Player(st.entity_id, st.name, st.state, dict(st.attributes))
                for st in states]

    async def _calendar(self) -> list[household.Event]:
        """Every calendar's events for the next year, from midnight today:
        one `calendar.get_events`, kept for `calendar_minutes` and until a
        calendar entity changes (an event starting or ending, an edit)."""
        s = self.engine.config["brain"]
        cals = tuple(sorted(self.hass.states.async_entity_ids("calendar")))
        if cals != self._events_of:
            self.close()
            self._events_of, self._events_until = cals, 0.0
            if cals:
                from homeassistant.helpers.event import async_track_state_change_event  # noqa: PLC0415

                def changed(_event: Any) -> None:
                    self._events_until = 0.0
                self._unwatch = async_track_state_change_event(self.hass, list(cals), changed)
        if not cals:
            return []
        if time.monotonic() < self._events_until:
            return self._events
        now = dt_util.now()
        start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        try:
            resp = await self.hass.services.async_call(
                "calendar", "get_events",
                {"entity_id": list(cals), "start_date_time": start.isoformat(),
                 "end_date_time": (start + timedelta(days=CALENDAR_DAYS)).isoformat()},
                blocking=True, return_response=True)
        except Exception:  # a broken calendar: answer from what's kept
            _LOGGER.exception("Alfie couldn't read the calendars")
            return self._events
        self._events = household.parse_events(resp, now.tzinfo)
        self._events_until = time.monotonic() + 60 * s["calendar_minutes"]
        return self._events

    def _default_list(self, s: dict[str, Any]) -> Any:
        for e in (s["todo_list"], "todo.shopping_list"):
            if e and (st := self.hass.states.get(e)) is not None:
                return st
        todos = sorted(self.hass.states.async_all("todo"), key=lambda x: x.entity_id)
        return todos[0] if todos else None

    def _pick_list(self, name: str, s: dict[str, Any]) -> Any:
        """A list by its name ("groceries", "to buy"), then by the finder."""
        got = household.best_match(name, self.hass.states.async_all("todo"), lambda st: st.name)
        return got[0] if got else self._pick(name, "todo", s)

    async def _items(self, entity_id: str) -> list[str] | None:
        try:
            resp = await self.hass.services.async_call(
                "todo", "get_items", {"entity_id": entity_id, "status": ["needs_action"]},
                blocking=True, return_response=True)
        except Exception:  # a broken list: the turn goes on
            _LOGGER.exception("Alfie couldn't read %s", entity_id)
            return None
        items = ((resp or {}).get(entity_id) or {}).get("items") or []
        return [str(i.get("summary") or "").strip() for i in items if str(i.get("summary") or "").strip()]

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
        if cmd == "weather_past":
            place, span = _split_span(slots.get("place", ""), slots.get("span", ""), words,
                                      "past_span")
            span = span or outside.default_past_span(now)
            w = await self._past(place, span, s, now)
            if w is None:
                return None
            if w.tz is not None:
                now = now.astimezone(w.tz)
            return outside.past_reply(w, slots.get("ask", ""), span, slots.get("hilo", ""),
                                      bool(slots.get("amount")), words, now, s)
        place, span = _split_span(slots.get("place", ""), slots.get("span", ""), words)
        if cmd == "weather_now" and span and span != "now" and not slots.get("aspect"):
            cmd = "weather_forecast"    # "the weather in Tokyo tonight": a time said
        w = await self._weather(place, s, now, hourly=True, daily=cmd != "weather_gear")
        if w is None:
            return None
        if w.tz is not None:
            now = now.astimezone(w.tz)      # "tonight" is the place's night
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
        if place and entity is None:
            return await self._anywhere(place, s)
        st = self.hass.states.get(entity) if entity else None
        if st is None or st.state in answers.GONE:
            return None
        tz = now.tzinfo
        return outside.Weather(
            st.name, st.state, dict(st.attributes),
            outside.rows(await raw_forecast(self.hass, entity, "hourly"), tz) if hourly else [],
            outside.rows(await raw_forecast(self.hass, entity, "daily"), tz) if daily else [],
            place=place.title() if place else "")

    # ------------------------------------------------------------ anywhere

    def _units(self) -> dict[str, str]:
        u = self.hass.config.units
        return {"temperature": str(u.temperature_unit),
                "wind": str(getattr(u, "wind_speed_unit", "km/h") or "km/h"),
                "rain": str(getattr(u, "accumulated_precipitation_unit", "mm") or "mm")}

    def _in_house(self, place: str) -> bool:
        """Whether a place is somewhere in the house (an area or floor, by
        name or alias): "how cold is it in the kitchen" isn't a town."""
        from homeassistant.helpers import area_registry as ar, floor_registry as fr  # noqa: PLC0415
        want = openmeteo.key(place.removeprefix("the "))
        for a in ar.async_get(self.hass).async_list_areas():
            if want in {openmeteo.key(n) for n in (a.name, *a.aliases)}:
                return True
        for f in fr.async_get(self.hass).async_list_floors():
            if want in {openmeteo.key(n) for n in (f.name, *f.aliases)}:
                return True
        return False

    async def _anywhere(self, place: str, s: dict[str, Any]) -> outside.Weather | None:
        """The weather in a place with no weather entity, from Open-Meteo; None
        when it's off, not a place it knows, or it can't be asked (the turn
        goes on)."""
        if not s["weather_anywhere"] or not s["weather_url"] or not s["weather_geo_url"] \
                or self._in_house(place):
            return None
        session = async_get_clientsession(self.hass)
        timeout = aiohttp.ClientTimeout(total=s["weather_seconds"])
        try:
            spot = await self._place(session, timeout, place, s)
            if spot is None:
                return None
            units = self._units()
            fkey = (s["weather_url"], spot["lat"], spot["lon"], tuple(sorted(units.items())))
            got = self._forecasts.get(fkey)
            if got is None or time.monotonic() - got[0] > 60 * s["weather_minutes"]:
                async with session.get(s["weather_url"], timeout=timeout,
                                       params=openmeteo.forecast_params(spot["lat"], spot["lon"],
                                                                        units)) as r:
                    data = openmeteo.parse(await r.json(content_type=None), units) \
                        if r.status == 200 else None
                if data is None:
                    _LOGGER.debug("Alfie got no forecast for %s (%s)", place, r.status)
                    return None
                got = (time.monotonic(), data)
                self._forecasts[fkey] = got
                while len(self._forecasts) > FORECASTS:
                    self._forecasts.popitem(last=False)
            self._forecasts.move_to_end(fkey)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as err:
            _LOGGER.debug("Alfie couldn't ask Open-Meteo about %s: %s", place, err)
            return None
        data = got[1]
        tz = dt_util.get_time_zone(data["tz"]) or dt_util.DEFAULT_TIME_ZONE
        return outside.Weather(spot["name"], data["state"], data["attributes"],
                               outside.rows(data["hourly"], tz), outside.rows(data["daily"], tz),
                               place=place.title(), tz=tz)

    # ------------------------------------------------------------ the recent past

    async def _past(self, place: str, span: str, s: dict[str, Any],
                    now: datetime) -> outside.Weather | None:
        """The hours behind us (outside.past_reply reads them): from
        Open-Meteo, else the weather entity's recorded history; a rain gauge's
        amounts over them when there is one. None: nothing to tell."""
        how = s["weather_past"]
        if how == "off":
            return None
        start = outside.past_window(span, now)[0]
        w = None
        if how == "openmeteo":
            w = await self._past_openmeteo(place, s)
        if w is None and (not place or self._weather_entity(place, s)):
            w = await self._past_history(place, s, start, now)
        if w is not None and not place and s["rain_gauge"]:
            await self._gauge(w, s["rain_gauge"], start, now)
        return w

    async def _past_openmeteo(self, place: str, s: dict[str, Any]) -> outside.Weather | None:
        if not s["weather_url"]:
            return None
        session = async_get_clientsession(self.hass)
        timeout = aiohttp.ClientTimeout(total=s["weather_seconds"])
        units = self._units()
        try:
            if place:
                if not s["weather_anywhere"] or not s["weather_geo_url"] or self._in_house(place):
                    return None
                spot = await self._place(session, timeout, place, s)
                if spot is None:
                    return None
            else:           # the house, to about a kilometre
                spot = {"lat": round(self.hass.config.latitude, 2),
                        "lon": round(self.hass.config.longitude, 2),
                        "name": self.hass.config.location_name}
            key = (s["weather_url"], spot["lat"], spot["lon"], tuple(sorted(units.items())))
            got = self._pasts.get(key)
            if got is None or time.monotonic() - got[0] > 60 * s["weather_minutes"]:
                async with session.get(s["weather_url"], timeout=timeout,
                                       params=openmeteo.past_params(spot["lat"], spot["lon"],
                                                                    units)) as r:
                    data = openmeteo.parse_past(await r.json(content_type=None)) \
                        if r.status == 200 else None
                if data is None:
                    _LOGGER.debug("Alfie got no past weather for %s (%s)", place or "home",
                                  r.status)
                    return None
                got = (time.monotonic(), data)
                self._pasts[key] = got
                while len(self._pasts) > FORECASTS:
                    self._pasts.popitem(last=False)
            self._pasts.move_to_end(key)
        except (aiohttp.ClientError, asyncio.TimeoutError, ValueError) as err:
            _LOGGER.debug("Alfie couldn't ask Open-Meteo about the past (%s): %s",
                          place or "home", err)
            return None
        data = got[1]
        tz = (dt_util.get_time_zone(data["tz"]) or dt_util.DEFAULT_TIME_ZONE) if place else None
        attrs = {"temperature_unit": units["temperature"], "wind_speed_unit": units["wind"],
                 "precipitation_unit": units["rain"]}
        return outside.Weather(str(spot["name"]), "", attrs,
                               outside.rows(data["hourly"], tz or dt_util.DEFAULT_TIME_ZONE),
                               place=place.title() if place else "", tz=tz)

    async def _past_history(self, place: str, s: dict[str, Any], start: datetime,
                            now: datetime) -> outside.Weather | None:
        """The weather entity's recorded conditions and temperatures, an hour
        at a time (no amounts)."""
        entity = self._weather_entity(place, s)
        st = self.hass.states.get(entity) if entity else None
        if st is None or "recorder" not in self.hass.config.components:
            return None
        from homeassistant.components.recorder import get_instance, history  # noqa: PLC0415

        def read() -> list[Any]:
            return history.state_changes_during_period(
                self.hass, start, now, entity_id=entity, no_attributes=False,
                include_start_time_state=True).get(entity, [])
        try:
            states = await get_instance(self.hass).async_add_executor_job(read)
        except Exception:  # a broken recorder: the agent answers
            _LOGGER.exception("Alfie couldn't read the history of %s", entity)
            return None
        changes = [(dt_util.as_local(x.last_changed), x.state, dict(x.attributes))
                   for x in states if x.state not in answers.GONE]
        return outside.Weather(st.name, st.state, dict(st.attributes),
                               outside.history_rows(changes, start, now),
                               place=place.title() if place else "")

    async def _gauge(self, w: outside.Weather, entity: str, start: datetime,
                     now: datetime) -> None:
        """A rain gauge's amounts, hour by hour, over the rows it covers."""
        st = self.hass.states.get(entity)
        if st is None:
            return
        unit = str(st.attributes.get("unit_of_measurement") or "")
        got = await self._history(entity, start - timedelta(hours=1), now)
        if got:
            outside.gauge_into(w, got, unit, str(st.attributes.get("device_class") or ""))

    async def _place(self, session: Any, timeout: Any, place: str,
                     s: dict[str, Any]) -> dict[str, Any] | None:
        """Where a place name is (openmeteo.pick_place), kept, and so is a name
        that isn't a place; a geocoder that can't be asked raises."""
        language = (self.hass.config.language or "en").split("-")[0]
        ck = (s["weather_geo_url"], openmeteo.key(place))
        if ck in self._places:
            self._places.move_to_end(ck)
            return self._places[ck]
        spot = None
        for name, where in openmeteo.tries(place):
            async with session.get(s["weather_geo_url"], timeout=timeout,
                                   params=openmeteo.geo_params(name, language)) as r:
                if r.status != 200:
                    raise aiohttp.ClientError(f"geocoder answered {r.status}")
                spot = openmeteo.pick_place(await r.json(content_type=None), name, where)
            if spot is not None:
                break
        self._places[ck] = spot
        while len(self._places) > PLACES:
            self._places.popitem(last=False)
        return spot

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


def _split_span(place: str, span: str, words: dict[str, Any],
                list_name: str = "span") -> tuple[str, str]:
    """("whistler tomorrow", "") -> ("whistler", "tomorrow"): a time said after
    the place lands in the place's wildcard."""
    p = _clean(place).lower()
    spans = (words.get("lists") or {}).get(list_name) or {}
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
