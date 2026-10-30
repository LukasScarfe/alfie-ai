"""Alfie's local answers (design.md "Brain" → Local answers): the replies to
the questions his own commands match, built from facts conversation.py
gathers (states, a little history), so the LLM isn't asked what the house
already knows.

PURE (no HA import), so the tests run under plain python. The words are the
language file's `answers`, `states`, `same_state` and `things`
(lang/<code>/brain.json). Times come in as aware datetimes in the house's
time zone; `now` is passed in, never read here.
"""

from __future__ import annotations

import math
from collections.abc import Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import datetime, timedelta
from typing import Any

from .finder import _key

LIST_MAX = 6        # names said in one reply before "and 3 more"
TIGHT_UNITS = ("%", "°", "°C", "°F")


@dataclass
class Thing:
    """One entity as a question needs it."""

    entity_id: str
    name: str
    state: str
    attributes: Mapping[str, Any] = field(default_factory=dict)
    last_changed: datetime | None = None
    area: str = ""
    # In its state for all the history read (a week): last_changed is only
    # when that history starts.
    long_ago: bool = False

    @property
    def domain(self) -> str:
        return self.entity_id.split(".", 1)[0]

    @property
    def device_class(self) -> str:
        return str(self.attributes.get("device_class") or "")

    @property
    def unit(self) -> str:
        return str(self.attributes.get("unit_of_measurement") or "")


def _t(words: Mapping[str, Any], key: str, **kw: Any) -> str:
    text = ((words or {}).get("answers") or {}).get(key) or key
    return text.format(**kw) if kw else text


# ------------------------------------------------------------ saying things

def number(value: Any) -> float | None:
    if isinstance(value, bool) or value is None:
        return None
    try:
        v = float(value)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


def say_number(v: float, unit: str = "") -> str:
    """21.46 °C -> "21.5°C"; 1234.0 W -> "1234 W"."""
    digits = 0 if abs(v) >= 100 else (1 if abs(v) >= 1 else 2)
    text = f"{round(v, digits):.{digits}f}".rstrip("0").rstrip(".") if digits else str(round(v))
    if text in ("-0", ""):
        text = "0"
    if not unit:
        return text
    return f"{text}{unit}" if unit.startswith(TIGHT_UNITS) else f"{text} {unit}"


def say_list(names: Sequence[str], words: Mapping[str, Any], joiner: str = "and") -> str:
    names = list(names)
    if len(names) > LIST_MAX:
        names = [*names[:LIST_MAX - 1], _t(words, "more", count=len(names) - LIST_MAX + 1)]
    if len(names) <= 1:
        return "".join(names)
    return f"{', '.join(names[:-1])} {_t(words, joiner)} {names[-1]}"


def say_time(at: datetime) -> str:
    """15:04 -> "3:04 pm", 15:00 -> "3 pm"."""
    hour = at.hour % 12 or 12
    ampm = "am" if at.hour < 12 else "pm"
    return f"{hour} {ampm}" if at.minute == 0 else f"{hour}:{at.minute:02d} {ampm}"


def say_when(at: datetime, now: datetime, words: Mapping[str, Any]) -> str:
    """When something happened (or will), the way a person says it: "at 3:04
    pm", "yesterday at 9 am", "on Monday at 6 pm", "on 12 March"."""
    days = (at.date() - now.date()).days
    time_ = say_time(at)
    if days == 0:
        return _t(words, "at", time=time_)
    if days == -1:
        return _t(words, "yesterday_at", time=time_)
    if days == 1:
        return _t(words, "tomorrow_at", time=time_)
    if -7 < days < 7:
        return _t(words, "day_at", day=at.strftime("%A"), time=time_)
    return _t(words, "date", date=f"{at.day} {at.strftime('%B')}")


def say_ago(seconds: float, words: Mapping[str, Any]) -> str:
    """A span in its two biggest units: "2 hours and 5 minutes", "3 days"."""
    units = ((words or {}).get("answers") or {}).get("units") or {}
    s = max(0, int(seconds))
    if s < 60:
        return _t(words, "just_now") if s < 10 else _unit(s, "second", units)
    parts = []
    for name, size in (("day", 86400), ("hour", 3600), ("minute", 60)):
        n, s = divmod(s, size)
        if n:
            parts.append(_unit(n, name, units))
        if len(parts) == 2 or (parts and name == "day" and n > 2):
            break
    return f" {_t(words, 'and')} ".join(parts[:2])


def _unit(n: int, name: str, units: Mapping[str, Any]) -> str:
    one, many = units.get(name) or (name, name + "s")
    return f"{n} {one if n == 1 else many}"


def say_state(thing: Thing, words: Mapping[str, Any], now: datetime | None = None,
              state: str | None = None) -> str:
    """A state the way he says it: "open", "21.5°C", "at 7:10 am"."""
    st = thing.state if state is None else state
    table = (words or {}).get("states") or {}
    for key in (f"{thing.domain}.{thing.device_class}", thing.domain, "_any"):
        said = (table.get(key) or {}).get(st)
        if said:
            return said
    v = number(st)
    if v is not None:
        return say_number(v, thing.unit)
    if thing.device_class == "timestamp" and now is not None:
        try:
            at = datetime.fromisoformat(st).astimezone(now.tzinfo)
            return say_when(at, now, words)
        except ValueError:
            pass
    return st.replace("_", " ")


def same_state(asked: str, said: str, raw: str, words: Mapping[str, Any]) -> bool:
    """Whether a state matches the one asked about ("is the door open?" and a
    door that is "open", or raw "on")."""
    asked, said, raw = asked.lower(), said.lower(), raw.lower()
    if asked in (said, raw):
        return True
    # Groups go by what the state is called: a door's raw "on" is said
    # "open", so it isn't "home" though "home" and "on" share a group.
    return any(isinstance(g, list) and asked in g and said in g
               for g in (words or {}).get("same_state") or [])


# ------------------------------------------------------------ entity answers

def state_reply(thing: Thing, words: Mapping[str, Any], now: datetime) -> str:
    return _t(words, "is", name=thing.name, state=say_state(thing, words, now))


def yes_no_reply(thing: Thing, asked: str, words: Mapping[str, Any], now: datetime) -> str:
    said = say_state(thing, words, now)
    key = "yes" if same_state(asked, said, thing.state, words) else "no"
    return _t(words, key, name=thing.name, state=said)


def compare_reply(thing: Thing, how: str, value: str, words: Mapping[str, Any],
                  now: datetime) -> str:
    v, limit = number(thing.state), number(str(value).strip().rstrip("%°"))
    if v is None:
        return _t(words, "not_number", name=thing.name, state=say_state(thing, words, now))
    if limit is None:
        return state_reply(thing, words, now)
    yes = v > limit if how == "above" else v < limit
    return _t(words, "yes" if yes else "no", name=thing.name, state=say_number(v, thing.unit))


def attribute(thing: Thing, attr: str, temp_unit: str = "") -> str | None:
    """An attribute said with its unit, or None when the thing has none."""
    a = thing.attributes

    def pct(v: Any, scale: float = 1.0) -> str | None:
        n = number(v)
        return None if n is None else f"{round(n * scale)}%"
    if attr == "brightness":
        return pct(a.get("brightness"), 100 / 255)
    if attr == "volume":
        return pct(a.get("volume_level"), 100)
    if attr == "position":
        return pct(a.get("current_position"))
    if attr == "speed":
        return pct(a.get("percentage"))
    if attr == "battery":
        return pct(a.get("battery_level", a.get("battery")))
    if attr == "humidity":
        return pct(a.get("current_humidity", a.get("humidity")))
    if attr in ("target_temperature", "current_temperature"):
        key = "temperature" if attr == "target_temperature" else "current_temperature"
        n = number(a.get(key))
        if n is None and attr == "target_temperature":
            lo, hi = number(a.get("target_temp_low")), number(a.get("target_temp_high"))
            if lo is not None and hi is not None:
                return f"{say_number(lo, temp_unit)} to {say_number(hi, temp_unit)}"
        return None if n is None else say_number(n, temp_unit)
    if attr == "color_temp":
        n = number(a.get("color_temp_kelvin"))
        return None if n is None else f"{round(n)} K"
    if attr == "color":
        rgb = a.get("rgb_color")
        return None if not rgb else color_name(rgb)
    key = {"source": "source", "mode": "hvac_mode", "preset": "preset_mode"}.get(attr)
    v = a.get(key) if key else None
    if attr == "mode" and v is None:
        v = thing.state if thing.domain == "climate" else None
    return None if v in (None, "") else str(v).replace("_", " ")


COLORS = {"red": (255, 0, 0), "orange": (255, 140, 0), "yellow": (255, 230, 0),
          "green": (0, 200, 0), "cyan": (0, 220, 220), "blue": (0, 60, 255),
          "purple": (150, 0, 255), "pink": (255, 100, 200), "white": (255, 255, 255),
          "warm white": (255, 200, 140)}


def color_name(rgb: Sequence[Any]) -> str:
    try:
        r, g, b = (float(x) for x in rgb[:3])
    except (TypeError, ValueError):
        return ""
    return min(COLORS, key=lambda n: sum((p - q) ** 2 for p, q in zip(COLORS[n], (r, g, b))))


def attribute_reply(thing: Thing, attr: str, words: Mapping[str, Any],
                    temp_unit: str = "") -> str:
    label = (((words or {}).get("answers") or {}).get("attrs") or {}).get(attr, attr)
    value = attribute(thing, attr, temp_unit)
    if value is None:
        if thing.state == "off" and attr in ("brightness", "volume", "speed", "color", "color_temp"):
            return _t(words, "attr_off", name=thing.name)
        return _t(words, "attr_missing", name=thing.name, attr=label)
    return _t(words, "attr", name=thing.name, attr=label, value=value)


# ------------------------------------------------------------ how many

def in_area(thing_area: str, area: str, name: str = "") -> bool:
    """Whether an entity's area is the one named ("the kitchen" in "Kitchen").
    With no area, its name may say it ("Kitchen lights")."""
    want, have = set(_key(area)), set(_key(thing_area))
    if not want:
        return False
    if not have:
        return bool(name) and want <= set(_key(name))
    return want <= have or have <= want


def counts(thing: Thing, kind: Mapping[str, Any]) -> bool:
    """Whether an entity is one of a kind ("lights", "windows")."""
    if thing.domain not in (kind.get("domains") or []):
        return False
    classes = kind.get("device_classes")
    return classes is None or thing.device_class in classes


def count_reply(things: Iterable[Thing], kind_key: str, state: str, area: str, ask: str,
                words: Mapping[str, Any], now: datetime) -> str:
    """How many (or which) of a kind are in a state, optionally in an area.
    `ask` is "all" for "are all the doors closed?", else counting."""
    kind = ((words or {}).get("things") or {}).get(kind_key or "anything") or {}
    pool = [t for t in things if counts(t, kind) and (not area or in_area(t.area, area, t.name))
            and t.state not in GONE]
    match = sorted((t for t in pool if same_state(state, say_state(t, words, now), t.state, words)),
                   key=lambda t: t.name.lower())
    where = _t(words, "where", area=area.removeprefix("the ")) if area else ""
    many = kind.get("many") or kind_key
    said_state = _say_asked(state, words)
    if ask == "all":
        rest = [t for t in pool if t not in match]
        if not rest:
            if not pool:
                return _t(words, "none", many=many, state=said_state, where=where)
            return _t(words, "all_yes", count=len(pool), many=many, where=where, state=said_state)
        others = {say_state(t, words, now) for t in rest}
        return _t(words, "all_no", list=say_list([t.name for t in rest], words),
                  verb=_t(words, "is_verb" if len(rest) == 1 else "are_verb"),
                  other=say_list(sorted(others), words, "or"))
    if not match:
        key = "none_any" if kind_key in ("", "anything") else "none"
        return _t(words, key, many=many, state=said_state, where=where)
    names = [t.name for t in match]
    if len(match) == 1:
        return _t(words, "one", list=names[0], state=said_state, where=where)
    key = "some" if len(match) <= LIST_MAX else "lots"
    return _t(words, key, count=len(match), many=many, state=said_state, where=where,
              list=say_list(names, words))


def _say_asked(state: str, words: Mapping[str, Any]) -> str:
    return {"detected": "detecting motion", "away": "away"}.get(state, state.replace("_", " "))


# ------------------------------------------------------------ when

def when_reply(thing: Thing, asked: str, words: Mapping[str, Any], now: datetime,
               last_time: datetime | None = None, history: bool = False) -> str | None:
    """When a thing changed, or was last in the state asked. With `asked` ""
    (changed, updated) the last change. None when the answer needs history
    and `history` says it hasn't been read yet."""
    said = say_state(thing, words, now)
    since = thing.last_changed or now
    if thing.long_ago and (not asked or same_state(asked, said, thing.state, words)):
        return _t(words, "changed_long", name=thing.name, state=said)
    if not asked:
        return _t(words, "changed", name=thing.name, state=said,
                  ago=say_ago((now - since).total_seconds(), words), when=say_when(since, now, words))
    if same_state(asked, said, thing.state, words):
        ago = say_ago((now - since).total_seconds(), words)
        return _t(words, "is_now", name=thing.name, asked=_say_asked(asked, words),
                  when=f"{say_when(since, now, words)}, {ago} ago")
    if not history:
        return None
    if last_time is None:
        return _t(words, "never", name=thing.name, asked=_say_asked(asked, words),
                  period=period_said("7d", words))
    return _t(words, "last", name=thing.name, asked=_say_asked(asked, words),
              ago=say_ago((now - last_time).total_seconds(), words),
              when=say_when(last_time, now, words))


def how_long_reply(thing: Thing, asked: str, words: Mapping[str, Any], now: datetime) -> str:
    said = say_state(thing, words, now)
    since = thing.last_changed or now
    ago = say_ago((now - since).total_seconds(), words)
    if thing.long_ago:
        ago = _t(words, "over_week")
        if not asked or same_state(asked, said, thing.state, words):
            return _t(words, "since_long", name=thing.name, state=said)
    if asked and not same_state(asked, said, thing.state, words):
        return _t(words, "not_now", name=thing.name, asked=_say_asked(asked, words), state=said,
                  ago=ago)
    return _t(words, "since", name=thing.name, state=said, ago=ago,
              when=say_when(since, now, words))


# ------------------------------------------------------------ history

GONE = ("unavailable", "unknown")


def settled_since(changes: Sequence[Change], state: str) -> datetime | None:
    """When a thing really went into its current state: the history's last
    change to it, skipping the restarts and dropouts (unavailable, then the
    same state again) that reset a state's last_changed. None when it was in
    that state for the whole history read."""
    since = None
    before = None
    for t, s in changes:
        if s in GONE:
            continue
        if s != before:
            since = t if before is not None else None
        before = s
    return since if before == state else None


PERIODS = ("today", "yesterday", "week", "7d", "morning", "night", "1h", "24h")


def period_span(key: str, now: datetime) -> tuple[datetime, datetime]:
    """A period's start and end ("today": midnight to now)."""
    midnight = now.replace(hour=0, minute=0, second=0, microsecond=0)
    if key == "yesterday":
        return midnight - timedelta(days=1), midnight
    if key == "week":
        return midnight - timedelta(days=now.weekday()), now
    if key == "7d":
        return now - timedelta(days=7), now
    if key == "morning":
        return midnight, min(now, midnight + timedelta(hours=12))
    if key == "night":
        night_end = midnight + timedelta(hours=8)
        if now < night_end:
            night_end -= timedelta(days=1)
        return night_end - timedelta(hours=14), min(now, night_end)
    if key == "1h":
        return now - timedelta(hours=1), now
    if key == "24h":
        return now - timedelta(hours=24), now
    return midnight, now


def period_said(key: str, words: Mapping[str, Any]) -> str:
    return (((words or {}).get("answers") or {}).get("periods") or {}).get(key, key)


Change = tuple[datetime, str]   # (from when, the state from then on)


def stat(changes: Sequence[Change], how: str, end: datetime
         ) -> tuple[float, datetime | None] | None:
    """The highest, lowest or time-weighted average of numeric states over a
    span (changes from its start, the first one being the state in force at
    the start), with when the extreme was first reached. None with no numbers."""
    nums = [(t, v) for t, s in changes if (v := number(s)) is not None]
    if not nums:
        return None
    if how == "max":
        t, v = max(nums, key=lambda x: (x[1], -x[0].timestamp()))
        return v, t
    if how == "min":
        t, v = min(nums, key=lambda x: (x[1], x[0].timestamp()))
        return v, t
    total = weight = 0.0
    for i, (t, s) in enumerate(changes):
        nxt = changes[i + 1][0] if i + 1 < len(changes) else end
        v, span = number(s), (nxt - t).total_seconds()
        if v is not None and span > 0:
            total, weight = total + v * span, weight + span
    if not weight:
        return sum(v for _, v in nums) / len(nums), None
    return total / weight, None


def times_in(changes: Sequence[Change], asked: str, thing: Thing, words: Mapping[str, Any],
             start: datetime) -> list[datetime]:
    """When the thing went into the state asked during the span (the first
    change is the state at the start: counted only if it began then)."""
    out, before = [], None
    for t, s in changes:
        if s in GONE:               # a dropout or restart isn't a change
            continue
        said = say_state(thing, words, None, s)
        now_in = same_state(asked, said, s, words)
        if now_in and before is not True and t > start:
            out.append(t)
        before = now_in
    return out


def stat_reply(thing: Thing, how: str, period: str, changes: Sequence[Change],
               words: Mapping[str, Any], now: datetime, end: datetime) -> str:
    when_said = period_said(period, words)
    got = stat(changes, how, end)
    if got is None:
        return _t(words, "no_history", name=thing.name, period=when_said)
    value, at = got
    return _t(words, how, name=thing.name, period=when_said, value=say_number(value, thing.unit),
              when=say_when(at, now, words) if at else "")


def times_reply(thing: Thing, asked: str, period: str, changes: Sequence[Change],
                words: Mapping[str, Any], now: datetime, start: datetime,
                count: bool = True) -> str:
    when_said = period_said(period, words)
    asked_said = _say_asked(asked, words)
    hits = times_in(changes, asked, thing, words, start)
    if not hits:
        return _t(words, "been_no" if not count else "never", name=thing.name, asked=asked_said,
                  period=when_said)
    last = say_when(hits[-1], now, words)
    if not count:
        return _t(words, "been_yes", name=thing.name, asked=asked_said, period=when_said, when=last)
    if len(hits) == 1:
        return _t(words, "times_one", name=thing.name, asked=asked_said, period=when_said, when=last)
    return _t(words, "times", name=thing.name, asked=asked_said, count=len(hits),
              period=when_said, when=last)


def unknown_reply(name: str, words: Mapping[str, Any]) -> str:
    return _t(words, "unknown", name=name)


def which_reply(names: Sequence[str], words: Mapping[str, Any]) -> str:
    return _t(words, "which", list=say_list(list(names), words, "or"))
