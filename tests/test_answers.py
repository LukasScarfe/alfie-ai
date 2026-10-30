from datetime import datetime, timedelta, timezone

import pytest

from alfie import answers, brain
from alfie.answers import Thing

EN = brain.load_language("en")
TZ = timezone(timedelta(hours=-7))
NOW = datetime(2026, 10, 30, 15, 4, tzinfo=TZ)      # a Friday


def at(h, m=0, days=0):
    return NOW.replace(hour=h, minute=m) + timedelta(days=days)


def thing(eid, state, name=None, area="", changed=None, **attrs):
    return Thing(eid, name or eid.split(".")[1].replace("_", " ").title(), state, attrs,
                 changed or NOW - timedelta(minutes=12), area)


# ------------------------------------------------------------ the sentences

hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, brain.default_settings(), "en"))


def read(text):
    """Every (command, slots) reading, as conversation.py gets them."""
    out = []
    for r in hassil.recognize_all(text, INTENTS):
        slots = {k: str(v.value) for k, v in r.entities.items()}
        out.append((brain.command_of(r.intent.name), slots))
    return out


# (question, command, slots it must have in some reading)
SENTENCES = [
    ("what's the office temperature", "entity", {"name": "office temperature"}),
    ("What is the kitchen light's brightness?", "entity", {"name": "kitchen light's brightness"}),
    ("what's the brightness of the kitchen light", "entity", {"attr": "brightness", "name": "kitchen light"}),
    ("is the back door open", "entity", {"name": "back door", "state": "open"}),
    ("is the washing machine running", "entity", {"name": "washing machine", "state": "on"}),
    ("is the freezer above -15", "entity", {"name": "freezer", "compare": "above", "value": "-15"}),
    ("is lukas home", "entity", {"name": "lukas", "state": "home"}),
    ("how many lights are on", "entity_count", {"thing": "light", "state": "on"}),
    ("which windows are open upstairs", "entity_count", {"thing": "window", "state": "open", "area": "upstairs"}),
    ("is anything on in the kitchen", "entity_count", {"state": "on", "area": "kitchen"}),
    ("are all the doors locked", "entity_count", {"thing": "door", "state": "locked"}),
    ("when was the front door last opened", "entity_when", {"name": "front door", "event": "open"}),
    ("when did lukas get home", "entity_when", {"name": "lukas", "event": "home"}),
    ("how long has the tv been on", "entity_when", {"name": "tv", "state": "on"}),
    ("when did the printer last change", "entity_when", {"name": "printer"}),
    ("what was the highest office temperature today", "entity_history",
     {"stat": "max", "name": "office temperature", "period": "today"}),
    ("how many times did the front door open today", "entity_history",
     {"name": "front door", "event": "open", "period": "today"}),
    ("was the heater on last night", "entity_history", {"name": "heater", "event": "on", "period": "night"}),
    ("how are you", "how_are_you", {}),
]


@pytest.mark.parametrize("text,cmd,want", SENTENCES)
def test_sentences(text, cmd, want):
    got = read(text)
    norm = [(c, {k: v.removeprefix("the ") for k, v in s.items()}) for c, s in got]
    assert any(c == cmd and all(s.get(k) == v for k, v in want.items()) for c, s in norm), got


@pytest.mark.parametrize("text", ["turn on the kitchen light", "play some jazz",
                                  "set a timer for 5 minutes"])
def test_commands_are_not_questions(text):
    assert read(text) == []


# ------------------------------------------------------------ saying things

@pytest.mark.parametrize("v,unit,said", [
    (21.46, "°C", "21.5°C"), (21.0, "°C", "21°C"), (1234.4, "W", "1234 W"), (0.456, "kWh", "0.46 kWh"),
    (40, "%", "40%"), (-0.01, "", "-0.01"), (0.0, "", "0"),
])
def test_say_number(v, unit, said):
    assert answers.say_number(v, unit) == said


@pytest.mark.parametrize("when,said", [
    (at(15, 4), "at 3:04 pm"), (at(9, days=-1), "yesterday at 9 am"),
    (at(18, 30, days=-4), "on Monday at 6:30 pm"), (at(7, days=1), "tomorrow at 7 am"),
    (at(12, days=-20), "on 10 October"),
])
def test_say_when(when, said):
    assert answers.say_when(when, NOW, EN) == said


@pytest.mark.parametrize("secs,said", [
    (3, "a moment"), (40, "40 seconds"), (60, "1 minute"), (3900, "1 hour and 5 minutes"),
    (90000, "1 day and 1 hour"), (3 * 86400 + 7200, "3 days"),
])
def test_say_ago(secs, said):
    assert answers.say_ago(secs, EN) == said


def test_say_list():
    assert answers.say_list(["A"], EN) == "A"
    assert answers.say_list(["A", "B", "C"], EN) == "A, B and C"
    assert answers.say_list(["A", "B"], EN, "or") == "A or B"
    assert answers.say_list(list("ABCDEFGH"), EN) == "A, B, C, D, E and 3 more"


# ------------------------------------------------------------ states

DOOR = thing("binary_sensor.back_door", "on", "Back Door", device_class="door")


@pytest.mark.parametrize("t,said", [
    (DOOR, "open"),
    (thing("binary_sensor.leak", "off", device_class="moisture"), "dry"),
    (thing("sensor.office_temperature", "21.46", unit_of_measurement="°C"), "21.5°C"),
    (thing("person.lukas", "not_home"), "away"),
    (thing("light.kitchen", "on"), "on"),
    (thing("sensor.washer_status", "rinse_cycle"), "rinse cycle"),
    (thing("sensor.next_alarm", "2026-10-31T14:00:00+00:00", device_class="timestamp"), "tomorrow at 7 am"),
    (thing("sensor.gone", "unavailable"), "unavailable"),
])
def test_say_state(t, said):
    assert answers.say_state(t, EN, NOW) == said


@pytest.mark.parametrize("t,asked,yes", [
    (DOOR, "open", True), (DOOR, "closed", False), (DOOR, "home", False),
    (thing("lock.front", "locked"), "locked", True), (thing("lock.front", "unlocked"), "open", True),
    (thing("person.lukas", "home"), "home", True), (thing("person.lukas", "not_home"), "home", False),
    (thing("person.lukas", "not_home"), "away", True),
    (thing("binary_sensor.hall", "on", device_class="motion"), "detected", True),
    (thing("media_player.tv", "playing"), "on", True), (thing("media_player.tv", "paused"), "on", False),
    (thing("climate.living", "heat"), "on", True), (thing("climate.living", "off"), "on", False),
    (thing("switch.washer", "on"), "on", True),
])
def test_same_state(t, asked, yes):
    said = answers.say_state(t, EN, NOW)
    assert answers.same_state(asked, said, t.state, EN) is yes


def test_state_replies():
    t = thing("sensor.office_temperature", "21.46", "Office Temperature", unit_of_measurement="°C")
    assert answers.state_reply(t, EN, NOW) == "Office Temperature is 21.5°C."
    assert answers.yes_no_reply(DOOR, "open", EN, NOW) == "Yes, Back Door is open."
    assert answers.yes_no_reply(DOOR, "closed", EN, NOW) == "No, Back Door is open."
    assert answers.compare_reply(t, "above", "20", EN, NOW) == "Yes, Office Temperature is 21.5°C."
    assert answers.compare_reply(t, "below", "20", EN, NOW) == "No, Office Temperature is 21.5°C."
    assert answers.compare_reply(DOOR, "above", "3", EN, NOW) == "Back Door isn't a number: it's open."


@pytest.mark.parametrize("t,attr,said", [
    (thing("light.kitchen", "on", "Kitchen Light", brightness=102), "brightness", "Kitchen Light's brightness is 40%."),
    (thing("light.kitchen", "off", "Kitchen Light"), "brightness", "Kitchen Light is off."),
    (thing("media_player.echo", "idle", "Echo", volume_level=0.35), "volume", "Echo's volume is 35%."),
    (thing("climate.hall", "heat", "Hall", temperature=20.5), "target_temperature", "Hall's target temperature is 20.5°C."),
    (thing("climate.hall", "heat", "Hall", current_temperature=19), "current_temperature", "Hall's temperature is 19°C."),
    (thing("cover.blind", "open", "Blind", current_position=70), "position", "Blind's position is 70%."),
    (thing("media_player.tv", "on", "TV", source="HDMI_1"), "source", "TV's input is HDMI 1."),
    (thing("light.strip", "on", "Strip", rgb_color=[250, 10, 5]), "color", "Strip's colour is red."),
    (thing("sensor.x", "3", "X"), "volume", "X has no volume."),
])
def test_attribute_reply(t, attr, said):
    assert answers.attribute_reply(t, attr, EN, "°C") == said


# ------------------------------------------------------------ how many

HOUSE = [
    thing("light.kitchen", "on", "Kitchen Light", "Kitchen"),
    thing("light.kitchen_island", "on", "Island", "Kitchen"),
    thing("light.office", "off", "Office Light", "Office"),
    thing("light.porch", "unavailable", "Porch", "Outside"),
    thing("binary_sensor.bedroom_window", "on", "Bedroom Window", "Bedroom", device_class="window"),
    thing("binary_sensor.office_window", "off", "Office Window", "Office", device_class="window"),
    thing("binary_sensor.back_door", "on", "Back Door", "Kitchen", device_class="door"),
    thing("lock.front_door", "locked", "Front Door Lock", "Hall"),
    thing("media_player.tv", "playing", "TV", "Living Room", device_class="tv"),
    thing("sensor.kitchen_temperature", "21", "Kitchen Temperature", "Kitchen"),
]


@pytest.mark.parametrize("kind,state,area,ask,said", [
    ("light", "on", "", "count", "2 lights are on: Island and Kitchen Light."),
    ("light", "on", "the kitchen", "count", "2 lights are on in kitchen: Island and Kitchen Light."),
    ("light", "on", "office", "count", "No lights are on in office."),
    ("window", "open", "", "count", "Only Bedroom Window is open."),
    ("anything", "on", "kitchen", "count", "2 things are on in kitchen: Island and Kitchen Light."),
    ("anything", "on", "", "count", "3 things are on: Island, Kitchen Light and TV."),
    ("anything", "on", "bedroom", "count", "Nothing is on in bedroom."),
    ("door", "closed", "", "all", "No, Back Door is open."),
    ("door", "locked", "", "all", "No, Back Door is open."),
    ("lock", "locked", "", "all", "Yes, all 1 locks are locked."),
])
def test_count_reply(kind, state, area, ask, said):
    assert answers.count_reply(HOUSE, kind, state, area, ask, EN, NOW) == said


def test_in_area():
    assert answers.in_area("", "kitchen", "Kitchen lights")
    assert not answers.in_area("Office", "kitchen", "Kitchen lights")
    assert answers.in_area("Living Room", "the living room")
    assert answers.in_area("Kitchen", "kitchen")
    assert not answers.in_area("Kitchen", "office")
    assert not answers.in_area("", "kitchen")


# ------------------------------------------------------------ when

def test_when_replies():
    door = thing("binary_sensor.front_door", "off", "Front Door", changed=at(14, 52),
                 device_class="door")
    assert answers.when_reply(door, "", EN, NOW) == "Front Door changed to closed 12 minutes ago, at 2:52 pm."
    assert answers.when_reply(door, "closed", EN, NOW) == "Front Door is closed now, since at 2:52 pm, 12 minutes ago."
    assert answers.when_reply(door, "open", EN, NOW) is None             # needs history
    assert answers.when_reply(door, "open", EN, NOW, at(14, 50), True) == \
        "Front Door was last open 14 minutes ago, at 2:50 pm."
    assert answers.when_reply(door, "open", EN, NOW, None, True) == \
        "Front Door hasn't been open in the last week."
    assert answers.how_long_reply(door, "closed", EN, NOW) == \
        "Front Door has been closed for 12 minutes, since at 2:52 pm."
    assert answers.how_long_reply(door, "open", EN, NOW) == \
        "Front Door isn't open, it's closed, and has been for 12 minutes."


# ------------------------------------------------------------ history

@pytest.mark.parametrize("key,start,end", [
    ("today", at(0), NOW), ("yesterday", at(0, days=-1), at(0)), ("week", at(0, days=-4), NOW),
    ("1h", at(14, 4), NOW), ("morning", at(0), at(12)), ("night", at(18, days=-1), at(8)),
])
def test_period_span(key, start, end):
    assert answers.period_span(key, NOW) == (start, end)


TEMPS = [(at(0), "18"), (at(6), "17.5"), (at(9), "unavailable"), (at(10), "22"), (at(13), "21")]


def test_stat():
    assert answers.stat(TEMPS, "max", NOW) == (22.0, at(10))
    assert answers.stat(TEMPS, "min", NOW) == (17.5, at(6))
    mean, _ = answers.stat(TEMPS, "mean", NOW)
    # 6 h at 18, 3 h at 17.5, 3 h at 22, 2:04 at 21 (the hour unavailable left out)
    assert mean == pytest.approx((6 * 18 + 3 * 17.5 + 3 * 22 + (2 + 4 / 60) * 21) / (14 + 4 / 60))
    assert answers.stat([(at(0), "off")], "max", NOW) is None


def test_stat_reply():
    t = thing("sensor.office_temperature", "21", "office temperature", unit_of_measurement="°C")
    assert answers.stat_reply(t, "max", "today", TEMPS, EN, NOW, NOW) == \
        "The highest office temperature today was 22°C, at 10 am."
    assert answers.stat_reply(t, "max", "today", [], EN, NOW, NOW) == \
        "I have no history for office temperature today."


DOOR_DAY = [(at(0), "off"), (at(7, 30), "on"), (at(7, 31), "off"), (at(12), "on"), (at(12, 5), "off")]


def test_times():
    door = thing("binary_sensor.front_door", "off", "Front Door", device_class="door")
    assert answers.times_in(DOOR_DAY, "open", door, EN, at(0)) == [at(7, 30), at(12)]
    # in the state at the span's start isn't an opening
    assert answers.times_in([(at(0), "on")], "open", door, EN, at(0)) == []
    assert answers.times_reply(door, "open", "today", DOOR_DAY, EN, NOW, at(0)) == \
        "Front Door was open 2 times today, last at 12 pm."
    assert answers.times_reply(door, "open", "today", DOOR_DAY[:3], EN, NOW, at(0)) == \
        "Front Door was open once today, at 7:30 am."
    assert answers.times_reply(door, "open", "today", DOOR_DAY, EN, NOW, at(0), count=False) == \
        "Yes, Front Door was open today, last at 12 pm."
    assert answers.times_reply(door, "open", "today", DOOR_DAY[:1], EN, NOW, at(0), count=False) == \
        "No, Front Door wasn't open today."


def test_which_reply():
    assert answers.which_reply(["Kitchen Light", "Kitchen Lamp"], EN) == \
        "Which one: Kitchen Light or Kitchen Lamp?"


def test_settled_since():
    # a restart (unavailable, then the same state) isn't a change
    home = [(at(0, days=-1), "not_home"), (at(16, days=-1), "home"), (at(15), "unavailable"),
            (at(15, 1), "home")]
    assert answers.settled_since(home, "home") == at(16, days=-1)
    assert answers.settled_since(home[1:], "home") is None          # home all along
    assert answers.settled_since([(at(1), "home"), (at(2), "not_home")], "home") is None
    assert answers.settled_since([], "home") is None


def test_long_ago_replies():
    t = thing("person.lukas", "home", "Lukas")
    t.long_ago = True
    assert answers.how_long_reply(t, "home", EN, NOW) == "Lukas has been home for over a week."
    assert answers.when_reply(t, "", EN, NOW) == "Lukas has been home for over a week."
    assert answers.how_long_reply(t, "away", EN, NOW) == \
        "Lukas isn't away, it's home, and has been for over a week."


def test_unknown_reply():
    assert answers.unknown_reply("front door", EN) == "I don't know anything called front door."


def test_times_skip_restarts():
    door = thing("binary_sensor.front_door", "on", "Front Door", device_class="door")
    day = [(at(0), "off"), (at(7), "on"), (at(8), "unavailable"), (at(8, 1), "on")]
    assert answers.times_in(day, "open", door, EN, at(0)) == [at(7)]
