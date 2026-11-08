"""Alfie's whole user configuration as one plain dict, kept in HA's Store.

PURE (no HA import), so the tests run under plain python. Its sections:

  signals      the good and bad signals (see signals.py)
  mood         how they combine into a level, and each level's look
  behaviour    the sleeping expression, motion sensors, fidgets, appearance stories
  personality  a preset plus the motion sliders it fills in
  look         Alfie's global default look: style, colours, widths, shapes
  screens      the user's screens: a type plus its options (screen_types.py)
  rotations    ordered lists of screens with seconds each
  stories      what Alfie does when a trigger fires (stories.py)
  triggers     when he does it (triggers.py)
  modes        house modes (modes.py)
  voice        following satellites, the Alfie LLM API, voice screens
  speech       how Alfie's voice says numbers, times and dates (speech.py)
  overview     the panel's Get started state

`default_config()` is the generic starter (defaults.py); Lukas's own house is
devenv/house.json. `validate()` turns any
stored or panel-sent dict into a complete, checked one, filling what is
missing from the defaults. `build()` turns a valid one into what the engine
runs on. Names of expressions, animations and personality presets come from
the face file (frontend/alfie-face.json), passed in as `face`; screen types
come from frontend/screens/*.json, passed in as `types`.
"""

from __future__ import annotations

import copy
import re
from collections.abc import Mapping
from dataclasses import dataclass
from typing import Any

from . import agent, brain, defaults, speech
from .mood import (
    COMBINE_MODES,
    DEFAULT_COUNT_THRESHOLDS,
    DEFAULT_ENERGY,
    DEFAULT_EXPRESSIONS,
    DEFAULT_LADDER,
    DEFAULT_THRESHOLDS,
    DEFAULT_WEIGHTS,
    LEVELS,
    MoodSettings,
)
from .signals import OPERATORS, SEVERITIES, Signal
from .stories import validate_stories
from .modes import mode_ids, validate_modes
from .triggers import validate_triggers

# 2: the behaviour reactions (on_critical, on_recover, on_wake, celebrate)
# became triggers and stories; migrate_v1 carries them over.
# 3: house modes; behaviour.sleep_entity became the Night mode (migrate_v2).
# 4: keys follow design.md "Words" (migrate_v3), and the overview section.
# 6: label and text screens' size became text_size, a multiplier (migrate_v5).
# 7: weather_past joins a saved brain.own_always that holds the forecast (migrate).
# 8: dismiss joins a saved brain.own_always that isn't empty (migrate).
CONFIG_VERSION = 8
SECTIONS = ("signals", "mood", "behaviour", "personality", "look", "expressions", "animations",
            "screens", "rotations", "stories", "triggers", "modes", "voice", "speech", "brain",
            "overview")
# An expression's numbers: lids [height, slant] in eye radii, size, and look.
LID_RANGE = (-1.5, 1.5)
SIZE_RANGE = (0.3, 2.0)
LOOK_RANGE = (-0.4, 0.4)
# Animation channels (alfie-face.js `animated`), each with its range: moves in
# ring radii, size as a share, and lid channels from 0 (as the expression) to 1.
CHANNELS = {**{k: (-0.5, 0.5) for k in ("dx", "dy", "lx", "ly", "rx", "ry", "fx", "fy")},
            "size": (-0.5, 1.0), **{k: (0.0, 1.0) for k in ("open", "shut", "shut_l", "shut_r", "droop")}}
EASES = ("ease", "spring", "cut", "linear")
KEY_SECONDS = (0.02, 10.0)
MAX_KEYS = 60
GUIDE_STEPS = ("signals", "motion", "sleep", "dashboard", "screens")   # Get started
STYLES = ("neon", "flat", "crt", "theme", "blueprint", "chalk", "ink", "pastel")   # the card's render styles
SPEAK_STYLES = ("pulse", "eyes", "both", "wave")   # how he shows speaking (no mouth)
SHAPE_TYPES = ("circle", "polygon", "star", "superellipse", "path")
SHAPE_SLOTS = ("head", "eye", "left_eye", "right_eye")
STEP_SECONDS = (3.0, 3600.0)     # how long a rotation step may show its screen
DEFAULT_TRANSITION = "fade"

# Personality sliders: (default, min, max). The default is "bubbly", which
# is exactly the M1 feel, so a fresh install moves as it always did.
PERSONALITY = {
    "exaggeration": (1.0, 0.3, 2.0),    # expression and animation size
    "speed": (1.0, 0.3, 2.5),           # animation and blend rate
    "bounce": (1.0, 0.0, 2.0),          # spring overshoot
    "fidget_rate": (1.0, 0.0, 4.0),     # idle fidgets per interval; 0 never
    "energy_bias": (0.0, -0.5, 0.5),    # added to the mood's energy
    "blink_rate": (1.0, 0.2, 3.0),
}
# Motion (Appearance → Motion): the numbers in the motions drawn by code, as
# (default, min, max). Each default is the motion as it always was; the card
# reads them through alfie-face.js motionOf, which holds the same defaults.
MOTION = {
    "speak_rate": (1.0, 0.3, 3.0),          # syllables, faster or slower
    "speak_pauses": (0.45, 0.0, 1.0),       # how deep the pauses between phrases dip
    "speak_contrast": (1.0, 0.3, 3.0),      # > 1 punchy syllables, < 1 a steady hum
    "pulse_depth": (0.045, 0.0, 0.3),       # pulse: how far the ring swells, in radii
    "eye_grow": (0.16, 0.0, 0.6),           # eyes: how much they grow on a syllable
    "eye_lift": (0.04, 0.0, 0.2),           # eyes: how far they lift
    "both_share": (0.7, 0.2, 1.0),          # both: each half's share
    "wave_depth": (0.028, 0.0, 0.25),       # wave: the ripple's reach, in radii
    "wave_bumps": (7.0, 2.0, 24.0),         # wave: bumps around the ring
    "wave_speed": (1.6, -5.0, 5.0),         # wave: turns a second; negative runs backwards
    "wave_detail": (0.0, 0.0, 1.0),         # wave: a finer ripple on top, like an audio trace
    "breath_depth": (1.0, 0.0, 4.0),        # breathing, times the usual
    "breath_seconds": (3.6, 1.0, 12.0),     # one breath at full energy
    "blink_seconds": (0.16, 0.05, 0.6),     # one blink (the rate is Personality's)
    "blink_min_gap": (1.6, 0.5, 8.0),       # never blinks more often than this
    "sag_below": (0.5, 0.0, 1.0),           # tiredness starts under this energy
    "sag_droop": (0.35, 0.0, 1.0),          # tired: how far the lids drop
    "sag_drop": (0.035, 0.0, 0.2),          # tired: how far the eyes sink
    "transition_speed": (1.0, 0.25, 4.0),   # every screen transition, faster or slower
    "outro_share": (0.6, 0.2, 1.5),         # a badge leaves in this share of its entrance
    "overshoot": (1.0, 0.0, 3.0),           # zoom, slide and flip springing past
    "corner_seconds": (0.8, 0.1, 3.0),      # his move to or from the corner
}
TRANSITION_SECONDS = (0.0, 5.0)   # look.motion.transition_seconds: {style: seconds}

CUSTOM = "custom"
NOTICE = "notice"     # motion sensor action: one of behaviour.notice at random

_LEVEL_ORDER = ("bubbly", "content", "uneasy", "sad")   # threshold keys, best first
_ID = re.compile(r"^[a-z0-9_]+$")


class ConfigError(ValueError):
    """A config that can't be used, with every problem found."""

    def __init__(self, errors: list[str]) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors


@dataclass(frozen=True)
class Built:
    signals: tuple[Signal, ...]
    mood: MoodSettings
    behaviour: dict[str, Any]
    personality: dict[str, float]


# ------------------------------------------------------------------ defaults

def signal_dict(s: Signal) -> dict[str, Any]:
    return {"id": s.id, "name": s.name, "entities": list(s.entities), "op": s.op,
            "value": s.value, "kind": s.kind, "severity": s.severity, "weight": s.weight,
            "match": s.match, "screen": s.screen, "enabled": s.enabled,
            "repeat": default_repeat()}


def default_repeat() -> dict[str, Any]:
    """A signal's repeat options, all off: replay its bad news on walk-in,
    every N hours (both play `story`), or add its screen to the rotation
    while it is bad."""
    return {"on_motion": False, "every_hours": 0, "in_rotation": False, "story": "bad_news"}


def personality_values(name: str, face: Mapping[str, Any] | None = None) -> dict[str, float]:
    presets = (face or {}).get("personalities") or {}
    base = {k: d for k, (d, _, _) in PERSONALITY.items()}
    return {**base, **{k: float(v) for k, v in presets.get(name, {}).items() if k in base}}


def default_look() -> dict[str, Any]:
    """The card's own defaults, so an untouched look changes nothing."""
    return {"style": "neon", "ring_color": "", "eye_color": "", "background": "",
            "text_color": "", "accent_color": "", "line_color": "", "line_width": 0.035,
            "screen_line_width": 0.02, "glow": None, "eye_fill": False, "padding": 0.08,
            "aspect": 1.0,
            "shapes": {"head": {"type": "circle"}, "eye": {"type": "circle"}},
            "motion": default_motion()}


def default_motion() -> dict[str, Any]:
    return {**{k: _num(d) for k, (d, _, _) in MOTION.items()}, "transition_seconds": {}}


# What voice screens leave out unless told otherwise: things with no state
# worth a screen (a script running, a scene set) and Alfie's own plumbing.
SCREEN_SKIP = ("script", "scene", "automation", "todo", "schedule", "button", "conversation",
               "tts", "stt", "update", "event")
SPEECH_ENTITY = "tts.alfie_voice"   # Alfie's own voice can't hand words to itself
VOICE_PRESENTS = ("corner", "handover", "card")
PLOT_TITLES = ("icon", "icon_name", "name", "none")   # a voice plot's title


def default_voice() -> dict[str, Any]:
    """Voice (design.md "Voice"): which satellites he follows ([] every one),
    his look in each phase, the Alfie LLM API's persona and mood prompt, and
    where a speak step talks when it names no speakers."""
    return {"enabled": True, "satellites": [], "while_asleep": True,
            "listening_expression": "surprised", "listening_animation": "",
            "processing_animation": "processing",
            "speak_style": "pulse", "speak_strength": 1,
            "after": "nod",
            "persona": False, "persona_prompt": defaults.PERSONA_PROMPT,
            "mood_aware": True,
            "assist_tool": False, "intent": False,
            "sentences": list(defaults.WHATS_WRONG_SENTENCES),
            "speak_targets": [], "tts_entity": "", "language": "",
            # Voice screens (design.md "Voice screens"): the find tool, and a
            # screen made from what a voice turn did or was asked about.
            "find_entity": True, "screens": True, "action_screens": True,
            "answer_screens": True, "screen_present": "corner", "screen_seconds": 5,
            "hold_while_speaking": False, "linger_seconds": 6,
            "plot_hours": 24, "plot_title": "icon", "plot_text_size": 2, "max_grid": 6,
            "screen_skip": list(SCREEN_SKIP), "volume_screen": True, "screen_text": "minimal",
            # A request for music: an animation and a badge, and the now playing screen.
            "music_animation": "groove", "music_expression": "happy",
            "music_icon": "mdi:music-note", "music_screen": True, "music_seconds": 15,
            "music_show_title": True, "music_show_artist": True, "music_show_album": False,
            "music_show_paused": False}


def default_speech() -> dict[str, Any]:
    """Alfie's voice (design.md "Brain", Speech): the TTS engine tts.alfie_voice
    hands the rewritten text to ("" the first other one), and the rules."""
    return {"engine": "", **speech.default_settings()}


def default_brain() -> dict[str, Any]:
    """Alfie's brain (design.md "Brain"): conversation.alfie's delegate and
    what it answers locally (brain.py)."""
    return brain.default_settings()


def default_config() -> dict[str, Any]:
    return {
        "version": CONFIG_VERSION,
        "signals": [signal_dict(s) for s in defaults.SIGNALS],
        "mood": {
            "combine": "worst",
            "weights": dict(DEFAULT_WEIGHTS),
            "thresholds": dict(DEFAULT_THRESHOLDS),
            "count_thresholds": dict(DEFAULT_COUNT_THRESHOLDS),
            "ladder": dict(DEFAULT_LADDER),
            "expressions": dict(DEFAULT_EXPRESSIONS),
            "energy": dict(DEFAULT_ENERGY),
        },
        "behaviour": {
            "sleep_expression": defaults.SLEEP_EXPRESSION,
            "motion_sensors": [{"entity": e, "action": a} for e, a in defaults.MOTION_SENSORS],
            "notice": list(defaults.NOTICE),
            "idle_fidgets": list(defaults.IDLE_FIDGETS),
            "idle_interval": defaults.IDLE_INTERVAL,
            "motion_debounce": defaults.MOTION_DEBOUNCE,
            "appear_story_bad": defaults.APPEAR_STORY_BAD,
            "appear_story_ok": defaults.APPEAR_STORY_OK,
        },
        "personality": {"preset": "bubbly", **personality_values("bubbly")},
        "look": default_look(),
        "expressions": [],    # his own faces, and the built-ins changed (design.md "The character")
        "animations": [],     # his own keyframe animations, and the built-ins changed
        "screens": [],        # Alfie ships none: the user builds them
        "rotations": [],
        "stories": copy.deepcopy(list(defaults.STORIES)),
        "triggers": copy.deepcopy(list(defaults.TRIGGERS)),
        "modes": copy.deepcopy(list(defaults.MODES)),
        "voice": default_voice(),
        "speech": default_speech(),
        "brain": default_brain(),
        "overview": {"dismissed": False, "done": []},
    }


def migrate_options(cfg: dict[str, Any], options: Mapping[str, Any]) -> dict[str, Any]:
    """Carry milestone 1's options-flow values into a fresh config, once."""
    cfg = copy.deepcopy(cfg)
    if options.get("combine") in COMBINE_MODES:
        cfg["mood"]["combine"] = options["combine"]
    for key in ("idle_interval", "motion_debounce"):
        if isinstance(options.get(key), (int, float)):
            cfg["behaviour"][key] = float(options[key])
    if "celebrate_fix" in options:
        _enable(cfg, "fixed", bool(options["celebrate_fix"]))
    return cfg


def _enable(cfg: dict[str, Any], trigger_id: str, on: bool) -> None:
    for t in cfg["triggers"]:
        if t["id"] == trigger_id:
            t["enabled"] = on


def _swap_animation(cfg: dict[str, Any], story_id: str, old: str, new: str) -> None:
    for st in cfg["stories"]:
        if st["id"] == story_id:
            if st["simple"].get("animation") == old:
                st["simple"]["animation"] = new
            for step in st["steps"]:
                if step.get("kind") == "animation" and step.get("name") == old:
                    step["name"] = new
                    return


def migrate_v1(raw: Mapping[str, Any]) -> dict[str, Any]:
    """A version 1 config as version 2: its behaviour reactions become the
    default triggers and stories (an empty reaction disables its trigger, a
    different animation goes into its story). Anything already v2 passes."""
    # No version at all is a partial config written for this one, not a v1 store
    # (every store carries the version it was saved at).
    raw = copy.deepcopy(dict(raw))
    if raw.get("version", CONFIG_VERSION) >= 2 or "triggers" in raw:
        return raw
    base = default_config()
    raw["version"] = 2
    raw["stories"], raw["triggers"] = base["stories"], base["triggers"]
    b = raw.get("behaviour") if isinstance(raw.get("behaviour"), Mapping) else {}
    b = dict(b)
    for key, trig, story, default in (("on_critical", "critical", "alarm", defaults.ON_CRITICAL),
                                      ("on_recover", "fixed", "celebrate", defaults.ON_RECOVER),
                                      ("on_wake", "wake", "wake_up", defaults.ON_WAKE)):
        if key not in b:
            continue
        name = b.pop(key)
        if not name:
            _enable(raw, trig, False)
        elif name != default:
            _swap_animation(raw, story, default, str(name))
    if "celebrate" in b and not b.pop("celebrate"):
        _enable(raw, "fixed", False)
    raw["behaviour"] = b
    return raw


def migrate_v2(raw: dict[str, Any]) -> dict[str, Any]:
    """A version 2 config as version 3: the sleep entity becomes the Night
    mode (none: Night is only picked by hand), Away joins it, and the
    Welcome home story and trigger are added. Anything already v3 passes."""
    if raw.get("version", CONFIG_VERSION) >= 3 or "modes" in raw:
        return raw
    raw["version"] = 3
    b = raw.get("behaviour")
    b = dict(b) if isinstance(b, Mapping) else {}
    entity = str(b.pop("sleep_entity", defaults.V2_SLEEP_ENTITY) or "").strip()
    raw["behaviour"] = b
    away = copy.deepcopy(next(m for m in defaults.MODES if m["id"] == "away"))
    triggers = raw.get("triggers")
    if isinstance(triggers, list):
        ids = {t.get("id") for t in triggers if isinstance(t, Mapping)}
        away["triggers_off"] = [t for t in away["triggers_off"] if t in ids]
    raw["modes"] = [defaults.night_mode(entity), away]
    stories = raw.get("stories")
    if isinstance(stories, list) and not any(
            isinstance(st, Mapping) and st.get("id") == "welcome_home" for st in stories):
        raw["stories"] = [*stories, copy.deepcopy(
            next(st for st in defaults.STORIES if st["id"] == "welcome_home"))]
    if isinstance(triggers, list) and "welcome" not in ids:
        raw["triggers"] = [*triggers, copy.deepcopy(
            next(t for t in defaults.TRIGGERS if t["id"] == "welcome"))]
    return raw


_ALFIE_STATES = {"normal": "awake", "idle": "quiet", "blank": "hidden"}   # old presence values


def _rename(d: Any, old: str, new: str) -> None:
    if isinstance(d, dict) and old in d:
        val = d.pop(old)
        d.setdefault(new, val)


def migrate_v3(raw: dict[str, Any]) -> dict[str, Any]:
    """A version 3 config in version 4's words: signal label → name, story
    mode/template → form/simple, house mode presence → alfie (with new value
    names), behaviour gaze_map → motion_sensors, look face_color → ring_color.
    Item by item and idempotent, since older migrations add new-style items."""
    for s in raw.get("signals") or []:
        _rename(s, "label", "name")
    for st in raw.get("stories") or []:
        if isinstance(st, dict) and "mode" in st:
            mode = st.pop("mode")
            st.setdefault("form", "simple" if mode == "template" else mode)
        _rename(st, "template", "simple")
    for m in raw.get("modes") or []:
        if isinstance(m, dict) and "presence" in m:
            p = m.pop("presence")
            m.setdefault("alfie", _ALFIE_STATES.get(p, p))
    _rename(raw.get("behaviour"), "gaze_map", "motion_sensors")
    _rename(raw.get("look"), "face_color", "ring_color")
    raw["version"] = CONFIG_VERSION
    return raw


# Hello as it shipped before it explained his mood.
_HELLO_V4 = [{"kind": "expression", "name": "@mood", "hold": 1.5, "blend": 0},
             {"kind": "animation", "name": "nod", "wait": True}]


def migrate_v4(raw: dict[str, Any]) -> dict[str, Any]:
    """Hello, still as it shipped, gains its @why screen, so Alfie shows what
    sets his mood when he appears in a rotation. An edited Hello is left be."""
    for st in raw.get("stories") or []:
        if isinstance(st, dict) and st.get("id") == defaults.APPEAR_STORY_OK \
                and st.get("steps") == _HELLO_V4:
            hello = next(d for d in defaults.STORIES if d["id"] == defaults.APPEAR_STORY_OK)
            st["steps"] = copy.deepcopy(hello["steps"])
    raw["version"] = CONFIG_VERSION
    return raw


def migrate_v5(raw: dict[str, Any]) -> dict[str, Any]:
    """Label and text screens' `size` (a cap height, 0.3 by default) becomes
    `text_size`, the 1x multiplier every other screen type has."""
    for sc in raw.get("screens") or []:
        o = sc.get("options") if isinstance(sc, dict) and sc.get("type") in ("label", "text") else None
        if isinstance(o, dict) and "size" in o:
            size = o.pop("size")
            if isinstance(size, (int, float)) and not isinstance(size, bool):
                o.setdefault("text_size", round(size / 0.3, 2))
    raw["version"] = CONFIG_VERSION
    return raw


def migrate(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Any stored or imported config, in the current version's keys."""
    was = raw.get("version", CONFIG_VERSION) if isinstance(raw, Mapping) else CONFIG_VERSION
    out = migrate_v5(migrate_v4(migrate_v3(migrate_v2(_add_appear(migrate_v1(raw))))))
    always = (out.get("brain") or {}).get("own_always") if isinstance(out.get("brain"), dict) \
        else None
    if isinstance(was, int) and was < 7 and isinstance(always, list) and "weather_forecast" in always \
            and "weather_past" not in always:
        always.append("weather_past")
    if isinstance(was, int) and was < 8 and isinstance(always, list) and always \
            and "dismiss" not in always:
        always.append("dismiss")
    return out


def _add_appear(raw: dict[str, Any]) -> dict[str, Any]:
    """A config from before the appearance stories gets them, once: the
    default "hello" story is added, and Bad news is the bad one if it still
    exists. After that the saved behaviour says what plays, and a deleted
    hello stays deleted."""
    b = raw.get("behaviour")
    stories = raw.get("stories")
    if (isinstance(b, Mapping) and "appear_story_ok" in b) or not isinstance(stories, list):
        return raw
    ids = {st.get("id") for st in stories if isinstance(st, Mapping)}
    if defaults.APPEAR_STORY_OK not in ids:
        hello = next(st for st in defaults.STORIES if st["id"] == defaults.APPEAR_STORY_OK)
        raw["stories"] = [*stories, copy.deepcopy(hello)]
    raw["behaviour"] = {**(b if isinstance(b, Mapping) else {}),
                        "appear_story_ok": defaults.APPEAR_STORY_OK,
                        "appear_story_bad": defaults.APPEAR_STORY_BAD
                        if defaults.APPEAR_STORY_BAD in ids else ""}
    return raw


# ---------------------------------------------------------------- validating

class _Check:
    """Collects problems instead of stopping at the first, so the panel can
    show them all at once."""

    def __init__(self) -> None:
        self.errors: list[str] = []

    def bad(self, where: str, what: str) -> None:
        self.errors.append(f"{where}: {what}")

    def number(self, where: str, v: Any, lo: float | None = None, hi: float | None = None,
               fallback: float = 0.0) -> float:
        if isinstance(v, bool) or not isinstance(v, (int, float, str)):
            self.bad(where, "must be a number")
            return fallback
        try:
            x = float(v)
        except ValueError:
            self.bad(where, "must be a number")
            return fallback
        if (lo is not None and x < lo) or (hi is not None and x > hi):
            self.bad(where, f"must be between {lo:g} and {hi:g}")
            return fallback
        return x

    def choice(self, where: str, v: Any, options: Any, fallback: Any = None) -> Any:
        if v not in options:
            self.bad(where, f"{v!r} is not one of {', '.join(map(str, options))}")
            return fallback
        return v

    def names(self, where: str, v: Any, options: Any) -> list[str]:
        if not isinstance(v, list):
            self.bad(where, "must be a list")
            return []
        out = []
        for x in v:
            if x not in options:
                self.bad(where, f"unknown {x!r}")
            elif x not in out:
                out.append(x)
        return out


def _section(raw: Mapping[str, Any], key: str, base: dict[str, Any]) -> dict[str, Any]:
    got = raw.get(key)
    return {**base, **got} if isinstance(got, Mapping) else dict(base)


def _value(v: Any) -> Any:
    """A signal value as stored: a number stays a number, anything else text."""
    if isinstance(v, bool):
        return "on" if v else "off"
    if isinstance(v, (int, float)):
        return v
    return "" if v is None else str(v).strip()


def _signals(raw: Any, ck: _Check) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        ck.bad("signals", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, s in enumerate(raw):
        where = f"signal {i + 1}"
        if not isinstance(s, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        sid = str(s.get("id") or "").strip()
        if not _ID.match(sid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"signal {sid}"
        if sid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(sid)
        ents = s.get("entities")
        if isinstance(ents, str):
            ents = [ents]
        ents = [str(e).strip() for e in ents or [] if str(e).strip()] \
            if isinstance(ents, list) else []
        if not ents:
            ck.bad(where, "needs at least one entity or pattern")
        d = {
            "id": sid,
            "name": str(s.get("name") or sid).strip(),
            "entities": ents,
            "op": ck.choice(f"{where} operator", s.get("op", "is"), OPERATORS, "is"),
            "value": _value(s.get("value", "on")),
            "kind": ck.choice(f"{where} kind", s.get("kind", "bad"), ("bad", "good"), "bad"),
            "severity": ck.choice(f"{where} severity", s.get("severity", "major"), SEVERITIES,
                                  "major"),
            "weight": None if s.get("weight") in (None, "") else
            ck.number(f"{where} weight", s.get("weight"), 0, 100, 1.0),
            "match": ck.choice(f"{where} match", s.get("match", "any"), ("any", "all"), "any"),
            "screen": (str(s["screen"]).strip() or None) if s.get("screen") else None,
            "enabled": bool(s.get("enabled", True)),
            "repeat": _repeat(where, s.get("repeat"), ck),
        }
        if d["op"] in ("above", "below"):
            if not isinstance(d["value"], (int, float)):
                try:
                    d["value"] = float(d["value"])
                except ValueError:
                    ck.bad(where, f"'{d['op']}' needs a number")
        out.append(d)
    return out


def _repeat(where: str, raw: Any, ck: _Check) -> dict[str, Any]:
    base = default_repeat()
    r = {**base, **raw} if isinstance(raw, Mapping) else base
    return {"on_motion": bool(r["on_motion"]),
            "every_hours": _num(ck.number(f"{where} repeat hours", r["every_hours"],
                                          0, 168, 0)),
            "in_rotation": bool(r["in_rotation"]),
            "story": str(r["story"] or "").strip()}


def _ordered(where: str, d: Mapping[str, float], ck: _Check) -> None:
    vals = [d[k] for k in _LEVEL_ORDER]
    if any(a < b for a, b in zip(vals, vals[1:])):
        ck.bad(where, "must not rise from bubbly down to sad")


def _mood(raw: Mapping[str, Any], base: dict[str, Any], expressions: Any,
          ck: _Check) -> dict[str, Any]:
    m = _section(raw, "mood", base)
    out: dict[str, Any] = {"combine": ck.choice("mood combine", m["combine"], COMBINE_MODES,
                                                "worst")}
    for key, keys, lo, hi in (("weights", ("minor", "major", "critical", "good"), 0, 100),
                              ("thresholds", _LEVEL_ORDER, -100, 100),
                              ("count_thresholds", _LEVEL_ORDER, -100, 100),
                              ("energy", LEVELS, 0.05, 1.5)):
        src = {**base[key], **(m[key] if isinstance(m.get(key), Mapping) else {})}
        out[key] = {k: ck.number(f"mood {key} {k}", src[k], lo, hi, base[key][k])
                    for k in base[key] if k in keys}
    out["count_thresholds"] = {k: int(round(v)) for k, v in out["count_thresholds"].items()}
    _ordered("mood thresholds", out["thresholds"], ck)
    _ordered("mood count_thresholds", out["count_thresholds"], ck)
    ladder = {**base["ladder"], **(m["ladder"] if isinstance(m.get("ladder"), Mapping) else {})}
    out["ladder"] = {k: ck.choice(f"mood ladder {k}", ladder[k], LEVELS, base["ladder"][k])
                     for k in SEVERITIES}
    ex = {**base["expressions"],
          **(m["expressions"] if isinstance(m.get("expressions"), Mapping) else {})}
    out["expressions"] = {k: ck.choice(f"mood expression for {k}", ex[k], expressions, "neutral")
                          for k in base["expressions"]}
    # In the defaults' key order, so a reset section compares equal as JSON.
    return {k: out[k] for k in base}


def _behaviour(raw: Mapping[str, Any], base: dict[str, Any], expressions: Any,
               animations: Any, ck: _Check) -> dict[str, Any]:
    b = _section(raw, "behaviour", base)
    motion = []
    for i, g in enumerate(b["motion_sensors"] if isinstance(b["motion_sensors"], list) else []):
        ent = str((g or {}).get("entity") or "").strip() if isinstance(g, Mapping) else ""
        if not ent:
            ck.bad(f"motion sensor {i + 1}", "needs an entity")
            continue
        act = ck.choice(f"motion sensor {ent}", g.get("action", NOTICE), (NOTICE, *animations),
                        NOTICE)
        motion.append({"entity": ent, "action": act})
    return {
        "sleep_expression": ck.choice("sleep expression", b["sleep_expression"], expressions,
                                      "closed"),
        "motion_sensors": motion,
        "notice": ck.names("notice animations", b["notice"], animations),
        "idle_fidgets": ck.names("idle fidgets", b["idle_fidgets"], animations),
        "idle_interval": ck.number("idle interval", b["idle_interval"], 10, 3600,
                                   base["idle_interval"]),
        "motion_debounce": ck.number("motion debounce", b["motion_debounce"], 0, 600,
                                     base["motion_debounce"]),
        # Story ids ("" for none), checked against the stories in validate().
        "appear_story_bad": str(b.get("appear_story_bad") or "").strip(),
        "appear_story_ok": str(b.get("appear_story_ok") or "").strip(),
    }


def _entity_list(where: str, v: Any, domains: tuple[str, ...], ck: _Check) -> list[str]:
    if not isinstance(v, list):
        ck.bad(where, "must be a list")
        return []
    out: list[str] = []
    for x in v:
        x = str(x).strip()
        if x.count(".") != 1 or x.split(".")[0] not in domains:
            ck.bad(where, f"{x!r} is not a {' or '.join(domains)} entity")
        elif x not in out:
            out.append(x)
    return out


def _sentences(v: Any, ck: _Check) -> list[str]:
    """The intent's sentences, in HA's template syntax: (a|b) [optional]."""
    if isinstance(v, str):
        v = v.splitlines()
    if not isinstance(v, list):
        ck.bad("voice sentences", "must be a list")
        return list(defaults.WHATS_WRONG_SENTENCES)
    out: list[str] = []
    for x in v:
        x = " ".join(str(x).split()).lower()
        if not x:
            continue
        if x.count("(") != x.count(")") or x.count("[") != x.count("]") \
                or re.search(r"[.,!?;]", x):
            ck.bad("voice sentences", f"{x!r}: unbalanced brackets or punctuation")
        elif x not in out:
            out.append(x)
    return out


def _voice(raw: Mapping[str, Any], base: dict[str, Any], expressions: Any,
           animations: Any, ck: _Check) -> dict[str, Any]:
    v = _section(raw, "voice", base)
    tts = str(v["tts_entity"] or "").strip()
    if tts and not tts.startswith("tts."):
        ck.bad("voice TTS engine", f"{tts!r} is not a tts entity")
        tts = ""
    prompt = str(v["persona_prompt"] or "").strip()
    return {
        "enabled": bool(v["enabled"]),
        "satellites": _entity_list("voice satellites", v["satellites"], ("assist_satellite",), ck),
        "while_asleep": bool(v["while_asleep"]),
        "listening_expression": ck.choice("voice listening expression",
                                          v["listening_expression"] or "",
                                          ("", *expressions), ""),
        "listening_animation": ck.choice("voice listening animation",
                                         v["listening_animation"] or "", ("", *animations), ""),
        "processing_animation": ck.choice("voice thinking animation",
                                          v["processing_animation"] or "", ("", *animations), ""),
        "speak_style": ck.choice("voice speaking style", v["speak_style"], SPEAK_STYLES, "pulse"),
        "speak_strength": _num(ck.number("voice speaking strength", v["speak_strength"],
                                         0.2, 5, 1.0)),
        "after": ck.choice("voice after a reply", v["after"] or "", ("", *animations), ""),
        "persona": bool(v["persona"]),
        "persona_prompt": prompt[:4000] or defaults.PERSONA_PROMPT,
        "mood_aware": bool(v["mood_aware"]),
        "assist_tool": bool(v["assist_tool"]),
        "intent": bool(v["intent"]),
        "sentences": _sentences(v["sentences"], ck),
        "speak_targets": _entity_list("voice speakers", v["speak_targets"],
                                      ("media_player", "assist_satellite"), ck),
        "tts_entity": tts,
        "language": str(v["language"] or "").strip(),
        "find_entity": bool(v["find_entity"]),
        "screens": bool(v["screens"]),
        "action_screens": bool(v["action_screens"]),
        "answer_screens": bool(v["answer_screens"]),
        "screen_present": ck.choice("voice screen presenting", v["screen_present"],
                                    VOICE_PRESENTS, "corner"),
        "screen_seconds": _num(ck.number("voice screen time", v["screen_seconds"], 1, 120, 5)),
        "hold_while_speaking": bool(v["hold_while_speaking"]),
        "linger_seconds": _num(ck.number("voice screen linger", v["linger_seconds"], 0, 120, 6)),
        "plot_hours": _num(ck.number("voice screen plot span", v["plot_hours"], 1, 720, 24)),
        "plot_title": ck.choice("voice plot title", v["plot_title"], PLOT_TITLES, "icon"),
        "plot_text_size": _num(ck.number("voice plot text size", v["plot_text_size"], 0.5, 2, 2)),
        "max_grid": int(ck.number("voice screen grid size", v["max_grid"], 1, 12, 6)),
        "screen_skip": _skip_list(v["screen_skip"], ck),
        "volume_screen": bool(v["volume_screen"]),
        "screen_text": ck.choice("voice screen text", v["screen_text"], ("minimal", "full"), "minimal"),
        "music_animation": ck.choice("voice music animation", v["music_animation"] or "",
                                     ("", *animations), ""),
        "music_expression": ck.choice("voice music expression", v["music_expression"] or "",
                                      ("", *expressions), ""),
        "music_icon": _music_icon(v["music_icon"], ck),
        "music_screen": bool(v["music_screen"]),
        "music_seconds": _num(ck.number("voice music screen time", v["music_seconds"], 1, 120, 15)),
        "music_show_title": bool(v["music_show_title"]),
        "music_show_artist": bool(v["music_show_artist"]),
        "music_show_album": bool(v["music_show_album"]),
        "music_show_paused": bool(v["music_show_paused"]),
    }


def validate_speech(rules: Any) -> dict[str, Any]:
    """A checked speech section on its own (the panel's preview of a draft)."""
    ck = _Check()
    out = _speech({"speech": rules}, default_speech(), ck)
    if ck.errors:
        raise ConfigError(ck.errors)
    return out


def _speech(raw: Mapping[str, Any], base: dict[str, Any], ck: _Check) -> dict[str, Any]:
    v = _section(raw, "speech", base)
    engine = str(v["engine"] or "").strip()
    if engine and (not engine.startswith("tts.") or engine == SPEECH_ENTITY):
        ck.bad("speech engine", f"{engine!r} is not another tts entity")
        engine = ""
    pairs = []
    for p in v["replacements"] if isinstance(v["replacements"], list) else []:
        if not isinstance(p, Mapping):
            ck.bad("speech replacements", f"{p!r} is not a from and a to")
        elif str(p.get("from") or "").strip():     # a row still empty is dropped
            pairs.append({"from": str(p["from"]).strip()[:100], "to": str(p.get("to") or "")[:200]})
    flags = ("numbers", "and", "temperature_unit", "units", "currency", "abbreviations",
             "markdown", "links", "emoji")
    out = {
        "engine": engine,
        "decimals": int(ck.number("speech decimals", v["decimals"], 0, 3, 1)),
        "years": ck.choice("speech years", v["years"], speech.YEARS, "pairs"),
        "years_2000": ck.choice("speech years after 2000", v["years_2000"], speech.YEARS_2000,
                                "twenty"),
        "time_style": ck.choice("speech times", v["time_style"], speech.TIME_STYLES, "clock"),
        "time_period": ck.choice("speech time of day", v["time_period"], speech.TIME_PERIODS,
                                 "words"),
        "date_style": ck.choice("speech dates", v["date_style"], speech.DATE_STYLES, "month_day"),
        "numeric_dates": ck.choice("speech numeric dates", v["numeric_dates"],
                                   speech.NUMERIC_DATES, "month_first"),
        "date_year": ck.choice("speech date year", v["date_year"], speech.DATE_YEARS,
                               "not_this_year"),
        **{k: bool(v[k]) for k in flags},
        "replacements": pairs[:200],
    }
    return {k: out[k] for k in base}    # the defaults' key order


BRAIN_AGENT = "conversation.alfie"   # the brain can't delegate to itself


def _sentence(where: str, v: Any, ck: _Check) -> str | None:
    """A sentence template (HA's syntax): text, brackets balanced."""
    t = " ".join(str(v or "").split())[:200]
    depth: list[str] = []
    for ch in t:
        if ch in "([":
            depth.append(")" if ch == "(" else "]")
        elif ch in ")]" and (not depth or depth.pop() != ch):
            depth.append("x")
            break
    if depth:
        ck.bad(where, f"{t!r} has unbalanced brackets")
        return None
    return t or None


def _brain(raw: Mapping[str, Any], base: dict[str, Any], ck: _Check) -> dict[str, Any]:
    v = _section(raw, "brain", base)
    old = (raw.get("brain") or {}) if isinstance(raw.get("brain"), Mapping) else {}
    if "commands" in old and "off_commands" not in old:
        # Before 0.20 the section listed the commands that were on: the ones
        # it knew then and left out stay off; newer ones come on.
        on = old["commands"] if isinstance(old["commands"], list) else []
        v["off_commands"] = [c for c in ("whats_wrong", "how_are_you") if c not in on]
    delegate = str(v["delegate"] or "").strip()
    if delegate and (not delegate.startswith("conversation.") or delegate == BRAIN_AGENT):
        ck.bad("brain delegate", f"{delegate!r} is not another conversation agent")
        delegate = ""
    extra = v["extra_sentences"] if isinstance(v["extra_sentences"], Mapping) else {}
    sentences = {}
    for cmd in brain.COMMANDS:
        got = extra.get(cmd) or []
        got = got if isinstance(got, list) else [got]
        sentences[cmd] = [t for i, x in enumerate(got[:50])
                          if (t := _sentence(f"brain {cmd} sentence {i + 1}", x, ck))]
    weather = str(v["weather"] or "").strip()
    if weather and not weather.startswith("weather."):
        ck.bad("brain weather", f"{weather!r} is not a weather entity")
        weather = ""
    rain_gauge = str(v["rain_gauge"] or "").strip()
    if rain_gauge and not rain_gauge.startswith("sensor."):
        ck.bad("brain rain gauge", f"{rain_gauge!r} is not a sensor")
        rain_gauge = ""
    icons = {}
    for key in ("local_icon", "delegate_icon"):
        icon = str(v[key] or "").strip()
        icons[key] = icon if not icon or _is_icon(icon) else ""
        if icon and not icons[key]:
            ck.bad(f"brain {key.replace('_', ' ')}", f"{icon!r} is not an icon name")
    quick = v["agent_quick_tools"] if isinstance(v["agent_quick_tools"], list) else []
    phrases = v["agent_think_phrases"] if isinstance(v["agent_think_phrases"], list) else []
    return {
        "delegate": delegate,
        "agent_url": _url("brain agent server", v["agent_url"], ck),
        "agent_key": str(v["agent_key"] or "").strip()[:500],
        "agent_model": str(v["agent_model"] or "").strip()[:100] or "hermes-agent",
        "agent_prompt": str(v["agent_prompt"] or "").strip()[:2000],
        "agent_prompt_typed": str(v["agent_prompt_typed"] or "").strip()[:2000],
        "agent_final_only": bool(v["agent_final_only"]),
        "agent_earlier": bool(v["agent_earlier"]),
        "room_context": bool(v["room_context"]),
        "room_minutes": int(ck.number("brain room minutes", v["room_minutes"], 1, 120, 15)),
        "room_turns": int(ck.number("brain room turns", v["room_turns"], 1, 20, 6)),
        "profiles": _profiles(v["profiles"], ck),
        "profile_routing": ck.choice("brain profile routing", v["profile_routing"],
                                     ("profiles", "names"), "profiles"),
        "voice_identity": bool(v["voice_identity"]),
        "ears_url": _url("brain alfie-ears", v["ears_url"], ck),
        "ears_fresh": int(ck.number("brain ears freshness", v["ears_fresh"], 1, 120, 15)),
        "ears_match": int(ck.number("brain ears text match", v["ears_match"], 50, 100, 85)),
        "voice_sticky": int(ck.number("brain voice sticky", v["voice_sticky"], 0, 900, 90)),
        "guest_entity": _guest(v["guest_entity"], ck),
        "guest_house_only": bool(v["guest_house_only"]),
        "drop_not_meant": bool(v["drop_not_meant"]),
        "drop_expression": _face_name(v["drop_expression"]),
        "agent_seconds": _num(ck.number("brain agent wait", v["agent_seconds"], 5, 900, 120)),
        "agent_wait": bool(v["agent_wait"]),
        "agent_wait_seconds": _num(ck.number("brain agent quiet time", v["agent_wait_seconds"],
                                             1, 60, 4)),
        "agent_quick_tools": [t for x in quick[:50] if (t := str(x).strip()[:60])],
        **{f"agent_think_{k}": ck.choice(f"brain agent thinking {k}", v[f"agent_think_{k}"],
                                         agent.THINK, brain.default_settings()[f"agent_think_{k}"])
           for k in ("voice", "typed", "asked")},
        "agent_think_phrases": [t for x in phrases[:30]
                                if (t := " ".join(str(x).split())[:60])],
        "own_sentences": bool(v["own_sentences"]),
        "off_commands": ck.names("brain commands off", v["off_commands"], brain.COMMANDS),
        "own_always": ck.names("brain commands always on", v["own_always"], brain.COMMANDS),
        "voice_label": " ".join(str(v["voice_label"] or "").split())[:60],
        "run_bare": bool(v["run_bare"]),
        "run_conditions": bool(v["run_conditions"]),
        "run_reply": str(v["run_reply"] or "").strip()[:200],
        "extra_sentences": sentences,
        "exposed_only": bool(v["exposed_only"]),
        "match_floor": int(ck.number("brain match floor", v["match_floor"], 30, 120, 70)),
        "ask_which": bool(v["ask_which"]),
        "say_unknown": bool(v["say_unknown"]),
        "count_skip": [str(x).strip() for x in (v["count_skip"] if isinstance(v["count_skip"], list)
                                                 else []) if str(x).strip()][:50],
        "weather": weather,
        "weather_anywhere": bool(v["weather_anywhere"]),
        "weather_geo_url": _url("brain place finder", v["weather_geo_url"], ck),
        "weather_url": _url("brain weather anywhere", v["weather_url"], ck),
        "weather_seconds": _num(ck.number("brain weather anywhere wait", v["weather_seconds"],
                                          1, 15, 3)),
        "weather_minutes": int(ck.number("brain weather anywhere minutes", v["weather_minutes"],
                                         5, 360, 30)),
        "weather_past": ck.choice("brain past weather", v["weather_past"],
                                  ("openmeteo", "history", "off"), "openmeteo"),
        "weather_reports": _entity_list("brain weather reports", v["weather_reports"],
                                        ("weather",), ck),
        "rain_gauge": rain_gauge,
        "cold_below": _num(ck.number("brain cold below", v["cold_below"], -40, 40, 10)),
        "warm_above": _num(ck.number("brain warm above", v["warm_above"], -20, 50, 22)),
        "windy_speed": _num(ck.number("brain windy speed", v["windy_speed"], 1, 200, 30)),
        "rain_chance": int(ck.number("brain rain chance", v["rain_chance"], 1, 100, 40)),
        "rain_mm": _num(ck.number("brain rain amount", v["rain_mm"], 0, 50, 0.3)),
        "sun_uv": _num(ck.number("brain sun uv", v["sun_uv"], 0, 15, 3)),
        "dates": _brain_dates(v["dates"], ck),
        "imperial": v["imperial"] if v["imperial"] in ("us", "uk") else "us",
        "calendars": _entity_list("brain calendars", v["calendars"], ("calendar",), ck),
        "calendar_dates": bool(v["calendar_dates"]),
        "calendar_minutes": int(ck.number("brain calendar minutes", v["calendar_minutes"], 1, 1440, 60)),
        "event_max": int(ck.number("brain events said", v["event_max"], 1, 30, 6)),
        "media_players": _entity_list("brain media players", v["media_players"], ("media_player",), ck),
        "media_skip": [str(x).strip() for x in (v["media_skip"] if isinstance(v["media_skip"], list)
                                                 else []) if str(x).strip()][:50],
        "todo_list": _todo(v["todo_list"], ck),
        "list_max": int(ck.number("brain list items said", v["list_max"], 1, 50, 10)),
        "jokes": _jokes(v["jokes"], ck),
        "builtin_jokes": bool(v["builtin_jokes"]),
        "joke_expression": _face_name(v["joke_expression"]),
        "joke_animation": _face_name(v["joke_animation"]),
        "random_max": int(ck.number("brain random number most", v["random_max"], 2, 1000000, 10)),
        "repeat_minutes": int(ck.number("brain repeat minutes", v["repeat_minutes"], 1, 1440, 10)),
        "dismiss_reply": " ".join(str(v["dismiss_reply"] or "").split())[:200],
        "wiki_url": _url("brain wikipedia server", v["wiki_url"], ck),
        "wiki_book": str(v["wiki_book"] or "").strip()[:200],
        "wiki_sentences": int(ck.number("brain wikipedia sentences", v["wiki_sentences"], 1, 10, 2)),
        "wiki_brackets": bool(v["wiki_brackets"]),
        "wiki_credit": bool(v["wiki_credit"]),
        "wiki_seconds": _num(ck.number("brain wikipedia wait", v["wiki_seconds"], 1, 30, 4)),
        "local_intents": bool(v["local_intents"]),
        "local_states": bool(v["local_states"]),
        "local_media_search": bool(v["local_media_search"]),
        "fallback": str(v["fallback"] or "").strip()[:300],
        "log_size": int(ck.number("brain log size", v["log_size"], 1, brain.LOG_MAX, 50)),
        **icons,
        "icon_seconds": _num(ck.number("brain icon time", v["icon_seconds"], 0, 60, 3)),
    }


def _jokes(raw: Any, ck: _Check) -> list[str]:
    """His own jokes, one line each ("setup | punchline")."""
    out = []
    for i, line in enumerate((raw if isinstance(raw, list) else [])[:200]):
        line = " ".join(str(line).split())
        if len(line) > 400:
            ck.bad(f"brain joke {i + 1}", "is longer than 400 characters")
        elif line:
            out.append(line)
    return out


def _url(where: str, v: Any, ck: _Check) -> str:
    """An http(s) address, "" for none."""
    u = str(v or "").strip().rstrip("/")
    if u and not re.match(r"^https?://[^\s/]+", u):
        ck.bad(where, f"{u!r} is not an http:// address")
        return ""
    return u


def _profiles(raw: Any, ck: _Check) -> list[dict[str, str]]:
    """People with their own agent profile. `url` is a whole address or a
    path on the house agent server ("/p/lukas"); `id` is what alfie-ears
    calls them."""
    out: list[dict[str, str]] = []
    for i, p in enumerate(raw[:20] if isinstance(raw, list) else []):
        if not isinstance(p, Mapping):
            continue
        name = " ".join(str(p.get("name") or "").split())[:60]
        pid = re.sub(r"[^a-z0-9_-]", "", str(p.get("id") or name).strip().lower())[:40]
        url = str(p.get("url") or "").strip().rstrip("/")
        if url and not url.startswith("/"):
            url = _url(f"brain profile {i + 1} address", url, ck)
        if not pid:
            ck.bad(f"brain profile {i + 1}", "needs a name or an id")
            continue
        if any(x["id"] == pid for x in out):
            ck.bad(f"brain profile {i + 1}", f"the id {pid!r} is used twice")
            continue
        out.append({"id": pid, "name": name or pid, "user": str(p.get("user") or "").strip()[:64],
                    "url": url[:300], "key": str(p.get("key") or "").strip()[:500]})
    return out


def _guest(v: Any, ck: _Check) -> str:
    e = str(v or "").strip()
    if e and "." not in e:
        ck.bad("brain guest entity", f"{e!r} is not an entity")
        return ""
    return e


def _face_name(v: Any) -> str:
    """An expression or animation name; the engine skips one it doesn't know
    (custom ones can be added or removed after)."""
    return str(v or "").strip()[:60]


def _todo(v: Any, ck: _Check) -> str:
    t = str(v or "").strip()
    if t and not t.startswith("todo."):
        ck.bad("brain list", f"{t!r} is not a todo entity")
        return ""
    return t


DATE_LINE = re.compile(r"^(.+?):\s*(\d{4}-)?\d{1,2}-\d{1,2}$")


def _brain_dates(raw: Any, ck: _Check) -> list[str]:
    """The user's own named dates, one "name: MM-DD" (or YYYY-MM-DD) each."""
    out = []
    for i, line in enumerate((raw if isinstance(raw, list) else [])[:100]):
        line = " ".join(str(line).split())
        if not line:
            continue
        if DATE_LINE.match(line):
            out.append(line)
        else:
            ck.bad(f"brain date {i + 1}", f"{line!r} is not \"name: MM-DD\"")
    return out


def _is_icon(icon: str) -> bool:
    from .stories import is_icon_name   # lazy: stories imports this module
    return is_icon_name(icon)


def _music_icon(v: Any, ck: _Check) -> str:
    from .stories import is_icon_name   # lazy: stories imports this module
    icon = str(v or "").strip()
    if icon and not is_icon_name(icon):
        ck.bad("voice music icon", f"{icon!r} is not an icon name (like mdi:music-note)")
        return ""
    return icon


def _skip_list(v: Any, ck: _Check) -> list[str]:
    """Domains (script) or entity ids (light.hall) voice screens leave out."""
    items = v.split(",") if isinstance(v, str) else v if isinstance(v, list) else []
    out: list[str] = []
    for x in items:
        x = str(x).strip().lower()
        if not x:
            continue
        if not re.match(r"^[a-z_]+(\.[a-z0-9_]+)?$", x):
            ck.bad("voice screens leave out", f"{x!r} is not a domain or an entity id")
        elif x not in out:
            out.append(x)
    return out


def _personality(raw: Mapping[str, Any], face: Mapping[str, Any], ck: _Check) -> dict[str, Any]:
    p = raw.get("personality") if isinstance(raw.get("personality"), Mapping) else {}
    presets = (*(face.get("personalities") or {}), CUSTOM)
    preset = ck.choice("personality preset", p.get("preset", "bubbly"), presets, "bubbly")
    # A named preset is its numbers; only "custom" keeps the sliders it is given.
    base = personality_values(preset if preset != CUSTOM else "bubbly", face)
    src = {**base, **p} if preset == CUSTOM else base
    return {"preset": preset,
            **{k: ck.number(f"personality {k}", src[k], lo, hi, d)
               for k, (d, lo, hi) in PERSONALITY.items()}}


_VAR = r"var\(--[A-Za-z0-9_-]+(?:\s*,[^()]*)?\)"


def _colour(where: str, v: Any, ck: _Check) -> str:
    """A CSS colour for the look: "" (from the style), #hex or var(--x)."""
    from .screen_types import _COLOR   # lazy: screen_types imports this module
    if v is None:
        return ""
    if not isinstance(v, str):
        ck.bad(where, "must be text")
        return ""
    v = v.strip()
    if v and not _COLOR.match(v) and not re.fullmatch(_VAR, v):
        ck.bad(where, "must be a colour like #ffcc00 or var(--primary-color)")
        return ""
    return v


def _shape(where: str, raw: Any, ck: _Check) -> dict[str, Any]:
    """A shape spec checked for type and ranges; unknown keys are dropped and
    only the keys given are kept (the face file supplies the rest)."""
    if not isinstance(raw, Mapping):
        ck.bad(where, "must be a mapping")
        return {"type": "circle"}
    typ = ck.choice(f"{where} type", raw.get("type", "circle"), SHAPE_TYPES, "circle")
    out: dict[str, Any] = {"type": typ}

    def num(key: str, lo: float, hi: float, integer: bool = False) -> None:
        if raw.get(key) is None:
            return
        x = ck.number(f"{where} {key}", raw[key], lo, hi, lo)
        out[key] = int(round(x)) if integer else _num(x)

    if typ == "polygon":
        num("sides", 3, 12, True)
        num("roundness", 0, 1)
    elif typ == "star":
        num("points", 2, 12, True)
        num("inner", 0.05, 1)
        num("roundness", 0, 1)
    elif typ == "superellipse":
        num("n", 0.2, 10)
    elif typ == "path":
        pts = raw.get("points")
        good = isinstance(pts, list) and 3 <= len(pts) <= 200 and all(
            isinstance(q, (list, tuple)) and len(q) == 2
            and all(isinstance(c, (int, float)) and not isinstance(c, bool) and -1 <= c <= 1
                    for c in q) for q in pts)
        if good:
            out["points"] = [[_num(q[0]), _num(q[1])] for q in pts]
        else:
            ck.bad(f"{where} points", "needs 3 to 200 [x, y] points, each between -1 and 1")
            out["points"] = [[1, 0], [-1, 1], [-1, -1]]
        num("roundness", 0, 1)
    num("rotation", -360, 360)
    st = raw.get("stretch")
    if st is not None:
        if isinstance(st, (list, tuple)) and len(st) == 2:
            out["stretch"] = [_num(ck.number(f"{where} stretch", c, 0.3, 3, 1.0)) for c in st]
        else:
            ck.bad(f"{where} stretch", "must be [x, y]")
    return out


def _look(raw: Mapping[str, Any], base: dict[str, Any], ck: _Check) -> dict[str, Any]:
    got = raw.get("look")
    lk = {**base, **got} if isinstance(got, Mapping) else dict(base)
    glow = lk.get("glow")
    shapes_in = lk.get("shapes") if isinstance(lk.get("shapes"), Mapping) else base["shapes"]
    shapes = {}
    for slot in SHAPE_SLOTS:
        if slot in shapes_in:
            shapes[slot] = _shape(f"look shape {slot}", shapes_in[slot], ck)
        elif slot in base["shapes"]:
            shapes[slot] = dict(base["shapes"][slot])
    for slot in shapes_in:
        if slot not in SHAPE_SLOTS:
            ck.bad("look shapes", f"unknown shape {slot!r}")
    bg = lk.get("background")
    return {
        "style": ck.choice("look style", lk.get("style"), STYLES, "neon"),
        "ring_color": _colour("look ring colour", lk.get("ring_color"), ck),
        "eye_color": _colour("look eye colour", lk.get("eye_color"), ck),
        "background": "" if bg == "none" else _colour("look background", bg, ck),
        "text_color": _colour("look text colour", lk.get("text_color"), ck),
        "accent_color": _colour("look accent colour", lk.get("accent_color"), ck),
        "line_color": _colour("look screen line colour", lk.get("line_color"), ck),
        "line_width": ck.number("look line width", lk.get("line_width"), 0.005, 0.2,
                                base["line_width"]),
        "screen_line_width": ck.number("look screen line width", lk.get("screen_line_width"),
                                       0.003, 0.1, base["screen_line_width"]),
        "glow": None if glow in (None, "") else ck.number("look glow", glow, 0, 2, 0.0),
        "eye_fill": bool(lk.get("eye_fill")),
        "padding": ck.number("look padding", lk.get("padding"), 0, 0.45, base["padding"]),
        "aspect": ck.number("look aspect", lk.get("aspect"), 0.5, 3, base["aspect"]),
        "shapes": shapes,
        "motion": _motion(lk.get("motion"), base.get("motion") or default_motion(), ck),
    }


def _motion(raw: Any, base: dict[str, Any], ck: _Check) -> dict[str, Any]:
    if raw is not None and not isinstance(raw, Mapping):
        ck.bad("look motion", "must be a mapping")
        raw = None
    got = {**base, **(raw or {})}
    for k in got:
        if k not in MOTION and k != "transition_seconds":
            ck.bad("look motion", f"unknown setting {k!r}")
    out: dict[str, Any] = {k: _num(ck.number(f"look motion {k}", got.get(k, d), lo, hi, d))
                           for k, (d, lo, hi) in MOTION.items()}
    out["wave_bumps"] = round(out["wave_bumps"])
    secs = got.get("transition_seconds") or {}
    if not isinstance(secs, Mapping):
        ck.bad("look motion transition_seconds", "must be a mapping")
        secs = {}
    lo, hi = TRANSITION_SECONDS
    out["transition_seconds"] = {
        k: _num(ck.number(f"look motion transition_seconds {k}", v, lo, hi, 0.0))
        for k, v in secs.items() if isinstance(k, str) and _ID.match(k) and v not in (None, "")}
    for k in secs:
        if not (isinstance(k, str) and _ID.match(k)):
            ck.bad("look motion transition_seconds", f"{k!r} is not a transition")
    return out


def _num(x: float) -> int | float:
    """Whole numbers as ints, so the stored JSON reads 20, not 20.0."""
    return int(x) if float(x).is_integer() else x


def _screens(raw: Any, types: Mapping[str, Any], ck: _Check) -> list[dict[str, Any]]:
    from .screen_types import check_options   # lazy: screen_types imports this module
    if not isinstance(raw, list):
        ck.bad("screens", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, s in enumerate(raw):
        where = f"screen {i + 1}"
        if not isinstance(s, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        sid = str(s.get("id") or "").strip()
        if not _ID.match(sid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"screen {sid}"
        if sid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(sid)
        meta = types.get(str(s.get("type") or ""))
        if meta is None:
            ck.bad(where, f"unknown type {s.get('type')!r}")
            continue
        out.append({"id": sid, "type": meta["type"],
                    "title": str(s.get("title") or "").strip() or meta.get("title") or sid,
                    "options": check_options(meta, s.get("options"), ck, where)})
    return out


def _rotations(raw: Any, screen_ids: set[str], ck: _Check) -> list[dict[str, Any]]:
    if not isinstance(raw, list):
        ck.bad("rotations", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, r in enumerate(raw):
        where = f"rotation {i + 1}"
        if not isinstance(r, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        rid = str(r.get("id") or "").strip()
        if not _ID.match(rid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"rotation {rid}"
        if rid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(rid)
        # Any slug, "random" included: the intro names live in the frontend and
        # grow, so the server only insists on a well-formed one.
        tr = str(r.get("transition") or DEFAULT_TRANSITION).strip()
        if not _ID.match(tr):
            ck.bad(f"{where} transition", "must be a name (lower-case letters, digits and _)")
            tr = DEFAULT_TRANSITION
        steps = r.get("steps", [])
        if not isinstance(steps, list):
            ck.bad(f"{where} steps", "must be a list")
            steps = []
        out_steps = []
        for j, st in enumerate(steps):
            sw = f"{where} step {j + 1}"
            if not isinstance(st, Mapping):
                ck.bad(sw, "must be a mapping")
                continue
            secs = ck.number(f"{sw} seconds", st.get("seconds", 20), *STEP_SECONDS, 20.0)
            if st.get("alfie"):
                # Alfie himself, playing the most relevant story (behaviour.appear_story_*).
                out_steps.append({"alfie": True, "seconds": _num(secs)})
                continue
            sc = str(st.get("screen") or "").strip()
            if sc not in screen_ids:
                ck.bad(sw, f"screen {sc!r} does not exist")
                continue
            out_steps.append({"screen": sc, "seconds": _num(secs)})
        # Alfie between every pair of screens, as an Alfie step; 0 (the default)
        # goes straight from screen to screen.
        face = ck.number(f"{where} face seconds", r.get("face_seconds", 0), 0, 3600, 0.0)
        out.append({"id": rid, "name": str(r.get("name") or "").strip() or rid,
                    "transition": tr, "face_seconds": _num(face), "steps": out_steps})
    return out


def _expressions(raw: Any, ck: _Check) -> list[dict[str, Any]]:
    """Custom expressions, and built-ins changed (an id that is a built-in's
    name replaces it): [{id, name, left, right, size, look, shapes?}]."""
    if not isinstance(raw, list):
        ck.bad("expressions", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, e in enumerate(raw):
        where = f"expression {i + 1}"
        if not isinstance(e, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        eid = str(e.get("id") or "").strip()
        if not _ID.match(eid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"expression {eid}"
        if eid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(eid)

        def lids(key: str, fallback: Any) -> list[int | float]:
            v = e.get(key, fallback)
            if not (isinstance(v, (list, tuple)) and len(v) == 4):
                ck.bad(f"{where} {key}", "must be 4 numbers: upper lid height, slant, lower lid height, slant")
                return [1, 0, -1, 0]
            return [_num(ck.number(f"{where} {key}", x, *LID_RANGE, 0.0)) for x in v]

        left = lids("left", [1, 0, -1, 0])
        look = e.get("look", [0, 0])
        if not (isinstance(look, (list, tuple)) and len(look) == 2):
            ck.bad(f"{where} look", "must be [x, y]")
            look = [0, 0]
        item = {"id": eid, "name": str(e.get("name") or "").strip() or eid,
                "left": left, "right": lids("right", left),
                "size": _num(ck.number(f"{where} size", e.get("size", 1), *SIZE_RANGE, 1.0)),
                "look": [_num(ck.number(f"{where} look", x, *LOOK_RANGE, 0.0)) for x in look]}
        shapes = e.get("shapes")
        if isinstance(shapes, Mapping) and shapes:
            item["shapes"] = {}
            for slot, spec in shapes.items():
                if slot not in ("eye", "left_eye", "right_eye"):
                    ck.bad(f"{where} shapes", f"unknown shape {slot!r} (eye, left_eye, right_eye)")
                    continue
                item["shapes"][slot] = _shape(f"{where} shape {slot}", spec, ck)
        out.append(item)
    return out


def _animations(raw: Any, ck: _Check) -> list[dict[str, Any]]:
    """Custom keyframe animations, and built-ins changed (by id):
    [{id, name, keys: [[seconds, {channel: value}, ease], ...]}]."""
    if not isinstance(raw, list):
        ck.bad("animations", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, a in enumerate(raw):
        where = f"animation {i + 1}"
        if not isinstance(a, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        aid = str(a.get("id") or "").strip()
        if not _ID.match(aid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"animation {aid}"
        if aid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(aid)
        keys_in = a.get("keys")
        if not isinstance(keys_in, list) or not 1 <= len(keys_in) <= MAX_KEYS:
            ck.bad(f"{where} keys", f"needs 1 to {MAX_KEYS} keys")
            continue
        keys = []
        for j, k in enumerate(keys_in):
            kw = f"{where} key {j + 1}"
            if not (isinstance(k, (list, tuple)) and len(k) in (2, 3) and isinstance(k[1], Mapping)):
                ck.bad(kw, "must be [seconds, {channel: value}, ease]")
                continue
            ch = {}
            for name, v in k[1].items():
                if name not in CHANNELS:
                    ck.bad(kw, f"unknown channel {name!r}")
                    continue
                ch[name] = _num(ck.number(f"{kw} {name}", v, *CHANNELS[name], 0.0))
            keys.append([_num(ck.number(f"{kw} seconds", k[0], *KEY_SECONDS, 0.2)), ch,
                         ck.choice(f"{kw} ease", k[2] if len(k) == 3 else "ease", EASES, "ease")])
        out.append({"id": aid, "name": str(a.get("name") or "").strip() or aid, "keys": keys})
    return out


def face_extras(cfg: Mapping[str, Any]) -> dict[str, Any]:
    """The config's own expressions and animations as the card reads them, by id."""
    def strip(x: Mapping[str, Any]) -> dict[str, Any]:
        return {k: v for k, v in x.items() if k not in ("id", "name")}
    return {"expressions": {e["id"]: strip(e) for e in cfg.get("expressions", [])},
            "animations": {a["id"]: strip(a) for a in cfg.get("animations", [])}}


def validate(raw: Any, face: Mapping[str, Any],
             types: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """A complete, checked config from `raw`, or ConfigError listing every
    problem. Missing sections and keys take the defaults."""
    if not isinstance(raw, Mapping):
        raise ConfigError(["config must be a mapping"])
    raw = migrate(raw)
    ck = _Check()
    base = default_config()
    custom = _expressions(raw.get("expressions", base["expressions"]), ck)
    expressions = tuple(face.get("expressions") or ())
    expressions += tuple(e["id"] for e in custom if e["id"] not in expressions)
    own_anims = _animations(raw.get("animations", base["animations"]), ck)
    animations = tuple(face.get("animations") or ())
    animations += tuple(a["id"] for a in own_anims if a["id"] not in animations)
    cfg = {
        "version": CONFIG_VERSION,
        "signals": _signals(raw.get("signals", base["signals"]), ck),
        "mood": _mood(raw, base["mood"], expressions, ck),
        "behaviour": _behaviour(raw, base["behaviour"], expressions, animations, ck),
        "personality": _personality(raw, face, ck),
        "look": _look(raw, base["look"], ck),
        "expressions": custom,
        "animations": own_anims,
    }
    cfg["screens"] = _screens(raw.get("screens", base["screens"]), types or {}, ck)
    cfg["rotations"] = _rotations(raw.get("rotations", base["rotations"]),
                                  {s["id"] for s in cfg["screens"]}, ck)
    cfg["stories"] = validate_stories(raw.get("stories", base["stories"]), ck, expressions,
                                      animations, {s["id"] for s in cfg["screens"]})
    raw_modes = raw.get("modes")
    if raw_modes is None:
        # The default modes, minus switching off triggers this config doesn't have.
        tids = {t.get("id") for t in raw.get("triggers", base["triggers"]) if isinstance(t, Mapping)}
        raw_modes = [{**m, "triggers_off": [t for t in m["triggers_off"] if t in tids]}
                     for m in base["modes"]]
    cfg["triggers"] = validate_triggers(raw.get("triggers", base["triggers"]), ck,
                                        {s["id"] for s in cfg["stories"]},
                                        {s["id"] for s in cfg["signals"]},
                                        mode_ids(raw_modes))
    cfg["modes"] = validate_modes(raw_modes, ck, tuple(face.get("personalities") or ()),
                                  {r["id"] for r in cfg["rotations"]})
    cfg["voice"] = _voice(raw, base["voice"], expressions, animations, ck)
    cfg["speech"] = _speech(raw, base["speech"], ck)
    cfg["brain"] = _brain(raw, base["brain"], ck)
    cfg["overview"] = _overview(raw.get("overview"), ck)
    trigger_ids = {t["id"] for t in cfg["triggers"]}
    for m in cfg["modes"]:
        for tid in m["triggers_off"]:
            if tid not in trigger_ids:
                ck.bad(f"mode {m['id']} triggers off", f"trigger {tid!r} does not exist")
    story_ids = {s["id"] for s in cfg["stories"]}
    for key in ("appear_story_bad", "appear_story_ok"):
        sid = cfg["behaviour"][key]
        if sid and sid not in story_ids:
            ck.bad(f"behaviour {key.replace('_', ' ')}", f"story {sid!r} does not exist")
    for sig in cfg["signals"]:
        r = sig["repeat"]
        if (r["on_motion"] or r["every_hours"]) and r["story"] not in story_ids:
            ck.bad(f"signal {sig['id']} repeat", f"story {r['story']!r} does not exist")
    if not ck.errors:
        try:
            build(cfg)
        except ValueError as e:   # the dataclasses' own checks, as a last word
            ck.bad("config", str(e))
    if ck.errors:
        raise ConfigError(ck.errors)
    return cfg


def _overview(raw: Any, ck: _Check) -> dict[str, Any]:
    o = raw if isinstance(raw, Mapping) else {}
    done = o.get("done", [])
    return {"dismissed": bool(o.get("dismissed", False)),
            "done": ck.names("overview done", done, GUIDE_STEPS) if done else []}


def reset(cfg: Mapping[str, Any], section: str | None = None) -> dict[str, Any]:
    """`cfg` with one section (or, with None, everything) back to the defaults."""
    base = default_config()
    if section is None:
        return base
    if section not in SECTIONS:
        raise ConfigError([f"unknown section {section!r}"])
    return {**copy.deepcopy(dict(cfg)), section: base[section]}


# ------------------------------------------------------------------ building

def build(cfg: Mapping[str, Any]) -> Built:
    """What the engine runs on, from a validated config."""
    signals = tuple(
        Signal(id=s["id"], name=s["name"], entities=tuple(s["entities"]), op=s["op"],
               value=s["value"], kind=s["kind"], severity=s["severity"], weight=s["weight"],
               screen=s["screen"], match=s["match"], enabled=s["enabled"])
        for s in cfg["signals"])
    m = cfg["mood"]
    mood = MoodSettings(combine=m["combine"], weights=dict(m["weights"]),
                        thresholds=dict(m["thresholds"]),
                        count_thresholds=dict(m["count_thresholds"]),
                        ladder=dict(m["ladder"]), expressions=dict(m["expressions"]),
                        energy=dict(m["energy"]))
    p = cfg["personality"]
    return Built(signals=signals, mood=mood, behaviour=dict(cfg["behaviour"]),
                 personality={k: float(p[k]) for k in PERSONALITY})
