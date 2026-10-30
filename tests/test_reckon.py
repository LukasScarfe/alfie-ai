from datetime import date, datetime, timedelta, timezone

import pytest

from alfie import brain, reckon

EN = brain.load_language("en")
TODAY = date(2026, 10, 30)                # a Friday
NAMED = reckon.holidays(EN, ["Lukas's birthday: 03-14", "Our anniversary: 2019-06-01"])


# ------------------------------------------------------------ numbers and sums

@pytest.mark.parametrize("text,value", [
    ("12", 12), ("two hundred and five", 205), ("a hundred", 100), ("three point five", 3.5),
    ("twenty one", 21), ("1.5", 1.5), ("2 million", 2e6), ("one thousand two hundred", 1200),
    ("seventy", 70)])
def test_numbers(text, value):
    assert reckon.parse_number(text) == value


@pytest.mark.parametrize("text,said", [
    ("12 times 7", "12 times 7 is 84."), ("15% of 80", "15% of 80 is 12."),
    ("the square root of 144", "Square root of 144 is 12."),
    ("2 plus 3 times 4", "2 plus 3 times 4 is 14."), ("10 divided by 3", "10 divided by 3 is 3.33."),
    ("2 to the power of 10", "2 to the power of 10 is 1024."), ("five squared", "Five squared is 25."),
    ("minus 4 plus 10", "Minus 4 plus 10 is 6."), ("half of 90", "Half of 90 is 45."),
    ("7 x 6", "7 x 6 is 42."), ("12*12", "12*12 is 144.")])
def test_sums(text, said):
    assert reckon.sum_reply(text, EN) == said


@pytest.mark.parametrize("text", ["the office temperature", "the time difference with tokyo",
                                  "12", "times", "the weather"])
def test_not_sums(text):
    assert reckon.sum_reply(text, EN) is None


def test_divide_by_zero():
    assert reckon.sum_reply("5 divided by 0", EN) == "You can't divide by zero."


# ------------------------------------------------------------ units

@pytest.mark.parametrize("amount,src,dst,system,said", [
    ("5", "mi", "km", "us", "5 miles is 8.05 kilometres."),
    ("30", "c", "f", "us", "30 degrees Celsius is 86 degrees Fahrenheit."),
    ("a", "l", "cup", "us", "1 litre is 4.23 cups."),
    ("a", "l", "cup", "uk", "1 litre is 4 cups."),
    ("a", "mi", "ft", "us", "1 mile is 5280 feet."),
    ("ten", "kg", "lb", "us", "10 kilograms is 22 pounds."),
    ("1", "kg", "km", "us", "I can't turn kilograms into kilometres.")])
def test_convert(amount, src, dst, system, said):
    assert reckon.convert_reply(amount, src, dst, EN, system) == said


def test_convert_not_a_number():
    assert reckon.convert_reply("lots of", "mi", "km", EN) is None


# ------------------------------------------------------------ dates

def test_easter_and_rules():
    assert reckon.easter(2026) == date(2026, 4, 5)
    assert reckon.easter(2027) == date(2027, 3, 28)
    assert reckon.rule("10/mon/2")(2026) == date(2026, 10, 12)       # Thanksgiving
    assert reckon.rule("11/thu/4")(2026) == date(2026, 11, 26)
    assert reckon.rule("05/mon/-1")(2026) == date(2026, 5, 25)       # Memorial Day
    assert reckon.rule("05/mon/<25")(2026) == date(2026, 5, 18)      # Victoria Day
    assert reckon.rule("05/mon/<25")(2027) == date(2027, 5, 24)
    assert reckon.rule("02-29")(2027) == date(2027, 2, 28)


@pytest.mark.parametrize("text,want", [
    ("christmas", date(2026, 12, 25)), ("tomorrow", date(2026, 10, 31)), ("friday", TODAY),
    ("next friday", date(2026, 11, 6)), ("last friday", date(2026, 10, 23)),
    ("monday", date(2026, 11, 2)), ("in 3 weeks", date(2026, 11, 20)),
    ("100 days ago", date(2026, 7, 22)), ("it 100 days ago", date(2026, 7, 22)),
    ("25 december", date(2026, 12, 25)),
    ("the 3rd of march 2027", date(2027, 3, 3)), ("december 25th", date(2026, 12, 25)),
    ("the 5th", date(2026, 11, 5)), ("lukas's birthday", date(2027, 3, 14)),
    ("easter", date(2027, 3, 28)), ("a month from now", date(2026, 11, 30)),
    ("christmas 2027", date(2027, 12, 25)), ("next week", date(2026, 11, 6))])
def test_parse_when(text, want):
    w = reckon.parse_when(text, TODAY, NAMED)
    assert w is not None and w.on(TODAY) == want


@pytest.mark.parametrize("text", ["the office temperature", "sunset", "my dentist", "the 45th"])
def test_not_dates(text):
    w = reckon.parse_when(text, TODAY, NAMED)
    assert w is None or w.on(TODAY) is None


@pytest.mark.parametrize("ask,text,said", [
    ("until", "christmas", "Christmas is in 56 days, on Friday 25 December."),
    ("sleeps", "christmas", "Christmas is in 56 sleeps, on Friday 25 December."),
    ("weeks", "christmas", "Christmas is in 8 weeks, on Friday 25 December."),
    ("until", "halloween", "Halloween is tomorrow."),
    ("until", "25 november", "Wednesday 25 November is in 26 days."),
    ("since", "new year", "New Year's Day was 302 days ago, on Thursday 1 January."),
    ("since", "christmas", "Christmas was 309 days ago, on Thursday 25 December 2025."),
    ("dow", "christmas", "Christmas is a Friday."),
    ("dow", "the 4th of july 1976", "4 July 1976 was a Sunday."),
    ("dow", "it", "Today is Friday 30 October."),
    ("date", "in 3 weeks", "That's Friday 20 November."),
    ("date", "100 days ago", "That was Wednesday 22 July."),
    ("when", "easter", "Easter is on Sunday 28 March 2027, in 149 days."),
    ("when", "our anniversary", "Our anniversary is on Tuesday 1 June 2027, in 214 days."),
    ("until", "friday", "That is today!")])
def test_date_replies(ask, text, said):
    assert reckon.date_reply(ask, text, TODAY, EN, NAMED) == said


def test_not_a_date_reply():
    assert reckon.date_reply("when", "sunset", TODAY, EN, NAMED) is None


@pytest.mark.parametrize("ask,text,said", [
    ("week", "", "It's week 44."),
    ("year_left", "", "It's day 303 of 365, with 62 days left in the year."),
    ("month_left", "", "1 day left in October."),
    ("leap", "", "No, 2026 isn't a leap year. The next one is 2028."),
    ("leap", "2028", "Yes, 2028 is a leap year.")])
def test_calendar(ask, text, said):
    assert reckon.calendar_reply(ask, text, TODAY, EN) == said


# ------------------------------------------------------------ world clocks

def test_world_time():
    zi = pytest.importorskip("zoneinfo")
    try:
        london, tokyo = zi.ZoneInfo("Europe/London"), zi.ZoneInfo("Asia/Tokyo")
        vancouver = zi.ZoneInfo("America/Vancouver")
    except zi.ZoneInfoNotFoundError:
        pytest.skip("no time zone data")
    here = datetime(2026, 10, 30, 15, 4, tzinfo=vancouver)
    assert reckon.world_reply("time", "london", here, here.astimezone(london), EN) == \
        "It's 10:04 pm in London, 7 hours ahead of here."
    assert reckon.world_reply("time", "tokyo", here, here.astimezone(tokyo), EN) == \
        "It's 7:04 am on Saturday in Tokyo, 16 hours ahead of here."
    assert reckon.world_reply("diff", "the uk", here, here.astimezone(london), EN) == \
        "Uk is 7 hours ahead of here."
    zones = reckon.zone_names(["America/New_York", "Europe/London", "Etc/GMT+5"])
    assert reckon.find_zone("new york", zones, EN) == "America/New_York"
    assert reckon.find_zone("japan", zones, EN) == "Asia/Tokyo"
    assert reckon.find_zone("the kitchen", zones, EN) is None


# ------------------------------------------------------------ the sentences

hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, brain.default_settings(), "en"))

SENTENCES = [
    ("what time is it in london", "world_time", {"place": "london"}),
    ("what's the time difference with tokyo", "world_time", {"wt": "diff", "place": "tokyo"}),
    ("how many days until christmas", "dates", {"ask": "until", "date": "christmas"}),
    ("how many sleeps until christmas", "dates", {"ask": "sleeps", "date": "christmas"}),
    ("what day is christmas", "dates", {"ask": "dow", "date": "christmas"}),
    ("what's the date in 3 weeks", "dates", {"ask": "date", "date": "in 3 weeks"}),
    ("when is easter", "dates", {"ask": "when", "date": "easter"}),
    ("what week is it", "dates", {"ask": "week"}),
    ("is 2028 a leap year", "dates", {"ask": "leap", "date": "2028"}),
    ("what's 12 times 7", "maths", {"expr": "12 times 7"}),
    ("convert 5 miles to km", "convert", {"value": "5", "src": "mi", "dst": "km"}),
    ("how many cups in a litre", "convert", {"dst": "cup", "src": "l"}),
    ("what's 30 celsius in fahrenheit", "convert", {"value": "30", "src": "c", "dst": "f"}),
]


@pytest.mark.parametrize("text,cmd,want", SENTENCES)
def test_sentences(text, cmd, want):
    got = [(brain.command_of(r.intent.name), {k: str(v.value) for k, v in r.entities.items()})
           for r in hassil.recognize_all(text, INTENTS)]
    assert any(c == cmd and all(s.get(k) == v for k, v in want.items()) for c, s in got), got
