import random

import pytest

from alfie import brain, fun

EN = brain.load_language("en")


def rng(seed=1):
    return random.Random(seed)


def test_coin_says_heads_or_tails():
    seen = {fun.coin_reply(EN, rng(i)) for i in range(40)}
    assert seen == {"Heads.", "Tails."}


@pytest.mark.parametrize("text,count,sides", [
    ("a die", 1, 6), ("a dice", 1, 6), ("the die", 1, 6), ("the dice", 2, 6), ("dice", 2, 6),
    ("two dice", 2, 6), ("3 dice", 3, 6), ("a d20", 1, 20), ("a d 20", 1, 20),
    ("two d6", 2, 6), ("a twenty sided die", 1, 20), ("three twelve sided dice", 3, 12),
    ("a 4 sided dice", 1, 4)])
def test_dice(text, count, sides):
    r = rng()
    said = fun.dice_reply(text, EN, r)
    rolls = [random.Random(1).randint(1, sides) for _ in range(1)]
    if count == 1:
        assert said == f"You rolled {rolls[0]}."
    else:
        r2 = rng()
        rolls = [r2.randint(1, sides) for _ in range(count)]
        assert said.endswith(f"That's {sum(rolls)}.")
        assert said.startswith(str(rolls[0]))


@pytest.mark.parametrize("text", ["up the blinds", "the window down", "over"])
def test_dice_leaves_other_rolls(text):
    assert fun.dice_reply(text, EN, rng()) is None


def test_too_many_dice():
    assert fun.dice_reply("fifty dice", EN, rng()).startswith("I can roll up to 10 dice")


@pytest.mark.parametrize("text,lo,hi", [
    ("", 1, 10), ("between 1 and 100", 1, 100), ("between one and ten", 1, 10),
    ("from five to fifty", 5, 50), ("up to 20", 1, 20), ("between 50 and 5", 5, 50),
    ("between one and a hundred", 1, 100)])
def test_number(text, lo, hi):
    for seed in range(30):
        n = int(fun.number_reply(text, EN, rng(seed), 10).rstrip("."))
        assert lo <= n <= hi
    assert fun.number_reply(text, EN, rng(3), 10) == f"{random.Random(3).randint(lo, hi)}."


def test_number_needs_a_range():
    assert fun.number_reply("between 5 and 5", EN, rng()) is None


@pytest.mark.parametrize("text,things", [
    ("pizza or tacos", {"pizza", "tacos"}),
    ("between the red one and the blue one", {"red one", "blue one"}),
    ("one of pizza, curry or tacos", {"pizza", "curry", "tacos"})])
def test_pick(text, things):
    seen = {fun.pick_reply(text, EN, rng(i)) for i in range(40)}
    assert seen == {f"I pick {t}." for t in things}


def test_pick_keeps_the_commas():
    assert fun.with_commas("red green or blue", "Choose one of red, green or blue.") == \
        "red, green or blue"
    assert fun.with_commas("pizza or tacos", "") == "pizza or tacos"


def test_pick_needs_two():
    assert fun.pick_reply("pizza", EN, rng()) is None
    assert fun.pick_reply("pizza or pizza", EN, rng()) is None


def test_jokes_dont_repeat_until_all_told():
    bag = fun.JokeBag()
    jokes = fun.joke_lines(EN, [], True)
    assert len(jokes) == 30 and all(" ... " in j for j in jokes)
    r = rng()
    told = [fun.joke_reply(bag, EN, [], True, r) for _ in jokes]
    assert sorted(told) == sorted(jokes)
    nxt = fun.joke_reply(bag, EN, [], True, r)
    assert nxt != told[-1]


def test_own_jokes():
    bag = fun.JokeBag()
    assert fun.joke_reply(bag, EN, ["Knock knock | Who's there?"], False, rng()) == \
        "Knock knock ... Who's there?"
    assert fun.joke_reply(bag, EN, ["One liner."], False, rng()) == "One liner."
    assert fun.joke_reply(bag, EN, [], False, rng()) == "I don't know any jokes yet."


def test_chat():
    assert fun.chat_reply("name", EN, rng(), "Alfie").startswith(("I'm Alfie", "My name's Alfie"))
    assert fun.chat_reply("thanks", EN, rng()) in EN["fun"]["lines"]["thanks"]
    assert fun.chat_reply("age", EN, rng(), days=9) == "I was set up 9 days ago."
    assert fun.chat_reply("age", EN, rng(), days=1) == "I was set up 1 day ago."
    assert fun.chat_reply("age", EN, rng(), days=0) == "I was set up today."
    assert fun.chat_reply("version", EN, rng(), version="0.25.0") == "I'm version 0.25.0."
    assert fun.chat_reply("nonsense", EN, rng()) is None


def test_help_follows_the_commands_on():
    on = brain.commands_on(brain.default_settings())
    said = fun.help_reply(on, EN, "Desktop")
    assert said.startswith("I can tell you about anything in the house, the weather, the sky, "
                           "dates, sums, who's home, what's playing, your calendar and your lists. "
                           "I can also start your voice actions, flip coins, roll dice and tell jokes.")
    assert said.endswith("For anything else, I ask my bigger brain.")
    assert fun.help_reply(["joke", "coin"], EN) == "I can flip coins and tell jokes."
    assert fun.help_reply([], EN).startswith("Not much right now")


hassil = pytest.importorskip("hassil")
INTENTS = hassil.Intents.from_dict(brain.own_intents(EN, brain.default_settings(), "en"))


@pytest.mark.parametrize("text,cmd,want", [
    ("say that again", "repeat", {}),
    ("what did you say", "repeat", {}),
    ("sorry what", "repeat", {}),
    ("i didn't catch that", "repeat", {}),
    ("what can you do", "help", {}),
    ("what can i ask you", "help", {}),
    ("flip a coin", "coin", {}),
    ("heads or tails", "coin", {}),
    ("roll a die", "dice", {"value": "a die"}),
    ("roll two dice", "dice", {"value": "two dice"}),
    ("roll a d20", "dice", {"value": "a d20"}),
    ("pick a number", "number", {}),
    ("pick a number between 1 and 100", "number", {"value": "between 1 and 100"}),
    ("give me a random number", "number", {}),
    ("pick between pizza and tacos", "pick", {"value": "pizza and tacos"}),
    ("choose one of red, green or blue", "pick", {"value": "red green or blue"}),
    ("tell me a joke", "joke", {}),
    ("tell me another joke", "joke", {}),
    ("do you know any jokes", "joke", {}),
    ("make me laugh", "joke", {}),
    ("what's your name", "chat", {"ask": "name"}),
    ("who are you", "chat", {"ask": "name"}),
    ("hello", "chat", {"ask": "hello"}),
    ("hey alfie", "chat", {"ask": "hello"}),
    ("good morning", "chat", {"ask": "morning"}),
    ("thank you", "chat", {"ask": "thanks"}),
    ("thanks alfie", "chat", {"ask": "thanks"}),
    ("how old are you", "chat", {"ask": "age"}),
    ("who made you", "chat", {"ask": "maker"}),
    ("are you there", "chat", {"ask": "there"}),
])
def test_sentences(text, cmd, want):
    got = [(brain.command_of(r.intent.name), {k: str(v.value).strip() for k, v in r.entities.items()})
           for r in hassil.recognize_all(text, INTENTS)]
    assert any(c == cmd and all(s.get(k) == v for k, v in want.items()) for c, s in got), got


@pytest.mark.parametrize("text", [
    "cancel", "cancel that", "oh just cancel it", "nevermind", "never mind", "forget it",
    "forget I asked", "that's all", "that's all thanks", "nothing", "no thanks", "go away",
    "be quiet", "i wasn't talking to you", "wrong person", "false alarm", "okay never mind then",
])
def test_dismiss_sentences(text):
    names = {brain.command_of(r.intent.name) for r in hassil.recognize_all(text, INTENTS)}
    assert "dismiss" in names, names     # tried first (conversation.ORDER)


@pytest.mark.parametrize("text", ["stop", "cancel the timer", "cancel my alarm",
                                  "forget it was raining", "nothing is on"])
def test_dismiss_leaves_the_rest(text):
    names = {brain.command_of(r.intent.name) for r in hassil.recognize_all(text, INTENTS)}
    assert "dismiss" not in names


def test_migration_adds_dismiss_to_own_always():
    from alfie import config
    raw = {"version": 7, "brain": {"own_always": ["weather_now"]}}
    assert config.migrate(raw)["brain"]["own_always"] == ["weather_now", "dismiss"]
    raw = {"version": 7, "brain": {"own_always": []}}       # emptied on purpose: left so
    assert config.migrate(raw)["brain"]["own_always"] == []
