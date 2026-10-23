"""Voice screens (design.md "Voice screens"): what a voice turn was about, and
the screen Alfie makes from it.

PURE (no HA import), so the tests run under plain python. voice.py feeds a
`Turn` the chat log's content as HA adds it (conversation's chat log
subscription). HA's own agent logs its intents, results and reply there as
it goes; an LLM agent's subscribers hear only what was said and the tool
results, so its finished turn is read back from the whole log
(`last_turn`). When the reply is in, `subject` says which entities the turn
acted on or asked about and `screen_for` builds a screen of them.
"""

from __future__ import annotations

import re
from collections.abc import Callable, Mapping
from dataclasses import dataclass, field
from typing import Any

from .finder import Index

# Intents that change something; the rest (HassGetState, GetLiveContext,
# HassGetWeather, ...) only look.
ACTION_INTENTS = frozenset({
    "HassTurnOn", "HassTurnOff", "HassToggle", "HassLightSet", "HassSetPosition",
    "HassOpenCover", "HassCloseCover", "HassLockDoor", "HassUnlockDoor",
    "HassFanSetSpeed", "HassClimateSetTemperature", "HassMediaPause", "HassMediaUnpause",
    "HassMediaNext", "HassMediaPrevious", "HassSetVolume", "HassSetVolumeRelative",
    "HassMediaPlayerMute", "HassMediaPlayerUnmute", "HassVacuumStart",
    "HassVacuumReturnToBase", "HassValveOpen", "HassValveClose"})
# Intents that change a volume: their turn shows the volume screen.
VOLUME_INTENTS = frozenset({"HassSetVolume", "HassSetVolumeRelative", "HassMediaPlayerMute",
                            "HassMediaPlayerUnmute"})
# The state a switch was in before the intent, for the knob to slide from.
FROM_STATE = {"HassTurnOn": "off", "HassTurnOff": "on", "HassOpenCover": "closed",
              "HassCloseCover": "open", "HassLockDoor": "unlocked", "HassUnlockDoor": "locked",
              "HassMediaPause": "playing", "HassMediaUnpause": "paused",
              "HassValveOpen": "closed", "HassValveClose": "open"}
# Things that are on or off: the toggle's knob.
ON_OFF = ("light", "switch", "fan", "input_boolean", "binary_sensor", "lock", "cover",
          "media_player", "climate", "valve", "siren", "humidifier", "vacuum", "automation")
FIND_TOOL = "find_entity"
# A request for music: a tool by its name (play_music, a Spotify or Music
# Assistant tool), or the words with something done to a media player.
MUSIC_TOOL = re.compile(r"music|spotify|song|playlist|radio|album")
MUSIC_WORDS = re.compile(r"\b(music|songs?|playlists?|album|tunes|spotify|radio|play\w* .*\bby\b)", re.I)
# A voice plot's title icon, by the sensor's device class.
CLASS_ICONS = {
    "temperature": "mdi:thermometer", "humidity": "mdi:water-percent", "moisture": "mdi:water",
    "power": "mdi:flash", "energy": "mdi:lightning-bolt", "illuminance": "mdi:brightness-5",
    "aqi": "mdi:air-filter", "pm25": "mdi:air-filter", "pm10": "mdi:air-filter",
    "carbon_dioxide": "mdi:molecule-co2", "battery": "mdi:battery", "pressure": "mdi:gauge",
    "atmospheric_pressure": "mdi:gauge", "wind_speed": "mdi:weather-windy",
    "precipitation": "mdi:weather-rainy", "voltage": "mdi:sine-wave", "current": "mdi:current-ac",
    "signal_strength": "mdi:wifi", "distance": "mdi:ruler", "speed": "mdi:speedometer",
    "weight": "mdi:weight", "sound_pressure": "mdi:ear-hearing", "data_rate": "mdi:transmission-tower",
    "monetary": "mdi:cash", "duration": "mdi:timer-outline", "volume": "mdi:cup-water",
}
PLOT_ICON = "mdi:chart-line"
MAX_SPOKEN = 600     # characters of a reply kept, for timing and matching


def _bare(tool: str) -> str:
    """assist__HassTurnOn -> HassTurnOn (LLM agents namespace their tools)."""
    return str(tool or "").rsplit("__", 1)[-1]


def _get(obj: Any, key: str, default: Any = None) -> Any:
    """A field of a ToolInput (an object in process) or of its dict form."""
    if isinstance(obj, Mapping):
        return obj.get(key, default)
    return getattr(obj, key, default)


@dataclass
class Turn:
    """One question and its answer, as the chat log fills in."""

    said: str = ""                     # what the person said
    reply: str = ""                    # Alfie's final answer
    done: bool = False
    shown: bool = False                # its screen has been made (once per turn)
    acted: list[str] = field(default_factory=list)      # entity ids changed
    asked: list[str] = field(default_factory=list)      # entity ids looked at
    names: list[str] = field(default_factory=list)      # names a lookup was given
    tools: list[str] = field(default_factory=list)      # every tool called, bare names
    froms: dict[str, str] = field(default_factory=dict)  # entity id -> state before
    _calls: dict[str, str] = field(default_factory=dict)  # tool call id -> intent

    def feed(self, content: Mapping[str, Any]) -> None:
        role = content.get("role")
        if role == "user":
            self.__init__()            # a new question starts a new turn
            self.said = str(content.get("content") or "")[:MAX_SPOKEN]
        elif role == "assistant":
            calls = content.get("tool_calls") or []
            for c in calls:
                tool = _bare(_get(c, "tool_name", ""))
                self._calls[str(_get(c, "id", ""))] = tool
                self._add(self.tools, tool)
                args = _get(c, "tool_args", {}) or {}
                for k in ("name", "query"):
                    v = args.get(k) if isinstance(args, Mapping) else None
                    for n in (v if isinstance(v, list) else [v]):
                        if isinstance(n, str) and n.strip() and n not in self.names:
                            self.names.append(n.strip())
            if content.get("content") and not calls:
                self.reply = str(content["content"])[:MAX_SPOKEN]
                self.done = True
        elif role == "tool_result":
            tool = _bare(content.get("tool_name") or self._calls.get(
                str(content.get("tool_call_id")), ""))
            res = content.get("result")
            data = res.get("data") if isinstance(res, Mapping) else content.get("tool_result")
            self._add(self.tools, tool)
            self._result(tool, data)

    def _result(self, tool: str, data: Any) -> None:
        if not isinstance(data, Mapping):
            return
        if tool == FIND_TOOL:
            rows = data.get("results") or []
            if rows and isinstance(rows[0], Mapping) and rows[0].get("entity_id"):
                self._add(self.asked, rows[0]["entity_id"])
            return
        targets = (data.get("data") or {}).get("success") if isinstance(data.get("data"), Mapping) else None
        ids = [t.get("id") for t in targets or [] if isinstance(t, Mapping) and t.get("type") == "entity"]
        if not ids:
            return
        acting = tool in ACTION_INTENTS or data.get("response_type") == "action_done"
        for eid in ids:
            if not isinstance(eid, str) or "." not in eid:
                continue
            self._add(self.acted if acting else self.asked, eid)
            if acting and tool in FROM_STATE:
                self.froms.setdefault(eid, FROM_STATE[tool])

    @staticmethod
    def _add(lst: list[str], eid: str) -> None:
        if eid not in lst:
            lst.append(eid)


def last_turn(contents: list[Mapping[str, Any]]) -> Turn:
    """The turn from the last thing the person said to the end of a whole
    chat log (its contents' dicts): how an LLM agent's turn is read, as HA
    tells subscribers only of what the person said and of tool results."""
    start = max((i for i, c in enumerate(contents) if c.get("role") == "user"), default=0)
    t = Turn()
    for c in contents[start:]:
        t.feed(c)
    return t


def is_music(turn: Turn) -> bool:
    """Whether the person asked for music."""
    if any(MUSIC_TOOL.search(t.lower()) for t in turn.tools if t):
        return True
    media = any(e.startswith("media_player.") for e in turn.acted)
    return bool(MUSIC_WORDS.search(turn.said)) and (media or bool(turn.tools))


def is_volume(turn: Turn) -> bool:
    """Whether the turn changed a volume (and played no music)."""
    return any(t in VOLUME_INTENTS for t in turn.tools)


def plot_icon(attrs: Mapping[str, Any]) -> str:
    """An icon for a sensor's kind: its device class's, else its own, else a chart."""
    return CLASS_ICONS.get(str(attrs.get("device_class") or "")) or str(
        attrs.get("icon") or "") or PLOT_ICON


def plot_title(style: str, attrs: Mapping[str, Any], name: str) -> str:
    """A voice plot's title: icon (default), icon_name, name or none."""
    icon = plot_icon(attrs)
    return {"icon": icon, "icon_name": f"{icon} {name}", "name": name}.get(style, "")


def subject(turn: Turn, index: Index | None) -> tuple[str, list[str]]:
    """("action" | "answer", entity ids), or ("", []) when the turn was about
    nothing in the house. What it did beats what it looked at, which beats
    the names a lookup was given, which beats names in the words."""
    if turn.acted:
        return "action", list(turn.acted)
    if turn.asked:
        return "answer", list(turn.asked)
    if index is None:
        return "", []
    ids: list[str] = []
    for n in turn.names:
        e = index.best(n)
        if e and e.entity_id not in ids:
            ids.append(e.entity_id)
    if not ids:
        ids = index.mentioned(turn.said) or index.mentioned(turn.reply)
    return ("answer", ids) if ids else ("", [])


# ------------------------------------------------------------------ screens

State = Callable[[str], "tuple[str, Mapping[str, Any]] | None"]   # id -> (state, attributes)


def _number(state: str) -> float | None:
    try:
        return float(state)
    except (TypeError, ValueError):
        return None


def _kind(eid: str, st: tuple[str, Mapping[str, Any]] | None) -> str:
    domain = eid.split(".", 1)[0]
    if domain == "weather":
        return "weather"
    if st is None:
        return "toggle"
    state, attrs = st
    if domain in ("sensor", "number", "input_number") and (
            _number(state) is not None or attrs.get("state_class") or attrs.get("unit_of_measurement")):
        return "number"
    return "toggle"


def screen_for(kind: str, ids: list[str], state_of: State,
               settings: Mapping[str, Any], froms: Mapping[str, str] | None = None
               ) -> dict[str, Any] | None:
    """The screen for a turn: {"type", "title", "options"}, or None.

    `settings` is the voice config (answer_screens, action_screens,
    plot_hours, max_grid, screen_skip)."""
    if not kind or not ids:
        return None
    if not settings.get("action_screens" if kind == "action" else "answer_screens", True):
        return None
    skip = set(settings.get("screen_skip") or ())
    ids = [e for e in ids if e not in skip and e.split(".", 1)[0] not in skip
           and state_of(e) is not None]
    if not ids:
        return None
    max_grid = int(settings.get("max_grid") or 6)
    title = lambda e: str((state_of(e) or ("", {}))[1].get("friendly_name") or e)  # noqa: E731
    kinds = {e: _kind(e, state_of(e)) for e in ids}

    if kind == "answer":
        nums = [e for e in ids if kinds[e] == "number"]
        if kinds[ids[0]] == "weather":
            return {"type": "weather", "title": title(ids[0]), "options": {"weather": ids[0]}}
        if nums and len(nums) == len(ids):
            units = {str((state_of(e) or ("", {}))[1].get("unit_of_measurement") or "") for e in nums}
            if len(units) == 1 and len(nums) <= 6:
                first = (state_of(nums[0]) or ("", {}))[1]
                return {"type": "plot", "title": title(nums[0]) if len(nums) == 1 else "",
                        "options": {"entities": nums, "hours": settings.get("plot_hours") or 24,
                                    "title": plot_title(settings.get("plot_title", "icon"), first,
                                                        title(nums[0]) if len(nums) == 1 else ""),
                                    "text_size": settings.get("plot_text_size") or 2}}
            return {"type": "bars", "title": "", "options": {
                "entities": nums[:max_grid], "range": "auto"}}
    froms = froms or {}
    shown = ids[:max_grid]
    return {"type": "toggle", "title": title(shown[0]) if len(shown) == 1 else "",
            "options": {"entities": shown,
                        "from": [froms.get(e, "") for e in shown] if kind == "action" else [],
                        "more": max(0, len(ids) - len(shown)),
                        "action": kind == "action"}}


SONG_AND_ARTIST = {"bar": "none", "times": "none", "state_icon": False, "text_size": 1.5}


def music_screen(ids: list[str], state_of: State,
                 settings: Mapping[str, Any]) -> dict[str, Any]:
    """The now playing screen for a music request: the players it named (any
    Music Assistant player when it named none). Until one plays it shows the
    music badge rather than "Nothing playing", as the music is on its way.
    By default just the song and the artist (Lukas, 2026-10-22): no album, bar
    or times. Which of the song, artist and album show are settings."""
    players = [e for e in ids if e.startswith("media_player.") and state_of(e) is not None]
    return {"type": "nowplaying", "title": "",
            "options": {"players": players, "empty": settings.get("music_icon") or "mdi:music-note",
                        "show_title": settings.get("music_show_title", True),
                        "show_artist": settings.get("music_show_artist", True),
                        "show_album": settings.get("music_show_album", False),
                        **SONG_AND_ARTIST}}


# Which player a volume screen shows when a turn changed several: one playing,
# then one that is on, then any with a volume.
_LIVE = {"playing": 3, "paused": 2, "on": 2, "idle": 1, "buffering": 3}


def volume_screen(ids: list[str], state_of: State) -> dict[str, Any] | None:
    """The volume screen for a turn that changed a volume: a speaker icon and a
    slider for one player (Lukas, 2026-10-22: "just a volume icon with a
    slider"), not a grid of every player it set."""
    best, rank = None, -1
    for e in ids:
        st = state_of(e) if e.startswith("media_player.") else None
        if st is None:
            continue
        r = _LIVE.get(st[0], 0) * 2 + (st[1].get("volume_level") is not None)
        if r > rank:
            best, rank = e, r
    if best is None:
        return None
    return {"type": "volume", "title": "", "options": {"entity": best}}


def speech_seconds(text: str) -> float:
    """About how long a reply takes to say (design.md: ~14 characters a second)."""
    return len(text or "") / 14.0
