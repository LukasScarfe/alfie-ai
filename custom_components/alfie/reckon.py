"""Alfie's answers about time, dates and numbers (design.md "Brain" → Local
answers, M15 C): the time in another place, days until or since a date,
which weekday a date is, dates ahead or back, week numbers, leap years, sums
said out loud and unit conversions.

PURE (no HA import), so the tests run under plain python. The words are the
language file's `reckon` section (lang/<code>/brain.json); `today` and `now`
are passed in, never read here. Time zones come in as tzinfo objects, read by
local.py (zoneinfo reads files).
"""

from __future__ import annotations

import calendar
import math
import re
from collections.abc import Callable, Iterable, Mapping
from dataclasses import dataclass
from datetime import date, datetime, timedelta
from typing import Any

from .answers import say_ago, say_time

MAX_RESULT = 1e15      # a sum bigger than this is said as too big


def _w(words: Mapping[str, Any]) -> Mapping[str, Any]:
    return (words or {}).get("reckon") or {}


def _t(words: Mapping[str, Any], key: str, **kw: Any) -> str:
    text = (_w(words).get("replies") or {}).get(key) or key
    return text.format(**kw) if kw else text


def _clean(text: str) -> str:
    t = " ".join(str(text or "").lower().replace("’", "'").replace(",", " ").split())
    return t.strip(" ?.!")


# ------------------------------------------------------------ numbers

SMALL = {w: i for i, w in enumerate(
    "zero one two three four five six seven eight nine ten eleven twelve thirteen fourteen "
    "fifteen sixteen seventeen eighteen nineteen".split())}
TENS = {w: 10 * (i + 2) for i, w in enumerate(
    "twenty thirty forty fifty sixty seventy eighty ninety".split())}
SCALES = {"hundred": 100, "thousand": 1000, "million": 10 ** 6, "billion": 10 ** 9}
ORDINALS = {"first": 1, "second": 2, "third": 3, "fourth": 4, "fifth": 5, "sixth": 6,
            "seventh": 7, "eighth": 8, "ninth": 9, "tenth": 10, "eleventh": 11, "twelfth": 12,
            "thirteenth": 13, "fourteenth": 14, "fifteenth": 15, "sixteenth": 16,
            "seventeenth": 17, "eighteenth": 18, "nineteenth": 19, "twentieth": 20,
            "thirtieth": 30}


def _num_token(tok: str) -> float | None:
    t = tok.replace("_", "")
    if re.fullmatch(r"-?\d+(\.\d+)?|-?\.\d+", t):
        return float(t)
    return None


def number_words(tokens: list[str], i: int) -> tuple[float, int] | None:
    """A number said from tokens[i]: digits ("1,250" arrives as "1 250"
    only from speech, so commas are dropped first) or words ("two hundred
    and five", "three point five", "a hundred"). (value, tokens used)."""
    if i >= len(tokens):
        return None
    v = _num_token(tokens[i])
    if v is not None:
        j = i + 1
        if j < len(tokens) and tokens[j] in SCALES:      # "2 million"
            return v * SCALES[tokens[j]], j + 1 - i
        return v, 1
    total = cur = 0.0
    j, seen = i, False
    while j < len(tokens):
        tok = tokens[j]
        if tok in SMALL:
            cur += SMALL[tok]
        elif tok in TENS:
            cur += TENS[tok]
        elif tok in SCALES and (seen or tok == "hundred"):
            cur = (cur or 1) * SCALES[tok]
            if SCALES[tok] > 100:
                total, cur = total + cur, 0.0
        elif tok in ("a", "an") and j + 1 < len(tokens) and tokens[j + 1] in SCALES and not seen:
            cur = 1
        elif tok == "and" and seen and j + 1 < len(tokens) and \
                (tokens[j + 1] in SMALL or tokens[j + 1] in TENS):
            j += 1
            continue
        elif tok == "point" and seen and j + 1 < len(tokens):
            digits = ""
            k = j + 1
            while k < len(tokens) and (tokens[k] in SMALL and SMALL[tokens[k]] < 10
                                       or re.fullmatch(r"\d", tokens[k])):
                digits += str(SMALL.get(tokens[k], tokens[k]))
                k += 1
            if not digits:
                break
            return total + cur + float("0." + digits), k - i
        else:
            break
        seen = True
        j += 1
    if not seen:
        return None
    return total + cur, j - i


def parse_number(text: str) -> float | None:
    """A whole phrase that is one number, or None."""
    toks = _clean(text).split()
    got = number_words(toks, 0)
    return got[0] if got and got[1] == len(toks) else None


def say_num(v: float) -> str:
    """84.0 -> "84", 8.04672 -> "8.05", 0.0254 -> "0.0254", 1234567 -> "1234567"."""
    if v == 0 or not math.isfinite(v):
        return "0"
    if abs(v - round(v)) < 1e-9 and abs(v) < MAX_RESULT:
        return str(int(round(v)))
    digits = max(0, min(6, 2 - math.floor(math.log10(abs(v)))))
    text = f"{v:.{digits}f}".rstrip("0").rstrip(".")
    return "0" if text in ("-0", "") else text


# ------------------------------------------------------------ sums

class _Bad(Exception):
    pass


OPS: list[tuple[tuple[str, ...], str]] = [
    # "the" is dropped before these are matched: "to the power of" is "to power of".
    (("raised", "to", "power", "of"), "^"), (("to", "power", "of"), "^"), (("to", "power"), "^"), (("multiplied", "by"), "*"), (("divided", "by"), "/"),
    (("take", "away"), "-"), (("square", "root", "of"), "sqrt"), (("percent", "of"), "%of"),
    (("per", "cent", "of"), "%of"), (("%", "of"), "%of"), (("half", "of"), "half"),
    (("a", "half", "of"), "half"), (("a", "third", "of"), "third"),
    (("a", "quarter", "of"), "quarter"), (("plus",), "+"), (("add",), "+"), (("+",), "+"),
    (("minus",), "-"), (("-",), "-"), (("less",), "-"), (("times",), "*"), (("x",), "*"),
    (("*",), "*"), (("×",), "*"), (("over",), "/"), (("/",), "/"), (("÷",), "/"),
    (("^",), "^"), (("squared",), "sq"), (("cubed",), "cube"), (("percent",), "%"),
    (("%",), "%"), (("mod",), "mod"), (("modulo",), "mod")]


def tokens_of_sum(text: str) -> list[Any] | None:
    """A spoken sum as numbers and operator symbols, or None when any word
    isn't part of a sum (so "what's the office temperature" isn't one)."""
    t = _clean(text)
    t = re.sub(r"(\d)\s*([%+*/^×÷x])\s*", r"\1 \2 ", t)
    t = re.sub(r"(\d)%", r"\1 %", t)
    t = re.sub(r"([+*/^×÷])(\d)", r"\1 \2", t)
    toks = [x for x in t.split() if x not in ("the", "is", "equals", "equal", "what")]
    out: list[Any] = []
    i = 0
    while i < len(toks):
        for words, op in OPS:
            if tuple(toks[i:i + len(words)]) == words:
                out.append(op)
                i += len(words)
                break
        else:
            got = number_words(toks, i)
            if got is None:
                return None
            out.append(got[0])
            i += got[1]
    if not any(isinstance(x, str) for x in out) or not any(isinstance(x, float) for x in out):
        return None
    return out


def evaluate(toks: list[Any]) -> float:
    """The value of a sum's tokens, by the usual rules (powers, then times and
    divide, then plus and minus). Raises ZeroDivisionError or _Bad."""
    pos = 0

    def peek() -> Any:
        return toks[pos] if pos < len(toks) else None

    def take() -> Any:
        nonlocal pos
        pos += 1
        return toks[pos - 1]

    def atom() -> float:
        tok = peek()
        if tok == "-":
            take()
            return -atom()
        if tok in ("sqrt", "half", "third", "quarter"):
            take()
            v = power()
            if tok == "sqrt":
                if v < 0:
                    raise _Bad("negative root")
                return math.sqrt(v)
            return v / {"half": 2, "third": 3, "quarter": 4}[tok]
        if isinstance(tok, float):
            take()
            v = tok
            while peek() in ("sq", "cube", "%"):
                op = take()
                v = v * v if op == "sq" else v ** 3 if op == "cube" else v / 100
            if peek() == "%of":
                take()
                return v / 100 * power()
            return v
        raise _Bad(f"unexpected {tok!r}")

    def power() -> float:
        v = atom()
        if peek() == "^":
            take()
            e = power()
            if abs(e) > 1000:
                raise _Bad("too big")
            v = v ** e
            if isinstance(v, complex):
                raise _Bad("complex")
        return v

    def term() -> float:
        v = power()
        while peek() in ("*", "/", "mod"):
            op = take()
            r = power()
            v = v * r if op == "*" else v / r if op == "/" else math.fmod(v, r)
        return v

    def expr() -> float:
        v = term()
        while peek() in ("+", "-"):
            op = take()
            r = term()
            v = v + r if op == "+" else v - r
        return v

    v = expr()
    if pos != len(toks):
        raise _Bad("left over")
    return v


def sum_reply(text: str, words: Mapping[str, Any]) -> str | None:
    """ "12 times 7" -> "12 times 7 is 84." None when it isn't a sum."""
    toks = tokens_of_sum(text)
    if toks is None:
        return None
    said = _clean(text).removeprefix("the ")
    said = said[:1].upper() + said[1:]
    try:
        v = evaluate(toks)
    except ZeroDivisionError:
        return _t(words, "divide_zero")
    except (_Bad, OverflowError, ValueError):
        return None
    if not math.isfinite(v) or abs(v) >= MAX_RESULT:
        return _t(words, "too_big", sum=said)
    return _t(words, "sum", sum=said, value=say_num(v))


# ------------------------------------------------------------ units

# unit -> (kind, size in the kind's base unit). Temperatures are converted
# by formula; cups, pints, gallons and fluid ounces depend on `brain.imperial`.
UNITS: dict[str, tuple[str, float]] = {
    "mm": ("length", 0.001), "cm": ("length", 0.01), "m": ("length", 1.0),
    "km": ("length", 1000.0), "in": ("length", 0.0254), "ft": ("length", 0.3048),
    "yd": ("length", 0.9144), "mi": ("length", 1609.344), "nmi": ("length", 1852.0),
    "mg": ("mass", 1e-6), "g": ("mass", 0.001), "kg": ("mass", 1.0), "t": ("mass", 1000.0),
    "oz": ("mass", 0.028349523125), "lb": ("mass", 0.45359237), "st": ("mass", 6.35029318),
    "ml": ("volume", 0.001), "cl": ("volume", 0.01), "dl": ("volume", 0.1), "l": ("volume", 1.0),
    "tsp": ("volume", 0.00492892159), "tbsp": ("volume", 0.0147867648),
    "cup": ("volume", 0.0), "pint": ("volume", 0.0), "quart": ("volume", 0.0),
    "gal": ("volume", 0.0), "floz": ("volume", 0.0),
    "c": ("temp", 0.0), "f": ("temp", 0.0), "k": ("temp", 0.0),
    "kmh": ("speed", 1 / 3.6), "mph": ("speed", 0.44704), "ms": ("speed", 1.0),
    "kn": ("speed", 0.514444), "s": ("time", 1.0), "min": ("time", 60.0), "h": ("time", 3600.0),
    "day": ("time", 86400.0), "week": ("time", 604800.0), "year": ("time", 31557600.0),
    "sqm": ("area", 1.0), "sqft": ("area", 0.09290304), "acre": ("area", 4046.8564224),
    "ha": ("area", 10000.0), "sqkm": ("area", 1e6), "sqmi": ("area", 2589988.110336),
}
VOLUMES = {"us": {"cup": 0.2365882365, "pint": 0.473176473, "quart": 0.946352946,
                  "gal": 3.785411784, "floz": 0.0295735295625},
           "uk": {"cup": 0.25, "pint": 0.56826125, "quart": 1.1365225, "gal": 4.54609,
                  "floz": 0.0284130625}}


def _size(unit: str, system: str) -> float:
    kind, size = UNITS[unit]
    if kind == "volume" and unit in VOLUMES["us"]:
        return VOLUMES.get(system, VOLUMES["us"])[unit]
    return size


def convert(value: float, src: str, dst: str, system: str = "us") -> float | None:
    """A value in one unit as another, or None when they measure different
    things."""
    if src not in UNITS or dst not in UNITS or UNITS[src][0] != UNITS[dst][0]:
        return None
    if UNITS[src][0] == "temp":
        c = {"c": value, "f": (value - 32) * 5 / 9, "k": value - 273.15}[src]
        return {"c": c, "f": c * 9 / 5 + 32, "k": c + 273.15}[dst]
    return value * _size(src, system) / _size(dst, system)


def say_unit(unit: str, value: float, words: Mapping[str, Any]) -> str:
    names = (_w(words).get("unit_names") or {}).get(unit) or [unit, unit]
    return names[0] if abs(value) == 1 else names[1]


def convert_reply(amount: str, src: str, dst: str, words: Mapping[str, Any],
                  system: str = "us") -> str | None:
    """ "5" miles to km -> "5 miles is 8.05 kilometres." None when the amount
    isn't a number."""
    value = 1.0 if _clean(amount) in ("", "a", "an", "one") else parse_number(amount)
    if value is None:
        return None
    got = convert(value, src, dst, system)
    if got is None:
        return _t(words, "cant_convert", src=say_unit(src, 2, words), dst=say_unit(dst, 2, words))
    return _t(words, "converted", value=say_num(value), src=say_unit(src, value, words),
              got=say_num(got), dst=say_unit(dst, got, words))


# ------------------------------------------------------------ dates

DAY_NAMES = ("monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday")
MONTHS = {m.lower(): i for i, m in enumerate(calendar.month_name) if m}
MONTHS.update({m.lower(): i for i, m in enumerate(calendar.month_abbr) if m})
MONTHS["sept"] = 9


def easter(year: int) -> date:
    """Western Easter Sunday (the anonymous Gregorian computus)."""
    a, b, c = year % 19, year // 100, year % 100
    d, e = b // 4, b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i, k = c // 4, c % 4
    m = (32 + 2 * e + 2 * i - h - k) % 7
    n = (a + 11 * h + 22 * m) // 451
    month, day = divmod(h + m - 7 * n + 114, 31)
    return date(year, month, day + 1)


def rule(spec: str) -> Callable[[int], date | None] | None:
    """A date rule as said in the language file: "12-25" every year,
    "10/mon/2" the second Monday of October, "05/mon/-1" the last Monday of
    May, "05/mon/<25" the last Monday before the 25th, "easter-2"."""
    spec = spec.strip().lower()
    if spec.startswith("easter"):
        shift = int(spec[6:] or 0)
        return lambda y: easter(y) + timedelta(days=shift)
    if m := re.fullmatch(r"(\d{1,2})-(\d{1,2})", spec):
        mo, d = int(m[1]), int(m[2])

        def fixed(y: int) -> date | None:
            try:
                return date(y, mo, d)
            except ValueError:          # 29 February in a common year
                return date(y, mo, d - 1) if (mo, d) == (2, 29) else None
        return fixed
    if m := re.fullmatch(r"(\d{1,2})/([a-z]{3})/(-?\d|<\d{1,2})", spec):
        mo, wd = int(m[1]), [d[:3] for d in DAY_NAMES].index(m[2])

        def nth(y: int) -> date:
            if m[3].startswith("<"):
                d = date(y, mo, int(m[3][1:])) - timedelta(days=1)
                return d - timedelta(days=(d.weekday() - wd) % 7)
            n = int(m[3])
            if n > 0:
                first = date(y, mo, 1)
                return first + timedelta(days=(wd - first.weekday()) % 7 + 7 * (n - 1))
            last = date(y, mo, calendar.monthrange(y, mo)[1])
            return last - timedelta(days=(last.weekday() - wd) % 7)
        return nth
    return None


@dataclass
class When:
    """A date someone said: a fixed day, or one every year (a holiday, a
    birthday, "25 December")."""

    fixed: date | None = None
    yearly: Callable[[int], date | None] | None = None
    name: str = ""          # "Christmas", "Lukas's birthday"; "" a plain date
    way: str = ""           # "next", "last" (said), else by the question
    since_year: int = 0     # a named date's first year (an anniversary)

    def on(self, today: date, way: str = "next") -> date | None:
        """The day meant: the next (today or later) or the last (today or
        earlier) one, for a yearly date."""
        if self.fixed is not None:
            return self.fixed
        if self.yearly is None:
            return None
        way = self.way or way
        this = self.yearly(today.year)
        if this is None:
            return None
        if way == "last":
            return this if this < today else self.yearly(today.year - 1)
        if way == "next_strict":
            return this if this > today else self.yearly(today.year + 1)
        return this if this >= today else self.yearly(today.year + 1)


def holidays(words: Mapping[str, Any], extra: Iterable[str] = ()) -> dict[str, When]:
    """Every named date, by each way of saying it: the language's holidays,
    then the user's own ("Lukas's birthday: 03-14", "Our anniversary:
    2019-06-01")."""
    out: dict[str, When] = {}
    for h in (_w(words).get("holidays") or {}).values():
        if not isinstance(h, Mapping) or not (r := rule(str(h.get("date", "")))):
            continue
        for w in h.get("words") or []:
            out[_clean(w)] = When(yearly=r, name=h.get("name") or w)
    for line in extra:
        name, _, when = str(line).rpartition(":")
        name, when = name.strip(), when.strip()
        m = re.fullmatch(r"(?:(\d{4})-)?(\d{1,2})-(\d{1,2})", when)
        if not name or not m or not (r := rule(f"{m[2]}-{m[3]}")):
            continue
        w = When(yearly=r, name=name, since_year=int(m[1] or 0))
        key = _clean(name)
        out[key] = w
        for lead in ("my ", "our ", "the "):
            if key.startswith(lead):
                out[key[len(lead):]] = w
    return out


UNIT_DAYS = {"day": 1, "days": 1, "week": 7, "weeks": 7, "fortnight": 14, "fortnights": 14}
UNIT_MONTHS = {"month": 1, "months": 1, "year": 12, "years": 12}


def add_months(d: date, n: int) -> date:
    y, m = divmod(d.month - 1 + n, 12)
    y, m = d.year + y, m + 1
    return date(y, m, min(d.day, calendar.monthrange(y, m)[1]))


def _ordinal_day(tok: str) -> int | None:
    if m := re.fullmatch(r"(\d{1,2})(st|nd|rd|th)?", tok):
        n = int(m[1])
        return n if 1 <= n <= 31 else None
    return ORDINALS.get(tok)


def date_key(text: str) -> tuple[str, str, int]:
    """A date said, split: ("next christmas 2027") -> ("christmas",
    "next_strict", 2027). The first is what named dates are looked up by."""
    t = _clean(text)
    for lead in ("it ", "it'll be ", "it will be ", "on ", "the "):
        t = t.removeprefix(lead)
    way = ""
    for w, key in (("next ", "next_strict"), ("this ", ""), ("last ", "last"),
                   ("this coming ", ""), ("coming ", "")):
        if t.startswith(w) and t != w.strip():
            way, t = key, t[len(w):]
            break
    year = 0
    if m := re.fullmatch(r"(.+?) (\d{4})", t):
        t, year = m[1], int(m[2])
    return t, way, year


def parse_when(text: str, today: date, named: Mapping[str, When]) -> When | None:
    """A date said: "christmas", "next friday", "in 3 weeks", "100 days ago",
    "25 december", "the 3rd of march 2027", "tomorrow"... or None."""
    t, way, year = date_key(text)
    if t in named:
        w = named[t]
        if year and w.yearly:
            return When(fixed=w.yearly(year), name=w.name, since_year=w.since_year)
        return When(w.fixed, w.yearly, w.name, way, w.since_year)
    if t in ("today", "now", "it", "tonight"):
        return When(fixed=today)
    rel = {"tomorrow": 1, "yesterday": -1, "day after tomorrow": 2, "day before yesterday": -2}
    if t in rel:
        return When(fixed=today + timedelta(days=rel[t]))
    if t in DAY_NAMES:
        wd = DAY_NAMES.index(t)
        if way == "last":
            return When(fixed=today - timedelta(days=(today.weekday() - wd) % 7 or 7))
        ahead = (wd - today.weekday()) % 7
        if way == "next_strict" and ahead == 0:
            ahead = 7
        return When(fixed=today + timedelta(days=ahead))
    if way in ("next_strict", "last") and t in ("week", "month", "year"):
        sign = 1 if way == "next_strict" else -1
        if t == "week":
            return When(fixed=today + timedelta(days=7 * sign))
        return When(fixed=add_months(today, sign * (1 if t == "month" else 12)))
    toks = t.split()
    # "in 3 weeks", "3 weeks from now", "100 days ago", "a fortnight from today"
    if toks and toks[0] == "in":
        toks, sign = toks[1:], 1
    elif toks and toks[-1] in ("ago", "before", "earlier"):
        toks, sign = toks[:-1], -1
    elif len(toks) > 2 and " ".join(toks[-2:]) in ("from now", "from today") or \
            toks and toks[-1] in ("time", "later", "hence"):
        toks, sign = toks[:-2] if toks[-2] == "from" else toks[:-1], 1
    else:
        sign = 0
    if sign and toks:
        unit = toks[-1]
        amount = 1.0 if toks[:-1] in (["a"], ["an"], []) else parse_number(" ".join(toks[:-1]))
        if amount is not None and amount == int(amount):
            n = int(amount) * sign
            if unit in UNIT_DAYS:
                return When(fixed=today + timedelta(days=n * UNIT_DAYS[unit]))
            if unit in UNIT_MONTHS:
                return When(fixed=add_months(today, n * UNIT_MONTHS[unit]))
    # Calendar dates: "25 december", "december 25th", "the 3rd of march", "25th"
    if m := re.fullmatch(r"(\d{4})-(\d{1,2})-(\d{1,2})", t):
        try:
            return When(fixed=date(int(m[1]), int(m[2]), int(m[3])))
        except ValueError:
            return None
    toks = [x for x in t.split() if x not in ("of", "the")]
    day = month = None
    if len(toks) == 2:
        a, b = toks
        if a in MONTHS and _ordinal_day(b):
            month, day = MONTHS[a], _ordinal_day(b)
        elif b in MONTHS and _ordinal_day(a):
            month, day = MONTHS[b], _ordinal_day(a)
    elif len(toks) == 1 and re.fullmatch(r"\d{1,2}(st|nd|rd|th)|[a-z]+", toks[0]) and \
            (d := _ordinal_day(toks[0])) and not toks[0].isdigit():
        day = d
    if day is None:
        return None
    if month is None:              # "the 25th": this month's, or next month's
        def monthly(_y: int, d: int = day) -> date | None:
            for k in range(3):
                m0 = add_months(today.replace(day=1), k)
                if d <= calendar.monthrange(m0.year, m0.month)[1] and m0.replace(day=d) >= today:
                    return m0.replace(day=d)
            return None
        return When(fixed=monthly(0))
    r = rule(f"{month}-{day}")
    if r is None:
        return None
    if year:
        try:
            return When(fixed=date(year, month, day))
        except ValueError:
            return None
    return When(yearly=r, way=way)


def say_date(d: date, today: date, words: Mapping[str, Any], weekday: bool = True) -> str:
    """ "Friday 25 December", with the year when it isn't this one."""
    text = f"{d.day} {d.strftime('%B')}"
    if weekday:
        text = f"{d.strftime('%A')} {text}"
    if d.year != today.year:
        text += f" {d.year}"
    return text


def _count(n: int, unit: str, words: Mapping[str, Any]) -> str:
    names = (_w(words).get("counts") or {}).get(unit) or [unit, unit + "s"]
    return f"{n} {names[0] if n == 1 else names[1]}"


def date_reply(ask: str, text: str, today: date, words: Mapping[str, Any],
               named: Mapping[str, When]) -> str | None:
    """Days until or since a date, its weekday, the date meant, when it is.
    `ask`: until, weeks, sleeps, since, dow, date, when. None when the words
    aren't a date (the turn goes on)."""
    w = parse_when(text, today, named)
    if w is None:
        return None
    d = w.on(today, "last" if ask == "since" else "next")
    if d is None:
        return None
    days = (d - today).days
    name = w.name
    said = say_date(d, today, words)
    if ask in ("until", "weeks", "sleeps", "since"):
        if days == 0:
            return _t(words, "is_today", name=name or _t(words, "that"))
        if ask != "since" and days == 1:
            return _t(words, "is_tomorrow", name=name or said, date=said)
        span = abs(days)
        if ask == "weeks" and span >= 7:
            weeks, rest = divmod(span, 7)
            n = _count(weeks, "week", words) + (
                f" {_t(words, 'and')} {_count(rest, 'day', words)}" if rest else "")
        else:
            n = _count(span, "sleep" if ask == "sleeps" else "day", words)
        if days < 0:
            if name:
                return _t(words, "was_named", name=name, n=n, date=said)
            return _t(words, "was", n=n, date=said)
        if name:
            return _t(words, "in_named", name=name, n=n, date=said)
        return _t(words, "in", n=n, date=said)
    if ask == "dow":
        if days == 0 and not name:
            return _t(words, "date_today", date=said)
        key = "dow_was" if days < 0 else "dow_is"
        return _t(words, key, what=name or say_date(d, today, words, weekday=False),
                  day=d.strftime("%A"), date=say_date(d, today, words, weekday=False))
    if ask == "date":
        key = "date_was" if days < 0 else "date_today" if days == 0 else "date_is"
        return _t(words, key, what=_clean(text), date=said)
    # when is ...
    if days == 0:
        return _t(words, "is_today", name=name or said)
    tail = _t(words, "ago_tail", n=_count(-days, "day", words)) if days < 0 else \
        _t(words, "in_tail", n=_count(days, "day", words))
    return _t(words, "when_was" if days < 0 else "when", name=name or _t(words, "that"), date=said,
              tail=tail)


def calendar_reply(ask: str, text: str, today: date, words: Mapping[str, Any]) -> str | None:
    """The week number, days left in the year or month, leap years."""
    if ask == "week":
        return _t(words, "week", n=today.isocalendar()[1])
    if ask == "year_left":
        total = 366 if calendar.isleap(today.year) else 365
        n = today.timetuple().tm_yday
        return _t(words, "year_left", n=n, total=total, left=_count(total - n, "day", words))
    if ask == "month_left":
        left = calendar.monthrange(today.year, today.month)[1] - today.day
        return _t(words, "month_left", left=_count(left, "day", words),
                  month=today.strftime("%B"))
    if ask == "leap":
        t = _clean(text)
        y = today.year if t in ("", "it", "this year", "this", "now") else \
            today.year + 1 if t == "next year" else today.year - 1 if t == "last year" else \
            int(n) if (n := parse_number(t)) is not None and 1 <= n <= 9999 and n == int(n) else None
        if y is None:
            return None
        if calendar.isleap(y):
            return _t(words, "leap_yes", year=y)
        nxt = next(x for x in range(y + 1, y + 9) if calendar.isleap(x))
        return _t(words, "leap_no", year=y, next=nxt)
    return None


# ------------------------------------------------------------ world clocks

def zone_names(zones: Iterable[str]) -> dict[str, str]:
    """IANA zones by the place they name: "new york" -> America/New_York."""
    out = {}
    for z in sorted(zones):
        if "/" not in z or z.startswith(("Etc/", "SystemV/", "posix/", "right/")):
            continue
        out.setdefault(z.rsplit("/", 1)[1].replace("_", " ").lower(), z)
    return out


def find_zone(place: str, zones: Mapping[str, str], words: Mapping[str, Any]) -> str | None:
    p = _clean(place).removeprefix("the ")
    aliases = _w(words).get("places") or {}
    return aliases.get(p) or zones.get(p)


def _offset(at: datetime) -> float:
    off = at.utcoffset()
    return off.total_seconds() if off is not None else 0.0


def world_reply(ask: str, place: str, here: datetime, there: datetime,
                words: Mapping[str, Any]) -> str:
    """The time (or day) in a place, and how far ahead or behind it is.
    `here` and `there` are the same moment in the two zones."""
    p = " ".join(x.capitalize() if x not in ("of", "the") else x
                 for x in _clean(place).removeprefix("the ").split())
    diff = _offset(there) - _offset(here)
    if diff == 0:
        gap = _t(words, "same_time")
    else:
        gap = _t(words, "ahead" if diff > 0 else "behind", by=say_ago(abs(diff), words))
    if ask == "diff":
        return _t(words, "diff", place=p, gap=gap)
    day = ""
    if there.date() != here.date():
        day = _t(words, "on_day", day=there.strftime("%A"))
    if ask == "day":
        return _t(words, "day_there", place=p, date=say_date(there.date(), here.date(), words))
    return _t(words, "time_there", place=p, time=say_time(there), day=day, gap=gap)
