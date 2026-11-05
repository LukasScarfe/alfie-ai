from datetime import datetime, timedelta, timezone

import pytest

from alfie import brain, outside
from alfie.outside import Row, Weather

EN = brain.load_language("en")
TZ = timezone(timedelta(hours=-7))
NOW = datetime(2026, 10, 30, 15, 4, tzinfo=TZ)      # a Friday
S = brain.default_settings()


def hour(h, days=0, **kw):
    return Row(NOW.replace(hour=0, minute=0) + timedelta(days=days, hours=h), **kw)


def day(days, **kw):
    return Row(NOW.replace(hour=12, minute=0) + timedelta(days=days), **kw)


def weather(cond="cloudy", hourly=(), daily=(), place="", **attrs):
    a = {"temperature": 7.0, "temperature_unit": "°C", "wind_speed": 13.0, "wind_speed_unit": "km/h",
         "wind_bearing": 40, "humidity": 89, **attrs}
    return Weather("Home", cond, a, list(hourly), list(daily), place)


DRY = [hour(h, cond="cloudy", temp=8 - abs(h - 15) / 3) for h in range(15, 24)] + \
      [hour(h, 1, cond="cloudy", temp=5 + h / 4) for h in range(24)]
WET = [hour(h, cond="cloudy" if h < 18 else "rainy", temp=7, pop=20 if h < 18 else 80)
       for h in range(15, 24)] + [hour(h, 1, cond="rainy" if h < 9 else "cloudy", temp=6) for h in range(24)]
RAIN = [hour(h, cond="rainy", temp=7) for h in range(15, 24)] + WET[9:]
DAYS = [day(0, cond="rainy", temp=11, low=5, precip=0.4), day(1, cond="cloudy", temp=12, low=4, pop=30),
        day(2, cond="sunny", temp=14, low=3), day(3, cond="rainy", temp=9, low=6, pop=70)]


def test_rows_parse_and_sort():
    got = outside.rows([{"datetime": "2026-10-31T01:00:00+00:00", "condition": "rainy", "temperature": 6.9,
                         "precipitation_probability": 80},
                        {"datetime": "2026-10-31T00:00:00Z", "temperature": "x"}, "junk", {"datetime": "no"}], TZ)
    assert [r.at.hour for r in got] == [17, 18]
    assert got[0].temp is None and got[1].cond == "rainy" and got[1].pop == 80


@pytest.mark.parametrize("key,start,end,by_day", [
    ("tonight", (30, 18), (31, 6), False), ("tomorrow", (31, 0), (1, 0), True),
    ("weekend", (31, 0), (2, 0), True), ("fri", None, (31, 0), True), ("mon", (2, 0), (3, 0), True),
    ("tomorrow_morning", (31, 6), (31, 12), False), ("soon", None, (30, 18), False)])
def test_span_window(key, start, end, by_day):
    s, e, d = outside.span_window(key, NOW)
    want_s = NOW if start is None else NOW.replace(day=start[0], hour=start[1], minute=0,
                                                   month=10 if start[0] > 20 else 11)
    assert s == want_s and (e.day, e.hour) == end and d == by_day


def test_weather_now():
    w = weather("rainy", WET, DAYS)
    assert outside.now_reply(w, "", "", EN, NOW, S) == "It's raining and 7°C. Today's high is 11°C."
    dry = weather("cloudy", WET, DAYS)
    assert outside.now_reply(dry, "", "", EN, NOW, S).endswith(
        "Rain is likely from about 6 pm (80% chance).")
    assert outside.now_reply(weather(place="Whistler"), "", "temp", EN, NOW, S) == \
        "It's 7°C outside in Whistler."
    assert outside.now_reply(weather(), "", "wind", EN, NOW, S) == \
        "The wind is 13 km/h from the northeast."
    assert outside.now_reply(weather(apparent_temperature=3), "", "temp", EN, NOW, S) == \
        "It's 7°C outside, feels like 3°C."
    assert outside.now_reply(weather(), "", "humidity", EN, NOW, S) == "The humidity outside is 89%."


def test_is_it():
    assert outside.now_reply(weather("rainy", RAIN), "rain", "", EN, NOW, S) == "Yes, it's raining."
    assert outside.now_reply(weather("cloudy", DRY), "rain", "", EN, NOW, S) == "No, it's cloudy."
    assert outside.now_reply(weather(), "cold", "", EN, NOW, S) == "Yes, it's cold: 7°C."
    assert outside.now_reply(weather(), "wind", "", EN, NOW, S).startswith("No, the wind is 13 km/h")
    assert outside.now_reply(weather(wind_speed=40), "wind", "", EN, NOW, S).startswith("Yes, it's windy")
    # Raining now, dry in an hour.
    w = weather("rainy", [hour(15, cond="rainy"), hour(16, cond="rainy"), hour(17, cond="cloudy")])
    assert outside.now_reply(w, "rain", "", EN, NOW, S) == \
        "Yes, it's raining. It should stop at about 5 pm."


def test_will_it():
    w = weather("cloudy", WET, DAYS)
    assert outside.forecast_reply(w, "rain", "tonight", "", "", EN, NOW, S) == \
        "Yes, rain is likely tonight, from about 6 pm (80% chance)."
    assert outside.forecast_reply(weather("cloudy", DRY, DAYS), "rain", "tomorrow", "", "", EN, NOW, S) == \
        "No rain is forecast tomorrow. It should be cloudy."
    # Beyond the hourly forecast: the daily one.
    assert outside.forecast_reply(w, "rain", "mon", "", "", EN, NOW, S) == \
        "Yes, rain is likely on Monday (70% chance)."
    assert outside.forecast_reply(w, "snow", "sun", "", "", EN, NOW, S) == \
        "No snow is forecast on Sunday. It should be sunny."


def test_start_and_stop():
    w = weather("cloudy", WET, DAYS)
    assert outside.forecast_reply(w, "rain", "", "", "start", EN, NOW, S) == \
        "Rain is likely from about 6 pm (80% chance)."
    assert outside.forecast_reply(w, "rain", "", "", "stop", EN, NOW, S) == \
        "It isn't raining now. Rain is likely from about 6 pm (80% chance)."
    wet = weather("rainy", RAIN, DAYS)
    assert outside.forecast_reply(wet, "rain", "", "", "stop", EN, NOW, S) == \
        "The rain should stop at about 9 am tomorrow."
    assert outside.forecast_reply(weather("cloudy", DRY), "rain", "", "", "start", EN, NOW, S) == \
        "No rain is forecast in the next 32 hours."


def test_high_and_low():
    w = weather("cloudy", DRY, DAYS)
    assert outside.forecast_reply(w, "", "tomorrow", "max", "", EN, NOW, S) == "The high tomorrow is 12°C."
    assert outside.forecast_reply(w, "", "sat", "min", "", EN, NOW, S) == "The low on Saturday is 4°C."
    assert outside.forecast_reply(w, "", "tonight", "both", "", EN, NOW, S) == \
        "The high tonight is 7°C, and the low 5°C."
    assert outside.forecast_reply(w, "", "weekend", "max", "", EN, NOW, S) == \
        "The high this weekend is 14°C."


def test_summaries():
    w = weather("rainy", WET, DAYS)
    assert outside.forecast_reply(w, "", "tomorrow", "", "", EN, NOW, S) == \
        "Tomorrow: cloudy, a high of 12°C and a low of 4°C, 30% chance of rain."
    assert outside.forecast_reply(w, "", "today", "", "", EN, NOW, S) == \
        "It's raining and 7°C. Today: rainy, a high of 11°C and a low of 5°C, 0.4 mm of rain."
    assert outside.forecast_reply(w, "", "weekend", "", "", EN, NOW, S) == \
        "Saturday: cloudy, up to 12°C. Sunday: sunny, up to 14°C."
    assert outside.forecast_reply(weather("cloudy", WET, DAYS), "", "tonight", "", "", EN, NOW, S) == \
        "Tonight: rainy, 6 to 7°C, rain likely from about 6 pm."
    assert outside.forecast_reply(weather(), "", "", "", "", EN, NOW, S) == "I have no forecast."


def test_gear():
    assert outside.gear_reply(weather("cloudy", WET), "rain", "", EN, NOW, S) == \
        "Yes, rain is likely from about 6 pm (80% chance)."
    assert outside.gear_reply(weather("cloudy", DRY), "rain", "", EN, NOW, S) == \
        "No, no rain is forecast in the next 12 hours."
    assert outside.gear_reply(weather("rainy", WET), "rain", "", EN, NOW, S) == "Yes, it's raining now."
    assert outside.gear_reply(weather("cloudy", DRY), "cold", "", EN, NOW, S) == \
        "Yes, it gets down to 5°C in the next 12 hours."
    assert outside.gear_reply(weather("cloudy", DRY), "warm", "", EN, NOW, S) == \
        "Probably not: it only gets up to 8°C in the next 12 hours."
    assert outside.gear_reply(weather("cloudy", DRY), "sun", "", EN, NOW, S) is None
    sunny = [hour(h, cond="sunny", uv=5) for h in range(15, 20)]
    assert outside.gear_reply(weather("sunny", sunny), "sun", "", EN, NOW, S) == \
        "Yes, the UV index reaches 5 in the next 12 hours."


def test_place_and_whole_degrees():
    w = weather("cloudy", DRY, [day(1, cond="partlycloudy", temp=11.4, low=4.2)], place="Whistler")
    assert outside.forecast_reply(w, "", "tomorrow", "max", "", EN, NOW, S) == \
        "The high tomorrow in Whistler is 11°C."
    assert outside.forecast_reply(w, "snow", "tomorrow", "", "", EN, NOW, S) == \
        "No snow is forecast tomorrow in Whistler. It should be cloudy."


def test_fahrenheit_thresholds():
    w = weather(temperature=45, temperature_unit="°F")
    assert outside.now_reply(w, "cold", "", EN, NOW, S) == "Yes, it's cold: 45°F."
    assert outside.now_reply(weather(temperature=55, temperature_unit="°F"), "cold", "", EN, NOW, S) == \
        "No, it's 55°F."


def sun_day(off, rise=(7, 59), set_=(17, 53)):
    base = NOW.replace(hour=0, minute=0) + timedelta(days=off)
    return {"dawn": base.replace(hour=rise[0] - 1, minute=25), "sunrise": base.replace(hour=rise[0], minute=rise[1]),
            "noon": base.replace(hour=12, minute=56), "sunset": base.replace(hour=set_[0], minute=set_[1] - off * 2),
            "dusk": base.replace(hour=set_[0], minute=set_[1] + 3)}


TIMES = {o: sun_day(o) for o in (-1, 0, 1, 2)}


def test_sun():
    assert outside.sun_reply(TIMES, "sunset", "", "", "", EN, NOW) == \
        "Sunset is at 5:53 pm, in 2 hours and 49 minutes."
    assert outside.sun_reply(TIMES, "sunset", "", "until", "", EN, NOW) == \
        "Sunset is in 2 hours and 49 minutes, at 5:53 pm."
    # Today's sunrise has passed: tomorrow's.
    assert outside.sun_reply(TIMES, "sunrise", "", "", "", EN, NOW) == \
        "Sunrise is tomorrow at 7:59 am, in 16 hours and 55 minutes."
    assert outside.sun_reply(TIMES, "sunrise", "today", "", "", EN, NOW) == "Sunrise was at 7:59 am."
    assert outside.sun_reply(TIMES, "", "", "", "dark", EN, NOW) == \
        "No, it's light. It gets dark at 5:56 pm."
    late = NOW.replace(hour=21)
    assert outside.sun_reply(TIMES, "", "", "", "dark", EN, late) == \
        "Yes, it's dark. It gets light tomorrow at 6:25 am."
    assert outside.sun_reply(TIMES, "", "today", "", "", EN, NOW) == \
        "There's 9 hours and 54 minutes of daylight today. That's 2 minutes less than the day before."


@pytest.mark.parametrize("phase,k,want", [
    ("new", 300, datetime(2024, 4, 8, 18, 21, tzinfo=timezone.utc)),
    ("full", 300.5, datetime(2024, 4, 23, 23, 49, tzinfo=timezone.utc)),
    ("new", 0, datetime(2000, 1, 6, 18, 14, tzinfo=timezone.utc))])
def test_moon_events(phase, k, want):
    assert abs((outside.moon_event(k) - want).total_seconds()) < 10 * 60


def test_moon_now_and_next():
    full = datetime(2024, 4, 23, 23, 49, tzinfo=timezone.utc)
    assert outside.moon_now(full)[0] == "full"
    assert outside.moon_now(full)[1] > 0.99
    assert outside.moon_now(full + timedelta(days=4))[0] == "waning_gibbous"
    assert outside.moon_now(full - timedelta(days=11))[0] == "waxing_crescent"
    assert outside.moon_events(full - timedelta(days=1), "full") == outside.moon_event(300.5)
    said = outside.moon_reply("", "full", EN, NOW)
    assert said.startswith("The next full moon is ")
    assert outside.moon_reply("full", "", EN, NOW).startswith(("Yes", "No"))


# ------------------------------------------------------------ the sentences

hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, S, "en"))

SENTENCES = [
    ("is it raining", "weather_now", {"ask": "rain"}),
    ("what's the weather like", "weather_now", {}),
    ("what's the weather in vancouver", "weather_now", {"place": "vancouver"}),
    ("is it sunny in london", "weather_now", {"ask": "sun", "place": "london"}),
    ("is it snowing in toronto", "weather_now", {"ask": "snow", "place": "toronto"}),
    ("what is the weather in paris", "weather_now", {"place": "paris"}),
    ("how's the weather in toronto", "weather_now", {"place": "toronto"}),
    ("how's the weather looking tomorrow", "weather_forecast", {"span": "tomorrow"}),
    ("how cold is it outside", "weather_now", {"aspect": "temp"}),
    ("what's the temperature outside", "weather_now", {"aspect": "temp"}),
    ("will it rain tomorrow", "weather_forecast", {"ask": "rain", "span": "tomorrow"}),
    ("is it going to snow this weekend", "weather_forecast", {"ask": "snow", "span": "weekend"}),
    ("when will it stop raining", "weather_forecast", {"ask": "rain", "change": "stop"}),
    ("when will the rain stop", "weather_forecast", {"ask": "rain", "change": "stop"}),
    ("what's the high tomorrow", "weather_forecast", {"hilo": "max", "span": "tomorrow"}),
    ("how hot will it get today", "weather_forecast", {"hilo": "max", "span": "today"}),
    ("what's the forecast for the weekend", "weather_forecast", {"span": "weekend"}),
    ("what's the weather like on saturday", "weather_forecast", {"span": "sat"}),
    ("do I need an umbrella", "weather_gear", {"gear": "rain"}),
    ("should I wear a coat tomorrow", "weather_gear", {"gear": "cold", "span": "tomorrow"}),
    ("when is sunset", "sun", {"sun_event": "sunset"}),
    ("what time does the sun rise tomorrow", "sun", {"sun_event": "sunrise", "day": "tomorrow"}),
    ("how long until sunset", "sun", {"until": "until", "sun_event": "sunset"}),
    ("is it dark outside", "sun", {"light": "dark"}),
    ("how much daylight is there today", "sun", {"day": "today"}),
    ("what's the moon phase", "moon", {}),
    ("is it a full moon tonight", "moon", {"phase": "full"}),
    ("when is the next full moon", "moon", {"phase": "full", "when": "1"}),
]


@pytest.mark.parametrize("text,cmd,want", SENTENCES)
def test_sentences(text, cmd, want):
    got = [(brain.command_of(r.intent.name), {k: str(v.value) for k, v in r.entities.items()})
           for r in hassil.recognize_all(text, INTENTS)]
    assert any(c == cmd and all(s.get(k) == v for k, v in want.items()) for c, s in got), got


@pytest.mark.parametrize("text", ["is it raining", "is it windy"])
def test_now_is_not_forecast(text):
    got = {brain.command_of(r.intent.name) for r in hassil.recognize_all(text, INTENTS)}
    assert "weather_forecast" not in got
