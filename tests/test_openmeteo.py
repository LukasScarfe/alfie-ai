"""openmeteo.py: finding a place and reading Open-Meteo's forecast."""

from datetime import datetime, timedelta, timezone

from alfie import brain, openmeteo, outside

EN = brain.load_language("en")
S = brain.default_settings()

GEO = {"results": [
    {"name": "London", "latitude": 51.50853, "longitude": -0.12574, "country": "United Kingdom",
     "country_code": "GB", "admin1": "England", "timezone": "Europe/London", "population": 8961989},
    {"name": "London", "latitude": 42.98339, "longitude": -81.23304, "country": "Canada",
     "country_code": "CA", "admin1": "Ontario", "timezone": "America/Toronto", "population": 422324},
    {"name": "Londonderry", "latitude": 55.0, "longitude": -7.3, "population": 90000},
]}


def test_tries():
    assert openmeteo.tries("London") == [("london", "")]
    assert openmeteo.tries("london ontario") == [("london ontario", ""), ("london", "ontario")]
    assert openmeteo.tries("Paris, Texas") == [("paris", "texas")]
    assert openmeteo.tries("São Paulo")[0] == ("sao paulo", "")
    assert openmeteo.tries("  ") == []


def test_pick_place_most_populous_and_qualified():
    assert openmeteo.pick_place(GEO, "london")["country"] == "United Kingdom"
    got = openmeteo.pick_place(GEO, "london", "ontario")
    assert got["tz"] == "America/Toronto" and got["lat"] == 42.983
    assert openmeteo.pick_place(GEO, "london", "canada")["admin1"] == "Ontario"
    assert openmeteo.pick_place(GEO, "london", "ca")["admin1"] == "Ontario"
    assert openmeteo.pick_place(GEO, "london", "texas") is None


def test_pick_place_needs_the_name_said():
    """The geocoder finds Kitchener for "kitchen": that isn't the place."""
    kitchen = {"results": [{"name": "Kitchener", "latitude": 43.4, "longitude": -80.5,
                            "population": 256885}]}
    assert openmeteo.pick_place(kitchen, "kitchen") is None
    assert openmeteo.pick_place({}, "london") is None
    assert openmeteo.pick_place({"results": "x"}, "london") is None


def test_condition():
    assert openmeteo.condition(0, 1) == "sunny"
    assert openmeteo.condition(0, 0) == "clear-night"
    assert openmeteo.condition(63) == "rainy"
    assert openmeteo.condition(75) == "snowy"
    assert openmeteo.condition(95) == "lightning-rainy"
    assert openmeteo.condition(None) == "" and openmeteo.condition(12345) == ""


def test_forecast_params_units():
    p = openmeteo.forecast_params(1.0, 2.0, {"temperature": "°F", "wind": "mph", "rain": "in"})
    assert p["temperature_unit"] == "fahrenheit" and p["wind_speed_unit"] == "mph"
    assert p["precipitation_unit"] == "inch" and p["timezone"] == "auto"
    p = openmeteo.forecast_params(1.0, 2.0, {"temperature": "°C", "wind": "km/h", "rain": "mm"})
    assert p["temperature_unit"] == "celsius" and p["wind_speed_unit"] == "kmh"


T0 = int(datetime(2026, 11, 4, 0, 0, tzinfo=timezone.utc).timestamp())
DATA = {
    "timezone": "Europe/London",
    "current": {"time": T0 + 15 * 3600, "temperature_2m": 9.7, "relative_humidity_2m": 73,
                "apparent_temperature": 6.4, "is_day": 1, "weather_code": 61,
                "pressure_msl": 1025.9, "wind_speed_10m": 14.4, "wind_direction_10m": 58,
                "uv_index": 0.5, "dew_point_2m": 5.1, "visibility": 26120.0},
    "hourly": {"time": [T0 + h * 3600 for h in range(48)],
               "temperature_2m": [8 + (h % 24) / 4 for h in range(48)],
               "precipitation_probability": [80 if h < 18 else 5 for h in range(48)],
               "precipitation": [0.5 if h < 18 else 0 for h in range(48)],
               "weather_code": [61 if h < 18 else 3 for h in range(48)],
               "wind_speed_10m": [10] * 48, "uv_index": [0] * 48, "is_day": [1] * 48},
    "daily": {"time": [T0, T0 + 86400], "weather_code": [61, 3],
              "temperature_2m_max": [12.1, 11.0], "temperature_2m_min": [7.0, 6.0],
              "precipitation_probability_max": [80, 10], "precipitation_sum": [6.0, 0.0],
              "uv_index_max": [1, 1], "wind_speed_10m_max": [15, 12]},
}
UNITS = {"temperature": "°C", "wind": "km/h", "rain": "mm"}


def test_parse():
    got = openmeteo.parse(DATA, UNITS)
    assert got["state"] == "rainy" and got["tz"] == "Europe/London"
    a = got["attributes"]
    assert a["temperature"] == 9.7 and a["visibility"] == 26.1 and a["wind_bearing"] == 58
    assert len(got["hourly"]) == 48 and got["hourly"][0]["condition"] == "rainy"
    assert got["daily"][0]["templow"] == 7.0
    assert openmeteo.parse({}, UNITS) is None
    assert openmeteo.parse({"current": {"weather_code": None}}, UNITS) is None


def test_answers_like_a_weather_entity():
    """Parsed, it reads like any weather entity in outside.py's replies."""
    got = openmeteo.parse(DATA, UNITS)
    tz = timezone.utc
    w = outside.Weather("London", got["state"], got["attributes"],
                        outside.rows(got["hourly"], tz), outside.rows(got["daily"], tz),
                        place="London", tz=tz)
    now = datetime(2026, 11, 4, 15, 10, tzinfo=tz)
    said = outside.now_reply(w, "rain", "", EN, now, S)
    assert said.startswith("Yes") and "London" in said
    said = outside.now_reply(w, "sun", "", EN, now, S)
    assert said.startswith("No") and "London" in said
    said = outside.now_reply(w, "", "", EN, now, S)
    assert "10" in said and "London" in said
    said = outside.forecast_reply(w, "rain", "tomorrow", "", "", EN, now, S)
    assert said and "London" in said
    assert outside.now_reply(w, "", "temp", EN, now - timedelta(hours=1), S)
