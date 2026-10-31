from datetime import date, datetime, timedelta
from zoneinfo import ZoneInfo

import pytest

from alfie import brain, household as H, reckon

EN = brain.load_language("en")
TZ = ZoneInfo("America/Vancouver")
NOW = datetime(2026, 10, 30, 18, 0, tzinfo=TZ)          # a Friday evening


# ------------------------------------------------------------ people

def person(name, state, changes=(), start=None):
    return H.Person(f"person.{name.lower()}", name, state, list(changes),
                    last_changed=NOW - timedelta(minutes=5), start=start)


LUKAS = person("Lukas", "home")
MICHELLE = person("Michelle", "Michelle School")


@pytest.mark.parametrize("ask,people,said", [
    ("who", [LUKAS, MICHELLE], "Lukas is home. Michelle is at Michelle School."),
    ("who", [LUKAS, person("Kat", "home")], "Everyone's home: Lukas and Kat."),
    ("who", [person("Kat", "not_home")], "Nobody's home. Kat is out."),
    ("anyone", [LUKAS, MICHELLE], "Yes, Lukas is home."),
    ("anyone", [MICHELLE], "No, nobody's home."),
    ("everyone", [LUKAS, MICHELLE], "No. Michelle is at Michelle School."),
    ("everyone", [LUKAS], "Yes, everyone's home.")])
def test_who_is_home(ask, people, said):
    assert H.people_reply(ask, people, None, EN, NOW) == said


@pytest.mark.parametrize("ask,who,said", [
    ("home", LUKAS, "Yes, Lukas is home."),
    ("home", MICHELLE, "No, Michelle is at Michelle School."),
    ("away", MICHELLE, "Yes, Michelle is at Michelle School."),
    ("away", LUKAS, "No, Lukas is home."),
    ("where", person("Kat", "not_home"), "Kat is out."),
    ("where", person("Kat", "unknown"), "I don't know where Kat is.")])
def test_one_person(ask, who, said):
    assert H.people_reply(ask, [LUKAS, MICHELLE], who, EN, NOW) == said


def test_how_long_and_when_from_history():
    start = NOW - timedelta(days=7)
    changes = [(start, "home"), (NOW - timedelta(hours=9), "not_home"),
               (NOW - timedelta(hours=8, minutes=40), "Michelle School")]
    m = person("Michelle", "Michelle School", changes, start)
    assert H.people_reply("how_long", [m], m, EN, NOW) == \
        "Michelle has been at Michelle School for 9 hours."
    assert H.people_reply("left", [m], m, EN, NOW) == "Michelle left at 9 am."
    assert H.people_reply("arrived", [m], m, EN, NOW) == \
        "Michelle isn't home yet. Michelle left at 9 am."
    home = person("Lukas", "home", [(start, "home")], start)
    assert H.people_reply("how_long", [home], home, EN, NOW) == "Lukas has been home for over a week."
    back = person("Lukas", "home", [(start, "not_home"), (NOW - timedelta(days=1, hours=2), "home")], start)
    assert H.people_reply("arrived", [back], back, EN, NOW) == "Lukas got home yesterday at 4 pm."


def test_no_person_named():
    assert H.people_reply("where", [LUKAS], None, EN, NOW) is None
    assert H.people_reply("who", [], None, EN, NOW) is None


# ------------------------------------------------------------ media

SONG = {"media_title": "Something Serious", "media_artist": "Bruno Mars",
        "media_album_name": "Doo-Wops", "device_class": "speaker"}
RECORD = H.Player("media_player.record_player", "Record player", "playing", SONG)
MA = H.Player("media_player.wiim", "Record player music", "playing", SONG)
TV = H.Player("media_player.tv", "TV", "on", {"device_class": "tv", "source": "YouTube"})
KITCHEN = H.Player("media_player.kitchen", "Kitchen speaker", "idle",
                   {"media_title": "Old song", "media_artist": "Someone"})


@pytest.mark.parametrize("ask,players,said", [
    ("playing", [MA, RECORD, KITCHEN], "It's Something Serious by Bruno Mars on the Record player."),
    ("anything", [KITCHEN], "No, nothing's playing."),
    ("playing", [KITCHEN], "Nothing's playing."),
    ("song", [RECORD], "It's Something Serious by Bruno Mars."),
    ("artist", [RECORD], "That's Bruno Mars."),
    ("album", [RECORD], "It's from Doo-Wops."),
    ("anything", [RECORD], "Yes, Something Serious by Bruno Mars on the Record player."),
    ("tv", [TV, RECORD], "The TV is showing YouTube."),
    ("playing", [H.Player("media_player.p", "Plex", "playing",
                          {"media_title": "Taxi Service", "media_series_title": "Nathan for You"})],
     "It's Nathan for You: Taxi Service on the Plex.")])
def test_media(ask, players, said):
    assert H.media_reply(ask, players, EN) == said


def test_media_paused_and_named():
    paused = H.Player("media_player.k", "Kitchen speaker", "paused", SONG)
    assert H.media_reply("playing", [paused], EN) == \
        "Nothing's playing. Something Serious by Bruno Mars is paused on the Kitchen speaker."
    assert H.media_reply("playing", [RECORD, KITCHEN], EN, named=KITCHEN) == \
        "Nothing's playing on the Kitchen speaker."
    assert H.media_reply("tv", [RECORD], EN) is None
    off = H.Player("media_player.tv", "TV", "off", {"device_class": "tv"})
    assert H.media_reply("tv", [off], EN) == "The TV is off."


# ------------------------------------------------------------ calendar

RESPONSE = {
    "calendar.family": {"events": [
        {"start": "2026-11-01", "end": "2026-11-02", "summary": "PAY RENT!!!"},
        {"start": "2026-11-01T17:30:00-07:00", "end": "2026-11-01T18:30:00-07:00",
         "summary": "PoPo bday dinner"},
        {"start": "2026-11-04T19:30:00-07:00", "end": "2026-11-04T21:00:00-07:00", "summary": "Dance"},
        {"start": "2026-11-11T19:30:00-07:00", "end": "2026-11-11T21:00:00-07:00", "summary": "Dance"},
        {"start": "2026-11-12", "end": "2026-11-13", "summary": "Scarfe Dad Birthday"},
        {"start": "2026-10-30T17:00:00-07:00", "end": "2026-10-30T19:00:00-07:00", "summary": "Games"},
        {"start": "bad", "summary": "Broken"}]},
    "calendar.holidays": {"events": [
        {"start": "2026-10-31", "end": "2026-11-01", "summary": "Halloween"},
        {"start": "2026-12-24", "end": "2026-12-25", "summary": "Christmas Eve"},
        {"start": "2026-12-25", "end": "2026-12-26", "summary": "Christmas Day (regional holiday)"},
        {"start": "2026-12-26", "end": "2026-12-27", "summary": "Boxing Day / Christmas Holiday (regional holiday)"},
        {"start": "2027-03-28", "end": "2027-03-29", "summary": "Easter Sunday"},
        {"start": "2027-03-29", "end": "2027-03-30", "summary": "Easter Monday (regional holiday)"},
        {"start": "2027-05-09", "end": "2027-05-10", "summary": "Mother’s Day"}]},
    "calendar.holidays_2": {"events": [
        {"start": "2026-10-31", "end": "2026-11-01", "summary": "Halloween"}]},
}
EVENTS = H.parse_events(RESPONSE, TZ)


def test_parse_events():
    titles = [e.title for e in EVENTS]
    assert titles.count("Halloween") == 1 and "Broken" not in titles
    assert titles[0] == "Games"
    assert EVENTS[titles.index("Christmas Day (regional holiday)")].said == "Christmas Day"
    assert EVENTS[titles.index("Boxing Day / Christmas Holiday (regional holiday)")].said == "Boxing Day"


@pytest.mark.parametrize("ask,span,said", [
    ("on", "today", "Today you've got Games at 5 pm."),
    ("on", "tomorrow", "Tomorrow you've got Halloween."),
    ("on", "sun", "On Sunday you've got PAY RENT!!! and PoPo bday dinner at 5:30 pm."),
    ("on", "next_week", "Next week you've got Dance on Wednesday at 7:30 pm."),
    ("on", "weekend", "This weekend you've got Halloween tomorrow, PAY RENT!!! on Sunday and "
                      "PoPo bday dinner on Sunday at 5:30 pm."),
    ("any", "mon", "No, your calendar is clear on Monday."),
    ("free", "mon", "Yes, your calendar is clear on Monday."),
    ("free", "sun", "No, on Sunday you've got PAY RENT!!! and PoPo bday dinner at 5:30 pm."),
    ("next", "", "Next is Halloween tomorrow.")])
def test_events(ask, span, said):
    assert H.events_reply(ask, span, EVENTS, EN, NOW) == said


def test_events_cut_to_most():
    said = H.events_reply("on", "coming", EVENTS, EN, NOW, most=2)
    assert said.endswith("and 3 more.")


@pytest.mark.parametrize("asked,said", [
    ("dance", "Dance is on Wednesday at 7:30 pm, in 5 days."),
    ("christmas", "Christmas Day is on Friday 25 December, in 56 days."),
    ("dad's birthday", "Scarfe Dad Birthday is on Thursday 12 November, in 13 days."),
    ("popo's birthday dinner", "PoPo bday dinner is on Sunday at 5:30 pm, in 2 days."),
    ("games", "Games is on now, until 7 pm."),
    ("halloween", "Halloween is tomorrow.")])
def test_when(asked, said):
    assert H.when_reply(asked, EVENTS, EN, NOW) == said


def test_when_nothing_fits():
    assert H.when_reply("the dentist", EVENTS, EN, NOW) is None
    assert H.when_reply("the", EVENTS, EN, NOW) is None


@pytest.mark.parametrize("asked,day,title", [
    ("christmas", date(2026, 12, 25), "Christmas Day"),
    ("easter", date(2027, 3, 28), "Easter Sunday"),
    ("mother's day", date(2027, 5, 9), "Mother’s Day"),
    ("boxing day", date(2026, 12, 26), "Boxing Day")])
def test_event_dates_for_reckon(asked, day, title):
    assert H.event_date(asked, EVENTS, NOW.date()) == (day, title)


def test_calendar_dates_feed_reckon():
    named = {**reckon.holidays(EN)}
    d, title = H.event_date("christmas", EVENTS, NOW.date())
    named["christmas"] = reckon.When(fixed=d, name=title)
    assert reckon.date_reply("sleeps", "christmas", NOW.date(), EN, named) == \
        "Christmas Day is in 56 sleeps, on Friday 25 December."


def test_date_key():
    assert reckon.date_key("next christmas 2027") == ("christmas", "next_strict", 2027)
    assert reckon.date_key("the 25th") == ("25th", "", 0)


# ------------------------------------------------------------ lists

ITEMS = ["Milk 2%", "Eggs", "Bread", "Apples", "Cheese"]


@pytest.mark.parametrize("ask,name,items,item,said", [
    ("items", "Groceries", ITEMS, "", "The Groceries list has 5 things: Milk 2%, Eggs, Bread, Apples and Cheese."),
    ("items", "Shopping list", [], "", "The Shopping list is empty."),
    ("count", "Chores", ["Bins"], "", "There is 1 thing on the Chores list."),
    ("count", "Groceries", ITEMS, "", "There are 5 things on the Groceries list."),
    ("has", "Groceries", ITEMS, "milk", "Yes, Milk 2% is on the Groceries list."),
    ("has", "Groceries", ITEMS, "bananas", "No, bananas isn't on the Groceries list.")])
def test_lists(ask, name, items, item, said):
    assert H.list_reply(ask, name, items, EN, item) == said


def test_list_cut():
    assert H.list_reply("items", "Registry", [f"thing {i}" for i in range(27)], EN, most=3).endswith(
        "thing 0, thing 1, thing 2 and 24 more.")


# ------------------------------------------------------------ voice actions

def test_run_reply():
    assert H.run_reply("Gaming PC", EN) == "OK, Gaming PC."
    assert H.run_reply("Gaming PC", EN, "Waking {name} up.") == "Waking Gaming PC up."
    assert H.run_reply("Gaming PC", EN, "Bad {nope}") == "Bad {nope}"
    assert H.run_reply("Gaming PC", EN, failed=True) == "Gaming PC didn't start."


# ------------------------------------------------------------ sentences

hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, brain.default_settings(), "en"))

SENTENCES = [
    ("turn on the gaming pc", "run", {"name": "gaming pc"}),
    ("start movie night", "run", {"name": "movie night"}),
    ("turn the gaming pc on", "run", {"name": "gaming pc"}),
    ("it's movie time", "run", {"name": "movie time"}),
    ("time for bed", "run", {"name": "bed"}),
    ("goodnight", "run", {"name": "goodnight"}),
    ("who's home", "people", {"ask": "who"}),
    ("is anyone home", "people", {"ask": "anyone"}),
    ("is everyone home", "people", {"ask": "everyone"}),
    ("is michelle home", "people", {"ask": "home", "name": "michelle"}),
    ("is lukas out", "people", {"ask": "away", "name": "lukas"}),
    ("where is michelle", "people", {"ask": "where", "name": "michelle"}),
    ("how long has lukas been home", "people", {"ask": "how_long", "name": "lukas"}),
    ("when did michelle leave", "people", {"ask": "left", "name": "michelle"}),
    ("when did lukas get home", "people", {"ask": "arrived", "name": "lukas"}),
    ("what's playing", "media", {"ask": "playing"}),
    ("what's playing on the record player", "media", {"ask": "playing", "name": "record player"}),
    ("who sings this", "media", {"ask": "artist"}),
    ("what song is this", "media", {"ask": "song"}),
    ("is anything playing", "media", {"ask": "anything"}),
    ("what's on the tv", "media", {"ask": "tv"}),
    ("what's on today", "calendar", {"ask": "on", "span": "today"}),
    ("what's on my calendar tomorrow", "calendar", {"ask": "on", "span": "tomorrow"}),
    ("do i have anything on this weekend", "calendar", {"ask": "any", "span": "weekend"}),
    ("am i free on friday", "calendar", {"ask": "free", "span": "fri"}),
    ("what's next on my calendar", "calendar", {"ask": "next"}),
    ("what's coming up", "calendar", {"ask": "on"}),
    ("when is my next dance", "calendar", {"ask": "when", "what": "dance"}),
    ("what time is games tomorrow", "calendar", {"ask": "when", "what": "games", "span": "tomorrow"}),
    ("what's on the shopping list", "lists", {"ask": "items", "name": "shopping"}),
    ("read me the groceries list", "lists", {"ask": "items", "name": "groceries"}),
    ("how many things are on the to buy list", "lists", {"ask": "count", "name": "to buy"}),
    ("is milk on the shopping list", "lists", {"ask": "has", "item": "milk", "name": "shopping"}),
    ("what's on my to do list", "lists", {"ask": "items"}),
    ("what do we need to buy", "lists", {"ask": "shop"}),
    ("do we need milk", "lists", {"ask": "has_shop", "item": "milk"}),
]


@pytest.mark.parametrize("text,cmd,want", SENTENCES)
def test_sentences(text, cmd, want):
    got = [(brain.command_of(r.intent.name), {k: str(v.value).strip() for k, v in r.entities.items()})
           for r in hassil.recognize_all(text, INTENTS)]
    assert any(c == cmd and all(s.get(k) == v for k, v in want.items()) for c, s in got), got
