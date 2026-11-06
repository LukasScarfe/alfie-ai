"""The recent past: "did it rain today" (outside.past_reply, openmeteo.parse_past)."""

from datetime import datetime, timedelta, timezone

import pytest

from alfie import brain, config, openmeteo, outside
from alfie.outside import Row, Weather

EN = brain.load_language("en")
TZ = timezone(timedelta(hours=-7))
NOW = datetime(2026, 10, 30, 15, 4, tzinfo=TZ)      # a Friday
MID = NOW.replace(hour=0, minute=0)
S = brain.default_settings()


def hours(n_back, kw=None):
    """Rows for the last n_back finished hours, oldest first; kw maps an
    hour-of-day range to fields."""
    out = []
    start = NOW.replace(minute=0) - timedelta(hours=n_back)
    for i in range(n_back + 3):                 # and a few hours still to come
        at = start + timedelta(hours=i)
        r = Row(at, "cloudy", temp=8.0, precip=0.0, wind=10.0, snow=0.0)
        for (a, b), f in (kw or {}).items():
            if a <= at.hour < b and at.date() == NOW.date():
                for k, v in f.items():
                    setattr(r, k, v)
        out.append(r)
    return out


def weather(rows, place="", **attrs):
    return Weather("Home", "", {"temperature_unit": "°C", "wind_speed_unit": "km/h",
                                "precipitation_unit": "mm", **attrs}, rows, [], place)


def say(w, ask="", span="", hilo="", amount=False, now=NOW):
    return outside.past_reply(w, ask, span, hilo, amount, EN, now, S)


WET_MORNING = hours(48, {(6, 9): {"cond": "rainy", "precip": 1.5, "temp": 6.0}})


def test_rained_today_with_amount_and_when():
    assert say(WET := weather(WET_MORNING), "rain") == \
        "Yes, it rained today: about 4.5 mm, from 6 am to 9 am."
    assert say(WET, "rain", amount=True) == "About 4.5 mm of rain fell today, from 6 am to 9 am."


def test_dry():
    w = weather(hours(48))
    assert say(w, "rain") == "No, it stayed dry today."
    assert say(w, "rain", "yesterday", amount=True) == "No rain fell yesterday."
    assert say(w, "snow") == "No, it didn't snow today."


def test_rain_is_not_in_the_wrong_span():
    assert say(weather(WET_MORNING), "rain", "afternoon").startswith("No, it stayed dry")
    assert say(weather(WET_MORNING), "rain", "morning").startswith("Yes, it rained this morning")
    assert say(weather(WET_MORNING), "rain", "yesterday").startswith("No")


def test_trace_and_on_and_off_and_still_going():
    trace = hours(48, {(10, 11): {"precip": 0.15, "cond": "rainy"}})
    assert say(weather(trace), "rain").startswith("Barely: only a trace of rain today (0.15 mm)")
    gaps = hours(48, {(6, 7): {"precip": 1.0}, (9, 10): {"precip": 1.0}})
    assert say(weather(gaps), "rain").endswith("on and off from 6 am to 10 am.")
    going = hours(48, {(13, 15): {"precip": 1.0}})
    assert say(weather(going), "rain").endswith("since 1 pm.")


def test_days_over_a_long_span():
    rows = hours(72)
    for r in rows:
        if r.at.date() == (NOW - timedelta(days=2)).date() and 3 <= r.at.hour < 5:
            r.precip = 2.0
    rows[-5].precip = 2.0           # earlier today
    assert say(weather(rows), "rain", "3d").endswith("on Wednesday and today.")


def test_no_amounts_from_history():
    rows = hours(24, {(6, 9): {"cond": "rainy"}})
    for r in rows:
        r.precip = r.snow = None
    assert say(weather(rows), "rain") == "Yes, it rained today, from 6 am to 9 am."
    assert say(weather(rows), "rain", amount=True).endswith("but I can't say how much.")


def test_snow_in_cm():
    rows = hours(24, {(2, 4): {"cond": "snowy", "snow": 1.5, "precip": 1.2}})
    assert say(weather(rows), "snow") == "Yes, it snowed today: about 3 cm, from 2 am to 4 am."
    assert say(weather(rows), "rain") == "No, it stayed dry today."


def test_kinds_hilo_and_wind():
    sunny = hours(24, {(8, 14): {"cond": "sunny"}})
    assert say(weather(sunny), "sun") == "Yes, it was sunny for about 6 hours today."
    assert say(weather(hours(24)), "fog") == "No, it wasn't foggy today. It was mostly cloudy."
    warm = hours(24, {(12, 15): {"temp": 12.4}, (3, 5): {"temp": 2.0}})
    assert say(weather(warm), hilo="max") == "The high today was 12°C."
    assert say(weather(warm), hilo="both") == "The high today was 12°C, and the low 2°C."
    assert say(weather(warm), "cold") == "Yes, it got down to 2°C today."
    assert say(weather(warm), "warm") == "Not really: it only got up to 12°C today."
    gusty = hours(24, {(9, 10): {"wind": 41.0}})
    assert say(weather(gusty), "wind") == "Yes, the wind reached 41 km/h today."


def test_summary():
    assert say(weather(WET_MORNING), span="yesterday") == \
        "Yesterday: mostly cloudy, 8°C, and dry."
    assert say(weather(WET_MORNING), span="today") == \
        "Today: mostly cloudy, 6 to 8°C, 4.5 mm of rain."
    week = say(weather(hours(72)), span="3d")
    assert week.startswith("Monday: mostly cloudy") is False and "Today: mostly cloudy" in week


def test_place_and_none_yet():
    assert say(weather(WET_MORNING, place="London"), "rain").startswith(
        "Yes, it rained today in London")
    assert say(weather([]), "rain") == "I don't have the weather today yet."


def test_windows():
    w = outside.past_window
    assert w("today", NOW) == (MID, NOW)
    assert w("night", NOW) == (MID - timedelta(hours=6), MID + timedelta(hours=6))
    assert w("evening", NOW) == (MID - timedelta(hours=6), MID)      # last evening
    assert w("morning", NOW) == (MID + timedelta(hours=6), MID + timedelta(hours=12))
    assert w("wed", NOW) == (MID - timedelta(days=2), MID - timedelta(days=1))
    assert w("fri", NOW) == (MID, NOW)
    assert w("week", NOW)[0] == MID - timedelta(days=4)
    assert outside.say_past_span("thu", EN, NOW) == "yesterday"
    assert outside.say_past_span("mon", EN, NOW) == "on Monday"
    assert outside.default_past_span(NOW.replace(hour=3)) == "24h"


def test_history_rows_sample_each_hour():
    changes = [(MID - timedelta(hours=2), "cloudy", {"temperature": 7}),
               (MID + timedelta(hours=1, minutes=10), "rainy", {"temperature": 6})]
    rows = outside.history_rows(changes, MID, MID + timedelta(hours=3, minutes=5))
    assert [(r.at.hour, r.cond, r.temp) for r in rows] == [(0, "cloudy", 7), (1, "rainy", 6),
                                                           (2, "rainy", 6)]


def test_gauge_total_and_rate():
    rows = hours(24)
    w = weather(rows)
    h = lambda x, m=0: MID + timedelta(hours=x, minutes=m)  # noqa: E731
    outside.gauge_into(w, [(h(5), "10.0"), (h(6, 30), "11.0"), (h(7, 30), "13.5"),
                           (h(8), "0"), (h(9), "unknown")], "mm", "precipitation")
    assert say(w, "rain") == "Yes, it rained today: about 3.5 mm, from 6 am to 8 am."
    w = weather(hours(24))
    outside.gauge_into(w, [(h(10), "2"), (h(11, 30), "0")], "mm/h", "precipitation_intensity")
    assert say(w, "rain", amount=True) == "About 3 mm of rain fell today, from 10 am to 12 pm."


def test_parse_past_moves_each_hour_to_its_start():
    t = int(datetime(2026, 10, 30, 10, tzinfo=timezone.utc).timestamp())
    got = openmeteo.parse_past({"timezone": "America/Vancouver", "hourly": {
        "time": [t, t + 3600], "precipitation": [0.4, 0.0], "snowfall": [0, 0],
        "weather_code": [61, 3], "temperature_2m": [7, 8], "is_day": [1, 1]}})
    rows = outside.rows(got["hourly"])
    assert rows[0].at.hour == 9 and rows[0].precip == 0.4 and rows[0].cond == "rainy"
    assert openmeteo.parse_past({"current": {}}) is None
    p = openmeteo.past_params(49.2, -123.1, {"rain": "mm"})
    assert p["past_days"] == "7" and "current" not in p and "snowfall" in p["hourly"]


def test_migration_adds_past_to_own_always():
    raw = {"version": 6, "brain": {"own_always": ["weather_forecast", "weather_now"]}}
    assert "weather_past" in config.migrate(raw)["brain"]["own_always"]
    raw = {"version": 7, "brain": {"own_always": ["weather_forecast"]}}
    assert "weather_past" not in config.migrate(raw)["brain"]["own_always"]


hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, S, "en"))

SENTENCES = [
    ("did it rain today", {"ask": "rain", "span": "today"}),
    ("has it rained today", {"ask": "rain", "span": "today"}),
    ("did it rain", {"ask": "rain"}),
    ("has it been raining", {"ask": "rain"}),
    ("did it rain last night", {"ask": "rain", "span": "night"}),
    ("did it snow in whistler yesterday", {"ask": "snow"}),
    ("did it rain in london yesterday", {"ask": "rain"}),   # local.py splits the span off
    ("how much rain did we get today", {"ask": "rain", "amount": "1", "span": "today"}),
    ("how much rain fell yesterday", {"ask": "rain", "amount": "1", "span": "yesterday"}),
    ("did we get any rain this week", {"ask": "rain", "span": "week"}),
    ("was it windy yesterday", {"ask": "wind", "span": "yesterday"}),
    ("was it sunny on saturday", {"ask": "sun", "span": "sat"}),
    ("what was the high yesterday", {"hilo": "max", "span": "yesterday"}),
    ("how cold did it get last night", {"hilo": "min", "span": "night"}),
    ("what was the weather like yesterday", {"span": "yesterday"}),
    ("how was the weather this morning", {"span": "morning"}),
]


@pytest.mark.parametrize("text,want", SENTENCES)
def test_sentences(text, want):
    got = [(brain.command_of(r.intent.name), {k: str(v.value) for k, v in r.entities.items()})
           for r in hassil.recognize_all(text, INTENTS)]
    assert any(c == "weather_past" and all(s.get(k) == v for k, v in want.items())
               for c, s in got), got


@pytest.mark.parametrize("text", ["will it rain tomorrow", "is it raining", "what's the high today",
                                  "what was the highest office temperature today"])
def test_not_past(text):
    got = {brain.command_of(r.intent.name) for r in hassil.recognize_all(text, INTENTS)}
    assert "weather_past" not in got
