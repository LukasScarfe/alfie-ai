from datetime import date

import pytest

from alfie.speech import English, load_language, speak, split_ready

TODAY = date(2026, 10, 30)

# What an agent wrote -> what Alfie says, with the default settings.
SAID = [
    # the 2026-10-30 voice runs
    ("The temperature outside is 18°C, and the indoor temperature is 22°C.",
     "The temperature outside is eighteen degrees, and the indoor temperature is twenty-two degrees."),
    ("The Monstera moisture level is 38%.", "The Monstera moisture level is thirty-eight percent."),
    ("Timer set for 30 seconds", "Timer set for thirty seconds"),
    ("over a period of about 1,500 years, between the 12th and 2nd centuries BCE",
     "over a period of about one thousand five hundred years, between the twelfth and second "
     "centuries B.C.E."),
    # years
    ("It was published in 1884.", "It was published in eighteen eighty-four."),
    ("1884 was a good year.", "eighteen eighty-four was a good year."),
    ("Born in 1884, he", "Born in eighteen eighty-four, he"),
    ("In 1884; then 1990.", "In eighteen eighty-four; then nineteen ninety."),
    ("The year 2005 and 2026.", "The year two thousand five and twenty twenty-six."),
    ("in 1905 and 1900", "in nineteen oh five and nineteen hundred"),
    ("in 800 AD", "in eight hundred A.D."),
    ("It ended in 500 BC. Then", "It ended in five hundred B.C. Then"),
    ("the 2nd century BCE.", "the second century B.C.E."),
    ("Well... maybe", "Well... maybe"),
    ("the 1980s and '90s", "the nineteen eighties and nineties"),
    ("We have 2000 people and 3 dogs.", "We have two thousand people and three dogs."),
    # times
    ("It is 21:45.", "It is nine forty-five in the evening."),
    ("It's 9:05 PM.", "It's nine oh five in the evening."),
    ("at 7am and 12:00 pm.", "at seven in the morning and noon."),
    ("at 9 p.m. and then", "at nine in the evening and then"),
    ("at 9:30", "at nine thirty"),
    ("at 00:00", "at midnight"),
    # dates
    ("on 2026-10-30", "on October thirtieth"),
    ("on 10/30/2026", "on October thirtieth"),
    ("on 30/10/2026", "on October thirtieth"),
    ("on October 30th, 2026", "on October thirtieth"),
    ("on the 12th of October 2025", "on October twelfth, twenty twenty-five"),
    ("on 2026-11-02T07:30", "on November second at seven thirty in the morning"),
    # measurements
    ("wind 12 km/h, gusts 1 km/h", "wind twelve kilometres an hour, gusts one kilometre an hour"),
    ("it was 21.37 °C", "it was twenty-one point four degrees"),
    ("It is -5 °C", "It is minus five degrees"),
    ("18 degrees C outside", "18 degrees outside".replace("18", "eighteen")),
    ("PM2.5 is 12 µg/m³.", "PM2.5 is twelve micrograms per cubic metre."),
    ("Uses 1.5 kWh, e.g. a lot.", "Uses one point five kilowatt hours, for example a lot."),
    ("It costs $5.20, or $1,500.", "It costs five dollars twenty, or one thousand five hundred dollars."),
    ("1/2 cup", "a half cup"),
    ("the 10-12 range", "the ten to twelve range"),
    ("30 s", "thirty seconds"),
    # left alone
    ("qwen3 runs on a B580", "qwen3 runs on a B580"),
    # markdown, links, emoji
    ("**Weather:**\n- Rain\n- 7°C", "Weather: Rain. seven degrees"),
    ("See [the docs](https://x.org) 🙂", "See the docs"),
    ("Read https://example.com now", "Read now"),
]


@pytest.mark.parametrize("text,said", SAID)
def test_said(text, said):
    assert speak(text, today=TODAY) == said


def test_settings():
    assert speak("It's 21:45", {"time_style": "24h"}) == "It's twenty-one forty-five"
    assert speak("It's 21:45", {"time_style": "casual"}) == "It's quarter to ten in the evening"
    assert speak("9:15 am", {"time_style": "casual", "time_period": "ampm"}) == "quarter past nine AM"
    assert speak("9:15 am", {"time_period": "none"}) == "nine fifteen"
    assert speak("21:00", {"time_style": "24h"}) == "twenty-one hundred"
    assert speak("in 2026", {"years_2000": "thousand", "and": True}) == "in two thousand and twenty-six"
    assert speak("in 1884", {"years": "number"}) == "in one thousand eight hundred eighty-four"
    assert speak("in 1884", {"years": "off", "numbers": False}) == "in 1884"
    assert speak("105", {"and": True}) == "one hundred and five"
    assert speak("on 2026-10-30", {"date_style": "day_month", "date_year": "always"}) == \
        "on the thirtieth of October, twenty twenty-six"
    assert speak("on 2026-10-30", {"date_style": "off", "numbers": False}) == "on 2026-10-30"
    assert speak("on 05/04/2026", {"numeric_dates": "day_first"}, today=TODAY) == "on April fifth"
    assert speak("It is 18°C", {"temperature_unit": True}) == "It is eighteen degrees Celsius"
    assert speak("2 km", {"units": False}) == "two km"
    assert speak("21.37", {"decimals": 2}) == "twenty-one point three seven"
    assert speak("Hey Monstera", {"replacements": [{"from": "monstera", "to": "mon-stair-uh"}]}) == \
        "Hey mon-stair-uh"
    assert speak("**bold**", {"markdown": False}) == "**bold**"


def test_this_year_needs_today():
    assert speak("on 2026-10-30") == "on October thirtieth, twenty twenty-six"


def test_language_without_words_only_does_the_plain_passes():
    assert load_language("xx") is None
    assert speak("Il fait **18°C**", language="xx") == "Il fait 18°C"
    assert load_language("en-GB")["code"] == "en"


def test_number_words():
    en = English(load_language("en"), False)
    assert en.cardinal(0) == "zero"
    assert en.cardinal(1_000_005) == "one million five"
    assert en.cardinal(-42) == "minus forty-two"
    assert [en.ordinal(n) for n in (1, 2, 3, 5, 12, 20, 21, 30, 100)] == [
        "first", "second", "third", "fifth", "twelfth", "twentieth", "twenty-first", "thirtieth",
        "one hundred th".replace(" th", "th")]
    assert en.year(1066, "twenty") == "ten sixty-six"
    assert en.year(2000, "twenty") == "two thousand"
    assert en.year(2010, "twenty") == "twenty ten"
    assert en.decade(1900) == "nineteen hundreds"


def test_split_ready_cuts_only_finished_sentences():
    assert split_ready("It is 2.") == ("", "It is 2.")
    assert split_ready("It is 2.5 degrees. And then") == ("It is 2.5 degrees. ", "And then")
    assert split_ready("One!\nTwo") == ("One!\n", "Two")


def test_config_section():
    from test_config import FACE
    from alfie.config import ConfigError, default_config, validate
    cfg = validate(default_config(), FACE)
    assert cfg["speech"]["engine"] == "" and cfg["speech"]["years"] == "pairs"
    got = validate({"speech": {"engine": "tts.piper", "decimals": 2,
                               "replacements": [{"from": " Monstera ", "to": "mon-stair-uh"}]}}, FACE)
    assert got["speech"]["engine"] == "tts.piper" and got["speech"]["decimals"] == 2
    assert got["speech"]["replacements"] == [{"from": "Monstera", "to": "mon-stair-uh"}]
    assert validate({"speech": {"replacements": [{"from": "", "to": ""}]}}, FACE)["speech"]["replacements"] == []
    for bad in ({"engine": "tts.alfie_voice"}, {"engine": "media_player.x"}, {"years": "roman"},
                {"replacements": ["x"]}):
        with pytest.raises(ConfigError):
            validate({"speech": bad}, FACE)
