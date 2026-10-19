"""The streets provider: pure geometry, the Overpass parse, the opt-in gate,
the cell cache (memory and disk) and the failure backoff. No network."""
import asyncio
import json
import math
from types import SimpleNamespace

import pytest

from alfie.providers import streets as S

# A hand-made, trimmed Overpass `out geom` response around (51.5000, -0.1200).
FIXTURE = {"version": 0.6, "elements": [
    {"type": "way", "id": 1, "tags": {"highway": "primary", "name": "High Street"},
     "geometry": [{"lat": 51.4990, "lon": -0.1200}, {"lat": 51.4995, "lon": -0.12001},
                  {"lat": 51.5000, "lon": -0.1200}, {"lat": 51.5010, "lon": -0.1200}]},
    {"type": "way", "id": 2, "tags": {"highway": "residential"},
     "geometry": [{"lat": 51.5000, "lon": -0.1210}, {"lat": 51.5000, "lon": -0.1190}]},
    {"type": "way", "id": 3, "tags": {"highway": "service", "service": "alley"},
     "geometry": [{"lat": 51.5003, "lon": -0.1205}, {"lat": 51.5003, "lon": -0.1195}]},
    {"type": "way", "id": 4, "tags": {"highway": "footway"},
     "geometry": [{"lat": 51.5, "lon": -0.12}, {"lat": 51.5001, "lon": -0.12}]},
    {"type": "way", "id": 5, "tags": {"highway": "tertiary"},
     "geometry": [{"lat": 51.6, "lon": -0.12}, {"lat": 51.7, "lon": -0.12}]},   # far outside
    {"type": "node", "id": 6, "lat": 51.5, "lon": -0.12},
    {"type": "way", "id": 7, "tags": {"highway": "residential"}, "geometry": [{"lat": 51.5, "lon": -0.12}]},
]}


def test_parse_keeps_known_classes_only():
    ways = S.parse_overpass(FIXTURE)
    assert [k for k, _ in ways] == ["primary", "residential", "alley", "tertiary"]
    assert S.parse_overpass(None) == [] and S.parse_overpass({"elements": [1, None]}) == []


def test_query_is_one_box_with_geometry():
    q = S.build_query(51.5, -0.12)
    assert "out geom" in q and "service" in q and q.count("way[") == 2


def test_simplify_drops_collinear_points():
    pts = [(0, 0), (1, 0.01), (2, -0.01), (3, 0), (3, 5)]
    assert S.simplify(pts, 0.1) == [(0, 0), (3, 0), (3, 5)]
    assert S.simplify([(0, 0), (1, 1)], 5) == [(0, 0), (1, 1)]
    long = [(i, math.sin(i) * 0.001) for i in range(20000)]    # deep input must not recurse
    assert len(S.simplify(long, 0.1)) == 2


def test_clip_cuts_to_the_box():
    assert S.clip([(-5, 0), (5, 0)], 2, 2) == [[(-2.0, 0.0), (2.0, 0.0)]]
    assert S.clip([(-5, 9), (5, 9)], 2, 2) == []
    runs = S.clip([(-1, 0), (3, 0), (3, 1), (1, 1)], 2, 2)    # leaves, comes back across the corner
    assert runs[0][0] == (-1, 0) and runs[0][-1] == (2.0, 0.0)
    assert S.clip([(0, 0), (1, 1), (0, 1)], 2, 2) == [[(0, 0), (1, 1), (0, 1)]]


def test_compact_is_small_clipped_and_roundtrips():
    ways = S.parse_overpass(FIXTURE)
    out = S.compact(ways, 51.5, -0.12)
    assert [k for k, _ in out] == ["primary", "residential", "alley"]   # the far way is clipped away
    k, flat = out[0]
    assert len(flat) == 4                       # 4 points simplified to the 2 ends, lat/lon pairs
    assert all(isinstance(v, float) and v == round(v, 5) for v in flat)
    assert abs(flat[0] - 51.499) < 1e-4 and abs(flat[2] - 51.501) < 1e-4
    # the 1 km way was clipped to the fetch radius (520 m)
    far = S.compact([("primary", [(51.49, -0.12), (51.51, -0.12)])], 51.5, -0.12)
    assert abs(far[0][1][0] - (51.5 - 520 / S.M_PER_DEG)) < 1e-4


def test_cell_rounding():
    assert S.cell(51.50049, -0.12051) == (51.5, -0.121)
    assert S.valid_latlon(0, 0) is None and S.valid_latlon("x", 1) is None
    assert S.valid_latlon(91, 0) is None and S.valid_latlon(51, -0.1) == (51.0, -0.1)


# ------------------------------------------------------------ provider
class FakeHass:
    def __init__(self, tmp, states=None, home=(51.5, -0.12)):
        self.config = SimpleNamespace(latitude=home[0], longitude=home[1],
                                      path=lambda *p: str(tmp.joinpath(*p)))
        self._states = states or {}
        self.states = SimpleNamespace(get=self._states.get)

    async def async_add_executor_job(self, fn, *a):
        return fn(*a)


def tracker(lat, lon):
    return SimpleNamespace(attributes={"latitude": lat, "longitude": lon})


class Fake(S.StreetsProvider):
    def __init__(self, response=FIXTURE, error=None):
        super().__init__()
        self.calls, self.response, self.error, self.t = [], response, error, 1000.0

    def _now(self):
        return self.t

    async def _download(self, hass, endpoint, query):
        self.calls.append((endpoint, query))
        if self.error:
            raise self.error
        return self.response


def screen(**o):
    return {"id": "m", "type": "map", "options": {"trackers": ["device_tracker.a"],
                                                  "allow_network": True, "endpoint": "", **o}}


def run(coro):
    return asyncio.run(coro)


def test_refuses_without_opt_in(tmp_path):
    p = Fake()
    h = FakeHass(tmp_path, {"device_tracker.a": tracker(51.50049, -0.12051)})
    with pytest.raises(S.StreetsError, match="Street maps are off"):
        run(p.fetch(h, screen(allow_network=False)))
    assert p.calls == []


def test_fetch_rounds_position_and_caches_in_memory_and_disk(tmp_path):
    p = Fake()
    h = FakeHass(tmp_path, {"device_tracker.a": tracker(51.50049, -0.12051)})
    d = run(p.fetch(h, screen()))
    assert d["cell"] == [51.5, -0.121] and d["radius"] == 520
    assert [k for k, _ in d["ways"]] == ["primary", "residential", "alley"]
    (endpoint, query), = p.calls
    assert endpoint == S.OVERPASS
    assert "51.50049" not in query and "-0.12051" not in query      # only the rounded cell leaves
    run(p.fetch(h, screen()))
    assert len(p.calls) == 1                                        # memory
    files = list((tmp_path / ".storage" / "alfie_streets").glob("v2_51.500_-0.121.json"))
    assert len(files) == 1 and json.loads(files[0].read_text()) == d["ways"]
    # A fresh provider (a restart) reads the disk, even with the network off.
    p2 = Fake()
    d2 = run(p2.fetch(h, screen(allow_network=False)))
    assert d2["ways"] == d["ways"] and p2.calls == []


def test_centre_falls_back_to_home_and_skips_unlocated(tmp_path):
    p = Fake()
    h = FakeHass(tmp_path, {"device_tracker.a": SimpleNamespace(attributes={})})
    assert run(p.fetch(h, screen()))["cell"] == [51.5, -0.12]
    h2 = FakeHass(tmp_path, home=(0, 0))
    with pytest.raises(S.StreetsError, match="no tracker"):
        run(Fake().fetch(h2, screen()))


def test_failure_backs_off_ten_minutes(tmp_path):
    p = Fake(error=OSError("down"))
    h = FakeHass(tmp_path, {"device_tracker.a": tracker(51.5, -0.12)})
    with pytest.raises(S.StreetsError, match="could not reach"):
        run(p.fetch(h, screen()))
    with pytest.raises(S.StreetsError, match="trying again"):
        run(p.fetch(h, screen()))
    assert len(p.calls) == 1
    p.t += S.RETRY_AFTER + 1
    p.error = None
    assert run(p.fetch(h, screen()))["ways"]
    assert len(p.calls) == 2


def test_rate_limit_holds_every_cell(tmp_path):
    p = Fake(error=S.RateLimited("busy (HTTP 429)", 5))
    h = FakeHass(tmp_path, {"device_tracker.a": tracker(51.5, -0.12)})
    with pytest.raises(S.StreetsError, match="busy"):
        run(p.fetch(h, screen()))
    h2 = FakeHass(tmp_path, {"device_tracker.a": tracker(52.5, -0.12)})    # another cell
    p.error = None
    with pytest.raises(S.StreetsError, match="slow down"):
        run(p.fetch(h2, screen()))
    assert len(p.calls) == 1


def test_endpoint_option_and_validation(tmp_path):
    p = Fake()
    h = FakeHass(tmp_path, {"device_tracker.a": tracker(51.5, -0.12)})
    run(p.fetch(h, screen(endpoint="https://overpass.example/api")))
    assert p.calls[0][0] == "https://overpass.example/api"
    with pytest.raises(S.StreetsError, match="http"):
        run(Fake().fetch(h, screen(endpoint="ftp://x")))


def test_user_agent_is_polite():
    assert "Alfie" in S.USER_AGENT and "github.com" in S.USER_AGENT
