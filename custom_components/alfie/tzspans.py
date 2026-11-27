"""HA's own UTC offsets for the cards.

Browsers carry their own copy of the tz database and it lags: when a region changes its rules
(stops changing its clocks, say), a browser built on older tz data shows the old offset. HA's
zoneinfo is the authority, so the scene carries a small table of HA's offsets around now and the
cards turn epoch seconds into local time with it, falling back to the browser's Intl outside it.
"""

from __future__ import annotations

from datetime import datetime, timezone, tzinfo
from typing import Any

DAY = 86400
BACK = 400 * DAY     # plots and the sky look back; weather looks ahead
AHEAD = 400 * DAY
REFRESH = DAY        # rebuild once a day, long before the table runs out


def _offset(tz: tzinfo, t: int) -> int:
    off = datetime.fromtimestamp(t, timezone.utc).astimezone(tz).utcoffset()
    return int(off.total_seconds()) if off is not None else 0


def spans(tz: tzinfo, name: str, now: float) -> dict[str, Any]:
    """{zone, from, to, spans: [[start, offset], ...]} for [now - BACK, now + AHEAD).

    Each span runs from its start to the next one's; offsets are seconds east of UTC. Sampled
    daily (zones change offset at most a few times a year, never twice in a day), and each
    change is found to the second by bisection.
    """
    t0 = int(now) - BACK
    t1 = int(now) + AHEAD
    out = [[t0, _offset(tz, t0)]]
    t, off = t0, out[0][1]
    while t < t1:
        nxt = min(t + DAY, t1)
        o = _offset(tz, nxt)
        if o != off:
            lo, hi = t, nxt          # off at lo, o at hi
            while hi - lo > 1:
                mid = (lo + hi) // 2
                if _offset(tz, mid) == off:
                    lo = mid
                else:
                    hi = mid
            out.append([hi, o])
            off = o
        t = nxt
    return {"zone": name, "from": t0, "to": t1, "spans": out}


class TzTable:
    """The table for HA's current zone, rebuilt when the zone changes or once a day."""

    def __init__(self) -> None:
        self._key: tuple[str, int] | None = None
        self._table: dict[str, Any] | None = None

    def get(self, tz: tzinfo, name: str, now: float) -> dict[str, Any]:
        key = (name, int(now) // REFRESH)
        if key != self._key or self._table is None:
            self._table = spans(tz, name, now)
            self._key = key
        return self._table
