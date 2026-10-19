"""The history provider: recorder history of a plot screen's entities, bucketed.

The reading and averaging are pure functions (`bucketize`, `to_samples`,
`stats_samples`), tested without Home Assistant; `HistoryProvider.fetch` is the
thin part that talks to the recorder, in the recorder's executor. Cards never
read history themselves: one server-side read per screen per ttl, and only the
small bucketed arrays travel (docs/screens-contract.md "Providers").
"""

from __future__ import annotations

import hashlib
import json
import math
import time
from datetime import datetime, timedelta, timezone
from typing import Any

from . import Provider, register

MAX_BUCKETS = 60
STATS_FROM_HOURS = 240        # spans over 10 days use long-term statistics when they exist
MIN_TTL, MAX_TTL = 900.0, 21600.0

Sample = tuple[float, "float | None"]   # (epoch s, value in force from then on; None = no data)


def number(state: Any) -> float | None:
    """A state string as a finite number, or None (unavailable, unknown, text)."""
    try:
        v = float(state)
    except (TypeError, ValueError):
        return None
    return v if math.isfinite(v) else None


COMBINE = ("mean", "max", "min", "last")


def bucketize(samples: list[Sample], start: float, end: float, buckets: int,
              combine: str = "mean") -> list[float | None]:
    """`buckets` values of a step function over [start, end), one per bucket.

    Each sample holds its value until the next one (the last until `end`), so a
    sensor that only reports on change still fills the buckets it sat steady
    through. Time with no data (None samples, or before the first sample) does
    not count; a bucket with none at all is None. `combine` says what a bucket
    holds: the time-weighted mean, the highest or lowest value it saw, or the
    value in force at its end. All but the mean are values the sensor really
    had, so a count stays a whole number.
    """
    buckets = max(1, min(int(buckets), MAX_BUCKETS))
    width = (end - start) / buckets
    if width <= 0:
        return [None] * buckets
    total = [0.0] * buckets      # sum of value * seconds
    secs = [0.0] * buckets       # seconds with data
    pick: list[float | None] = [None] * buckets   # max, min or last
    pts = sorted(samples, key=lambda s: s[0])
    for i, (ts, v) in enumerate(pts):
        if v is None:
            continue
        a = max(ts, start)
        b = min(pts[i + 1][0] if i + 1 < len(pts) else end, end)
        if b <= a:
            continue
        k0 = min(buckets - 1, int((a - start) / width))
        k1 = min(buckets - 1, int((b - start) / width))
        for k in range(k0, k1 + 1):
            lo, hi = max(a, start + k * width), min(b, start + (k + 1) * width)
            if hi > lo:
                total[k] += v * (hi - lo)
                secs[k] += hi - lo
                p = pick[k]
                if p is None or combine == "last" or (combine == "max" and v > p) or (combine == "min" and v < p):
                    pick[k] = v
    if combine in ("max", "min", "last"):
        return pick
    return [round(total[k] / secs[k], 2) if secs[k] > 1e-9 else None for k in range(buckets)]


def to_samples(states: list[Any]) -> list[Sample]:
    """Recorder State objects (oldest first) as samples. Anything that is not a
    number (unavailable, unknown) becomes a gap."""
    return [(s.last_changed.timestamp(), number(s.state)) for s in states]


def stats_samples(rows: list[dict], period: float = 3600.0, field: str = "mean") -> list[Sample]:
    """Hourly statistics rows ({"start", "mean", ...}) as samples: each row's
    `field` holds for its period, and a missing hour is a gap."""
    out: list[Sample] = []
    last_end = None
    for r in rows:
        s = r["start"]
        s = s.timestamp() if isinstance(s, datetime) else float(s)
        if last_end is not None and s - last_end > 1:
            out.append((last_end, None))
        out.append((s, number(r.get(field))))
        last_end = s + period
    if last_end is not None:
        out.append((last_end, None))
    return out


def ttl_for(hours: float, buckets: int) -> float:
    """Refresh about twice per bucket width: a day in 60 buckets every 15 min,
    two weeks in 56 every 3 h."""
    width = float(hours) * 3600 / max(1, min(int(buckets), MAX_BUCKETS))
    return min(MAX_TTL, max(MIN_TTL, width / 2))


@register("history")
class HistoryProvider(Provider):
    ttl = MIN_TTL

    async def get(self, hass: Any, screen: dict) -> dict:
        # Same as the base, but the ttl scales with the span.
        o = screen.get("options") or {}
        ttl = ttl_for(o.get("hours") or 72, o.get("buckets") or 36)
        opts = json.dumps(o, sort_keys=True, default=str)
        key = (screen["id"], hashlib.sha1(opts.encode()).hexdigest()[:12])
        res = await self.cache.get(key, ttl, lambda: self.fetch(hass, screen))
        return {**res, "at": res["at"] if res["at"] is not None else time.time()}

    async def fetch(self, hass: Any, screen: dict) -> dict:
        o = screen.get("options") or {}
        entities = [e for e in (o.get("entities") or []) if isinstance(e, str)][:6]
        hours = max(1.0, float(o.get("hours") or 72))
        buckets = max(2, min(int(o.get("buckets") or 36), MAX_BUCKETS))
        combine = o.get("combine") if o.get("combine") in COMBINE else "mean"
        # Hourly statistics have no "last"; the mean stands in for it.
        field = combine if combine in ("max", "min") else "mean"
        if not entities:
            raise ValueError("no entities chosen")
        if "recorder" not in hass.config.components:
            raise RuntimeError("the recorder is not set up")
        end = datetime.now(timezone.utc)
        start = end - timedelta(hours=hours)
        # Imported here: the recorder is optional and its import is heavy.
        from homeassistant.components.recorder import get_instance, history, statistics

        def read() -> dict[str, list[Sample]]:
            out: dict[str, list[Sample]] = {}
            stats: dict[str, list] = {}
            if hours > STATS_FROM_HOURS:
                stats = statistics.statistics_during_period(
                    hass, start, end, set(entities), "hour", None, {field})
            for e in entities:
                if stats.get(e):
                    out[e] = stats_samples(stats[e], field=field)
                    continue
                got = history.state_changes_during_period(
                    hass, start, end, entity_id=e, no_attributes=True,
                    include_start_time_state=True).get(e, [])
                out[e] = to_samples(got)
            return out

        samples = await get_instance(hass).async_add_executor_job(read)
        t0, t1 = start.timestamp(), end.timestamp()
        series = []
        for e in entities:
            st = hass.states.get(e)
            attrs = st.attributes if st else {}
            series.append({
                "entity_id": e,
                "name": attrs.get("friendly_name") or e.split(".", 1)[1].replace("_", " "),
                "unit": attrs.get("unit_of_measurement") or "",
                "values": bucketize(samples.get(e, []), t0, t1, buckets, combine),
            })
        return {"series": series, "start": t0, "end": t1}
