"""The history provider's pure parts, and its fetch against a fake hass."""
import asyncio
import sys
import types
from datetime import datetime, timezone

import pytest

from alfie.providers import history as H


def test_steady_sensor_fills_every_bucket():
    # One reading at the start holds for the whole span.
    assert H.bucketize([(0, 10.0)], 0, 100, 4) == [10.0] * 4


def test_time_weighted_mean():
    # 10 for the first 25 s of the bucket, 20 for the other 75 s.
    out = H.bucketize([(0, 10.0), (25, 20.0)], 0, 100, 1)
    assert out == [17.5]


def test_gap_and_unavailable_are_null():
    s = [(30, 5.0), (50, None), (75, 7.0)]
    out = H.bucketize(s, 0, 100, 4)       # buckets of 25 s
    assert out[0] is None and out[1] == 5.0 and out[2] is None and out[3] == 7.0


def test_partial_bucket_ignores_unavailable_time():
    # Bucket 0 is 10 for 10 s, unavailable for 10 s: mean stays 10, not 5.
    assert H.bucketize([(0, 10.0), (10, None), (20, 30.0)], 0, 40, 2) == [10.0, 30.0]


def test_samples_outside_the_span():
    # A start state long before the window, and a sample after it.
    assert H.bucketize([(-500, 3.0), (200, 9.0)], 0, 100, 2) == [3.0, 3.0]


def test_bucket_count_clamped_and_empty():
    assert len(H.bucketize([], 0, 10, 500)) == H.MAX_BUCKETS
    assert H.bucketize([], 0, 10, 3) == [None, None, None]
    assert H.bucketize([(0, 1.0)], 5, 5, 3) == [None, None, None]


def test_unsorted_input():
    assert H.bucketize([(50, 2.0), (0, 1.0)], 0, 100, 2) == [1.0, 2.0]


def test_number():
    assert H.number("12.5") == 12.5
    for bad in ("unavailable", "unknown", None, "", "nan", "inf", "on"):
        assert H.number(bad) is None


def test_to_samples():
    class S:
        def __init__(self, t, state):
            self.last_changed, self.state = datetime.fromtimestamp(t, timezone.utc), state
    assert H.to_samples([S(10, "4"), S(20, "unavailable")]) == [(10.0, 4.0), (20.0, None)]


def test_stats_samples_mark_missing_hours():
    rows = [{"start": 0.0, "mean": 1.0}, {"start": 3600.0, "mean": 2.0}, {"start": 10800.0, "mean": 3.0}]
    s = H.stats_samples(rows)
    out = H.bucketize(s, 0, 4 * 3600, 4)
    assert out == [1.0, 2.0, None, 3.0]


def test_ttl_scales_and_is_bounded():
    assert H.ttl_for(24, 60) == 900          # 12 min buckets: floor
    assert H.ttl_for(336, 56) == 336 * 3600 / 56 / 2
    assert H.ttl_for(2160, 10) == H.MAX_TTL


# -- fetch with a fake recorder -------------------------------------------------
class FakeState:
    def __init__(self, t, state):
        self.last_changed, self.state = datetime.fromtimestamp(t, timezone.utc), state


class Entity:
    def __init__(self, attributes):
        self.attributes = attributes


class Hass:
    def __init__(self, components=("recorder",)):
        self.config = types.SimpleNamespace(components=set(components))
        self.states = types.SimpleNamespace(get=lambda e: Entity(
            {"friendly_name": "Fern", "unit_of_measurement": "%"}) if e == "sensor.fern" else None)


def install_recorder(monkeypatch, states, stats=None):
    calls = {"stats": 0}
    pkg = types.ModuleType("homeassistant.components.recorder")

    class Inst:
        async def async_add_executor_job(self, fn):
            return fn()
    pkg.get_instance = lambda hass: Inst()
    hist = types.SimpleNamespace(state_changes_during_period=lambda hass, s, e, **kw: {
        kw["entity_id"]: states.get(kw["entity_id"], [])})

    def during(hass, s, e, ids, period, units, types_):
        calls["stats"] += 1
        return stats or {}
    st = types.SimpleNamespace(statistics_during_period=during)
    pkg.history, pkg.statistics = hist, st
    monkeypatch.setitem(sys.modules, "homeassistant", types.ModuleType("homeassistant"))
    monkeypatch.setitem(sys.modules, "homeassistant.components", types.ModuleType("homeassistant.components"))
    monkeypatch.setitem(sys.modules, "homeassistant.components.recorder", pkg)
    return calls


def screen(**o):
    return {"id": "p", "options": {"entities": ["sensor.fern", "sensor.x"], "hours": 24, "buckets": 6, **o}}


def test_fetch_shape(monkeypatch):
    now = datetime.now(timezone.utc).timestamp()
    install_recorder(monkeypatch, {"sensor.fern": [FakeState(now - 90000, "40"), FakeState(now - 5 * 3600, "unavailable")]})
    data = asyncio.run(H.HistoryProvider().fetch(Hass(), screen()))
    a, b = data["series"]
    assert a["entity_id"] == "sensor.fern" and a["name"] == "Fern" and a["unit"] == "%"
    assert a["values"][0] == 40.0 and a["values"][-1] is None and len(a["values"]) == 6
    assert b["name"] == "x" and b["values"] == [None] * 6      # no history, no entity
    assert data["end"] - data["start"] == pytest.approx(86400, abs=5)


def test_fetch_uses_statistics_for_long_spans_and_falls_back(monkeypatch):
    now = datetime.now(timezone.utc).timestamp()
    rows = [{"start": now - 20 * 3600, "mean": 55.0}]
    calls = install_recorder(monkeypatch, {"sensor.x": [FakeState(now - 30 * 86400, "7")]}, {"sensor.fern": rows})
    data = asyncio.run(H.HistoryProvider().fetch(Hass(), screen(hours=480, buckets=4)))
    assert calls["stats"] == 1
    assert data["series"][0]["values"] == [None, None, None, 55.0]  # statistics: one hourly row
    assert data["series"][1]["values"] == [7.0] * 4                # no statistics: from states


def test_fetch_needs_entities_and_recorder(monkeypatch):
    with pytest.raises(ValueError):
        asyncio.run(H.HistoryProvider().fetch(Hass(), {"id": "p", "options": {"entities": []}}))
    with pytest.raises(RuntimeError):
        asyncio.run(H.HistoryProvider().fetch(Hass(components=()), screen()))
