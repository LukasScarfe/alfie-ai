"""The weather anywhere (design.md "Brain" → Weather and sky): a place with no
weather entity of its name ("is it sunny in London") is found with
Open-Meteo's geocoder and its forecast read from Open-Meteo, then answered by
outside.py like the house's own weather. No key is needed; only the place's
name and its coordinates leave the house (`brain.weather_anywhere`).

PURE (no HA import): the query parameters and the parsing. local.py does the
fetching and the caching.
"""

from __future__ import annotations

import unicodedata
from collections.abc import Mapping, Sequence
from datetime import datetime, timezone
from typing import Any

GEO_COUNT = 20       # places asked for per name: "London" has a few
SPLITS = 2           # "london ontario": at most this many shorter names tried

# WMO weather codes as Home Assistant conditions (day, night).
WMO = {0: ("sunny", "clear-night"), 1: ("sunny", "clear-night"),
       2: ("partlycloudy", "partlycloudy"), 3: ("cloudy", "cloudy"),
       45: ("fog", "fog"), 48: ("fog", "fog"),
       51: ("rainy", "rainy"), 53: ("rainy", "rainy"), 55: ("rainy", "rainy"),
       56: ("snowy-rainy", "snowy-rainy"), 57: ("snowy-rainy", "snowy-rainy"),
       61: ("rainy", "rainy"), 63: ("rainy", "rainy"), 65: ("pouring", "pouring"),
       66: ("snowy-rainy", "snowy-rainy"), 67: ("snowy-rainy", "snowy-rainy"),
       71: ("snowy", "snowy"), 73: ("snowy", "snowy"), 75: ("snowy", "snowy"),
       77: ("snowy", "snowy"), 80: ("rainy", "rainy"), 81: ("rainy", "rainy"),
       82: ("pouring", "pouring"), 85: ("snowy", "snowy"), 86: ("snowy", "snowy"),
       95: ("lightning-rainy", "lightning-rainy"), 96: ("hail", "hail"), 99: ("hail", "hail")}

CURRENT = ("temperature_2m", "relative_humidity_2m", "apparent_temperature", "is_day",
           "weather_code", "pressure_msl", "wind_speed_10m", "wind_direction_10m", "uv_index",
           "dew_point_2m", "visibility")
HOURLY = ("temperature_2m", "precipitation_probability", "precipitation", "weather_code",
          "wind_speed_10m", "uv_index", "is_day")
DAILY = ("weather_code", "temperature_2m_max", "temperature_2m_min",
         "precipitation_probability_max", "precipitation_sum", "uv_index_max",
         "wind_speed_10m_max")


def key(text: str) -> str:
    """A name for comparing: lower case, no accents or punctuation."""
    t = unicodedata.normalize("NFKD", str(text)).encode("ascii", "ignore").decode().lower()
    return " ".join("".join(c if c.isalnum() else " " for c in t).split())


def tries(place: str) -> list[tuple[str, str]]:
    """The (name, qualifier) pairs to look a place up by: "london ontario"
    is tried whole, then as "london" in "ontario"; "paris, texas" as "paris"
    in "texas" first."""
    raw = str(place).strip()
    if "," in raw:
        name, _, rest = raw.partition(",")
        return [(key(name), key(rest))] if key(name) else []
    words = key(raw).split()
    out = [(" ".join(words), "")] if words else []
    for n in range(len(words) - 1, max(0, len(words) - 1 - SPLITS), -1):
        out.append((" ".join(words[:n]), " ".join(words[n:])))
    return out


def geo_params(name: str, language: str) -> dict[str, str]:
    return {"name": name, "count": str(GEO_COUNT), "language": language or "en",
            "format": "json"}


def pick_place(data: Any, name: str, qualifier: str = "") -> dict[str, Any] | None:
    """The place a name means among the geocoder's results: its name must be
    the name said (the geocoder also finds "Kitchener" for "kitchen"), in
    the region or country said if one was, and the most populous of those.
    (lat, lon, name, timezone) as a dict, or None."""
    results = data.get("results") if isinstance(data, Mapping) else None
    want, where = key(name), key(qualifier)
    best: tuple[float, Mapping[str, Any]] | None = None
    for r in results if isinstance(results, list) else []:
        if not isinstance(r, Mapping) or key(r.get("name", "")) != want:
            continue
        if not isinstance(r.get("latitude"), (int, float)) or \
                not isinstance(r.get("longitude"), (int, float)):
            continue
        if where:
            regions = [key(r.get(k, "")) for k in ("admin1", "admin2", "country", "country_code")]
            if not any(x and (x == where or x.startswith(where)) for x in regions):
                continue
        pop = float(r.get("population") or 0)
        if best is None or pop > best[0]:
            best = (pop, r)
    if best is None:
        return None
    r = best[1]
    return {"lat": round(float(r["latitude"]), 3), "lon": round(float(r["longitude"]), 3),
            "name": str(r.get("name") or name), "tz": str(r.get("timezone") or "UTC"),
            "country": str(r.get("country") or ""), "admin1": str(r.get("admin1") or "")}


def forecast_params(lat: float, lon: float, units: Mapping[str, str]) -> dict[str, str]:
    """`units`: temperature ("°C"/"°F"), wind ("km/h", "mph", "m/s", "kn")
    and rain ("mm"/"in"), Home Assistant's."""
    f = str(units.get("temperature", "°C")).endswith("F")
    wind = {"km/h": "kmh", "mph": "mph", "m/s": "ms", "kn": "kn"}.get(units.get("wind", "km/h"),
                                                                       "kmh")
    return {"latitude": str(lat), "longitude": str(lon), "current": ",".join(CURRENT),
            "hourly": ",".join(HOURLY), "daily": ",".join(DAILY), "timezone": "auto",
            "forecast_days": "7", "timeformat": "unixtime",
            "temperature_unit": "fahrenheit" if f else "celsius", "wind_speed_unit": wind,
            "precipitation_unit": "inch" if units.get("rain") == "in" else "mm"}


def condition(code: Any, is_day: Any = 1) -> str:
    try:
        day, night = WMO[int(code)]
    except (KeyError, TypeError, ValueError):
        return ""
    return night if is_day in (0, False) else day


def _at(v: Any) -> str | None:
    if isinstance(v, bool) or not isinstance(v, (int, float)):
        return None
    return datetime.fromtimestamp(v, timezone.utc).isoformat()


def _col(block: Mapping[str, Any], name: str, i: int) -> Any:
    col = block.get(name)
    return col[i] if isinstance(col, Sequence) and i < len(col) else None


def parse(data: Any, units: Mapping[str, str]) -> dict[str, Any] | None:
    """Open-Meteo's forecast as a weather entity would give it: `state` (a
    condition), `attributes`, and `hourly` / `daily` entries in
    weather.get_forecasts' shape (outside.rows reads them), with the
    place's `tz`. None when it isn't a forecast."""
    if not isinstance(data, Mapping) or not isinstance(data.get("current"), Mapping):
        return None
    cur = data["current"]
    state = condition(cur.get("weather_code"), cur.get("is_day", 1))
    if not state:
        return None
    vis = cur.get("visibility")
    attrs = {"temperature": cur.get("temperature_2m"),
             "apparent_temperature": cur.get("apparent_temperature"),
             "humidity": cur.get("relative_humidity_2m"),
             "pressure": cur.get("pressure_msl"), "pressure_unit": "hPa",
             "wind_speed": cur.get("wind_speed_10m"), "wind_bearing": cur.get("wind_direction_10m"),
             "uv_index": cur.get("uv_index"), "dew_point": cur.get("dew_point_2m"),
             "visibility": round(vis / 1000, 1) if isinstance(vis, (int, float)) else None,
             "visibility_unit": "km",
             "temperature_unit": units.get("temperature", "°C"),
             "wind_speed_unit": units.get("wind", "km/h"),
             "precipitation_unit": units.get("rain", "mm")}
    hourly, daily = [], []
    h = data.get("hourly") if isinstance(data.get("hourly"), Mapping) else {}
    for i, t in enumerate(h.get("time") or []):
        if (at := _at(t)) is None:
            continue
        hourly.append({"datetime": at,
                       "condition": condition(_col(h, "weather_code", i), _col(h, "is_day", i)),
                       "temperature": _col(h, "temperature_2m", i),
                       "precipitation_probability": _col(h, "precipitation_probability", i),
                       "precipitation": _col(h, "precipitation", i),
                       "uv_index": _col(h, "uv_index", i),
                       "wind_speed": _col(h, "wind_speed_10m", i)})
    d = data.get("daily") if isinstance(data.get("daily"), Mapping) else {}
    for i, t in enumerate(d.get("time") or []):
        if (at := _at(t)) is None:
            continue
        daily.append({"datetime": at, "condition": condition(_col(d, "weather_code", i)),
                      "temperature": _col(d, "temperature_2m_max", i),
                      "templow": _col(d, "temperature_2m_min", i),
                      "precipitation_probability": _col(d, "precipitation_probability_max", i),
                      "precipitation": _col(d, "precipitation_sum", i),
                      "uv_index": _col(d, "uv_index_max", i),
                      "wind_speed": _col(d, "wind_speed_10m_max", i)})
    return {"state": state, "attributes": {k: v for k, v in attrs.items() if v is not None},
            "hourly": hourly, "daily": daily, "tz": str(data.get("timezone") or "UTC")}
