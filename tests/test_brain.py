import pytest

from alfie import brain
from alfie.config import ConfigError, default_config
from test_config import valid as validate_config

EN = brain.load_language("en")
DEFAULTS = brain.default_settings()


def test_language_file_has_every_command():
    assert EN is not None
    for cmd in brain.COMMANDS:
        assert EN["commands"][cmd], cmd
    assert brain.load_language("en-GB") is EN
    assert brain.load_language("xx") is None


def test_own_intents_from_language_and_extras():
    s = {**DEFAULTS, "extra_sentences": {"whats_wrong": [], "how_are_you": ["you good"]}}
    data = brain.own_intents(EN, s, "en-US")
    assert data["language"] == "en"
    assert set(data["intents"]) == set(brain.INTENTS.values())
    assert data["lists"]["name"] == {"wildcard": True}
    assert {"in": "turned on", "out": "on"} in data["lists"]["event"]["values"]
    assert {"in": "lamps", "out": "light"} in data["lists"]["thing"]["values"]
    assert "what_is" in data["expansion_rules"]
    assert "you good" in data["intents"]["AlfieHowAreYou"]["data"][0]["sentences"]


@pytest.mark.parametrize("change", [{"own_sentences": False, "own_always": []},
                                    {"off_commands": list(brain.COMMANDS)}])
def test_own_intents_off(change):
    assert brain.own_intents(EN, {**DEFAULTS, **change}, "en") is None


def test_own_intents_only_chosen_commands():
    off = [c for c in brain.COMMANDS if c != "how_are_you"]
    data = brain.own_intents(EN, {**DEFAULTS, "off_commands": off}, "en")
    assert list(data["intents"]) == ["AlfieHowAreYou"]
    assert brain.command_of("AlfieHowAreYou") == "how_are_you"
    assert brain.command_of("HassTurnOn") is None


def test_own_always_with_own_sentences_off():
    """Off, his weather and sky commands still answer (fast) by default."""
    data = brain.own_intents(EN, {**DEFAULTS, "own_sentences": False}, "en")
    assert set(data["intents"]) == {brain.INTENTS[c] for c in brain.OUTSIDE}
    data = brain.own_intents(EN, {**DEFAULTS, "own_sentences": False,
                                  "own_always": ["weather_now"],
                                  "off_commands": ["moon"]}, "en")
    assert list(data["intents"]) == ["AlfieWeatherNow"]
    data = brain.own_intents(EN, {**DEFAULTS, "own_sentences": False,
                                  "own_always": ["weather_now"], "off_commands": ["weather_now"]}, "en")
    assert data is None


# (intent, settings change, left to the delegate)
LEAVE = [
    ("HassGetState", {}, False),
    ("HassGetWeather", {}, False),
    ("HassGetState", {"local_states": False}, True),
    ("HassGetWeather", {"local_states": False}, True),
    ("HassMediaSearchAndPlay", {}, True),
    ("HassMediaSearchAndPlay", {"local_media_search": True}, False),
    ("HassTurnOn", {"local_states": False}, False),
]


@pytest.mark.parametrize("name,change,left", LEAVE)
def test_leave_to_delegate(name, change, left):
    assert brain.leave_to_delegate(name, {**DEFAULTS, **change}) is left


HOW = [
    ("bubbly", "", "I'm feeling great!"),
    ("content", "Garden watered", "I'm good, thanks."),
    ("uneasy", "Monstera dry.", "A little uneasy. Mostly because of Monstera dry."),
    ("nonsense", "", "I'm good, thanks."),
]


@pytest.mark.parametrize("level,reason,said", HOW)
def test_how_are_you(level, reason, said):
    assert brain.how_are_you(EN, level, reason) == said


def test_fallback():
    assert brain.fallback(EN, DEFAULTS) == "Sorry, I don't know that one."
    assert brain.fallback(EN, {**DEFAULTS, "fallback": "No idea."}) == "No idea."
    assert brain.fallback(None, DEFAULTS) == "Sorry, I don't know that one."


WHY = [
    (("trigger",), {}, "An automation's sentence trigger matched."),
    (("own", "how_are_you"), {}, "Alfie's own sentence for how are you matched."),
    (("intent", "HassGetWeather"), {}, "Home Assistant's HassGetWeather intent matched."),
    (("delegate", ""), {"delegate": "Alfie desktop"},
     "Nothing local matched, so Alfie desktop answered."),
    (("delegate", ""), {"delegate": "Alfie desktop", "passed": ["HassGetState"]},
     "Nothing local matched, so Alfie desktop answered. Home Assistant matched HassGetState, "
     "left to the delegate by the settings."),
    (("none",), {}, "Nothing local matched and no delegate is set."),
    (("error",), {"delegate": "Ollama", "error": "timed out"},
     "Nothing local matched and Ollama failed: timed out."),
]


@pytest.mark.parametrize("args,kw,said", WHY)
def test_why(args, kw, said):
    assert brain.why(*args, **kw) == said


def test_turn_log_keeps_the_newest():
    log = brain.TurnLog(2)
    for i in range(3):
        log.add(brain.Turn(said=f" q{i} ", source="intent" if i else "delegate", at=i + 1))
    out = log.as_list()
    assert [t["said"] for t in out] == ["q2", "q1"]
    assert out[0]["tier"] == 1
    log.resize(1)
    assert [t["said"] for t in log.as_list()] == ["q2"]
    assert brain.Turn("x", source="delegate").tier == 3
    long = log.add(brain.Turn(said="q", reply="word " * 100)).reply
    assert len(long) <= brain.MAX_SAID and long.endswith("word…")


def test_config_brain_defaults_and_checks():
    cfg = validate_config(default_config())
    assert cfg["brain"] == DEFAULTS
    raw = default_config()
    raw["brain"] = {**DEFAULTS, "delegate": "conversation.ollama",
                    "extra_sentences": {"how_are_you": ["  you   good  "]}}
    got = validate_config(raw)["brain"]
    assert got["delegate"] == "conversation.ollama"
    assert got["extra_sentences"] == {**{c: [] for c in brain.COMMANDS},
                                      "how_are_you": ["you good"]}


@pytest.mark.parametrize("old,off", [
    (["whats_wrong", "how_are_you"], []),
    (["how_are_you"], ["whats_wrong"]),
    ([], ["whats_wrong", "how_are_you"]),
])
def test_config_brain_old_commands_list(old, off):
    """Before 0.20 the section listed the commands that were on; the newer
    ones come on."""
    raw = default_config()
    raw["brain"] = {k: v for k, v in DEFAULTS.items() if k != "off_commands"}
    raw["brain"]["commands"] = old
    got = validate_config(raw)["brain"]
    assert got["off_commands"] == off
    assert "commands" not in got


@pytest.mark.parametrize("change,where", [
    ({"delegate": "conversation.alfie"}, "brain delegate"),
    ({"delegate": "tts.piper"}, "brain delegate"),
    ({"extra_sentences": {"how_are_you": ["how (are you"]}}, "how_are_you sentence 1"),
    ({"extra_sentences": {"how_are_you": ["how are] you"]}}, "how_are_you sentence 1"),
    ({"off_commands": ["dance"]}, "brain commands off"),
    ({"match_floor": 5}, "brain match floor"),
    ({"local_icon": "bolt"}, "brain local icon"),
    ({"log_size": 0}, "brain log size"),
])
def test_config_brain_errors(change, where):
    raw = default_config()
    raw["brain"] = {**DEFAULTS, **change}
    with pytest.raises(ConfigError, match=where):
        validate_config(raw)


def test_whole_words():
    assert brain.whole_words({"name": "ing of life", "stat": "mean"}, "What is the meaning of life?") is False
    assert brain.whole_words({"name": "office temperature"}, "What's the office temperature?")
    assert brain.whole_words({"value": "red green or blue"}, "Choose one of red, green or blue.")
    assert brain.whole_words({"topic": "the beatles"}, "who are The Beatles")
    assert brain.whole_words({}, "hello")


def test_empty_state_answers_go_on():
    assert brain.empty_answer("HassGetState", 0, 0)
    assert not brain.empty_answer("HassGetState", 0, 3)      # "is any light on?" "No"
    assert not brain.empty_answer("HassGetState", 1, 0)
    assert not brain.empty_answer("HassTurnOn", 0, 0)
    known = ["home", "not_home", "Work"]
    assert brain.empty_answer("HassGetState", 0, 2, "taylor swift", known)
    assert not brain.empty_answer("HassGetState", 0, 2, "work", known)
    assert not brain.empty_answer("HassGetState", 0, 2, "not home", known)
