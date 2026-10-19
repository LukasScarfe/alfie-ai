"""Alfie's whole user configuration as one plain dict, kept in HA's Store.

PURE (no HA import), so the tests run under plain python. Four sections:

  signals      the good and bad signals (see signals.py)
  mood         how they combine into a level, and each level's look
  behaviour    sleep, the motion gaze map, fidgets and the reaction animations
  personality  a preset plus the motion sliders it fills in

`default_config()` is Lukas's house (defaults.py). `validate()` turns any
stored or panel-sent dict into a complete, checked one, filling what is
missing from the defaults. `build()` turns a valid one into what the engine
runs on. Names of expressions, animations and personality presets come from
the face file (frontend/alfie-face.json), passed in as `face`.
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

CONFIG_VERSION = 1
SECTIONS = ("signals", "mood", "behaviour", "personality")

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
NOTICE = "notice"     # gaze-map action: one of behaviour.notice at random

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
    return {"id": s.id, "label": s.label, "entities": list(s.entities), "op": s.op,
            "value": s.value, "kind": s.kind, "severity": s.severity, "weight": s.weight,
            "match": s.match, "screen": s.screen, "enabled": s.enabled}


def personality_values(name: str, face: Mapping[str, Any] | None = None) -> dict[str, float]:
    presets = (face or {}).get("personalities") or {}
    base = {k: d for k, (d, _, _) in PERSONALITY.items()}
    return {**base, **{k: float(v) for k, v in presets.get(name, {}).items() if k in base}}


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
            "sleep_entity": defaults.SLEEP_ENTITY,
            "sleep_expression": defaults.SLEEP_EXPRESSION,
            "gaze_map": [{"entity": e, "action": a} for e, a in defaults.GAZE_MAP.items()],
            "notice": list(defaults.NOTICE),
            "idle_fidgets": list(defaults.IDLE_FIDGETS),
            "idle_interval": defaults.IDLE_INTERVAL,
            "motion_debounce": defaults.MOTION_DEBOUNCE,
            "celebrate": True,
            "on_critical": defaults.ON_CRITICAL,
            "on_recover": defaults.ON_RECOVER,
            "on_wake": "wake_up",
        },
        "personality": {"preset": "bubbly", **personality_values("bubbly")},
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
        cfg["behaviour"]["celebrate"] = bool(options["celebrate_fix"])
    return cfg


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
            "label": str(s.get("label") or sid).strip(),
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
        }
        if d["op"] in ("above", "below"):
            if not isinstance(d["value"], (int, float)):
                try:
                    d["value"] = float(d["value"])
                except ValueError:
                    ck.bad(where, f"'{d['op']}' needs a number")
        out.append(d)
    return out


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
        out[key] = {k: ck.number(f"mood {key} {k}", src[k], lo, hi, base[key][k]) for k in keys}
    out["count_thresholds"] = {k: int(round(v)) for k, v in out["count_thresholds"].items()}
    _ordered("mood thresholds", out["thresholds"], ck)
    _ordered("mood count_thresholds", out["count_thresholds"], ck)
    ladder = {**base["ladder"], **(m["ladder"] if isinstance(m.get("ladder"), Mapping) else {})}
    out["ladder"] = {k: ck.choice(f"mood ladder {k}", ladder[k], LEVELS, base["ladder"][k])
                     for k in SEVERITIES}
    ex = {**base["expressions"],
          **(m["expressions"] if isinstance(m.get("expressions"), Mapping) else {})}
    out["expressions"] = {k: ck.choice(f"mood expression for {k}", ex[k], expressions, "neutral")
                          for k in LEVELS}
    return out


def _behaviour(raw: Mapping[str, Any], base: dict[str, Any], expressions: Any,
               animations: Any, ck: _Check) -> dict[str, Any]:
    b = _section(raw, "behaviour", base)
    anim_or_none = (*animations, "")
    gaze = []
    for i, g in enumerate(b["gaze_map"] if isinstance(b["gaze_map"], list) else []):
        ent = str((g or {}).get("entity") or "").strip() if isinstance(g, Mapping) else ""
        if not ent:
            ck.bad(f"motion {i + 1}", "needs an entity")
            continue
        act = ck.choice(f"motion {ent}", g.get("action", NOTICE), (NOTICE, *animations), NOTICE)
        gaze.append({"entity": ent, "action": act})
    return {
        "sleep_entity": str(b.get("sleep_entity") or "").strip(),
        "sleep_expression": ck.choice("sleep expression", b["sleep_expression"], expressions,
                                      "closed"),
        "gaze_map": gaze,
        "notice": ck.names("notice animations", b["notice"], animations),
        "idle_fidgets": ck.names("idle fidgets", b["idle_fidgets"], animations),
        "idle_interval": ck.number("idle interval", b["idle_interval"], 10, 3600,
                                   base["idle_interval"]),
        "motion_debounce": ck.number("motion debounce", b["motion_debounce"], 0, 600,
                                     base["motion_debounce"]),
        "celebrate": bool(b["celebrate"]),
        **{k: ck.choice(k.replace("_", " "), b[k] or "", anim_or_none, "")
           for k in ("on_critical", "on_recover", "on_wake")},
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


def validate(raw: Any, face: Mapping[str, Any]) -> dict[str, Any]:
    """A complete, checked config from `raw`, or ConfigError listing every
    problem. Missing sections and keys take the defaults."""
    if not isinstance(raw, Mapping):
        raise ConfigError(["config must be a mapping"])
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
    }
    if not ck.errors:
        try:
            build(cfg)
        except ValueError as e:   # the dataclasses' own checks, as a last word
            ck.bad("config", str(e))
    if ck.errors:
        raise ConfigError(ck.errors)
    return cfg


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
        Signal(id=s["id"], label=s["label"], entities=tuple(s["entities"]), op=s["op"],
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
