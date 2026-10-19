"""Street geometry for the map screen, from OpenStreetMap (Overpass).

Privacy first: nothing leaves the house unless the screen's `allow_network`
option is on, and then only a position rounded to a ~100 m cell (3 decimals,
xy's `_CELL`). One cell is fetched once, simplified and clipped here, and kept
for good in memory and on disk (`.storage/alfie_streets/`), so a typical map
asks the public service a handful of times in its life.

The parse, project, clip and simplify functions are pure (no HA import) and
tested with a hand-made Overpass response. Ported from xy-bench `streets.py`;
its `trails` and `street_cost` are scope-only and dropped.
"""

from __future__ import annotations

import json
import logging
import math
import os
import time
from typing import Any

from . import Provider, register

_LOGGER = logging.getLogger(__name__)

OVERPASS = "https://overpass-api.de/api/interpreter"
USER_AGENT = ("Alfie (Home Assistant integration, github.com/LukasScarfe/alfie-ai; "
              "caches every fetch, one request per ~100 m cell)")
CELL = 3                 # decimals a fetch centre is rounded to (~100 m)
FETCH_RADIUS = 520       # metres fetched and kept around a cell's centre
TOLERANCE = 3.0          # metres: Douglas-Peucker tolerance
RETRY_AFTER = 600.0      # seconds before a failed cell is tried again
CACHE_VERSION = 2        # bump when what is fetched or kept changes
M_PER_DEG = 111320.0

# Road classes kept (alleys come from highway=service + service=alley).
CLASSES = ("motorway", "trunk", "primary", "secondary", "tertiary",
           "unclassified", "residential", "living_street", "alley")


class StreetsError(Exception):
    """A failure whose message is fit to show the user."""


def cell(lat: float, lon: float) -> tuple[float, float]:
    return round(lat, CELL), round(lon, CELL)


def valid_latlon(lat: Any, lon: Any) -> tuple[float, float] | None:
    try:
        lat, lon = float(lat), float(lon)
    except (TypeError, ValueError):
        return None
    if not (-90 <= lat <= 90 and -180 <= lon <= 180) or (lat, lon) == (0.0, 0.0):
        return None
    return lat, lon


def build_query(lat: float, lon: float, radius: float = FETCH_RADIUS) -> str:
    """The one Overpass query: road classes and alleys in a box, with geometry."""
    dlat = radius / M_PER_DEG
    dlon = radius / (M_PER_DEG * max(0.01, math.cos(math.radians(lat))))
    kinds = "|".join(k for k in CLASSES if k != "alley")
    box = f"({lat - dlat:.6f},{lon - dlon:.6f},{lat + dlat:.6f},{lon + dlon:.6f})"
    return (f'[out:json][timeout:30];(way["highway"~"^({kinds})$"]{box};'
            f'way["highway"="service"]["service"="alley"]{box};);out geom;')


def parse_overpass(data: Any) -> list[tuple[str, list[tuple[float, float]]]]:
    """[(class, [(lat, lon), ...])] from an `out geom` response. Junk is skipped."""
    out = []
    for el in (data.get("elements") or []) if isinstance(data, dict) else []:
        if not isinstance(el, dict) or el.get("type") != "way":
            continue
        tags = el.get("tags") or {}
        kind = "alley" if tags.get("service") == "alley" else tags.get("highway")
        if kind not in CLASSES:
            continue
        pts = [(g["lat"], g["lon"]) for g in el.get("geometry") or []
               if isinstance(g, dict) and "lat" in g and "lon" in g]
        if len(pts) > 1:
            out.append((kind, pts))
    return out


def project(pts: list[tuple[float, float]], lat0: float, lon0: float) -> list[tuple[float, float]]:
    """(lat, lon) to local metres (x east, y north) around (lat0, lon0)."""
    kx = M_PER_DEG * math.cos(math.radians(lat0))
    return [((lon - lon0) * kx, (lat - lat0) * M_PER_DEG) for lat, lon in pts]


def unproject(pts: list[tuple[float, float]], lat0: float, lon0: float) -> list[tuple[float, float]]:
    kx = M_PER_DEG * max(0.01, math.cos(math.radians(lat0)))
    return [(lat0 + y / M_PER_DEG, lon0 + x / kx) for x, y in pts]


def clip_segment(a, b, w, h):
    """The part of segment a-b inside |x| <= w, |y| <= h, or None (Liang-Barsky)."""
    (x0, y0), (x1, y1) = a, b
    dx, dy = x1 - x0, y1 - y0
    t0, t1 = 0.0, 1.0
    for p, q in ((-dx, x0 + w), (dx, w - x0), (-dy, y0 + h), (dy, h - y0)):
        if p == 0:
            if q < 0:
                return None
            continue
        t = q / p
        if p < 0:
            t0 = max(t0, t)
        else:
            t1 = min(t1, t)
        if t0 > t1:
            return None
    return (x0 + t0 * dx, y0 + t0 * dy), (x0 + t1 * dx, y0 + t1 * dy)


def clip(pts, w, h):
    """A polyline cut to the box: the runs of it that are inside."""
    runs: list[list] = []
    cur: list = []
    for a, b in zip(pts, pts[1:]):
        seg = clip_segment(a, b, w, h)
        if seg is None:
            if len(cur) > 1:
                runs.append(cur)
            cur = []
            continue
        if not cur or math.dist(cur[-1], seg[0]) > 1e-9:
            if len(cur) > 1:
                runs.append(cur)
            cur = [seg[0]]
        cur.append(seg[1])
        if seg[1] != b:          # left the box: this run is done
            runs.append(cur)
            cur = []
    if len(cur) > 1:
        runs.append(cur)
    return runs


def simplify(pts, tol):
    """Douglas-Peucker: drop points within `tol` of the line they sit on.
    Iterative, so a very long way cannot overflow the stack."""
    n = len(pts)
    if n < 3:
        return list(pts)
    keep = [False] * n
    keep[0] = keep[-1] = True
    stack = [(0, n - 1)]
    while stack:
        i, j = stack.pop()
        a, b = pts[i], pts[j]
        dx, dy = b[0] - a[0], b[1] - a[1]
        norm = math.hypot(dx, dy)
        far, idx = -1.0, i
        for k in range(i + 1, j):
            px, py = pts[k]
            d = (abs(dy * (px - a[0]) - dx * (py - a[1])) / norm if norm
                 else math.dist(pts[k], a))
            if d > far:
                far, idx = d, k
        if far > tol:
            keep[idx] = True
            stack += [(i, idx), (idx, j)]
    return [p for p, k in zip(pts, keep) if k]


def compact(ways, lat0: float, lon0: float, radius: float = FETCH_RADIUS,
            tol: float = TOLERANCE) -> list[list]:
    """Ways clipped to a square `radius` metres around the cell centre and
    simplified, as the compact wire form [[class, [lat, lon, lat, lon, ...]], ...]
    (5 decimals, about 1 m)."""
    out = []
    for kind, pts in ways:
        for run in clip(project(pts, lat0, lon0), radius, radius):
            run = simplify(run, tol)
            if len(run) > 1:
                flat = [round(v, 5) for p in unproject(run, lat0, lon0) for v in p]
                out.append([kind, flat])
    return out


# ------------------------------------------------------------------ provider

def tracker_position(hass: Any, entity_id: str) -> tuple[float, float] | None:
    st = hass.states.get(entity_id)
    if st is None:
        return None
    a = st.attributes
    return valid_latlon(a.get("latitude"), a.get("longitude"))


def centre_of(hass: Any, trackers: list[str]) -> tuple[float, float] | None:
    """The map's centre: the first tracker that has a position, else home.
    The card applies the same rule."""
    for e in trackers:
        pos = tracker_position(hass, e)
        if pos:
            return pos
    return valid_latlon(hass.config.latitude, hass.config.longitude)


@register("streets")
class StreetsProvider(Provider):
    # The cells never expire, but the centre can move with a tracker, so the
    # answer is re-made now and then. That is a memory or disk read, not a fetch.
    ttl = 600.0

    def __init__(self) -> None:
        super().__init__()
        self._mem: dict[tuple[float, float], list[list]] = {}
        self._failed: dict[tuple[float, float], tuple[float, str]] = {}   # cell -> (until, why)
        self._hold_until = 0.0     # monotonic: no request at all before this (rate limited)

    # -- overridable for tests
    def _now(self) -> float:
        return time.monotonic()

    async def _download(self, hass: Any, endpoint: str, query: str) -> Any:
        """POST the query over HA's shared session; the parsed JSON."""
        import aiohttp
        from homeassistant.helpers.aiohttp_client import async_get_clientsession
        session = async_get_clientsession(hass)
        async with session.post(endpoint, data={"data": query},
                                headers={"User-Agent": USER_AGENT},
                                timeout=aiohttp.ClientTimeout(total=60)) as resp:
            if resp.status in (429, 503, 504):
                wait = resp.headers.get("Retry-After", "")
                raise RateLimited(f"the street service is busy (HTTP {resp.status})",
                                  float(wait) if wait.isdigit() else RETRY_AFTER)
            if resp.status != 200:
                raise StreetsError(f"the street service answered HTTP {resp.status}")
            return await resp.json(content_type=None)

    # -- disk
    @staticmethod
    def _path(hass: Any, key: tuple[float, float]) -> str:
        return hass.config.path(".storage", "alfie_streets",
                                f"v{CACHE_VERSION}_{key[0]:.{CELL}f}_{key[1]:.{CELL}f}.json")

    @staticmethod
    def _read(path: str) -> list[list] | None:
        try:
            with open(path, encoding="utf-8") as f:
                data = json.load(f)
            return data if isinstance(data, list) else None
        except (OSError, ValueError):
            return None

    @staticmethod
    def _write(path: str, ways: list[list]) -> None:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        tmp = path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(ways, f, separators=(",", ":"))
        os.replace(tmp, path)

    async def cell_ways(self, hass: Any, key: tuple[float, float], allow_network: bool,
                        endpoint: str) -> list[list]:
        if key in self._mem:
            return self._mem[key]
        path = self._path(hass, key)
        ways = await hass.async_add_executor_job(self._read, path)
        if ways is not None:
            self._mem[key] = ways
            return ways
        if not allow_network:
            raise StreetsError("Street maps are off. Turn on 'Fetch streets from the "
                               "internet' to draw them; only a position rounded to about "
                               "100 m is sent.")
        now = self._now()
        failed = self._failed.get(key)
        if failed and now < failed[0]:
            raise StreetsError(f"{failed[1]} (trying again in {int(failed[0] - now) // 60 + 1} min)")
        if now < self._hold_until:
            raise StreetsError("the street service asked us to slow down; waiting")
        try:
            raw = await self._download(hass, endpoint, build_query(*key))
            ways = compact(parse_overpass(raw), *key)
        except RateLimited as e:
            self._hold_until = now + e.wait
            self._failed[key] = (now + e.wait, str(e))
            raise StreetsError(str(e)) from e
        except StreetsError as e:
            self._failed[key] = (now + RETRY_AFTER, str(e))
            raise
        except Exception as e:  # the network fails many ways
            why = f"could not reach the street service ({type(e).__name__})"
            self._failed[key] = (now + RETRY_AFTER, why)
            raise StreetsError(why) from e
        self._failed.pop(key, None)
        self._mem[key] = ways
        try:
            await hass.async_add_executor_job(self._write, path, ways)
        except OSError as e:
            _LOGGER.warning("Alfie could not save a street cell: %s", e)
        return ways

    async def fetch(self, hass: Any, screen: dict) -> dict:
        o = screen.get("options") or {}
        endpoint = (o.get("endpoint") or OVERPASS).strip()
        if not endpoint.startswith(("https://", "http://")):
            raise StreetsError("the Overpass endpoint must be an http(s) address")
        centre = centre_of(hass, list(o.get("trackers") or []))
        if centre is None:
            raise StreetsError("no tracker has a position and Home Assistant has no home location")
        key = cell(*centre)
        ways = await self.cell_ways(hass, key, bool(o.get("allow_network")), endpoint)
        return {"cell": list(key), "radius": FETCH_RADIUS, "ways": ways}


class RateLimited(Exception):
    def __init__(self, msg: str, wait: float) -> None:
        super().__init__(msg)
        self.wait = max(60.0, wait)
