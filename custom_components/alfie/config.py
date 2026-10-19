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

from . import defaults
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
CONFIG_VERSION = 5
SECTIONS = ("signals", "mood", "behaviour", "personality", "look", "screens", "rotations",
            "stories", "triggers", "modes", "overview")
GUIDE_STEPS = ("signals", "motion", "sleep", "dashboard", "screens")   # Get started
STYLES = ("neon", "flat", "crt", "theme")     # the card's render styles
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
            "text_color": "", "accent_color": "", "line_width": 0.035,
            "screen_line_width": 0.02, "glow": None, "eye_fill": False, "padding": 0.08,
            "aspect": 1.0,
            "shapes": {"head": {"type": "circle"}, "eye": {"type": "circle"}}}


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
        "screens": [],        # Alfie ships none: the user builds them
        "rotations": [],
        "stories": copy.deepcopy(list(defaults.STORIES)),
        "triggers": copy.deepcopy(list(defaults.TRIGGERS)),
        "modes": copy.deepcopy(list(defaults.MODES)),
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


def migrate(raw: Mapping[str, Any]) -> dict[str, Any]:
    """Any stored or imported config, in the current version's keys."""
    return migrate_v4(migrate_v3(migrate_v2(_add_appear(migrate_v1(raw)))))


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
        "line_width": ck.number("look line width", lk.get("line_width"), 0.005, 0.2,
                                base["line_width"]),
        "screen_line_width": ck.number("look screen line width", lk.get("screen_line_width"),
                                       0.003, 0.1, base["screen_line_width"]),
        "glow": None if glow in (None, "") else ck.number("look glow", glow, 0, 2, 0.0),
        "eye_fill": bool(lk.get("eye_fill")),
        "padding": ck.number("look padding", lk.get("padding"), 0, 0.45, base["padding"]),
        "aspect": ck.number("look aspect", lk.get("aspect"), 0.5, 3, base["aspect"]),
        "shapes": shapes,
    }


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


def validate(raw: Any, face: Mapping[str, Any],
             types: Mapping[str, Any] | None = None) -> dict[str, Any]:
    """A complete, checked config from `raw`, or ConfigError listing every
    problem. Missing sections and keys take the defaults."""
    if not isinstance(raw, Mapping):
        raise ConfigError(["config must be a mapping"])
    raw = migrate(raw)
    ck = _Check()
    base = default_config()
    expressions = tuple(face.get("expressions") or ())
    animations = tuple(face.get("animations") or ())
    cfg = {
        "version": CONFIG_VERSION,
        "signals": _signals(raw.get("signals", base["signals"]), ck),
        "mood": _mood(raw, base["mood"], expressions, ck),
        "behaviour": _behaviour(raw, base["behaviour"], expressions, animations, ck),
        "personality": _personality(raw, face, ck),
        "look": _look(raw, base["look"], ck),
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
