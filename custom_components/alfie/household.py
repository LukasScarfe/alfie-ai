"""Alfie's answers about the household (design.md "Brain" → Local answers,
M15 D): who's home and where people are, what's playing, what's on the
calendar, and what's on a to-do list. Read-only: turning things on and off
stays with Home Assistant's intents.

PURE (no HA import), so the tests run under plain python. The words are the
language file's `household` section (lang/<code>/brain.json); `now` is passed
in, never read here. local.py reads the states, the history, the calendar
events and the list items.

The calendar also checks named dates (reckon.py): "how many sleeps until
Christmas" takes Christmas from a holidays calendar when there is one, and
"when is Dad's birthday" finds "Scarfe Dad Birthday".
"""

from __future__ import annotations

import re
from collections.abc import Callable, Iterable, Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta
from typing import Any

from .answers import say_ago, say_time

Change = tuple[datetime, str]
OFF = ("off", "standby", "unavailable", "unknown", "")


def _w(words: Mapping[str, Any]) -> Mapping[str, Any]:
    return (words or {}).get("household") or {}


def _t(words: Mapping[str, Any], key: str, **kw: Any) -> str:
    text = (_w(words).get("replies") or {}).get(key) or key
    return text.format(**kw) if kw else text


def _cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def join(items: Sequence[str], words: Mapping[str, Any], most: int = 0) -> str:
    """"a, b and c", cut to `most` with "and 3 more"."""
    items = list(items)
    if most and len(items) > most:
        items = [*items[:most], _t(words, "more", n=len(items) - most)]
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} {_t(words, 'and')} {items[-1]}"


# ------------------------------------------------------------ matching names

FILLER = frozenset({"the", "my", "our", "a", "an", "day", "holiday", "regional", "next", "s",
                    "list"})
SAME = {"bday": "birthday", "b-day": "birthday", "xmas": "christmas", "mom": "mother",
        "mum": "mother", "mothers": "mother", "fathers": "father", "dads": "dad", "moms": "mother"}


def tokens(text: str) -> list[str]:
    """Words for matching: lower case, no possessive 's, no punctuation,
    no plural s, a few spellings made one ("bday" = "birthday")."""
    t = str(text or "").lower().replace("’", "'").replace("'s ", " ").replace("'s", " ")
    t = re.sub(r"\([^)]*\)", " ", t)
    out = []
    for w in re.findall(r"[a-z0-9-]+", t):
        w = SAME.get(w, w)
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        out.append(w)
    return out


def match(asked: str, title: str) -> int | None:
    """How well a title fits what was asked: the count of its extra words
    (0 is exact), or None when it lacks a word asked. A title like "Boxing
    Day / Christmas Holiday" is tried part by part."""
    want = [w for w in tokens(asked) if w not in FILLER]
    if not want:
        return None
    best = None
    for part in (title or "").split("/"):
        have = [w for w in tokens(part) if w not in FILLER]
        if all(w in have for w in want):
            extra = len([w for w in have if w not in want])
            best = extra if best is None else min(best, extra)
    return best


def best_match(asked: str, items: Iterable[Any], title: Callable[[Any], str]) -> list[Any]:
    """The items whose title fits, the closest first (stable: their own
    order breaks a tie)."""
    scored = [(m, i, it) for i, it in enumerate(items) if (m := match(asked, title(it))) is not None]
    return [it for _m, _i, it in sorted(scored, key=lambda x: (x[0], x[1]))]


# ------------------------------------------------------------ people

@dataclass
class Person:
    entity_id: str
    name: str
    state: str                       # "home", "not_home", a zone's name, "unknown"
    changes: list[Change] = field(default_factory=list)    # history, oldest first
    last_changed: datetime | None = None
    start: datetime | None = None    # how far back the history goes

    @property
    def home(self) -> bool:
        return self.state == "home"

    @property
    def known(self) -> bool:
        return self.state not in ("unknown", "unavailable", "")

    def since(self) -> tuple[datetime | None, bool]:
        """When the person last arrived (when home) or left (when not):
        (time, long_ago). long_ago: it was before the history starts."""
        runs = [(t, s == "home") for t, s in self.changes if s not in ("unknown", "unavailable")]
        if not runs:
            return self.last_changed, False
        at = None
        for t, home in reversed(runs):
            if home != self.home:
                break
            at = t
        if at is None:
            return self.last_changed, False
        return at, bool(self.start and at <= self.start)


def where(p: Person, words: Mapping[str, Any]) -> str:
    """"home", "out", "at Michelle School"."""
    if p.home:
        return _t(words, "at_home")
    if p.state == "not_home":
        return _t(words, "away")
    return _t(words, "at_place", place=p.state)


def say_moment(at: datetime, now: datetime, words: Mapping[str, Any]) -> str:
    """"at 3 pm", "yesterday at 9 am", "on Monday at 6 pm", "on 12 March"."""
    days = (at.date() - now.date()).days
    time_ = say_time(at)
    if days == 0:
        return _t(words, "at_time", time=time_)
    if days == -1:
        return _t(words, "yesterday_at", time=time_)
    if -7 < days < 0:
        return _t(words, "day_at", day=at.strftime("%A"), time=time_)
    return _t(words, "on_date", date=f"{at.day} {at.strftime('%B')}")


def people_reply(ask: str, people: Sequence[Person], who: Person | None,
                 words: Mapping[str, Any], now: datetime) -> str | None:
    """`ask`: who (is home), anyone, everyone, home, away (is X ...), where,
    how_long, arrived, left. None when the question needs a person and none
    was found, or there are no people."""
    if ask in ("who", "anyone", "everyone"):
        if not people:
            return None
        home = [p.name for p in people if p.home]
        out = [p for p in people if not p.home and p.known]
        if ask == "anyone":
            if not home:
                return _t(words, "anyone_no")
            return _t(words, "anyone_yes", names=join(home, words),
                      verb=_t(words, "is" if len(home) == 1 else "are"))
        if ask == "everyone":
            if not out:
                return _t(words, "everyone_yes")
            return _t(words, "everyone_no", away=" ".join(
                _t(words, "where", name=p.name, where=where(p, words)) for p in out))
        if not home:
            said = _t(words, "nobody_home")
        elif not out:
            said = _t(words, "everyone_home" if len(home) > 1 else "home",
                      names=join(home, words), verb=_t(words, "is"))
        else:
            said = _t(words, "home", names=join(home, words),
                      verb=_t(words, "is" if len(home) == 1 else "are"))
        return " ".join([said, *(_t(words, "where", name=p.name, where=where(p, words))
                                 for p in out)])
    if who is None:
        return None
    if not who.known:
        return _t(words, "dont_know", name=who.name)
    at = where(who, words)
    if ask == "home":
        return _t(words, "yes_home", name=who.name) if who.home else \
            _t(words, "no_where", name=who.name, where=at)
    if ask == "away":
        return _t(words, "no_home", name=who.name) if who.home else \
            _t(words, "yes_where", name=who.name, where=at)
    if ask == "where":
        return _t(words, "where", name=who.name, where=at)
    since, long_ago = who.since()
    if ask == "how_long":
        if since is None:
            return _t(words, "where", name=who.name, where=at)
        if long_ago:
            return _t(words, "how_long_long", name=who.name, where=at)
        return _t(words, "how_long", name=who.name, where=at,
                  span=say_ago((now - since).total_seconds(), words))
    if ask in ("arrived", "left"):
        moment = _t(words, "long_ago") if long_ago or since is None else \
            say_moment(since, now, words)
        if who.home:
            return _t(words, "got_home", name=who.name, when=moment)
        if ask == "arrived":
            return _t(words, "not_home_left", name=who.name, when=moment)
        return _t(words, "left", name=who.name, when=moment)
    return None


# ------------------------------------------------------------ media

@dataclass
class Player:
    entity_id: str
    name: str
    state: str
    attrs: dict[str, Any] = field(default_factory=dict)

    @property
    def playing(self) -> bool:
        return self.state == "playing"

    @property
    def is_tv(self) -> bool:
        return self.attrs.get("device_class") == "tv"

    def what(self, words: Mapping[str, Any]) -> str:
        """"Something Serious by Bruno Mars", "Nathan for You: Taxi Service",
        "YouTube"; "" when it doesn't say."""
        a = self.attrs
        title, artist = str(a.get("media_title") or ""), str(a.get("media_artist") or "")
        series = str(a.get("media_series_title") or "")
        if series and title:
            return _t(words, "episode", series=series, title=title)
        if title and artist:
            return _t(words, "by", title=title, artist=artist)
        return title or series or str(a.get("app_name") or "")


def _same_track(players: Iterable[Player], words: Mapping[str, Any]) -> list[tuple[str, Player]]:
    """(what, player) for each playing thing, once: Music Assistant and the
    speaker's own integration report the same song (the shorter name kept)."""
    seen: dict[str, Player] = {}
    for p in players:
        w = p.what(words)
        if not w:
            continue
        if w not in seen or len(p.name) < len(seen[w].name):
            seen[w] = p
    return list(seen.items())


def media_reply(ask: str, players: Sequence[Player], words: Mapping[str, Any],
                named: Player | None = None) -> str | None:
    """`ask`: playing (what's playing), anything (is anything playing), song,
    artist, album, tv (what's on the TV). None when there's no player to
    ask about."""
    if ask == "tv":
        tvs = [named] if named else [p for p in players if p.is_tv]
        if not tvs:
            return None
        out = []
        for p in tvs:
            if p.state in OFF:
                out.append(_t(words, "tv_off", player=p.name))
                continue
            w = p.what(words) or str(p.attrs.get("source") or "")
            out.append(_t(words, "tv_showing" if w else "tv_on", player=p.name, what=w))
        return " ".join(out)
    pool = [named] if named else list(players)
    if not pool:
        return None
    playing = _same_track([p for p in pool if p.playing], words)
    if not playing:
        paused = _same_track([p for p in pool if p.state == "paused"], words)
        key = "nothing_on" if named else "nothing"
        said = _t(words, ("no_" if ask == "anything" else "") + key,
                  player=named.name if named else "")
        if paused:
            said += " " + _t(words, "paused", what=paused[0][0], player=paused[0][1].name)
        return said
    if ask in ("song", "artist", "album"):
        p = playing[0][1]
        a = p.attrs
        title, artist = str(a.get("media_title") or ""), str(a.get("media_artist") or "")
        album = str(a.get("media_album_name") or "")
        if ask == "artist" and artist:
            return _t(words, "artist", artist=artist, title=title or playing[0][0])
        if ask == "album":
            return _t(words, "album", album=album, title=title) if album else \
                _t(words, "no_album", what=playing[0][0])
        return _t(words, "song", what=playing[0][0])
    said = join([_t(words, "on_player", what=w, player=p.name) for w, p in playing], words)
    return _t(words, "yes_playing" if ask == "anything" else "playing", what=said)


# ------------------------------------------------------------ calendar

@dataclass
class Event:
    title: str
    start: datetime
    end: datetime
    all_day: bool
    calendar: str = ""

    @property
    def said(self) -> str:
        """The title as said: "Christmas Day (regional holiday)" -> "Christmas Day"."""
        t = re.sub(r"\s*\([^)]*\)", "", self.title).split(" / ")[0]
        return " ".join(t.split()) or self.title


def _when(v: Any, tz: Any) -> tuple[datetime, bool] | None:
    s = str(v or "")
    try:
        if "T" not in s and " " not in s:
            d = date.fromisoformat(s)
            return datetime(d.year, d.month, d.day, tzinfo=tz), True
        at = datetime.fromisoformat(s)
    except ValueError:
        return None
    return (at.astimezone(tz) if at.tzinfo else at.replace(tzinfo=tz)), False


def parse_events(response: Any, tz: Any) -> list[Event]:
    """`calendar.get_events`'s answer as Events, soonest first. The same title
    at the same start (two holiday calendars) is kept once."""
    out, seen = [], set()
    for entity, body in (response or {}).items():
        for ev in (body or {}).get("events") or []:
            title = str(ev.get("summary") or "").strip()
            got = _when(ev.get("start"), tz)
            if not title or got is None:
                continue
            start, all_day = got
            end = _when(ev.get("end"), tz)
            stop = end[0] if end and end[0] > start else start + timedelta(days=1 if all_day else 0)
            key = (title.lower(), start)
            if key in seen:
                continue
            seen.add(key)
            out.append(Event(title, start, stop, all_day, entity))
    out.sort(key=lambda e: (e.start, not e.all_day, e.title))
    return out


DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def _midnight(d: date, tz: Any) -> datetime:
    return datetime(d.year, d.month, d.day, tzinfo=tz)


def span_range(key: str, now: datetime) -> tuple[datetime, datetime]:
    """The time a span means: today, tonight, tomorrow, tomorrow_night,
    weekend, week (the rest of it), next_week, month (the rest), coming (the
    next 7 days) or a weekday (mon..sun, its next one, today included)."""
    tz, today = now.tzinfo, now.date()
    day = timedelta(days=1)
    if key == "tonight":
        return _midnight(today, tz).replace(hour=17), _midnight(today + day, tz).replace(hour=4)
    if key == "tomorrow":
        return _midnight(today + day, tz), _midnight(today + 2 * day, tz)
    if key == "tomorrow_night":
        return _midnight(today + day, tz).replace(hour=17), _midnight(today + 2 * day, tz).replace(hour=4)
    if key == "weekend":
        sat = today if today.weekday() >= 5 else today + timedelta(days=5 - today.weekday())
        return _midnight(sat, tz), _midnight(today + timedelta(days=7 - today.weekday()), tz)
    if key == "week":
        return _midnight(today, tz), _midnight(today + timedelta(days=7 - today.weekday()), tz)
    if key == "next_week":
        mon = today + timedelta(days=7 - today.weekday())
        return _midnight(mon, tz), _midnight(mon + 7 * day, tz)
    if key == "month":
        first = (today.replace(day=28) + 4 * day).replace(day=1)
        return _midnight(today, tz), _midnight(first, tz)
    if key == "coming":
        return now, now + 7 * day
    if key in DAYS:
        d = today + timedelta(days=(DAYS.index(key) - today.weekday()) % 7)
        return _midnight(d, tz), _midnight(d + day, tz)
    return _midnight(today, tz), _midnight(today + day, tz)


ONE_DAY = frozenset({"today", "tonight", "tomorrow", "tomorrow_night", *DAYS})


def say_span(key: str, now: datetime, words: Mapping[str, Any]) -> str:
    """"tomorrow", "this weekend", "on Friday"."""
    if key in DAYS:
        return _t(words, "on_day", day=span_range(key, now)[0].strftime("%A"))
    return ((_w(words).get("spans") or {}).get(key)) or _t(words, "today_word")


def say_day(at: datetime, now: datetime, words: Mapping[str, Any]) -> str:
    """"today", "tomorrow", "on Sunday", "on Monday 9 November"."""
    days = (at.date() - now.date()).days
    if days == 0:
        return _t(words, "today_word")
    if days == 1:
        return _t(words, "tomorrow_word")
    if 1 < days < 7:
        return _t(words, "on_day", day=at.strftime("%A"))
    return _t(words, "on_day", day=f"{at.strftime('%A')} {at.day} {at.strftime('%B')}")


def say_event(e: Event, now: datetime, words: Mapping[str, Any], with_day: bool) -> str:
    """"Dance at 7:30 pm", "Dance on Wednesday at 7:30 pm", "Halloween"."""
    if not with_day:
        return e.said if e.all_day else _t(words, "event_at", title=e.said, time=say_time(e.start))
    day = say_day(e.start, now, words)
    if e.all_day:
        return _t(words, "event_day", title=e.said, day=day)
    return _t(words, "event_day_at", title=e.said, day=day, time=say_time(e.start))


def in_span(events: Iterable[Event], start: datetime, end: datetime) -> list[Event]:
    return [e for e in events if e.start < end and e.end > start]


def events_reply(ask: str, span: str, events: Sequence[Event], words: Mapping[str, Any],
                 now: datetime, most: int = 6) -> str:
    """`ask`: on (what's on), any (anything on?), free, busy, next. `span` a
    span_range key ("" means the coming week, or just the next for `next`)."""
    if ask == "next":
        nxt = [e for e in events if e.start > now]
        if not nxt:
            return _t(words, "nothing_next")
        e = nxt[0]
        return _t(words, "next", event=say_event(e, now, words, True))
    span = span or "coming"
    start, end = span_range(span, now)
    got = in_span(events, start, end)
    said = say_span(span, now, words)
    if not got:
        return _t(words, {"free": "free_yes", "any": "any_no", "busy": "any_no"}.get(ask, "clear"),
                  span=said)
    listed = join([say_event(e, now, words, span not in ONE_DAY) for e in got], words, most)
    key = {"free": "free_no", "any": "any_yes", "busy": "any_yes"}.get(ask, "on")
    return _cap(_t(words, key, span=said, events=listed, Span=_cap(said)))


def find_event(asked: str, events: Sequence[Event], now: datetime,
               span: str = "") -> Event | None:
    """The event someone named: the closest title, then the soonest, among
    those not over yet (within `span` when one was said)."""
    pool = [e for e in events if e.end > now]
    if span:
        start, end = span_range(span, now)
        pool = in_span(pool, start, end)
    hits = best_match(asked, pool, lambda e: e.title)
    return hits[0] if hits else None


def when_reply(asked: str, events: Sequence[Event], words: Mapping[str, Any], now: datetime,
               span: str = "") -> str | None:
    """"When is my next dance?" -> "Dance is on Wednesday at 7:30 pm, in 5
    days." None when no event fits (the turn goes on: maybe a holiday)."""
    e = find_event(asked, events, now, span)
    if e is None:
        return None
    if e.start <= now:
        if e.all_day:
            return _t(words, "is_today", title=e.said)
        return _t(words, "on_now", title=e.said, time=say_time(e.end))
    days = (e.start.date() - now.date()).days
    tail = _t(words, "in_days", n=days) if days >= 2 else ""
    if e.all_day:
        return _t(words, "when_day", title=e.said, day=say_day(e.start, now, words), tail=tail)
    return _t(words, "when_at", title=e.said, day=say_day(e.start, now, words),
              time=say_time(e.start), tail=tail)


def event_date(asked: str, events: Sequence[Event], today: date) -> tuple[date, str] | None:
    """A named date from the calendar for reckon.py: (its day, its title)."""
    pool = [e for e in events if e.end.date() > today or e.start.date() == today]
    hits = best_match(asked, pool, lambda e: e.title)
    return (hits[0].start.date(), hits[0].said) if hits else None


# ------------------------------------------------------------ lists

def list_name(name: str) -> str:
    """"Groceries" -> "Groceries list"; "Shopping list" stays."""
    return name if name.lower().rstrip().endswith("list") else f"{name} list"


def run_reply(name: str, words: Mapping[str, Any], own: str = "", failed: bool = False) -> str:
    """What he says when he starts a voice action: the user's own words
    ({name} is its name) or the language's."""
    if failed:
        return _t(words, "run_failed", name=name)
    if own:
        try:
            return own.format(name=name)
        except (KeyError, IndexError, ValueError):
            return own
    return _t(words, "run_done", name=name)


def no_list(name: str, words: Mapping[str, Any]) -> str:
    return _t(words, "no_list", name=name)


def list_reply(ask: str, name: str, items: Sequence[str], words: Mapping[str, Any],
               item: str = "", most: int = 10) -> str | None:
    """`ask`: items (what's on it), count, has (is milk on it)."""
    lst = list_name(name)
    if ask == "has":
        if not item.strip():
            return None
        hit = best_match(item, items, lambda x: x)
        return _t(words, "has_yes", item=hit[0], list=lst) if hit else \
            _t(words, "has_no", item=item.strip(), list=lst)
    if not items:
        return _t(words, "list_empty", list=lst)
    n = len(items)
    count = _t(words, "one_thing") if n == 1 else _t(words, "things", n=n)
    if ask == "count":
        return _t(words, "list_count", list=lst, count=count,
                  verb=_t(words, "is" if n == 1 else "are"))
    return _t(words, "list_items", list=lst, count=count, items=join(items, words, most))
