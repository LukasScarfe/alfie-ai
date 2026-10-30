"""Alfie's answers about outside (design.md "Brain" → Local answers, M15 B):
the weather now and later, what to wear, the sun and the moon, built from a
weather entity's state, its cached forecast (providers/forecast.py) and the
sun times Home Assistant works out (local.py gathers them).

PURE (no HA import), so the tests run under plain python. The words are the
language file's `outside` section (lang/<code>/brain.json). Times come in as
aware datetimes; `now` is passed in, never read here. Thresholds are the
`brain` settings, in °C and km/h, converted to the weather entity's units.
"""

from __future__ import annotations

import math
from collections import Counter
from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field
from datetime import date, datetime, timedelta, timezone
from typing import Any

from .answers import number, say_ago, say_list, say_number, say_time

SOON_HOURS = 3        # "rain is likely from about 6 pm" after the weather now
STOP_HOURS = 12       # how far ahead "it should stop around ..." looks
GEAR_HOURS = 12       # "do I need an umbrella?" with no time said


@dataclass
class Row:
    """One forecast entry: an hour, or a day (`daily`)."""

    at: datetime
    cond: str = ""
    temp: float | None = None
    low: float | None = None
    pop: float | None = None        # chance of precipitation, %
    precip: float | None = None     # amount, the entity's unit
    uv: float | None = None
    wind: float | None = None


@dataclass
class Weather:
    """A weather entity now, with its forecast."""

    name: str
    cond: str
    attributes: Mapping[str, Any] = field(default_factory=dict)
    hourly: list[Row] = field(default_factory=list)
    daily: list[Row] = field(default_factory=list)
    place: str = ""                 # as asked ("in Whistler"), "" the house's

    @property
    def unit(self) -> str:
        return str(self.attributes.get("temperature_unit") or "°C")

    @property
    def wind_unit(self) -> str:
        return str(self.attributes.get("wind_speed_unit") or "km/h")

    def a(self, key: str) -> float | None:
        return number(self.attributes.get(key))


def rows(items: Any, tz: Any = None) -> list[Row]:
    """weather.get_forecasts entries as Rows, oldest first, in `tz`."""
    out = []
    for r in items if isinstance(items, list) else []:
        if not isinstance(r, Mapping):
            continue
        try:
            at = datetime.fromisoformat(str(r.get("datetime")).replace("Z", "+00:00"))
        except ValueError:
            continue
        if at.tzinfo is None:
            at = at.replace(tzinfo=timezone.utc)
        out.append(Row(at.astimezone(tz) if tz else at,
                       r["condition"] if isinstance(r.get("condition"), str) else "",
                       number(r.get("temperature")), number(r.get("templow")),
                       number(r.get("precipitation_probability")), number(r.get("precipitation")),
                       number(r.get("uv_index")), number(r.get("wind_speed"))))
    return sorted(out, key=lambda x: x.at)


def _w(words: Mapping[str, Any]) -> Mapping[str, Any]:
    return (words or {}).get("outside") or {}


def _t(words: Mapping[str, Any], key: str, **kw: Any) -> str:
    text = (_w(words).get("replies") or {}).get(key) or key
    return text.format(**kw) if kw else text


def cap(text: str) -> str:
    return text[:1].upper() + text[1:]


def _settings(s: Mapping[str, Any], w: Weather) -> dict[str, float]:
    """The thresholds in the entity's units."""
    f = w.unit.endswith("F")
    temp = (lambda c: c * 9 / 5 + 32) if f else (lambda c: c)
    per = {"km/h": 1.0, "mph": 1 / 1.609344, "m/s": 1 / 3.6, "kn": 1 / 1.852, "ft/s": 1 / 1.09728}
    return {"cold": temp(float(s.get("cold_below", 10))), "warm": temp(float(s.get("warm_above", 22))),
            "windy": float(s.get("windy_speed", 30)) * per.get(w.wind_unit, 1.0),
            "chance": float(s.get("rain_chance", 40)), "mm": float(s.get("rain_mm", 0.3)),
            "uv": float(s.get("sun_uv", 3))}


# ------------------------------------------------------------ saying things

def say_temp(v: float | None, w: Weather) -> str:
    return "?" if v is None else say_number(v, w.unit)


def say_cond(cond: str, words: Mapping[str, Any], how: str = "now") -> str:
    """A condition as he says it: "raining" now, "rainy" for a forecast."""
    return ((_w(words).get(how) or {}).get(cond)) or cond.replace("-", " ")


def say_day(d: date, today: date, words: Mapping[str, Any]) -> str:
    days = (d - today).days
    if days == 0:
        return _t(words, "today")
    if days == 1:
        return _t(words, "tomorrow")
    if 1 < days < 7:
        return _t(words, "on_day", day=d.strftime("%A"))
    return _t(words, "on_date", date=f"{d.strftime('%A')} {d.day} {d.strftime('%B')}")


def say_wind(w: Weather, words: Mapping[str, Any]) -> str:
    speed, bearing = w.a("wind_speed"), w.a("wind_bearing")
    if speed is None:
        return ""
    said = say_number(speed, w.wind_unit)
    points = _w(words).get("compass") or []
    if bearing is not None and len(points) == 8 and speed > 0:
        return _t(words, "wind_from", speed=said, dir=points[round(bearing / 45) % 8])
    return said


def _where(w: Weather, words: Mapping[str, Any]) -> str:
    return _t(words, "in_place", place=w.place) if w.place else ""


def is_kind(row_or_cond: Row | str, kind: str, words: Mapping[str, Any],
            lim: Mapping[str, float] | None = None, forecast: bool = False) -> bool:
    """Whether a condition (or a forecast row) is a kind of weather: "rain",
    "snow", "sun", "wind", "cold", "warm"... A row may also be rain by its
    chance or amount, wind by its speed, cold or warm by its temperature."""
    cond = row_or_cond.cond if isinstance(row_or_cond, Row) else row_or_cond
    if cond in ((_w(words).get("kinds") or {}).get(kind) or []):
        return True
    r = row_or_cond if isinstance(row_or_cond, Row) else None
    if r is None or lim is None:
        return False
    if kind == "rain":
        return ((r.pop is not None and r.pop >= lim["chance"])
                or (r.pop is None and r.precip is not None and r.precip >= lim["mm"]))
    if kind == "wind":
        return r.wind is not None and r.wind >= lim["windy"]
    if kind == "cold":
        low = r.low if r.low is not None else r.temp
        return low is not None and low < lim["cold"]
    if kind == "warm":
        return r.temp is not None and r.temp >= lim["warm"]
    return False


# ------------------------------------------------------------ spans of time

SPANS = ("now", "soon", "later", "today", "tonight", "morning", "afternoon", "evening",
         "tomorrow", "tomorrow_morning", "tomorrow_afternoon", "tomorrow_evening",
         "tomorrow_night", "weekend", "week", "mon", "tue", "wed", "thu", "fri", "sat", "sun")
DAYS = ("mon", "tue", "wed", "thu", "fri", "sat", "sun")


def span_window(key: str, now: datetime) -> tuple[datetime, datetime, bool]:
    """A time asked about as (start, end, by_day): by_day spans are answered
    from the daily forecast, the rest from the hourly one."""
    mid = now.replace(hour=0, minute=0, second=0, microsecond=0)

    def at(day: int, hour: int) -> datetime:
        return mid + timedelta(days=day, hours=hour)
    if key == "soon":
        return now, now + timedelta(hours=SOON_HOURS), False
    if key == "later":
        end = at(1, 0) if now.hour < 18 else now + timedelta(hours=6)
        return now, end, False
    if key == "tonight":
        return max(now, at(0, 18)), at(1, 6), False
    for i, part in enumerate(("morning", "afternoon", "evening")):
        if key == part:
            return max(now, at(0, 6 + 6 * i)), at(0, 12 + 6 * i), False
        if key == f"tomorrow_{part}":
            return at(1, 6 + 6 * i), at(1, 12 + 6 * i), False
    if key == "tomorrow_night":
        return at(1, 18), at(2, 6), False
    if key == "tomorrow":
        return at(1, 0), at(2, 0), True
    if key == "weekend":
        wd = now.weekday()
        return (now if wd >= 5 else at(5 - wd, 0)), at(7 - wd, 0), True
    if key == "week":
        return now, at(7, 0), True
    if key in DAYS:
        ahead = (DAYS.index(key) - now.weekday()) % 7
        return (now if ahead == 0 else at(ahead, 0)), at(ahead + 1, 0), True
    if key == "rest":
        return now, now + timedelta(hours=GEAR_HOURS), False
    return now, at(1, 0), True          # today


def say_span(key: str, words: Mapping[str, Any], now: datetime) -> str:
    """How a span is said in a sentence: "tonight", "on Saturday"."""
    if key in DAYS:
        return _t(words, "today") if DAYS.index(key) == now.weekday() else \
            _t(words, "on_day", day=_day_name(key))
    return ((_w(words).get("spans") or {}).get(key)) or key


def _day_name(key: str) -> str:
    return (date(2026, 10, 26) + timedelta(days=DAYS.index(key))).strftime("%A")   # a Monday


def hours_in(w: Weather, start: datetime, end: datetime) -> list[Row]:
    return [r for r in w.hourly if r.at + timedelta(hours=1) > start and r.at < end]


def days_in(w: Weather, start: datetime, end: datetime) -> list[Row]:
    first, last = start.date(), (end - timedelta(microseconds=1)).date()
    return [r for r in w.daily if first <= r.at.astimezone(start.tzinfo).date() <= last]


def _covered(w: Weather, end: datetime) -> bool:
    return bool(w.hourly) and w.hourly[-1].at + timedelta(hours=1) >= end


def _span_rows(w: Weather, key: str, now: datetime) -> tuple[list[Row], bool]:
    """The rows for a span, and whether they are hours (else days). A day
    within the hourly forecast is answered by its hours (more exact)."""
    start, end, by_day = span_window(key, now)
    if w.hourly and (not by_day or _covered(w, end)):
        got = hours_in(w, start, end)
        if got:
            return got, True
    return days_in(w, start, end), False


def _most(rows_: Sequence[Row]) -> str:
    conds = Counter(r.cond for r in rows_ if r.cond)
    return conds.most_common(1)[0][0] if conds else ""


def _chance(r: Row, words: Mapping[str, Any]) -> str:
    return _t(words, "chance", pop=round(r.pop)) if r.pop else ""


def _about(at: datetime, now: datetime, words: Mapping[str, Any]) -> str:
    """An hour ahead, roughly: "about 6 pm", "about 9 am tomorrow"."""
    at = at.astimezone(now.tzinfo)
    day = (at.date() - now.date()).days
    t = say_time(at)
    if day == 0:
        return _t(words, "about", time=t)
    if day == 1:
        return _t(words, "about_tomorrow", time=t)
    return _t(words, "about_day", day=at.strftime("%A"), time=t)


def _from(r: Row, now: datetime, hourly: bool, words: Mapping[str, Any]) -> str:
    """When a forecast row starts, said: "from about 6 pm", "on Saturday"."""
    if r.at <= now:
        return _t(words, "from_now")
    if not hourly:
        return say_day(r.at.astimezone(now.tzinfo).date(), now.date(), words)
    return _t(words, "from", when=_about(r.at, now, words))


# ------------------------------------------------------------ the weather now

def now_reply(w: Weather, ask: str, aspect: str, words: Mapping[str, Any], now: datetime,
              s: Mapping[str, Any]) -> str | None:
    """The weather now: all of it, one side of it (`aspect`: temp, wind...),
    or yes or no to a kind (`ask`: rain, sun, windy...)."""
    lim = _settings(s, w)
    where = _where(w, words)
    temp = w.a("temperature")
    if aspect:
        return _aspect(w, aspect, words, where)
    if ask:
        return _is_now(w, ask, words, now, lim, where)
    text = _t(words, "now", cond=say_cond(w.cond, words), temp=say_temp(temp, w), where=where)
    today = days_in(w, *span_window("today", now)[:2])
    hi = today[0].temp if today else None
    if hi is None and (hrs := hours_in(w, now, span_window("today", now)[1])):
        hi = max((r.temp for r in hrs if r.temp is not None), default=None)
    if hi is not None and (temp is None or hi > temp):
        text += " " + _t(words, "now_high", hi=say_temp(hi, w))
    return text + _rain_soon(w, now, lim, words)


def _aspect(w: Weather, aspect: str, words: Mapping[str, Any], where: str) -> str | None:
    if aspect == "temp":
        temp = w.a("temperature")
        if temp is None:
            return None
        feels = w.a("apparent_temperature")
        extra = _t(words, "feels", temp=say_temp(feels, w)) \
            if feels is not None and abs(feels - temp) >= 2 else ""
        return _t(words, "temp", temp=say_temp(temp, w), where=where, feels=extra)
    if aspect == "wind":
        wind = say_wind(w, words)
        return _t(words, "wind", wind=wind, where=where) if wind else None
    units = {"humidity": "%", "pressure": str(w.attributes.get("pressure_unit") or ""),
             "uv": "", "dew_point": w.unit,
             "visibility": str(w.attributes.get("visibility_unit") or "")}
    key = {"uv": "uv_index"}.get(aspect, aspect)
    v = w.a(key)
    if aspect not in units or v is None:
        return None
    label = (_w(words).get("aspects") or {}).get(aspect, aspect)
    return _t(words, "aspect", aspect=label, value=say_number(v, units[aspect]), where=where)


def _is_now(w: Weather, ask: str, words: Mapping[str, Any], now: datetime,
            lim: Mapping[str, float], where: str) -> str:
    """Is it raining (sunny, windy, cold...) now? With when rain should
    stop, or that it's coming soon."""
    temp, cond = w.a("temperature"), say_cond(w.cond, words)
    asked = say_cond(ask, words, "asked")
    if ask in ("cold", "warm", "hot"):
        if temp is None:
            yes = False
        else:
            yes = temp < lim["cold"] if ask == "cold" else temp >= lim["warm"]
        return _t(words, "yes_temp" if yes else "no_temp", asked=asked, temp=say_temp(temp, w),
                  where=where)
    if ask == "wind":
        speed = w.a("wind_speed")
        yes = is_kind(w.cond, "wind", words) or (speed is not None and speed >= lim["windy"])
        wind = say_wind(w, words)
        return _t(words, "yes_wind" if yes else "no_wind", wind=wind, where=where) if wind else \
            _t(words, "yes_now" if yes else "no_now", asked=asked, cond=cond, where=where)
    if is_kind(w.cond, ask, words):
        text = _t(words, "yes_now", asked=asked, cond=cond, where=where)
        if ask == "rain":
            stop = _rain_stops(w, now, lim, words)
            if stop:
                text += " " + _t(words, "should_stop", when=stop)
        return text
    text = _t(words, "no_now", asked=asked, cond=cond, where=where)
    return text + (_rain_soon(w, now, lim, words) if ask == "rain" else "")


def _rain_soon(w: Weather, now: datetime, lim: Mapping[str, float],
               words: Mapping[str, Any]) -> str:
    if is_kind(w.cond, "rain", words):
        return ""
    hit = next((r for r in hours_in(w, now, now + timedelta(hours=SOON_HOURS))
                if is_kind(r, "rain", words, lim)), None)
    if hit is None:
        return ""
    return " " + _t(words, "rain_soon", when=_from(hit, now, True, words), chance=_chance(hit, words))


def _rain_stops(w: Weather, now: datetime, lim: Mapping[str, float],
                words: Mapping[str, Any]) -> str:
    """When the rain (now) should stop, said, or "" when not within STOP_HOURS."""
    ahead = [r for r in hours_in(w, now, now + timedelta(hours=STOP_HOURS)) if r.at > now]
    dry = next((r for r in ahead if not is_kind(r, "rain", words, lim)), None)
    return _about(dry.at, now, words) if dry else ""


# ------------------------------------------------------------ the forecast

def forecast_reply(w: Weather, ask: str, span: str, hilo: str, change: str,
                   words: Mapping[str, Any], now: datetime, s: Mapping[str, Any]) -> str | None:
    """Later: will it rain (`ask`), the high or low (`hilo`), when it starts
    or stops (`change`), or the forecast for a span."""
    if not w.hourly and not w.daily:
        return _t(words, "no_forecast", where=_where(w, words))
    lim = _settings(s, w)
    if change:
        return _change(w, ask or "rain", change, words, now, lim)
    span = span or ("later" if ask else "today")
    if hilo:
        return _hilo(w, span, hilo, words, now)
    if ask:
        return _will(w, ask, span, words, now, lim)
    return _summary(w, span, words, now, lim)


def _will(w: Weather, ask: str, span: str, words: Mapping[str, Any], now: datetime,
          lim: Mapping[str, float]) -> str:
    got, hourly = _span_rows(w, span, now)
    when, asked = say_span(span, words, now), say_cond(ask, words, "noun")
    if not got:
        return _t(words, "no_forecast_for", span=when)
    hits = [r for r in got if is_kind(r, ask, words, lim)]
    if not hits:
        most = _most(got)
        tail = _t(words, "looks", cond=say_cond(most, words, "later")) if most else ""
        return _t(words, "will_no", asked=asked, span=when, looks=tail)
    first = hits[0]
    pop = max((r.pop for r in hits if r.pop is not None), default=None)
    chance = _t(words, "chance", pop=round(pop)) if pop else ""
    if hourly:
        return _t(words, "will_yes_from", asked=asked, span=when,
                  when=_from(first, now, True, words), chance=chance)
    return _t(words, "will_yes", asked=asked, span=when, chance=chance)


def _change(w: Weather, ask: str, change: str, words: Mapping[str, Any], now: datetime,
            lim: Mapping[str, float]) -> str:
    asked = say_cond(ask, words, "noun")
    raining = is_kind(w.cond, ask, words) or any(
        r.at <= now and is_kind(r, ask, words, lim) for r in hours_in(w, now, now))
    ahead = [r for r in w.hourly if r.at > now]
    if raining:
        dry = next((r for r in ahead if not is_kind(r, ask, words, lim)), None)
        if dry is None:
            return _t(words, "lasts", asked=asked)
        return _t(words, "stops", asked=asked, when=_about(dry.at, now, words))
    hit = next((r for r in ahead if is_kind(r, ask, words, lim)), None)
    lead = _t(words, "not_now_asked", asked=say_cond(ask, words, "asked")) if change == "stop" else ""
    if hit is None:
        hours = len(ahead) or 0
        return lead + _t(words, "none_ahead", asked=asked, hours=hours)
    return lead + _t(words, "starts", asked=cap(asked), when=_from(hit, now, True, words),
                     chance=_chance(hit, words))


def _hilo(w: Weather, span: str, hilo: str, words: Mapping[str, Any], now: datetime) -> str:
    when = say_span(span, words, now)
    start, end, by_day = span_window(span, now)
    days = days_in(w, start, end) if by_day else []
    hi = lo = None
    if len(days) == 1:
        hi, lo = days[0].temp, days[0].low
    if (hi is None or lo is None) and (hrs := hours_in(w, start, end)) and \
            (not by_day or _covered(w, end) or span == "today"):
        temps = [r.temp for r in hrs if r.temp is not None]
        if temps:
            hi = hi if hi is not None else max(temps)
            lo = lo if lo is not None else min(temps)
    if len(days) > 1:          # a weekend or week: the extremes over its days
        his = [r.temp for r in days if r.temp is not None]
        los = [r.low for r in days if r.low is not None]
        hi, lo = (max(his) if his else None), (min(los) if los else None)
    if hilo == "max" and hi is not None:
        return _t(words, "high", span=when, temp=say_temp(hi, w))
    if hilo == "min" and lo is not None:
        return _t(words, "low", span=when, temp=say_temp(lo, w))
    if hi is None and lo is None:
        return _t(words, "no_forecast_for", span=when)
    if hi is None or lo is None:
        return _t(words, "high" if hi is not None else "low", span=when,
                  temp=say_temp(hi if hi is not None else lo, w))
    return _t(words, "high_low", span=when, hi=say_temp(hi, w), lo=say_temp(lo, w))


def _rain_said(r: Row, words: Mapping[str, Any], lim: Mapping[str, float]) -> str:
    if r.pop:
        return _t(words, "day_chance", pop=round(r.pop))
    if r.precip is not None and r.precip >= lim["mm"]:
        return _t(words, "day_mm", mm=say_number(r.precip, "mm"))
    return ""


def _summary(w: Weather, span: str, words: Mapping[str, Any], now: datetime,
             lim: Mapping[str, float]) -> str:
    start, end, by_day = span_window(span, now)
    name = cap(((_w(words).get("span_names") or {}).get(span))
               or (_day_name(span) if span in DAYS else say_span(span, words, now)))
    if by_day:
        days = days_in(w, start, end)
        if len(days) > 1:
            parts = [_t(words, "day_short", day=r.at.strftime("%A"),
                        cond=say_cond(r.cond, words, "later"), hi=say_temp(r.temp, w))
                     for r in days if r.temp is not None or r.cond]
            return " ".join(parts) if parts else \
                _t(words, "no_forecast_for", span=say_span(span, words, now))
        if days:
            d = days[0]
            hi, lo = d.temp, d.low
            if span == "today" or (hi is None and _covered(w, end)):
                temps = [r.temp for r in hours_in(w, start, end) if r.temp is not None]
                hi = hi if hi is not None else (max(temps) if temps else None)
            text = _t(words, "day", span=name, cond=say_cond(d.cond, words, "later"),
                      temps=_temps(hi, lo, w, words), rain=_rain_said(d, words, lim))
            if span == "today" and w.cond:
                text = _t(words, "now", cond=say_cond(w.cond, words),
                          temp=say_temp(w.a("temperature"), w), where="") + " " + text
            return text
    hrs = hours_in(w, start, end)
    if not hrs:
        return _t(words, "no_forecast_for", span=say_span(span, words, now))
    temps = [r.temp for r in hrs if r.temp is not None]
    hit = next((r for r in hrs if is_kind(r, "rain", words, lim)), None)
    rain = _t(words, "rain_from", when=_from(hit, now, True, words)) if hit else ""
    return _t(words, "hours", span=name, cond=say_cond(_most(hrs), words, "later"),
              temps=_range(temps, w, words), rain=rain)


def _temps(hi: float | None, lo: float | None, w: Weather, words: Mapping[str, Any]) -> str:
    if hi is not None and lo is not None:
        return _t(words, "temps_both", hi=say_temp(hi, w), lo=say_temp(lo, w))
    if hi is not None:
        return _t(words, "temps_hi", hi=say_temp(hi, w))
    if lo is not None:
        return _t(words, "temps_lo", lo=say_temp(lo, w))
    return ""


def _range(temps: Sequence[float], w: Weather, words: Mapping[str, Any]) -> str:
    if not temps:
        return ""
    lo, hi = min(temps), max(temps)
    if round(lo) == round(hi):
        return _t(words, "range_one", temp=say_temp(hi, w))
    return _t(words, "range", lo=say_number(lo), hi=say_temp(hi, w))


# ------------------------------------------------------------ what to wear

def gear_reply(w: Weather, gear: str, span: str, words: Mapping[str, Any], now: datetime,
               s: Mapping[str, Any]) -> str | None:
    """Do I need an umbrella (rain), a coat (cold), sunscreen (sun), shorts
    (warm)? From the hours ahead (`GEAR_HOURS`) or the span asked."""
    lim = _settings(s, w)
    span = span or "rest"
    got, _hourly = _span_rows(w, span, now)
    when = say_span(span, words, now)
    if gear == "rain":
        if is_kind(w.cond, "rain", words) and span_window(span, now)[0] <= now:
            return _t(words, "gear_rain_now")
        hit = next((r for r in got if is_kind(r, "rain", words, lim)), None)
        if hit is None:
            return _t(words, "gear_rain_no", span=when) if got else None
        return _t(words, "gear_rain_yes", when=_from(hit, now, _hourly, words),
                  chance=_chance(hit, words))
    if gear in ("cold", "warm"):
        temps = [t for r in got for t in (r.temp, r.low) if t is not None]
        if span_window(span, now)[0] <= now and (t := w.a("temperature")) is not None:
            temps.append(t)
        if not temps:
            return None
        lo, hi = min(temps), max(temps)
        if gear == "cold":
            key = "gear_cold_yes" if lo < lim["cold"] else "gear_cold_no"
            return _t(words, key, temp=say_temp(lo, w), span=when)
        key = "gear_warm_yes" if hi >= lim["warm"] else "gear_warm_no"
        return _t(words, key, temp=say_temp(hi, w), span=when)
    if gear == "sun":
        uvs = [r.uv for r in got if r.uv is not None]
        if span_window(span, now)[0] <= now and (u := w.a("uv_index")) is not None:
            uvs.append(u)
        if not uvs:
            return None
        top = max(uvs)
        key = "gear_sun_yes" if top >= lim["uv"] else "gear_sun_no"
        return _t(words, key, uv=say_number(top), span=when)
    return None


# ------------------------------------------------------------ the sun

SUN_EVENTS = ("dawn", "sunrise", "noon", "sunset", "dusk")


def sun_reply(times: Mapping[int, Mapping[str, datetime | None]], event: str, day: str,
              until: str, light: str, words: Mapping[str, Any], now: datetime) -> str | None:
    """Sunrise, sunset (and dawn, dusk, noon) on a day, how long until one,
    whether it is dark, or how long the day is. `times` are the day's events
    by days from today (-1, 0, 1), from Home Assistant's own sun maths."""
    offset = {"yesterday": -1, "tomorrow": 1}.get(day, 0)
    today = times.get(0) or {}
    if light:
        dawn, dusk = today.get("dawn") or today.get("sunrise"), today.get("dusk") or today.get("sunset")
        if dawn is None or dusk is None:
            return None
        dark = not (dawn <= now < dusk)
        nxt = dawn if now < dawn else (times.get(1) or {}).get("dawn") or (times.get(1) or {}).get("sunrise")
        if dark:
            tail = _t(words, "light_at", when=_at(nxt, now, words)) if nxt else ""
        else:
            tail = _t(words, "dark_at", when=_at(dusk, now, words))
        yes = dark == (light == "dark")
        state = _t(words, "dark" if dark else "light")
        return _t(words, "yes_sky" if yes else "no_sky", state=state, tail=tail)
    if not event:
        return _daylight(times, offset, words, now)
    label = (_w(words).get("sun_events") or {}).get(event, event)
    at = (times.get(offset) or {}).get(event)
    if until or (not day and at is not None and at < now and event != "noon"):
        if at is None or at < now:   # today's has passed: tomorrow's
            at = (times.get(offset + 1) or {}).get(event)
        if at is None:
            return _t(words, "no_sun", event=label)
        if until:
            return _t(words, "sun_in", event=cap(label), ago=say_ago((at - now).total_seconds(), words),
                      when=_at(at, now, words))
    if at is None:
        return _t(words, "no_sun", event=label)
    if at < now:
        return _t(words, "sun_was", event=cap(label), when=_at(at, now, words))
    return _t(words, "sun_is", event=cap(label), when=_at(at, now, words),
              ago=say_ago((at - now).total_seconds(), words))


def _at(at: datetime, now: datetime, words: Mapping[str, Any]) -> str:
    at = at.astimezone(now.tzinfo)
    day = (at.date() - now.date()).days
    t = say_time(at)
    if day == 0:
        return _t(words, "at_time", time=t)
    if day == 1:
        return _t(words, "tomorrow_at", time=t)
    if day == -1:
        return _t(words, "yesterday_at", time=t)
    return _t(words, "day_at", day=at.strftime("%A"), time=t)


def _daylight(times: Mapping[int, Mapping[str, datetime | None]], offset: int,
              words: Mapping[str, Any], now: datetime) -> str | None:
    def length(o: int) -> float | None:
        d = times.get(o) or {}
        rise, set_ = d.get("sunrise"), d.get("sunset")
        return (set_ - rise).total_seconds() if rise and set_ else None
    got, before = length(offset), length(offset - 1)
    if got is None:
        return None
    day = (_w(words).get("spans") or {}).get({-1: "yesterday", 1: "tomorrow"}.get(offset, "today"))
    text = _t(words, "daylight", span=day, ago=say_ago(got, words))
    if before is not None and abs(got - before) >= 60:
        key = "longer" if got > before else "shorter"
        text += " " + _t(words, key, ago=say_ago(abs(got - before), words))
    return text


# ------------------------------------------------------------ the moon

SYNODIC = 29.530588861


def _jd(at: datetime) -> float:
    return at.timestamp() / 86400.0 + 2440587.5


def _from_jd(jd: float) -> datetime:
    return datetime.fromtimestamp((jd - 2440587.5) * 86400.0, timezone.utc)


def moon_event(k: float) -> datetime:
    """The new (k whole) or full (k + 0.5) moon number k after January 2000,
    by Meeus (Astronomical Algorithms, ch. 49): within a few minutes."""
    t = k / 1236.85
    jde = (2451550.09766 + SYNODIC * k + 0.00015437 * t * t - 0.00000015 * t ** 3
           + 0.00000000073 * t ** 4)
    e = 1 - 0.002516 * t - 0.0000074 * t * t
    r = math.radians
    m = r(2.5534 + 29.10535670 * k - 0.0000014 * t * t)
    mp = r(201.5643 + 385.81693528 * k + 0.0107582 * t * t + 0.00001238 * t ** 3)
    f = r(160.7108 + 390.67050284 * k - 0.0016118 * t * t)
    om = r(124.7746 - 1.56375588 * k + 0.0020672 * t * t)
    full = (k % 1) != 0
    a, b = (-0.40614, 0.17302) if full else (-0.40720, 0.17241)
    c2, c3, c4 = (0.01614, 0.01043, 0.00734) if full else (0.01608, 0.01039, 0.00739)
    jde += (a * math.sin(mp) + b * e * math.sin(m) + c2 * math.sin(2 * mp)
            + c3 * math.sin(2 * f) + c4 * e * math.sin(mp - m)
            - 0.00515 * e * math.sin(mp + m) + 0.00209 * e * e * math.sin(2 * m)
            - 0.00111 * math.sin(mp - 2 * f) - 0.00057 * math.sin(mp + 2 * f)
            + 0.00056 * e * math.sin(2 * mp + m) - 0.00042 * math.sin(3 * mp)
            + 0.00042 * e * math.sin(m + 2 * f) + 0.00038 * e * math.sin(m - 2 * f)
            - 0.00024 * e * math.sin(2 * mp - m) - 0.00017 * math.sin(om))
    return _from_jd(jde - 69 / 86400)    # TT to UT, near enough this century


def _k(at: datetime) -> float:
    return math.floor((_jd(at) - 2451550.09766) / SYNODIC)


def moon_events(after: datetime, phase: str) -> datetime:
    """The next new or full moon after a time."""
    half = 0.5 if phase == "full" else 0.0
    k = _k(after) - 1 + half
    while (at := moon_event(k)) <= after:
        k += 1
    return at


def moon_now(now: datetime) -> tuple[str, float, float]:
    """(phase name, how lit 0-1, age 0-1 of the cycle)."""
    prev = moon_events(now - timedelta(days=30), "new")
    while (nxt := moon_events(prev, "new")) <= now:
        prev = nxt
    age = (now - prev) / (nxt - prev)
    lit = (1 - math.cos(2 * math.pi * age)) / 2
    full = moon_events(prev, "full")
    day = timedelta(hours=18)
    if now - prev < day or nxt - now < day:
        name = "new"
    elif abs(now - full) < day:
        name = "full"
    elif abs(age - 0.25) < 0.03:
        name = "first_quarter"
    elif abs(age - 0.75) < 0.03:
        name = "last_quarter"
    elif age < 0.25:
        name = "waxing_crescent"
    elif age < 0.5:
        name = "waxing_gibbous"
    elif age < 0.75:
        name = "waning_gibbous"
    else:
        name = "waning_crescent"
    return name, lit, age


def moon_reply(phase: str, nxt: str, words: Mapping[str, Any], now: datetime) -> str:
    """The moon now (`phase` "" or asked yes/no: full, new) or when the next
    full or new one is (`nxt`)."""
    names = _w(words).get("moon") or {}
    name, lit, age = moon_now(now)
    said = names.get(name, name.replace("_", " "))
    pct = round(lit * 100)
    if nxt:
        at = moon_events(now, nxt).astimezone(now.tzinfo)
        return _t(words, "moon_next", phase=names.get(nxt, nxt),
                  when=say_day(at.date(), now.date(), words))
    if phase:
        yes = name == phase
        other = "full" if phase == "full" else "new"
        at = moon_events(now, other).astimezone(now.tzinfo)
        key = "moon_yes" if yes else "moon_no"
        return _t(words, key, phase=names.get(phase, phase), now=said, lit=pct,
                  when=say_day(at.date(), now.date(), words))
    coming = "full" if age < 0.5 else "new"
    at = moon_events(now, coming).astimezone(now.tzinfo)
    return _t(words, "moon", now=said, lit=pct, phase=names.get(coming, coming),
              when=say_day(at.date(), now.date(), words))
