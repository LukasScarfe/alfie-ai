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

from . import answers, brain, finder
from .const import DOMAIN

_LOGGER = logging.getLogger(__name__)

WHEN_DAYS = 7       # "when was the door last opened": how far back to look
SEARCH = 8          # finder hits weighed per name


@dataclass
class Reply:
    text: str
    detail: str = ""                      # the entity it was about, for the turn log
    choices: list[str] = field(default_factory=list)   # asked "which one?"


class LocalAnswers:
    def __init__(self, hass: HomeAssistant, engine: Any) -> None:
        self.hass, self.engine = hass, engine

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
                    return Reply(answers.unknown_reply(_clean(name), words))
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


def _split_attribute(name: str, words: dict[str, Any]) -> tuple[str, str]:
    """("kitchen light's brightness") -> ("brightness", "kitchen light")."""
    t = _clean(name).lower()
    attrs = ((words.get("lists") or {}).get("attr") or {})
    for phrase in sorted((p for p in attrs if not p.startswith("_")), key=len, reverse=True):
        for cut in (f"'s {phrase}", f" {phrase}"):
            if t.endswith(cut):
                return attrs[phrase], t[:-len(cut)]
    return "", t
