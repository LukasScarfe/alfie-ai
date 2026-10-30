"""Alfie's voice (design.md "Brain", Speech): text rewritten the way a person
says it, before a TTS engine reads it. Engines read digits and symbols
literally: Piper's espeak says 1884 as "one thousand eight hundred eighty
four", 18°C as "eighteen degrees C", 9:05 as "nine zero five" and a date with
"dash" or "slash". `speak` turns those into "eighteen eighty-four", "eighteen
degrees", "nine oh five" and "October thirtieth".

PURE (no HA import), so the tests run under plain python. The words come from
a language file, lang/<language>/speech.json; the grammar that puts number
words together is per language in SPELLERS (English for now). A language with
no speller only gets the language-free passes (markdown, links, emoji, the
user's own replacements).

Each pass is a setting in the `speech` config section (`default_settings`).
The passes run in an order that keeps them apart: dates before times before
measurements before plain numbers, so a later pass never sees digits an
earlier one has already said.
"""

from __future__ import annotations

import json
import os
import re
from collections.abc import Callable, Mapping
from datetime import date
from typing import Any

LANG_DIR = os.path.join(os.path.dirname(__file__), "lang")

YEARS = ("pairs", "number", "off")        # 1884: eighteen eighty-four / one thousand ... / as is
YEARS_2000 = ("twenty", "thousand")       # 2026: twenty twenty-six / two thousand twenty-six
TIME_STYLES = ("clock", "casual", "24h", "off")
TIME_PERIODS = ("words", "ampm", "none")  # in the evening / PM / nothing
DATE_STYLES = ("month_day", "day_month", "off")
NUMERIC_DATES = ("month_first", "day_first")
DATE_YEARS = ("not_this_year", "always")


def default_settings() -> dict[str, Any]:
    """The `speech` config section's speaking rules (config.py adds the engine)."""
    return {"numbers": True, "decimals": 1, "and": False,
            "years": "pairs", "years_2000": "twenty",
            "time_style": "clock", "time_period": "words",
            "date_style": "month_day", "numeric_dates": "month_first",
            "date_year": "not_this_year",
            "temperature_unit": False, "units": True, "currency": True,
            "abbreviations": True, "markdown": True, "links": True, "emoji": True,
            "replacements": []}


_LANGS: dict[str, dict[str, Any] | None] = {}


def _code(language: str) -> str:
    return (language or "en").replace("_", "-").split("-")[0].lower()


def language_ready(language: str) -> bool:
    """Whether `load_language` has read this language already (it never reads twice)."""
    return _code(language) in _LANGS


def load_language(language: str) -> dict[str, Any] | None:
    """The speech words for a language ("en", "en-GB" -> en), or None. Reads a
    file the first time: in HA, call it from an executor."""
    code = _code(language)
    if code not in _LANGS:
        path = os.path.join(LANG_DIR, code, "speech.json")
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            data["code"] = code
            _LANGS[code] = data
        except (OSError, ValueError):
            _LANGS[code] = None
    return _LANGS[code]


# ---------------------------------------------------------------- English words

class English:
    """Number words in English, from the language file's words."""

    def __init__(self, words: Mapping[str, Any], use_and: bool) -> None:
        self.w = words
        self.use_and = use_and

    def _below_1000(self, n: int) -> list[str]:
        ones, tens = self.w["ones"], self.w["tens"]
        out: list[str] = []
        if n >= 100:
            out += [ones[n // 100], self.w["hundred"]]
            n %= 100
            if n and self.use_and:
                out.append(self.w["and"])
        if n >= 20:
            out.append(tens[n // 10] + ("-" + ones[n % 10] if n % 10 else ""))
        elif n:
            out.append(ones[n])
        return out

    def cardinal(self, n: int) -> str:
        if n < 0:
            return f"{self.w['minus']} {self.cardinal(-n)}"
        if n == 0:
            return self.w["ones"][0]
        groups = []
        while n:
            groups.append(n % 1000)
            n //= 1000
        if len(groups) > len(self.w["scales"]):
            return " ".join(self.w["ones"][int(d)] for d in str(n))
        out: list[str] = []
        for i in range(len(groups) - 1, -1, -1):
            g = groups[i]
            if not g:
                continue
            # "one thousand and five": the and joins a last group below 100.
            if i == 0 and out and g < 100 and self.use_and:
                out.append(self.w["and"])
            out += self._below_1000(g)
            if i:
                out.append(self.w["scales"][i])
        return " ".join(out)

    def ordinal(self, n: int) -> str:
        words = self.cardinal(n)
        head, sep, last = words.rpartition(" ")
        pre, dash, unit = last.rpartition("-")
        irregular = self.w["ordinals"].get(unit)
        if irregular:
            unit = irregular
        elif unit.endswith("y"):
            unit = unit[:-1] + "ieth"
        else:
            unit += "th"
        return head + sep + pre + dash + unit

    def decimal(self, text: str, places: int) -> str:
        """A number as written ("1,500", "21.37", "-3") in words, decimals
        rounded to `places`."""
        neg = text.startswith(("-", "−"))
        text = text.lstrip("-−").replace(",", "")
        if "." in text:
            value = round(float(text), places)
            whole, _, frac = f"{value:.{places}f}".partition(".")
            frac = frac.rstrip("0")
        else:
            whole, frac = text, ""
        out = self.cardinal(int(whole or 0))
        if frac:
            out += f" {self.w['point']} " + " ".join(self.w["ones"][int(d)] for d in frac)
        if neg and (int(whole or 0) or frac):
            out = f"{self.w['minus']} {out}"
        return out

    def year(self, n: int, style_2000: str) -> str:
        if 2000 <= n < 2010 or (n >= 2010 and n < 2100 and style_2000 == "thousand"):
            return self.cardinal(n)
        if n < 1000 or n % 1000 == 0 and n < 10000:
            return self.cardinal(n)
        hi, lo = divmod(n, 100)
        if lo == 0:
            return f"{self.cardinal(hi)} {self.w['hundred']}"
        if lo < 10:
            return f"{self.cardinal(hi)} {self.w['oh']} {self.w['ones'][lo]}"
        return f"{self.cardinal(hi)} {self.cardinal(lo)}"

    def decade(self, n: int) -> str:
        """1980 -> nineteen eighties, 80 -> eighties."""
        if n < 100:
            return self.cardinal(n)[:-1] + "ies" if n % 10 == 0 and n >= 20 else self.cardinal(n) + "s"
        hi, lo = divmod(n, 100)
        if lo == 0:
            return f"{self.cardinal(hi)} {self.w['hundred']}s"
        return f"{self.cardinal(hi)} {self.decade(lo)}"


SPELLERS: dict[str, Callable[[Mapping[str, Any], bool], English]] = {"en": English}


# ---------------------------------------------------------------- the passes

_EMOJI = re.compile("[\U0001F000-\U0001FAFF☀-➿️‍]")
_URL = re.compile(r"https?://\S+|www\.\S+")
_MD_LINK = re.compile(r"\[([^\]]+)\]\([^)]*\)")
_INT = r"(?:\d{1,3}(?:,\d{3})+|\d+)"
_NUM = _INT + r"(?:\.\d+)?"
# A number standing on its own: not glued to letters (qwen3, PM2.5, B580).
_FREE = r"(?<![\w.$£€])"


def _markdown(text: str) -> str:
    text = _MD_LINK.sub(r"\1", text)
    text = re.sub(r"`{1,3}([^`]*)`{1,3}", r"\1", text)
    text = re.sub(r"(\*\*|__|\*|~~)(\S(?:.*?\S)?)\1", r"\2", text)
    lines = []
    for line in text.split("\n"):
        line = re.sub(r"^\s*(#{1,6}\s+|[-*•]\s+|\d+[.)]\s+|>\s*)", "", line).strip()
        if line and lines and not re.search(r"[.!?:;,]$", lines[-1]):
            lines[-1] += "."
        if line:
            lines.append(line)
    return " ".join(lines)


def _replacements(text: str, pairs: list[Mapping[str, Any]]) -> str:
    for p in pairs:
        src, dst = str(p.get("from") or "").strip(), str(p.get("to") or "")
        if src:
            text = re.sub(rf"(?<!\w){re.escape(src)}(?!\w)", lambda _m, d=dst: d, text,
                          flags=re.IGNORECASE)
    return text


def _abbreviations(text: str, table: Mapping[str, str]) -> str:
    for src in sorted(table, key=len, reverse=True):
        dst = table[src]
        left = r"(?<!\w)" if src[0].isalnum() else r"(?<!\S)"
        right = r"(?!\w|\.\w)" if src[-1].isalnum() else r"(?!\w)"   # not "AD" in "A.D.x"
        text = re.sub(left + re.escape(src) + right, lambda _m, d=dst: d, text)
    return text


def _kept_stop(m: re.Match) -> str:
    """The full stop of "9 p.m." when it also ends the sentence."""
    rest = m.string[m.end():]
    if m[0].endswith(".") and (not rest.strip() or re.match(r"\s+[A-Z]", rest)):
        return "."
    return ""


class Speaker:
    """Speaks text by one language's words and the user's settings."""

    def __init__(self, lang: Mapping[str, Any], settings: Mapping[str, Any],
                 today: date | None = None) -> None:
        self.w = lang
        self.s = {**default_settings(), **settings}
        self.today = today
        self.num = SPELLERS[lang["code"]](lang, bool(self.s["and"])) \
            if lang.get("code") in SPELLERS else None
        months = list(lang.get("months") or [])
        self.months = months
        self.month_index = {m.lower(): i + 1 for i, m in enumerate(months)}
        self.month_index.update({k: v for k, v in (lang.get("month_abbreviations") or {}).items()})
        names = sorted(self.month_index, key=len, reverse=True)
        self.month_re = r"(?P<mon>" + "|".join(re.escape(n) for n in names) + r")\.?" if names else None

    # -- helpers
    def n(self, text: str) -> str:
        return self.num.decimal(text, int(self.s["decimals"]))

    def _plural(self, text: str) -> bool:
        try:
            return abs(float(text.replace(",", "").lstrip("-−"))) != 1
        except ValueError:
            return True

    # -- dates
    def _date(self, year: int | None, month: int, day: int) -> str:
        if not 1 <= month <= 12 or not 1 <= day <= 31:
            raise ValueError
        tpl = self.w["date"][self.s["date_style"]]
        out = tpl.format(day=self.num.ordinal(day), month=self.months[month - 1])
        skip = (year is None or self.s["date_year"] == "not_this_year" and self.today is not None
                and year == self.today.year)
        if not skip:
            out = self.w["date"]["year"].format(date=out, year=self._year_words(year))
        return out

    def _year_words(self, y: int) -> str:
        if self.s["years"] == "number":
            return self.num.cardinal(y)
        return self.num.year(y, self.s["years_2000"])

    def dates(self, text: str) -> str:
        if self.s["date_style"] == "off":
            return text

        def iso(m: re.Match) -> str:
            try:
                out = self._date(int(m["y"]), int(m["mo"]), int(m["d"]))
            except ValueError:
                return m[0]
            return out + (self.w["date"]["at"] + m["t"] if m["t"] else "")
        text = re.sub(r"(?<![\w-])(?P<y>\d{4})-(?P<mo>\d{1,2})-(?P<d>\d{1,2})"
                      r"(?:[T ](?P<t>\d{1,2}:\d{2}(?::\d{2})?))?(?![\w-])", iso, text)

        def numeric(m: re.Match) -> str:
            a, b, y = int(m["a"]), int(m["b"]), int(m["y"])
            if y < 100:
                y += 2000
            month, day = (a, b) if self.s["numeric_dates"] == "month_first" else (b, a)
            if month > 12 >= day:
                month, day = day, month
            try:
                return self._date(y, month, day)
            except ValueError:
                return m[0]
        text = re.sub(r"(?<![\w/.])(?P<a>\d{1,2})([/.])(?P<b>\d{1,2})\2(?P<y>\d{4}|\d{2})(?![\w/]|\.\d)",
                      numeric, text)
        if not self.month_re:
            return text

        def named(m: re.Match, day_first: bool) -> str:
            month = self.month_index.get(m["mon"].lower())
            if month is None:
                return m[0]
            try:
                return self._date(int(m["y"]) if m["y"] else None, month, int(m["d"]))
            except ValueError:
                return m[0]
        year = r"(?:,?\s+(?P<y>\d{4}))?(?![\w:])"
        text = re.sub(rf"(?<!\w){self.month_re}\s+(?P<d>\d{{1,2}})(?:st|nd|rd|th)?(?![\d:]){year}",
                      lambda m: named(m, False), text, flags=re.IGNORECASE)
        text = re.sub(rf"(?<![\w:])(?:the\s+)?(?P<d>\d{{1,2}})(?:st|nd|rd|th)?\s+(?:of\s+)?{self.month_re}(?!\w){year}",
                      lambda m: named(m, True), text, flags=re.IGNORECASE)
        return text

    # -- times
    def _period(self, h24: int) -> str:
        for lo, hi, words in self.w["time"]["periods"]:
            if lo <= h24 < hi:
                return words
        return ""

    def _clock(self, h24: int, minute: int, known: bool, h_said: int) -> str:
        t = self.w["time"]
        style = self.s["time_style"]
        if style == "24h" and known:
            if minute == 0:
                return t["hundred"].format(hour=self.num.cardinal(h24))
            return f"{self.num.cardinal(h24)} {self._minutes(minute)}"
        if known and self.s["time_period"] == "words":
            if h24 == 12 and minute == 0:
                return t["noon"]
            if h24 == 0 and minute == 0:
                return t["midnight"]
        hour = (h24 % 12 or 12) if known else h_said
        nxt = (hour % 12) + 1
        said = None
        if style == "casual" and minute % 5 == 0:
            if minute == 0:
                said = t["oclock"].format(hour=self.num.cardinal(hour))
            elif minute == 30:
                said = t["half"].format(hour=self.num.cardinal(hour))
            elif minute < 30:
                mins = t["quarter"] if minute == 15 else self.num.cardinal(minute)
                said = t["past"].format(minutes=mins, hour=self.num.cardinal(hour))
            else:
                mins = t["quarter"] if minute == 45 else self.num.cardinal(60 - minute)
                said = t["to"].format(minutes=mins, hour=self.num.cardinal(nxt))
        period = known and self.s["time_period"] != "none"
        if said is None:
            if minute == 0 and period:
                said = self.num.cardinal(hour)
            elif minute == 0:
                said = t["oclock"].format(hour=self.num.cardinal(hour))
            else:
                said = f"{self.num.cardinal(hour)} {self._minutes(minute)}"
        if period:
            if self.s["time_period"] == "words":
                said += " " + self._period(h24)
            else:
                said += " " + (t["pm"] if h24 >= 12 else t["am"])
        return said

    def _minutes(self, minute: int) -> str:
        if minute < 10:
            return f"{self.w['oh']} {self.w['ones'][minute]}"
        return self.num.cardinal(minute)

    def times(self, text: str) -> str:
        if self.s["time_style"] == "off":
            return text
        ampm = r"(?:\s*(?P<ap>[AaPp])\.?\s?[Mm]\.?(?![\w]))?"

        def clock(m: re.Match) -> str:
            h, minute = int(m["h"]), int(m["m"])
            if h > 23 or minute > 59:
                return m[0]
            ap = (m["ap"] or "").lower()
            if ap:
                if h > 12:
                    return m[0]
                h24, known = (h % 12) + (12 if ap == "p" else 0), True
            else:
                # 21:45 or 09:05 is a 24-hour time; 9:05 could be either.
                known = h > 12 or h == 0 or m["h"].startswith("0")
                h24 = h
            return self._clock(h24, minute, known, h) + _kept_stop(m)
        text = re.sub(rf"(?<![\w:.])(?P<h>\d{{1,2}}):(?P<m>\d{{2}})(?::\d{{2}})?(?![\d:]){ampm}",
                      clock, text)

        def bare(m: re.Match) -> str:
            h = int(m["h"])
            if not 1 <= h <= 12:
                return m[0]
            return (self._clock((h % 12) + (12 if m["ap"].lower() == "p" else 0), 0, True, h)
                    + _kept_stop(m))
        return re.sub(r"(?<![\w:.])(?P<h>\d{1,2})\s*(?P<ap>[AaPp])\.?\s?[Mm]\.?(?!\w)", bare, text)

    # -- measurements
    def temperatures(self, text: str) -> str:
        units = self.w.get("temperature_units") or {}
        one, many = self.w["degree"]

        def say(m: re.Match) -> str:
            num = m["n"]
            if m["neg"]:
                num = "-" + num
            out = f"{self.n(num)} {one if not self._plural(num) else many}"
            if m["u"] and self.s["temperature_unit"]:
                out += " " + units.get(m["u"].upper(), m["u"])
            return out
        text = re.sub(rf"(?<![\w.])(?P<neg>[-−])?(?P<n>{_NUM})\s*°\s*(?P<u>[CFK](?![a-z]))?", say, text)
        # "18 degrees C" written out by an agent.
        text = re.sub(r"\b(degrees?)\s+(?P<u>[CF])\b(?!\.\w)",
                      lambda m: m[1] + (" " + units.get(m["u"], "") if self.s["temperature_unit"] else ""),
                      text)
        return text

    def currency(self, text: str) -> str:
        table = self.w.get("currency") or {}
        if not table:
            return text
        syms = "".join(re.escape(s) for s in table)

        def say(m: re.Match) -> str:
            one, many, sub1, subs = table[m["c"]]
            whole = int(m["n"].replace(",", ""))
            cents = int(m["f"]) if m["f"] else 0
            out = f"{self.num.cardinal(whole)} {one if whole == 1 else many}"
            if cents:
                out += f" {self.num.cardinal(cents)}" if whole else ""
                if not whole:
                    out = f"{self.num.cardinal(cents)} {sub1 if cents == 1 else subs}"
            return out
        return re.sub(rf"(?P<c>[{syms}])\s?(?P<n>{_INT})(?:\.(?P<f>\d{{2}}))?(?!\d)", say, text)

    def percent(self, text: str) -> str:
        return re.sub(rf"{_FREE}(?P<neg>[-−])?(?P<n>{_NUM})\s?%",
                      lambda m: f"{self.n((m['neg'] or '') + m['n'])} {self.w['percent']}", text)

    def units(self, text: str) -> str:
        table = self.w.get("units") or {}
        if not table:
            return text
        alts = "|".join(re.escape(u) for u in sorted(table, key=len, reverse=True))

        def say(m: re.Match) -> str:
            num = (m["neg"] or "") + m["n"]
            one, many = table[m["u"]]
            return f"{self.n(num)} {many if self._plural(num) else one}"
        return re.sub(rf"{_FREE}(?P<neg>[-−])?(?P<n>{_NUM})\s?(?P<u>{alts})(?![\w/²³])", say, text)

    def fractions(self, text: str) -> str:
        table = self.w.get("fractions") or {}
        for src, dst in table.items():
            text = re.sub(rf"(?<![\w/]){re.escape(src)}(?![\w/])", dst, text)
        return text

    # -- plain numbers
    def ordinals(self, text: str) -> str:
        return re.sub(r"(?<![\w.,])(\d+)(?:st|nd|rd|th)\b",
                      lambda m: self.num.ordinal(int(m[1])), text)

    def decades(self, text: str) -> str:
        def say(m: re.Match) -> str:
            n = int(m["n"])
            if len(m["n"]) == 4 and not 1000 <= n <= 2090:
                return m[0]
            return self.num.decade(n)
        return re.sub(r"(?<![\w.,])['’]?(?P<n>\d{4}|\d0)s\b", say, text)

    def years(self, text: str) -> str:
        if self.s["years"] == "off":
            return text
        cues = {c.lower() for c in self.w.get("year_cues") or ()}
        eras = tuple(self.w.get("eras") or ())
        counts = {c.lower() for c in self.w.get("not_year_after") or ()}

        def say(m: re.Match) -> str:
            n = int(m["n"])
            before = text[:m.start()].split()
            after = text[m.end():].split()
            prev = before[-1].lower().strip("(,") if before else ""
            nxt = after[0] if after else ""
            word = nxt.lower().strip(".,;:!?)")
            if nxt.startswith(eras):
                return self._year_words(n)
            if len(m["n"]) < 4 or n < 1000:
                return m[0]
            # "1500 years", "2000 people": a count, not a year.
            if word in counts or (len(word) > 3 and word.endswith("s")
                                  and word not in ("was", "has", "is")):
                return m[0]
            if prev in cues or 1100 <= n <= 2099:
                return self._year_words(n)
            return m[0]
        return re.sub(r"(?<![\w.,$£€-])(?P<n>\d{3,4})(?![\w/-]|[.,]\d)", say, text)

    def ranges(self, text: str) -> str:
        return re.sub(rf"(?<![\w.,-])(?P<a>{_NUM})\s?[-–]\s?(?P<b>{_NUM})(?![\w.-]|\.\d)",
                      lambda m: f"{m['a']} {self.w['to']} {m['b']}", text)

    def numbers(self, text: str) -> str:
        return re.sub(rf"(?<![\w.,$£€])(?P<neg>(?<!\S)[-−])?(?P<n>{_NUM})(?!\w|[.,]\d)",
                      lambda m: self.n((m["neg"] or "") + m["n"]), text)

    # -- all of it
    def speak(self, text: str) -> str:
        s = self.s
        text = str(text or "")
        if s["markdown"]:
            text = _markdown(text)
        if s["links"]:
            text = _URL.sub("", text)
        if s["emoji"]:
            text = _EMOJI.sub("", text)
        text = _replacements(text, s["replacements"] or [])
        if s["abbreviations"]:
            text = _abbreviations(text, self.w.get("abbreviations") or {})
        if self.num is not None:
            text = self.dates(text)
            text = self.times(text)
            text = self.temperatures(text)
            if s["currency"]:
                text = self.currency(text)
            text = self.percent(text)
            text = self.decades(text)
            if s["units"]:
                text = self.units(text)
            text = self.fractions(text)
            text = self.ordinals(text)
            text = self.years(text)
            text = self.ranges(text)
            if s["numbers"]:
                text = self.numbers(text)
        text = re.sub(r"(?<!\.)\.\.(?!\.)", ".", text)   # "B.C." ending a sentence; ... stays
        return re.sub(r"[ \t]{2,}", " ", text).strip()


def speak(text: str, settings: Mapping[str, Any] | None = None, language: str = "en",
          today: date | None = None) -> str:
    """`text` as a person would say it (a language with no words file comes back
    with only the language-free passes)."""
    lang = load_language(language) or {"code": ""}
    return Speaker(lang, settings or {}, today).speak(text)


# A sentence ends at . ! ? or a line break followed by space; a decimal point
# (2.5) or an abbreviation's dot (e.g.) is not followed by space, or is, so a
# streamed reply is cut only where a following chunk can't change the words.
_SENTENCE_END = re.compile(r"[.!?]+[\"')\]]?\s+|\n+")


def split_ready(buffer: str) -> tuple[str, str]:
    """(the complete sentences in `buffer`, the rest), for a streamed reply."""
    last = None
    for m in _SENTENCE_END.finditer(buffer):
        last = m
    if last is None:
        return "", buffer
    return buffer[:last.end()], buffer[last.end():]
