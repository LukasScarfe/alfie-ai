"""Triggers: when Alfie plays a story.

PURE (no HA import), so the tests run under plain python. A trigger is one
of these kinds, plus the story it plays and how it behaves when Alfie is busy:

  entity  an entity (or pattern) starts passing a test, or simply changes
  motion  a motion sensor turns on (optionally only while something is wrong)
  mood    the mood level changes (worse, better, or either; from / to levels)
  signal  a signal goes bad or recovers (any signal, or chosen ones)
  wake    Alfie wakes up or falls asleep
  mode    a house mode starts or ends (modes.py), e.g. leaving away: a welcome

An entity trigger's above / below value is a number or another entity (an
input_number, a sensor), whose state is the threshold, read when it is checked.

Entity and motion triggers are fed from the engine's one filtered listener;
the rest are checked in its mood recompute, which already knows what moved.
When several fire on the same change, only the highest priority plays.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from fnmatch import fnmatchcase
from typing import Any

from .mood import LEVELS
from .signals import OPERATORS, compare, is_pattern

KINDS = ("entity", "motion", "mood", "signal", "wake", "mode")
BUSY = ("auto", "queue", "interrupt", "skip")
ENTITY_OPS = ("changes", *OPERATORS)
DIRECTIONS = ("worse", "better", "any")
SIGNAL_EDGES = ("goes_bad", "recovers", "either")
WAKE_EDGES = ("wakes", "sleeps")
MODE_EDGES = ("enter", "leave", "either")


def kind_fields(kind: str) -> dict[str, Any]:
    """The fields only `kind` has, with their defaults, in stored order."""
    return {
        "entity": {"entities": [], "op": "changes", "value": ""},
        "motion": {"entities": [], "only_if_bad": False},
        "mood": {"direction": "any", "from": [], "to": []},
        "signal": {"signals": [], "edge": "recovers"},
        "wake": {"edge": "wakes"},
        "mode": {"modes": [], "edge": "enter"},
    }[kind]


def default_trigger(kind: str = "entity") -> dict[str, Any]:
    return {"id": "", "name": "", "enabled": True, "kind": kind, "story": "",
            "priority": 50, "busy": "auto", "cooldown": 0, "while_asleep": False,
            "moods": [], **kind_fields(kind)}


# ---------------------------------------------------------------- validating

def _num(x: float) -> int | float:
    return int(x) if float(x).is_integer() else x


def _slug(v: Any) -> bool:
    return isinstance(v, str) and v != "" and all(c.islower() or c.isdigit() or c == "_"
                                                  for c in v)


def _strings(v: Any) -> list[str]:
    if isinstance(v, str):
        v = [v]
    if not isinstance(v, list):
        return []
    out: list[str] = []
    for x in v:
        x = str(x).strip()
        if x and x not in out:
            out.append(x)
    return out


def _value(v: Any) -> Any:
    if isinstance(v, bool):
        return "on" if v else "off"
    if isinstance(v, (int, float)):
        return v
    return "" if v is None else str(v).strip()


def is_entity_id(v: Any) -> bool:
    """`domain.object_id`, as HA writes entity ids."""
    if not isinstance(v, str) or v.count(".") != 1:
        return False
    a, b = v.split(".")
    return _slug(a) and _slug(b)


def threshold_entity(trigger: Mapping[str, Any]) -> str | None:
    """The entity an above / below trigger takes its threshold from, if any."""
    if trigger.get("kind") != "entity" or trigger.get("op") not in ("above", "below"):
        return None
    v = trigger.get("value")
    return v if is_entity_id(v) else None


def validate_triggers(raw: Any, ck: Any, story_ids: set[str], signal_ids: set[str],
                      mode_ids: set[str] | None = None) -> list[dict[str, Any]]:
    """Checked triggers from `raw`; problems go to `ck` (config._Check)."""
    if not isinstance(raw, list):
        ck.bad("triggers", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, t in enumerate(raw):
        where = f"trigger {i + 1}"
        if not isinstance(t, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        tid = str(t.get("id") or "").strip()
        if not _slug(tid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"trigger {tid}"
        if tid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(tid)
        kind = ck.choice(f"{where} kind", t.get("kind", "entity"), KINDS, None)
        if kind is None:
            continue
        base = default_trigger(kind)
        d = {**base, **{k: v for k, v in t.items() if k in base}}
        story = str(d["story"] or "").strip()
        if story not in story_ids:
            ck.bad(where, f"story {story!r} does not exist")
        out_t: dict[str, Any] = {
            "id": tid,
            "name": str(d["name"] or "").strip() or tid,
            "enabled": bool(d["enabled"]),
            "kind": kind,
            "story": story,
            "priority": int(ck.number(f"{where} priority", d["priority"], 0, 100, 50)),
            "busy": ck.choice(f"{where} when busy", d["busy"], BUSY, "auto"),
            "cooldown": _num(ck.number(f"{where} cooldown", d["cooldown"], 0, 86400, 0)),
            "while_asleep": bool(d["while_asleep"]),
            "moods": ck.names(f"{where} only while", d["moods"], LEVELS),
        }
        if kind in ("entity", "motion"):
            out_t["entities"] = _strings(d["entities"])
            if not out_t["entities"]:
                ck.bad(where, "needs at least one entity or pattern")
        if kind == "entity":
            out_t["op"] = ck.choice(f"{where} operator", d["op"], ENTITY_OPS, "changes")
            out_t["value"] = _value(d["value"])
            if out_t["op"] in ("above", "below") and not isinstance(out_t["value"], (int, float)) \
                    and not is_entity_id(out_t["value"]):
                try:
                    out_t["value"] = float(out_t["value"])
                except ValueError:
                    ck.bad(where, f"'{out_t['op']}' needs a number or an entity")
        elif kind == "motion":
            out_t["only_if_bad"] = bool(d["only_if_bad"])
        elif kind == "mood":
            out_t["direction"] = ck.choice(f"{where} direction", d["direction"], DIRECTIONS,
                                           "any")
            out_t["from"] = ck.names(f"{where} from", d["from"], LEVELS)
            out_t["to"] = ck.names(f"{where} to", d["to"], LEVELS)
        elif kind == "signal":
            out_t["signals"] = _strings(d["signals"])
            for s in out_t["signals"]:
                if s not in signal_ids:
                    ck.bad(where, f"signal {s!r} does not exist")
            out_t["edge"] = ck.choice(f"{where} edge", d["edge"], SIGNAL_EDGES, "recovers")
        elif kind == "mode":
            out_t["modes"] = _strings(d["modes"])
            for m in out_t["modes"]:
                if mode_ids is not None and m not in mode_ids:
                    ck.bad(where, f"mode {m!r} does not exist")
            out_t["edge"] = ck.choice(f"{where} edge", d["edge"], MODE_EDGES, "enter")
        else:
            out_t["edge"] = ck.choice(f"{where} edge", d["edge"], WAKE_EDGES, "wakes")
        out.append(out_t)
    return out


# ------------------------------------------------------------------ matching

def watches(trigger: Mapping[str, Any], entity_id: str) -> bool:
    """Whether a change to `entity_id` could fire this entity or motion trigger."""
    if trigger["kind"] not in ("entity", "motion") or not trigger["enabled"]:
        return False
    return any(fnmatchcase(entity_id, p) if is_pattern(p) else entity_id == p
               for p in trigger["entities"])


def watches_threshold(trigger: Mapping[str, Any], entity_id: str) -> bool:
    return bool(trigger["enabled"]) and threshold_entity(trigger) == entity_id


def entity_fires(trigger: Mapping[str, Any], old: str | None, new: str | None,
                 limit: Any = None, old_limit: Any = None) -> bool:
    """An entity or motion trigger on one state change (states as strings,
    None when the entity appeared or went away). Edges only: a test that was
    already passing doesn't fire again. A threshold entity's states are
    `limit` (now) and `old_limit` (before; the same unless the threshold is
    what moved). With no readable threshold the trigger can't fire."""
    if new is None:
        return False
    if trigger["kind"] == "motion":
        return compare(new, "is", "on") and not (old is not None and compare(old, "is", "on"))
    if trigger["op"] == "changes":
        return old is not None and old != new
    value = trigger["value"]
    if threshold_entity(trigger):
        if limit is None:
            return False
        value, before = limit, limit if old_limit is None else old_limit
    else:
        before = value
    was = old is not None and compare(old, trigger["op"], before)
    return compare(new, trigger["op"], value) and not was


def mood_fires(trigger: Mapping[str, Any], old: str, new: str) -> bool:
    if old == new:
        return False
    worse = LEVELS.index(new) < LEVELS.index(old)     # LEVELS runs worst to best
    d = trigger["direction"]
    if (d == "worse" and not worse) or (d == "better" and worse):
        return False
    if trigger["from"] and old not in trigger["from"]:
        return False
    return not (trigger["to"] and new not in trigger["to"])


def signal_fires(trigger: Mapping[str, Any], went_bad: set[str],
                 recovered: set[str]) -> list[str]:
    """The signal ids that fire this trigger (none: it doesn't fire)."""
    edge = trigger["edge"]
    moved = (went_bad if edge in ("goes_bad", "either") else set()) | \
        (recovered if edge in ("recovers", "either") else set())
    if trigger["signals"]:
        moved &= set(trigger["signals"])
    return sorted(moved)


def wake_fires(trigger: Mapping[str, Any], woke: bool, slept: bool) -> bool:
    return woke if trigger["edge"] == "wakes" else slept


def mode_fires(trigger: Mapping[str, Any], old: str, new: str) -> bool:
    """A mode trigger when the mode goes from `old` to `new` ("normal": none).
    With no modes chosen, any real mode entering or leaving fires it."""
    if old == new:
        return False
    picked = trigger["modes"]
    hit = (lambda m: m in picked) if picked else (lambda m: m != "normal")
    edge = trigger["edge"]
    return (edge in ("enter", "either") and hit(new)) or (edge in ("leave", "either") and hit(old))


def allowed(trigger: Mapping[str, Any], level: str, asleep: bool) -> bool:
    """The conditions every kind shares: enabled, awake (unless allowed),
    and the mood in the "only while" list when there is one."""
    if not trigger["enabled"]:
        return False
    if asleep and not trigger["while_asleep"]:
        return False
    return not (trigger["moods"] and level not in trigger["moods"])


def choose(fired: Sequence[Mapping[str, Any]]) -> Mapping[str, Any] | None:
    """One change plays one story: the highest priority, the first on a tie."""
    best = None
    for t in fired:
        if best is None or t["priority"] > best["priority"]:
            best = t
    return best


def busy_action(busy: str, priority: int, playing: int | None) -> str:
    """What a firing does while a story of priority `playing` plays (None:
    nothing is playing): "play", "interrupt", "queue" or "skip"."""
    if playing is None:
        return "play"
    if busy == "auto":
        return "interrupt" if priority > playing else "queue"
    return busy
