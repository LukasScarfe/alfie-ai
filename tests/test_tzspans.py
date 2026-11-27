"""HA's UTC offsets for the cards (tzspans): transitions found to the second, cached a day."""

from datetime import datetime, timedelta, timezone, tzinfo
from zoneinfo import ZoneInfo

from alfie.tzspans import AHEAD, BACK, TzTable, spans


def test_berlin_transitions_to_the_second():
    now = datetime(2026, 6, 1, tzinfo=timezone.utc).timestamp()
    z = spans(ZoneInfo("Europe/Berlin"), "Europe/Berlin", now)
    assert z["zone"] == "Europe/Berlin"
    assert z["from"] == int(now) - BACK and z["to"] == int(now) + AHEAD
    starts = {s: o for s, o in z["spans"][1:]}
    spring = int(datetime(2026, 3, 29, 1, tzinfo=timezone.utc).timestamp())
    autumn = int(datetime(2026, 10, 25, 1, tzinfo=timezone.utc).timestamp())
    assert starts[spring] == 7200 and starts[autumn] == 3600


class _Permanent(tzinfo):
    """A zone that stops changing its clocks: -08:00 until 2026-03-08, then -07:00 for good."""
    CUT = datetime(2026, 3, 8, 10, tzinfo=timezone.utc)

    def utcoffset(self, dt):
        return timedelta(hours=-7) if dt.replace(tzinfo=None) >= datetime(2026, 3, 8, 3) else timedelta(hours=-8)

    def dst(self, dt):
        return timedelta(0)

    def fromutc(self, dt):
        off = timedelta(hours=-7) if dt.replace(tzinfo=None) >= self.CUT.replace(tzinfo=None) else timedelta(hours=-8)
        return (dt + off).replace(tzinfo=self)


def test_permanent_offset_has_no_future_change():
    now = datetime(2026, 11, 26, 22, tzinfo=timezone.utc).timestamp()
    z = spans(_Permanent(), "America/Whitehorse", now)
    assert z["spans"][-1][1] == -25200
    assert z["spans"][-1][0] == int(_Permanent.CUT.timestamp())
    assert all(s < now for s, _ in z["spans"])


def test_table_cached_per_day_and_zone():
    tab = TzTable()
    tz = ZoneInfo("Europe/Berlin")
    a = tab.get(tz, "Europe/Berlin", 1_800_000_000)
    assert tab.get(tz, "Europe/Berlin", 1_800_000_100) is a
    assert tab.get(ZoneInfo("UTC"), "UTC", 1_800_000_100) is not a
    assert tab.get(tz, "Europe/Berlin", 1_800_000_000 + 86400) is not a
    assert tab.get(ZoneInfo("UTC"), "UTC", 0)["spans"] == [[-BACK, 0]]
