"""Alfie's brain (design.md "Brain"): the conversation agent's decisions.
conversation.alfie (conversation.py) answers a turn from the first tier that
can:

  tier 1  an automation's sentence trigger, then Alfie's own commands (what's
          wrong, how are you), then Home Assistant's built-in intents, then his
          local answers that a built-in intent may know better (any entity's
          state, how many lights are on: `LATE`);
  tier 3  the agent server (`agent_url`, agent.py: Hermes Agent), else the
          delegate: any other conversation agent, usually an LLM.

Tier 2, the matcher, comes in M16. Tier 1 replies come from templates, so the
LLM is used only when nothing local is sure.

PURE (no HA import), so the tests run under plain python. The sentences and
replies are lang/<language>/brain.json; which commands are on, the extra
sentences and everything else are the `brain` config section
(`default_settings`). Each turn is kept in a small in-memory log with why it
went where it did (never entity state).
"""

from __future__ import annotations

import json
import os
import re
import time
from collections import deque
from collections.abc import Iterable, Mapping
from dataclasses import asdict, dataclass
from typing import Any

from .speech import LANG_DIR, _code

COMMANDS = ("whats_wrong", "how_are_you", "run", "entity", "entity_count", "entity_when",
            "entity_history", "weather_now", "weather_forecast", "weather_past", "weather_gear",
            "sun", "moon",
            "world_time", "dates", "convert", "maths", "people", "media", "calendar", "lists",
            "repeat", "help", "coin", "dice", "number", "pick", "joke", "chat", "wiki")
INTENTS = {"whats_wrong": "AlfieWhatsWrong", "how_are_you": "AlfieHowAreYou", "run": "AlfieRun",
           "entity": "AlfieEntity", "entity_count": "AlfieEntityCount",
           "entity_when": "AlfieEntityWhen", "entity_history": "AlfieEntityHistory",
           "weather_now": "AlfieWeatherNow", "weather_forecast": "AlfieWeatherForecast",
           "weather_past": "AlfieWeatherPast",
           "weather_gear": "AlfieWeatherGear", "sun": "AlfieSun", "moon": "AlfieMoon",
           "world_time": "AlfieWorldTime", "dates": "AlfieDates", "convert": "AlfieConvert",
           "maths": "AlfieMaths", "people": "AlfiePeople", "media": "AlfieMedia",
           "calendar": "AlfieCalendar", "lists": "AlfieLists", "repeat": "AlfieRepeat",
           "help": "AlfieHelp", "coin": "AlfieCoin", "dice": "AlfieDice",
           "number": "AlfieNumber", "pick": "AlfiePick", "joke": "AlfieJoke", "chat": "AlfieChat",
           "wiki": "AlfieWiki"}
LABELS = {"whats_wrong": "what's wrong", "how_are_you": "how are you", "run": "a voice action",
          "entity": "a thing's state", "entity_count": "how many things",
          "entity_when": "when a thing changed", "entity_history": "a thing's history",
          "weather_now": "the weather now", "weather_forecast": "the forecast",
          "weather_past": "the weather earlier",
          "weather_gear": "what to wear", "sun": "the sun", "moon": "the moon",
          "world_time": "the time somewhere", "dates": "dates", "convert": "converting units",
          "maths": "a sum", "people": "who's home", "media": "what's playing",
          "calendar": "the calendar", "lists": "a list", "repeat": "say that again",
          "help": "what can you do", "coin": "a coin", "dice": "dice",
          "number": "a random number", "pick": "picking one", "joke": "a joke",
          "chat": "small talk", "wiki": "Wikipedia"}
# Answered from a weather entity, the sun and the moon (outside.py).
OUTSIDE = frozenset({"weather_now", "weather_forecast", "weather_past", "weather_gear", "sun",
                     "moon"})
# Answered from the clock, the calendar and arithmetic (reckon.py).
RECKON = frozenset({"world_time", "dates", "convert", "maths"})
# Answered from people, players, calendars and to-do lists (household.py).
HOUSEHOLD = frozenset({"people", "media", "calendar", "lists"})
# Chance, jokes and small talk (fun.py). "repeat" and "help" are conversation.py's.
FUN = frozenset({"coin", "dice", "number", "pick", "joke", "chat"})
# What a voice action can start, and how (the `voice_label` label marks them).
RUNNABLE = {"script": ("script", "turn_on"), "automation": ("automation", "trigger"),
            "scene": ("scene", "turn_on"), "button": ("button", "press"),
            "input_button": ("input_button", "press")}
# Tried after HA's intents: a built-in intent knows its own entities better.
LATE = frozenset({"entity", "entity_count", "wiki"})
# Questions only the house can answer: a name that names nothing is said so.
HOUSE_ONLY = frozenset({"entity_when", "entity_history"})
WILDCARDS = ("name", "area", "value", "place", "date", "expr", "what", "item", "topic")
# HA intents that only read a state: local unless `local_states` is off (HA's
# own pipeline hands HassGetState to an LLM agent; the weather was invented).
STATE_INTENTS = frozenset({"HassGetState", "HassGetWeather"})
MEDIA_SEARCH = "HassMediaSearchAndPlay"
# Where a turn's answer came from, by tier.
SOURCES = {"trigger": 1, "own": 1, "intent": 1, "agent": 3, "delegate": 3, "none": 0,
           "error": 0, "dropped": 0}
LOG_MAX = 200
MAX_SAID = 300     # characters of a question or reply kept in the log


def default_settings() -> dict[str, Any]:
    """The `brain` config section."""
    return {"delegate": "",                 # a conversation entity; "" none
            "agent_url": "",                # an agent server (Hermes): it answers before the
                                            # delegate, which is then only its stand-in; "" off
            "agent_key": "",                # its API key
            "agent_model": "hermes-agent",  # the model name it's asked for
            "agent_prompt": "",             # each spoken turn's system message; "" the language's
            "agent_prompt_typed": "",       # ...each typed turn's; "" the language's
            "agent_final_only": True,       # spoken: only the final answer reaches the speaker
            "agent_earlier": True,          # tell it the turns HA answered that it never saw
            "room_context": True,           # spoken: tell it what was said in the room lately,
                                            # whoever answered (another person's profile too)
            "room_minutes": 15,             # ...within this long
            "room_turns": 6,                # ...at most this many
            "profiles": [],                 # people with their own agent profile:
                                            # {id, name, user (HA user id), url, key}
            "profile_routing": "profiles",  # "profiles": each person's turns go to their
                                            # own profile; "names": every turn goes to the
                                            # house's, "Lukas: ..." telling it who spoke
            "voice_identity": False,        # voice: the profile alfie-ears recognised
            "ears_url": "",                 # alfie-ears (its /api/last); "" none
            "ears_fresh": 15,               # seconds a verdict stays good for
            "ears_match": 85,               # % its text must match what HA heard
            "voice_sticky": 90,             # s: a voice ears can't place keeps the last
                                            # recognised person's profile there; 0 off
            "guest_entity": "input_boolean.guest_mode",   # on: guests are over
            "guest_house_only": True,       # ...then every voice turn is the house's
            "drop_not_meant": False,        # end turns ears says weren't for Alfie, silently
            "drop_expression": "",          # his face for one; "" none
            "agent_seconds": 120,           # the longest it may take
            "agent_wait": True,             # "give me a second" before something slow
            "agent_wait_seconds": 4,        # ...or when nothing has come for this long
            "agent_quick_tools": ["ha_", "memory", "session_search", "tool_search", "tool_call",
                                  "todo", "clarify", "skill_view", "skills_list"],
                                            # tools fast enough to need no wait line
            "agent_think_voice": "off",     # thinking on spoken requests (agent.THINK): fast
            "agent_think_typed": "default", # ...on typed ones; "default" the server's own
            "agent_think_asked": "medium",  # ...when asked ("think about it"); "default" ignore
            "agent_think_phrases": [],      # what asks for it; [] the language's
            "own_sentences": True, "off_commands": [],
            "own_always": sorted(OUTSIDE),  # matched even with own_sentences off (fast weather
                                            # while an agent server takes the rest)
            "voice_label": "Alfie voice",   # a label: what carries it, he starts by voice
            "run_bare": True,               # its name alone ("movie time") starts it too
            "run_conditions": False,        # an automation started by voice checks its conditions
            "run_reply": "",                # "" the language's ("OK, {name}.")
            "extra_sentences": {c: [] for c in COMMANDS},
            "exposed_only": False,          # entities: only those exposed to Assist
            "match_floor": 70,              # finder score a name needs (0-120)
            "ask_which": True,              # two equal fits: ask, else hand on
            "say_unknown": True,            # a house-only question about no known thing:
                                            # say so, not the delegate (it may invent it)
            "count_skip": ["adaptive_lighting"],   # integrations "how many" ignores
            "weather": "",                  # a weather entity; "" the house's (local.py)
            "weather_anywhere": True,       # "in Paris" with no weather entity of that name:
                                            # Open-Meteo (the place's name leaves the house)
            "weather_geo_url": "https://geocoding-api.open-meteo.com/v1/search",
            "weather_url": "https://api.open-meteo.com/v1/forecast",
            "weather_seconds": 3,           # Open-Meteo's time to answer, each call
            "weather_minutes": 30,          # a place's forecast kept this long
            "weather_past": "openmeteo",    # "did it rain today": openmeteo (the house's
                                            # whereabouts leave it; its history if that fails),
                                            # history (the weather entity's, no amounts), off
            "weather_reports": [],          # weather entities whose recorded rain counts as
                                            # rain fell; [] the house's (`weather`)
            "rain_gauge": "",               # a rain sensor (a total, or mm/h): its amounts
                                            # come first; "" none
            "cold_below": 10,               # °C: "do I need a coat?", "is it cold?"
            "warm_above": 22,               # °C: "is it warm?", "do I need shorts?"
            "windy_speed": 30,              # km/h: "is it windy?"
            "rain_chance": 40,              # %: a forecast hour this likely to rain is rain
            "rain_mm": 0.3,                 # mm: with no chance given, this much is rain
            "sun_uv": 3,                    # UV index: "do I need sunscreen?"
            "dates": [],                    # "Lukas's birthday: 03-14", "Our anniversary: 2019-06-01"
            "imperial": "us",               # cups, pints, gallons: "us" or "uk"
            "calendars": [],                # "what's on": these calendars; [] every one
            "calendar_dates": True,         # named dates ("Christmas") taken from the calendars
            "calendar_minutes": 60,         # events kept this long (and until a calendar changes)
            "event_max": 6,                 # events said in one reply
            "media_players": [],            # "what's playing": these; [] every player but...
            "media_skip": ["plex"],         # ...these integrations' (Plex lists friends' streams)
            "todo_list": "",                # "the list", "what do we need": "" todo.shopping_list
            "list_max": 10,                 # list items said in one reply
            "jokes": [],                    # his own jokes, "setup | punchline"
            "builtin_jokes": True,          # the language's jokes too
            "joke_expression": "happy",     # his face while telling one ("" none)
            "joke_animation": "laugh",      # and an animation after it ("" none)
            "random_max": 10,               # "pick a number": 1 to this
            "repeat_minutes": 10,           # "say that again" remembers this long
            "wiki_url": "",                 # kiwix-serve, like http://192.168.1.10:8080; "" off
            "wiki_book": "",                # its book by name; "" the first Wikipedia
            "wiki_sentences": 2,            # of the article's lead, said
            "wiki_brackets": False,         # say bracketed asides (dates, pronunciation)
            "wiki_credit": False,           # "Wikipedia says: …"
            "wiki_seconds": 4,              # kiwix-serve's time to answer
            "local_intents": True, "local_states": True, "local_media_search": False,
            "fallback": "",                 # "" the language's
            "log_size": 50,
            "local_icon": "mdi:lightning-bolt", "delegate_icon": "mdi:brain",
            "icon_seconds": 3}


_LANGS: dict[str, dict[str, Any] | None] = {}


def language_ready(language: str) -> bool:
    """Whether `load_language` has read this language already."""
    return _code(language) in _LANGS


def load_language(language: str) -> dict[str, Any] | None:
    """The brain's words for a language ("en-GB" -> en), or None. Reads a file
    the first time: in HA, call it from an executor."""
    code = _code(language)
    if code not in _LANGS:
        try:
            with open(os.path.join(LANG_DIR, code, "brain.json"), encoding="utf-8") as f:
                data = json.load(f)
            data["code"] = code
            _LANGS[code] = data
        except (OSError, ValueError):
            _LANGS[code] = None
    return _LANGS[code]


def own_intents(words: Mapping[str, Any] | None, settings: Mapping[str, Any],
                language: str) -> dict[str, Any] | None:
    """Alfie's own commands as Home Assistant sentence data (hassil's
    Intents.from_dict), or None when there are none to match."""
    always = settings.get("own_always") or ()
    if not settings["own_sentences"] and not always:
        return None
    words = words or {}
    lang_cmds = words.get("commands") or {}
    intents = {}
    for cmd in COMMANDS:
        if cmd in settings["off_commands"] or (not settings["own_sentences"]
                                               and cmd not in always):
            continue
        sentences = [*lang_cmds.get(cmd, []), *settings["extra_sentences"].get(cmd, [])]
        if sentences:
            intents[INTENTS[cmd]] = {"data": [{"sentences": sentences}]}
    if not intents:
        return None
    lists: dict[str, Any] = {w: {"wildcard": True} for w in WILDCARDS}
    for name, values in (words.get("lists") or {}).items():
        if isinstance(values, dict):
            lists[name] = {"values": [{"in": k, "out": v} for k, v in values.items()
                                      if not k.startswith("_")]}
    things = [{"in": w, "out": key} for key, t in (words.get("things") or {}).items()
              if isinstance(t, dict) for w in t.get("words", [])]
    if things:
        lists["thing"] = {"values": things}
    return {"language": _code(language), "intents": intents, "lists": lists,
            "expansion_rules": dict(words.get("rules") or {})}


def is_late(cmd: str, text: str, words: Mapping[str, Any] | None) -> bool:
    """Whether a command waits for Home Assistant's intents. Wikipedia does,
    except for questions starting with the language's `wiki.early` words
    ("who is Taylor Swift": HA's state intent would answer "Not any")."""
    if cmd not in LATE:
        return False
    if cmd == "wiki":
        early = ((words or {}).get("wiki") or {}).get("early") or []
        return not " ".join(text.lower().split()).startswith(tuple(early))
    return True


def whole_words(slots: Mapping[str, str], text: str) -> bool:
    """Whether every wildcard slot is whole words of the text. hassil can end
    a list word inside a word ("what is the meaning of life" read as the stat
    "mean" and the name "ing of life")."""
    low = " ".join(re.sub(r"[^\w\s']", " ", text.lower()).split())
    for w in WILDCARDS:
        v = " ".join(re.sub(r"[^\w\s']", " ", str(slots.get(w) or "").lower()).split())
        if v and not re.search(r"(?<![\w'])" + re.escape(v) + r"(?![\w'])", low):
            return False
    return True


def commands_on(settings: Mapping[str, Any]) -> list[str]:
    return [c for c in COMMANDS if c not in settings["off_commands"]]


def command_of(intent_name: str) -> str | None:
    return next((c for c, n in INTENTS.items() if n == intent_name), None)


def empty_answer(intent_name: str, matched: int, unmatched: int, asked: str = "",
                 known: Iterable[str] = ()) -> bool:
    """A state question HA answered about nothing real, better left to the
    agent or delegate: no entity at all, or a state nobody can be in ("who is
    Taylor Swift" reads as "who is at Taylor Swift" -> "Not any"). `asked` is
    the state asked about, `known` the states and zones there are."""
    if intent_name not in STATE_INTENTS or matched:
        return False
    if not unmatched:
        return True
    norm = lambda x: " ".join(str(x).lower().replace("_", " ").split())  # noqa: E731
    return bool(asked) and norm(asked) not in {norm(k) for k in known}


def leave_to_delegate(intent_name: str, settings: Mapping[str, Any]) -> bool:
    """Whether an HA intent that matched is left to the delegate instead."""
    if intent_name in STATE_INTENTS:
        return not settings["local_states"]
    if intent_name == MEDIA_SEARCH:
        return not settings["local_media_search"]
    return False


def how_are_you(words: Mapping[str, Any] | None, level: str, reason: str = "") -> str:
    """How he feels, said: the level's line, and the reason behind it when
    there is one."""
    lines = (words or {}).get("how_are_you") or {}
    feeling = lines.get(level) or lines.get("content") or "I'm fine."
    if reason and level != "content" and lines.get("because"):
        return lines["because"].format(feeling=feeling, reason=reason.rstrip("."))
    return feeling


def fallback(words: Mapping[str, Any] | None, settings: Mapping[str, Any]) -> str:
    return settings["fallback"] or (words or {}).get("fallback") or "Sorry, I don't know that one."


# ---------------------------------------------------------------- the turn log

@dataclass
class Turn:
    """One question, where its answer came from, and why."""

    said: str
    reply: str = ""
    source: str = "none"       # SOURCES
    detail: str = ""           # the command, intent or agent that answered
    why: str = ""
    ms: int = 0
    satellite: str = ""
    at: float = 0.0            # epoch seconds
    profile: str = ""          # the agent profile it went to ("" the house's)
    person: str = ""           # "names" routing: who it was told spoke ("" nobody)
    speaker: str = ""          # who alfie-ears heard ("" not asked)

    @property
    def tier(self) -> int:
        return SOURCES.get(self.source, 0)

    def as_dict(self) -> dict[str, Any]:
        return {**asdict(self), "tier": self.tier}


def why(source: str, detail: str = "", delegate: str = "",
        passed: Iterable[str] = (), error: str = "") -> str:
    """Why a turn went where it did, in a sentence for the turn log. `passed`
    are HA intents that matched but were left to the delegate."""
    left = list(passed)
    note = (f" Home Assistant matched {', '.join(left)}, left to the delegate by the "
            "settings." if left else "")
    if source == "trigger":
        return "An automation's sentence trigger matched."
    if source == "own":
        return f"Alfie's own sentence for {LABELS.get(detail, detail)} matched."
    if source == "intent":
        return f"Home Assistant's {detail} intent matched."
    if source == "delegate":
        return f"Nothing local matched, so {delegate or detail} answered." + note
    if source == "agent":
        return f"Nothing local matched, so the agent at {delegate or detail} answered." + note
    if source == "dropped":
        return f"alfie-ears heard it as not meant for Alfie ({detail}), so it was dropped."
    if source == "error":
        return f"Nothing local matched and {delegate or detail} failed: {error}".rstrip(": ") + "."
    return "Nothing local matched and no delegate is set." + note


def _cut(text: str) -> str:
    text = text.strip()
    return text if len(text) <= MAX_SAID else text[:MAX_SAID - 1].rstrip() + "…"


class TurnLog:
    """The last turns, newest last, in memory only."""

    def __init__(self, size: int = 50) -> None:
        self.turns: deque[Turn] = deque(maxlen=max(1, min(int(size), LOG_MAX)))

    def resize(self, size: int) -> None:
        size = max(1, min(int(size), LOG_MAX))
        if size != self.turns.maxlen:
            self.turns = deque(self.turns, maxlen=size)

    def add(self, turn: Turn) -> Turn:
        turn.said, turn.reply = _cut(turn.said), _cut(turn.reply)
        turn.at = turn.at or time.time()
        self.turns.append(turn)
        return turn

    def as_list(self) -> list[dict[str, Any]]:
        """Newest first."""
        return [t.as_dict() for t in reversed(self.turns)]
