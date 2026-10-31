"""Alfie's fun and Alfie himself (design.md "Brain" → Local answers, M15 E):
a coin, dice, a random number, picking one of a few things, jokes, small talk
(who he is, hello, thank you) and what he can do. "Say that again" is
conversation.py's: it needs the last reply.

PURE (no HA import), so the tests run under plain python. The words are the
language file's `fun` section (lang/<code>/brain.json). Chance comes from a
`random.Random` passed in, so the tests can fix it.
"""

from __future__ import annotations

import random
import re
from collections.abc import Iterable, Mapping, Sequence
from typing import Any

from .reckon import SMALL, TENS, number_words, say_num

DICE_MAX = 10           # dice in one roll
SIDES_MAX = 1000        # sides on one die
RANGE_MAX = 10 ** 9     # "a number between 1 and a billion"


def _w(words: Mapping[str, Any]) -> Mapping[str, Any]:
    return (words or {}).get("fun") or {}


def _t(words: Mapping[str, Any], key: str, **kw: Any) -> str:
    text = (_w(words).get("replies") or {}).get(key) or key
    return text.format(**kw) if kw else text


def _one(words: Mapping[str, Any], key: str, rng: random.Random, **kw: Any) -> str:
    """One of the language's lines for `key` (a list, or one line)."""
    got = (_w(words).get("lines") or {}).get(key)
    text = rng.choice(got) if isinstance(got, list) and got else got if isinstance(got, str) else key
    return text.format(**kw) if kw else text


def _numbers(text: str) -> list[int]:
    """The whole numbers said in the text, in words or digits ("d20", "two
    dice", "between 1 and a hundred")."""
    # "and" splits ("between one and ten"), so number_words can't join it.
    toks = ["&" if t == "and" else t
            for t in re.findall(r"[a-z]+|\d+", text.lower().replace(",", ""))]
    out, i = [], 0
    while i < len(toks):
        if toks[i] in SMALL and i + 1 < len(toks) and (toks[i + 1] in SMALL or toks[i + 1] in TENS):
            out.append(SMALL[toks[i]])      # "three twelve sided": two numbers, not 15
            i += 1
            continue
        got = number_words(toks, i)
        if got is None:
            i += 1
            continue
        value, used = got
        if value == int(value):
            out.append(int(value))
        i += used
    return out


# ------------------------------------------------------------ chance

def coin_reply(words: Mapping[str, Any], rng: random.Random) -> str:
    return _t(words, "heads" if rng.random() < 0.5 else "tails")


def dice_reply(text: str, words: Mapping[str, Any], rng: random.Random) -> str | None:
    """"roll a die", "roll two dice", "roll a d20", "roll three twelve sided
    dice". None when the text isn't a roll he understands."""
    text = " ".join(text.lower().split())
    if not re.search(r"\b(dice|dices|die|d\s?\d+)\b", text):
        return None     # "roll up the blinds"
    count, sides = 1, 6
    d = re.search(r"\bd\s?(\d+)\b", text)
    nums = _numbers(re.sub(r"\bd\s?\d+\b", " ", text))
    if d:
        sides = int(d.group(1))
        if nums:
            count = nums[0]
    elif "sided" in text or "side" in text:
        before = _numbers(re.split(r"\bsided?\b", text)[0])
        if not before:
            return None
        sides = before[-1]
        if len(before) > 1:
            count = before[0]
    elif nums:
        count = nums[0]
    elif re.search(r"\b(some|the)\s+dice\b|^dice$", text):
        count = 2       # "roll the dice" is a pair; "a dice" is one
    if not 1 <= count <= DICE_MAX or not 2 <= sides <= SIDES_MAX:
        return _t(words, "too_many_dice", most=DICE_MAX)
    rolls = [rng.randint(1, sides) for _ in range(count)]
    if count == 1:
        return _t(words, "rolled", n=say_num(rolls[0]))
    return _t(words, "rolled_many", rolls=join([say_num(r) for r in rolls], words),
              total=say_num(sum(rolls)))


def number_reply(text: str, words: Mapping[str, Any], rng: random.Random,
                 default_max: int = 10) -> str | None:
    """"pick a number", "a random number between 5 and 50", "pick a number
    up to 100"."""
    nums = [n for n in _numbers(text) if n <= RANGE_MAX]
    if len(nums) >= 2:
        lo, hi = sorted(nums[:2])
    elif len(nums) == 1:
        lo, hi = 1, nums[0]
    else:
        lo, hi = 1, default_max
    if hi <= lo:
        return None
    return _t(words, "number", n=say_num(rng.randint(lo, hi)))


SPLIT = re.compile(r"\s*(?:,|\bor\b|\band\b)\s*")


def with_commas(value: str, raw: str) -> str:
    """The slot's words as said in the raw text, commas kept (hassil drops
    them): "red green or blue" in "Choose one of red, green or blue." """
    parts = value.split()
    if not parts:
        return value
    m = re.search(r"[\s,]+".join(re.escape(p) for p in parts) + r"\b", raw.lower())
    return m.group(0) if m else value


def pick_reply(text: str, words: Mapping[str, Any], rng: random.Random) -> str | None:
    """One of the things said: "pizza, tacos or curry". None for fewer than two."""
    text = re.sub(r"^(between|from|one of|out of)\s+", "", " ".join(text.lower().split()))
    things = [x.strip() for x in SPLIT.split(text) if x.strip()]
    things = [re.sub(r"^(the|a|an)\s+", "", x) for x in things]
    if len(set(things)) < 2:
        return None
    return _t(words, "picked", thing=rng.choice(things))


def join(items: Sequence[str], words: Mapping[str, Any]) -> str:
    items = list(items)
    if len(items) <= 1:
        return "".join(items)
    return f"{', '.join(items[:-1])} {_t(words, 'and')} {items[-1]}"


# ------------------------------------------------------------ jokes

def joke_lines(words: Mapping[str, Any], own: Iterable[str], builtin: bool) -> list[str]:
    """Every joke he knows, each said as one line: the user's own ("setup |
    punchline") first, then the language's when `builtin` is on."""
    out = []
    for j in [*own, *((_w(words).get("jokes") or []) if builtin else [])]:
        j = " ".join(str(j).split())
        if "|" in j:
            setup, _, punch = j.partition("|")
            j = f"{setup.strip()} ... {punch.strip()}"
        if j and j not in out:
            out.append(j)
    return out


class JokeBag:
    """Jokes without a repeat until every one has been told."""

    def __init__(self) -> None:
        self.told: list[str] = []

    def next(self, jokes: Sequence[str], rng: random.Random) -> str | None:
        if not jokes:
            return None
        fresh = [j for j in jokes if j not in self.told]
        if not fresh:
            self.told = self.told[-1:] if len(jokes) > 1 else []
            fresh = [j for j in jokes if j not in self.told]
        joke = rng.choice(fresh)
        self.told.append(joke)
        return joke


def joke_reply(bag: JokeBag, words: Mapping[str, Any], own: Iterable[str], builtin: bool,
               rng: random.Random) -> str:
    return bag.next(joke_lines(words, own, builtin), rng) or _t(words, "no_jokes")


# ------------------------------------------------------------ Alfie himself

def chat_reply(ask: str, words: Mapping[str, Any], rng: random.Random, name: str = "Alfie",
               days: int | None = None, version: str = "") -> str | None:
    """Small talk: who he is, hello, thank you... `ask` is the language's
    `chat_q` value. `days` is how long ago he was set up."""
    lines = _w(words).get("lines") or {}
    if ask == "age":
        if days is None:
            return _one(words, "age_unknown", rng, name=name)
        if days < 1:
            return _t(words, "age_today")
        return _t(words, "age", n=say_num(days), days=_t(words, "day" if days == 1 else "days"))
    if ask == "version":
        return _t(words, "version", version=version) if version else None
    if ask not in lines:
        return None
    return _one(words, ask, rng, name=name)


def help_reply(on: Iterable[str], words: Mapping[str, Any], delegate: str = "") -> str:
    """What he can do, from the commands that are on, and who answers the
    rest. The language's `help` groups are each "say" (what he can tell you
    about) or "do", said when any of their commands is on."""
    on = set(on)
    groups = [g for g in _w(words).get("help") or []
              if isinstance(g, Mapping) and on & set(g.get("commands") or [])]
    about = [g["say"] for g in groups if g.get("say")]
    doing = [g["do"] for g in groups if g.get("do")]
    parts = []
    if about:
        parts.append(_t(words, "help", things=join(about, words)))
    if doing:
        parts.append(_t(words, "help_do" if about else "help_do_only", things=join(doing, words)))
    if not parts:
        parts.append(_t(words, "help_none"))
    if delegate:
        parts.append(_t(words, "help_delegate", name=delegate))
    return " ".join(parts)
