"""Good and bad signals: does an entity's state say something is right or wrong?

PURE (no HA import), so the tests run under plain python. A signal is an
entity (or a wildcard pattern over entity ids), an operator and a value; it is
*active* when any (or all, by choice) of its entities pass the test.
"""

from __future__ import annotations

from collections.abc import Iterable, Mapping
from dataclasses import dataclass, field
from fnmatch import fnmatchcase
from typing import Any

OPERATORS = ("above", "below", "is", "is_not")
KINDS = ("bad", "good")
SEVERITIES = ("minor", "major", "critical")

# States that say "no reading", which never make a signal active: a sensor
# that has dropped off the network is not a dry plant. Whether "unavailable"
# should itself be bad is the user's call, by a signal with op "is".
NO_READING = frozenset({"unknown", "unavailable", "none", ""})

_ON = frozenset({"on", "true", "yes", "home", "open", "detected", "1"})
_OFF = frozenset({"off", "false", "no", "not_home", "closed", "clear", "0"})


@dataclass(frozen=True)
class Signal:
    id: str
    name: str
    entities: tuple[str, ...]
    op: str = "is"
    value: Any = "on"
    kind: str = "bad"
    severity: str = "major"
    weight: float | None = None   # overrides the severity's weight when set
    screen: str | None = None
    match: str = "any"            # "any" or "all" of the matched entities
    enabled: bool = True          # a disabled signal is kept but never active

    def __post_init__(self) -> None:
        if self.op not in OPERATORS:
            raise ValueError(f"signal {self.id}: unknown operator {self.op!r}")
        if self.kind not in KINDS:
            raise ValueError(f"signal {self.id}: unknown kind {self.kind!r}")
        if self.severity not in SEVERITIES:
            raise ValueError(f"signal {self.id}: unknown severity {self.severity!r}")
        if self.match not in ("any", "all"):
            raise ValueError(f"signal {self.id}: match must be 'any' or 'all'")


@dataclass(frozen=True)
class SignalResult:
    signal: Signal
    active: bool
    entities: tuple[str, ...] = field(default=())   # the ones passing the test


def _number(v: Any) -> float | None:
    try:
        return float(v)
    except (TypeError, ValueError):
        return None


def _truthy(v: Any) -> bool | None:
    s = str(v).strip().lower()
    if s in _ON:
        return True
    if s in _OFF:
        return False
    return None


def compare(state: Any, op: str, value: Any) -> bool:
    """Whether one state passes `op value`. Numbers compare as numbers, on/off
    words as booleans (so "is on" matches a door's "open"), anything else as
    case-insensitive text. No reading never passes."""
    s = "" if state is None else str(state).strip()
    if s.lower() in NO_READING:
        return False
    if op in ("above", "below"):
        a, b = _number(s), _number(value)
        if a is None or b is None:
            return False
        return a > b if op == "above" else a < b
    a, b = _number(s), _number(value)
    if a is not None and b is not None:
        same = a == b
    else:
        ta, tb = _truthy(s), _truthy(value)
        same = ta == tb if ta is not None and tb is not None else s.lower() == str(value).strip().lower()
    return same if op == "is" else not same


def is_pattern(entity: str) -> bool:
    return any(c in entity for c in "*?[")


def matching(patterns: Iterable[str], entity_ids: Iterable[str]) -> list[str]:
    """The entity ids named by `patterns`, where a pattern may use * ? [..]."""
    ids = list(entity_ids)
    out: list[str] = []
    for p in patterns:
        if is_pattern(p):
            out.extend(e for e in ids if fnmatchcase(e, p) and e not in out)
        elif p not in out:
            out.append(p)
    return out


def evaluate(signal: Signal, states: Mapping[str, Any]) -> SignalResult:
    """`signal` against `states` (entity id -> state string). Entities named
    but missing from `states` count as no reading."""
    if not signal.enabled:
        return SignalResult(signal, False)
    names = matching(signal.entities, states.keys())
    passing = tuple(e for e in names if compare(states.get(e), signal.op, signal.value))
    if signal.match == "all":
        active = bool(names) and len(passing) == len(names)
    else:
        active = bool(passing)
    return SignalResult(signal, active, passing)


def evaluate_all(signals: Iterable[Signal], states: Mapping[str, Any]) -> list[SignalResult]:
    return [evaluate(s, states) for s in signals]


def watches(signal: Signal, entity_id: str) -> bool:
    """Whether a change to `entity_id` could change `signal`."""
    return any(fnmatchcase(entity_id, p) if is_pattern(p) else entity_id == p
               for p in signal.entities)
