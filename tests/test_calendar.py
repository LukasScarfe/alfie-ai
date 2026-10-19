"""The calendar provider: event parsing, the midnight ttl, the refetch on change."""
import asyncio
from datetime import date, datetime
from types import SimpleNamespace
from zoneinfo import ZoneInfo

from alfie.providers import calendar as C

TZ = ZoneInfo("Europe/London")


def test_parse_events():
    resp = {
        "calendar.family": {"events": [
            {"start": "2026-10-18", "end": "2026-10-19", "summary": "Kat's birthday"},
            {"start": "2026-10-18T09:30:00+01:00", "end": "2026-10-18T10:00:00+01:00", "summary": "Dentist"},
            {"start": "2026-10-19", "end": "2026-10-20", "summary": "Bins"},
            {"start": "2026-10-18", "summary": "Kat's birthday"},          # duplicate
            {"start": "2026-10-18", "summary": ""},                        # no title
            {"start": "nonsense", "summary": "Broken"},
        ]},
        "calendar.work": {"events": [{"start": "2026-10-18T08:00:00+01:00", "summary": "Standup"}]},
        "calendar.empty": {"events": []},
    }
    ev = C.parse_events(resp, date(2026, 10, 18), TZ)
    assert [(e["t"], e["a"], e["d"]) for e in ev] == [
        ("Kat's birthday", True, 0), ("Standup", False, 0), ("Dentist", False, 0), ("Bins", True, 1)]
    assert ev[0]["c"] == "calendar.family"
    assert C.parse_events(None, date(2026, 10, 18)) == []


def test_midnight_maths_survives_dst():
    now = datetime(2026, 10, 24, 22, 0, tzinfo=TZ)          # the night before clocks go back
    start, end = C.local_midnights(now, 2)
    assert start.isoformat() == "2026-10-24T00:00:00+01:00"
    assert end.isoformat() == "2026-10-26T00:00:00+00:00"
    assert C.seconds_to_midnight(now) == 2 * 3600
    assert C.seconds_to_midnight(datetime(2026, 10, 24, 23, 59, 59, tzinfo=TZ)) == C.MIN_TTL


class FakeHass:
    def __init__(self):
        self.config = SimpleNamespace(time_zone="Europe/London")
        self.calls = []
        self.services = SimpleNamespace(async_call=self.call)

    async def call(self, domain, service, data, blocking, return_response):
        self.calls.append((domain, service, data, blocking, return_response))
        return {"calendar.family": {"events": [{"start": "2026-10-18", "summary": "Kat's birthday"}]}}


class Fake(C.CalendarProvider):
    def _track(self, hass, screen_id, entities):
        self.tracked = (screen_id, entities)

    def _now(self, hass):
        return datetime(2026, 10, 18, 10, 0, tzinfo=TZ)


def test_fetch_calls_get_events_and_invalidates():
    async def go():
        p, h = Fake(), FakeHass()
        s = {"id": "b", "type": "text", "options": {"calendars": ["calendar.family"], "days": 3}}
        r = await p.get(h, s)
        assert r["error"] is None and r["data"]["events"][0]["t"] == "Kat's birthday"
        dom, svc, data, blocking, ret = h.calls[0]
        assert (dom, svc, blocking, ret) == ("calendar", "get_events", True, True)
        assert data["entity_id"] == ["calendar.family"]
        assert data["start_date_time"].startswith("2026-10-18T00:00") and data["end_date_time"].startswith("2026-10-21T00:00")
        assert p.tracked == ("b", ("calendar.family",))
        await p.get(h, s)
        assert len(h.calls) == 1 and p.ttl == 14 * 3600           # until midnight
        p.invalidate("b")
        await p.get(h, s)
        assert len(h.calls) == 2
    asyncio.run(go())


def test_no_calendars_makes_no_call():
    async def go():
        p, h = Fake(), FakeHass()
        r = await p.get(h, {"id": "b", "options": {"calendars": []}})
        assert r["data"]["events"] == [] and h.calls == []
    asyncio.run(go())
