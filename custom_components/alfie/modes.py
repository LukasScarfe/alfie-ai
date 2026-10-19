"""House modes: what kind of time it is in the house, and how Alfie behaves.

PURE (no HA import), so the tests run under plain python. Modes are an
ordered list; the first enabled one whose condition holds is the mode (one
at a time). A mode with no condition is only ever picked by hand, through
select.alfie_mode. Each mode overrides:

  alfie         awake, asleep (only `wake` severity wakes him), quiet (no
                fidgets or glances, calmer) or hidden (cards draw nothing)
  bad news      hold back signals at or below a severity; a mood floor or a
                fixed mood
  personality   a preset, energy bias and fidget rate
  rotation      another rotation for rotation cards, or pause
  triggers      ones that are off in the mode

A condition is a signals.Signal underneath, so it takes patterns, match
any/all and the same operators as signals.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from typing import Any

from .mood import LEVELS
from .signals import OPERATORS, SEVERITIES, Signal, SignalResult, evaluate

NORMAL = "normal"                 # no mode: what Alfie is without one
AUTO = "auto"                     # select.alfie_mode: follow the conditions
ALFIE_STATES = ("awake", "asleep", "quiet", "hidden")
WAKES = ("critical", "major", "never")
HOLD_BACKS = ("none", "minor", "major")
QUIET_ENERGY = 0.6                # quiet scales his energy by this
PAUSE = "pause"                   # a mode's rotation: hold the card's current step


def default_mode() -> dict[str, Any]:
    return {"id": "", "name": "", "enabled": True, "condition": None,
            "alfie": "awake", "wake": "critical", "hold_back": "none",
            "mood_floor": "", "mood_fixed": "",
            "personality": "", "energy_bias": None, "fidget_rate": None,
            "rotation": "", "triggers_off": []}


def default_condition() -> dict[str, Any]:
    return {"entities": [], "match": "any", "op": "is", "value": "on"}


# ---------------------------------------------------------------- validating

def _slug(v: Any) -> bool:
    return isinstance(v, str) and v != "" and all(c.islower() or c.isdigit() or c == "_"
                                                  for c in v)


def _num(x: float) -> int | float:
    return int(x) if float(x).is_integer() else x


def _strings(v: Any) -> list[str]:
    if isinstance(v, str):
        v = [v]
    out: list[str] = []
    for x in v if isinstance(v, list) else []:
        x = str(x).strip()
        if x and x not in out:
            out.append(x)
    return out


def _value(v: Any) -> Any:
    if isinstance(v, bool):
        return "on" if v else "off"
    if isinstance(v, (int, float)):
        return v
    s = "" if v is None else str(v).strip()
    try:
        return _num(float(s)) if s else s
    except ValueError:
        return s


def mode_ids(raw: Any) -> set[str]:
    """The ids `raw` modes will have, for checking references before them."""
    return {str(m.get("id") or "").strip() for m in raw if isinstance(m, Mapping)} \
        if isinstance(raw, list) else set()


def validate_modes(raw: Any, ck: Any, presets: Sequence[str],
                   rotation_ids: set[str]) -> list[dict[str, Any]]:
    """Checked modes from `raw`; problems go to `ck` (config._Check). Their
    triggers_off are checked by the caller, once the triggers are known."""
    if not isinstance(raw, list):
        ck.bad("modes", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, m in enumerate(raw):
        where = f"mode {i + 1}"
        if not isinstance(m, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        mid = str(m.get("id") or "").strip()
        if not _slug(mid) or mid in (NORMAL, AUTO):
            ck.bad(where, "id must be lower-case letters, digits and _ (not normal or auto)")
            continue
        where = f"mode {mid}"
        if mid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(mid)
        d = {**default_mode(), **{k: v for k, v in m.items() if k in default_mode()}}
        cond = None
        if isinstance(d["condition"], Mapping):
            c = {**default_condition(), **d["condition"]}
            cond = {"entities": _strings(c["entities"]),
                    "match": ck.choice(f"{where} match", c["match"], ("any", "all"), "any"),
                    "op": ck.choice(f"{where} operator", c["op"], OPERATORS, "is"),
                    "value": _value(c["value"])}
            if not cond["entities"]:
                ck.bad(where, "its condition needs an entity (or no condition: picked by hand)")
            if cond["op"] in ("above", "below") and not isinstance(cond["value"], (int, float)):
                ck.bad(where, f"'{cond['op']}' needs a number")
        rot = str(d["rotation"] or "").strip()
        if rot and rot != PAUSE and rot not in rotation_ids:
            ck.bad(where, f"rotation {rot!r} does not exist")

        def opt(key: str, lo: float, hi: float) -> int | float | None:
            v = d[key]
            if v is None or v == "":
                return None
            n = ck.number(f"{where} {key.replace('_', ' ')}", v, lo, hi, None)
            return None if n is None else _num(n)

        out.append({
            "id": mid,
            "name": str(d["name"] or "").strip() or mid,
            "enabled": bool(d["enabled"]),
            "condition": cond,
            "alfie": ck.choice(f"{where} alfie", d["alfie"], ALFIE_STATES, "awake"),
            "wake": ck.choice(f"{where} wake", d["wake"], WAKES, "critical"),
            "hold_back": ck.choice(f"{where} hold back", d["hold_back"], HOLD_BACKS, "none"),
            "mood_floor": ck.choice(f"{where} mood floor", d["mood_floor"] or "", ("", *LEVELS), ""),
            "mood_fixed": ck.choice(f"{where} mood", d["mood_fixed"] or "", ("", *LEVELS), ""),
            "personality": ck.choice(f"{where} personality", d["personality"] or "",
                                     ("", *presets), ""),
            "energy_bias": opt("energy_bias", -0.5, 0.5),
            "fidget_rate": opt("fidget_rate", 0, 4),
            "rotation": rot,
            "triggers_off": _strings(d["triggers_off"]),
        })
    return out


# ------------------------------------------------------------------ choosing

def condition_signal(mode: Mapping[str, Any]) -> Signal | None:
    """A mode's condition as a signal (for evaluate and watches)."""
    c = mode.get("condition")
    if not c or not c["entities"]:
        return None
    return Signal(id=f"mode:{mode['id']}", name=mode["name"], entities=tuple(c["entities"]),
                  op=c["op"], value=c["value"], kind="good", severity="minor",
                  match=c["match"])


def choose(modes: Sequence[Mapping[str, Any]], states: Mapping[str, Any],
           picked: str = AUTO) -> tuple[Mapping[str, Any] | None, SignalResult | None]:
    """The mode now and the condition result that chose it. `picked` is
    select.alfie_mode: auto follows the conditions, normal is no mode, and
    a mode id forces that mode (an unknown one falls back to auto)."""
    if picked == NORMAL:
        return None, None
    if picked != AUTO:
        for m in modes:
            if m["id"] == picked:
                return m, None
    for m in modes:
        if not m["enabled"]:
            continue
        sig = condition_signal(m)
        if sig is None:
            continue
        r = evaluate(sig, states)
        if r.active:
            return m, r
    return None, None


# ------------------------------------------------------------------ applying

def held_back(mode: Mapping[str, Any] | None, severity: str) -> bool:
    """Whether a bad signal of `severity` is ignored in `mode`."""
    if not mode or mode["hold_back"] == "none":
        return False
    return SEVERITIES.index(severity) <= SEVERITIES.index(mode["hold_back"])


def mood_level(mode: Mapping[str, Any] | None, level: str) -> str:
    """The mood level after a mode's fixed mood or floor (LEVELS: worst first)."""
    if not mode:
        return level
    if mode["mood_fixed"]:
        return mode["mood_fixed"]
    if mode["mood_floor"] and LEVELS.index(level) < LEVELS.index(mode["mood_floor"]):
        return mode["mood_floor"]
    return level


def wakes(mode: Mapping[str, Any] | None, severities: Sequence[str]) -> bool:
    """Whether the active bad signals' severities wake him in an asleep mode."""
    w = mode["wake"] if mode else "critical"
    if w == "never":
        return False
    return any(SEVERITIES.index(s) >= SEVERITIES.index(w) for s in severities)


def personality(mode: Mapping[str, Any] | None, base: Mapping[str, float],
                presets: Mapping[str, Mapping[str, float]]) -> dict[str, float]:
    """The personality in `mode`: its preset over the base, then its sliders."""
    out = dict(base)
    if not mode:
        return out
    if mode["personality"]:
        out.update({k: float(v) for k, v in presets.get(mode["personality"], {}).items()
                    if k in out})
    for k in ("energy_bias", "fidget_rate"):
        if mode[k] is not None:
            out[k] = float(mode[k])
    return out

