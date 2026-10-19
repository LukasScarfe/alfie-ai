"""From active signals to one mood: a level, an expression and an energy.

PURE (no HA import). How signals combine is the user's choice:

  weighted  bad severities subtract their weight, good signals add theirs,
            and the score falls into a level by thresholds;
  count     each good signal cancels one bad, and what is left sets the level;
  worst     a priority ladder: the worst active signal alone sets the level.
"""

from __future__ import annotations

from collections.abc import Mapping, Sequence
from dataclasses import dataclass, field

from .signals import SignalResult

LEVELS = ("miserable", "sad", "uneasy", "content", "bubbly")   # worst to best
COMBINE_MODES = ("worst", "weighted", "count")
SEVERITY_RANK = {"minor": 0, "major": 1, "critical": 2}

DEFAULT_WEIGHTS = {"minor": 1.0, "major": 2.0, "critical": 5.0, "good": 1.0}
# A score at or above a level's threshold reaches it; below the last is miserable.
DEFAULT_THRESHOLDS = {"bubbly": 1.0, "content": -0.5, "uneasy": -2.0, "sad": -4.0}
# For "count": the net (good - bad) that reaches each level.
DEFAULT_COUNT_THRESHOLDS = {"bubbly": 1, "content": 0, "uneasy": -1, "sad": -2}
# For "worst": the level the worst active bad severity gives.
DEFAULT_LADDER = {"minor": "uneasy", "major": "uneasy", "critical": "miserable"}
DEFAULT_EXPRESSIONS = {"bubbly": "happy", "content": "neutral", "uneasy": "skeptical",
                       "sad": "sad", "miserable": "alarmed"}
DEFAULT_ENERGY = {"bubbly": 1.0, "content": 0.8, "uneasy": 0.55, "sad": 0.35, "miserable": 0.2}


@dataclass(frozen=True)
class MoodSettings:
    combine: str = "worst"
    weights: Mapping[str, float] = field(default_factory=lambda: dict(DEFAULT_WEIGHTS))
    thresholds: Mapping[str, float] = field(default_factory=lambda: dict(DEFAULT_THRESHOLDS))
    count_thresholds: Mapping[str, int] = field(
        default_factory=lambda: dict(DEFAULT_COUNT_THRESHOLDS))
    ladder: Mapping[str, str] = field(default_factory=lambda: dict(DEFAULT_LADDER))
    expressions: Mapping[str, str] = field(default_factory=lambda: dict(DEFAULT_EXPRESSIONS))
    energy: Mapping[str, float] = field(default_factory=lambda: dict(DEFAULT_ENERGY))

    def __post_init__(self) -> None:
        if self.combine not in COMBINE_MODES:
            raise ValueError(f"unknown combine mode {self.combine!r}")


@dataclass(frozen=True)
class Mood:
    level: str
    score: float
    expression: str
    energy: float
    bad: tuple[SignalResult, ...]
    good: tuple[SignalResult, ...]

    @property
    def reason(self) -> str:
        """One line on why: the worst thing wrong, else the best thing right."""
        if self.bad:
            worst = self.bad[0].signal.name
            more = len(self.bad) - 1
            return worst + (f" (and {more} more)" if more else "")
        if self.good:
            return self.good[0].signal.name
        return "All's well."


def _weight(r: SignalResult, weights: Mapping[str, float]) -> float:
    s = r.signal
    if s.weight is not None:
        return s.weight
    return weights.get("good" if s.kind == "good" else s.severity, 1.0)


def _by_thresholds(score: float, thresholds: Mapping[str, float]) -> str:
    for level in ("bubbly", "content", "uneasy", "sad"):
        if score >= thresholds[level]:
            return level
    return "miserable"


def combine(results: Sequence[SignalResult], settings: MoodSettings | None = None) -> Mood:
    st = settings or MoodSettings()
    active = [r for r in results if r.active]
    bad = sorted((r for r in active if r.signal.kind == "bad"),
                 key=lambda r: -SEVERITY_RANK[r.signal.severity])
    good = [r for r in active if r.signal.kind == "good"]

    if st.combine == "weighted":
        score = sum(_weight(r, st.weights) for r in good) - sum(_weight(r, st.weights) for r in bad)
        level = _by_thresholds(score, st.thresholds)
    elif st.combine == "count":
        score = float(len(good) - len(bad))
        level = _by_thresholds(score, st.count_thresholds)
    else:
        if bad:
            level = st.ladder[bad[0].signal.severity]
            score = -float(SEVERITY_RANK[bad[0].signal.severity] + 1)
        elif good:
            level, score = "bubbly", 1.0
        else:
            level, score = "content", 0.0

    return Mood(level=level, score=score, expression=st.expressions[level],
                energy=st.energy[level], bad=tuple(bad), good=tuple(good))
