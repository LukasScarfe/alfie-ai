"""The forecast provider: pure parsing, fallback to daily, and the throttle."""
import asyncio
from types import SimpleNamespace

import pytest

from alfie.providers import forecast
from alfie.providers.forecast import ForecastProvider, parse_forecast

HOURLY = [
    {"datetime": "2026-10-18T10:00:00+00:00", "temperature": 12.4, "precipitation_probability": 20,
     "precipitation": 0.0, "condition": "cloudy"},
    {"datetime": "2026-10-18T11:00:00+00:00", "temperature": "13", "precipitation_probability": None,
     "precipitation": 1.26, "condition": "rainy"},
    {"datetime": "2026-10-18T12:00:00Z", "temperature": None, "condition": 7},
    "junk",
]


def test_parse_hourly():
    d = parse_forecast(HOURLY, "hourly", 24)
    assert d["type"] == "hourly" and len(d["times"]) == 3
    assert d["times"][0] == 1792317600 and d["times"][2] == 1792324800
    assert d["temp"] == [12.4, 13.0, None]
    assert d["pop"] == [20, None, None]
    assert d["precip"] == [0.0, 1.3, None]
    assert d["cond"] == ["cloudy", "rainy", None]
    assert d["low"] == []


def test_parse_limit_and_missing_probability():
    rows = [{"datetime": "2026-10-18T10:00:00+00:00", "temperature": 5, "precipitation": 0.4}] * 5
    d = parse_forecast(rows, "hourly", 2)
    assert len(d["temp"]) == 2 and d["pop"] == [] and d["precip"] == [0.4, 0.4]


def test_parse_daily_low_and_garbage():
    d = parse_forecast([{"datetime": "2026-10-19T00:00:00+00:00", "temperature": 14, "templow": 6}], "daily", 5)
    assert d["low"] == [6.0] and d["temp"] == [14.0]
    assert parse_forecast(None, "hourly", 5)["times"] == []
    assert parse_forecast([{"temperature": float("nan")}], "hourly", 5)["temp"] == [None]


class FakeHass:
    def __init__(self, hourly=HOURLY, daily=None, fail_hourly=False, fail_daily=False):
        self.calls = []
        self.st = {
            "weather.home": SimpleNamespace(state="rainy", last_updated="t0",
                                            attributes={"temperature": 11.0, "temperature_unit": "°C"}),
            "sun.sun": SimpleNamespace(state="below_horizon", last_updated="s", attributes={"elevation": -20}),
        }
        self.states = SimpleNamespace(get=self.st.get)
        self.services = SimpleNamespace(async_call=self._call)
        self.hourly, self.daily, self.fail_hourly, self.fail_daily = hourly, daily or [], fail_hourly, fail_daily

    async def _call(self, domain, service, data, blocking=False, return_response=False):
        assert (domain, service, blocking, return_response) == ("weather", "get_forecasts", True, True)
        self.calls.append(data["type"])
        if data["type"] == "hourly" and self.fail_hourly:
            raise ValueError("not supported")
        if data["type"] == "daily" and self.fail_daily:
            raise ValueError("not supported")
        return {data["entity_id"]: {"forecast": self.hourly if data["type"] == "hourly" else self.daily}}


class Clock:
    t = 1000.0

    def __call__(self):
        return self.t


def make():
    p = ForecastProvider()
    clock = Clock()
    p.clock = clock
    return p, clock


def screen(**o):
    return {"id": "w", "options": {"weather": "weather.home", "hours": 24, **o}}


def run(coro):
    return asyncio.run(coro)


def test_fetch_now_block_and_night():
    p, _ = make()
    d = run(p.fetch(FakeHass(), screen()))
    assert d["now"] == {"temperature": 11.0, "unit": "°C", "condition": "rainy", "night": True}
    assert d["type"] == "hourly" and d["unit"] == "°C"


def test_no_entity_is_an_error():
    p, _ = make()
    with pytest.raises(ValueError):
        run(p.fetch(FakeHass(), {"id": "w", "options": {}}))


def test_falls_back_to_daily():
    daily = [{"datetime": "2026-10-19T00:00:00+00:00", "temperature": 14, "templow": 6}]
    h = FakeHass(daily=daily, fail_hourly=True)
    p, _ = make()
    d = run(p.fetch(h, screen()))
    assert h.calls == ["hourly", "daily"] and d["type"] == "daily" and d["low"] == [6.0]


def test_daily_failure_raises():
    h = FakeHass(fail_hourly=True, fail_daily=True)
    p, _ = make()
    with pytest.raises(RuntimeError):
        run(p.fetch(h, screen(forecast="daily")))


def test_throttle():
    h = FakeHass()
    p, clock = make()
    run(p.fetch(h, screen()))
    clock.t += 30
    run(p.fetch(h, screen()))
    assert len(h.calls) == 1                      # cached
    h.st["weather.home"].last_updated = "t1"
    clock.t += 30
    run(p.fetch(h, screen()))
    assert len(h.calls) == 1                      # changed, but under MIN_GAP
    clock.t += forecast.MIN_GAP
    run(p.fetch(h, screen()))
    assert len(h.calls) == 2                      # changed and past MIN_GAP
    clock.t += forecast.MAX_AGE - 1
    run(p.fetch(h, screen()))
    assert len(h.calls) == 2
    clock.t += 2
    run(p.fetch(h, screen()))
    assert len(h.calls) == 3                      # hourly refresh
    run(p.fetch(h, screen(hours=12)))
    assert len(h.calls) == 4                      # changed options refetch


def test_now_is_live_even_when_cached():
    h = FakeHass()
    p, clock = make()
    run(p.fetch(h, screen()))
    h.st["weather.home"].attributes = {"temperature": 15.0}
    clock.t += 5
    assert run(p.fetch(h, screen()))["now"]["temperature"] == 15.0
