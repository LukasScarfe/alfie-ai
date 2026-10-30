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
    assert set(data["intents"]) == {"AlfieWhatsWrong", "AlfieHowAreYou"}
    assert "you good" in data["intents"]["AlfieHowAreYou"]["data"][0]["sentences"]


@pytest.mark.parametrize("change", [{"own_sentences": False}, {"commands": []}])
def test_own_intents_off(change):
    assert brain.own_intents(EN, {**DEFAULTS, **change}, "en") is None


def test_own_intents_only_chosen_commands():
    data = brain.own_intents(EN, {**DEFAULTS, "commands": ["how_are_you"]}, "en")
    assert list(data["intents"]) == ["AlfieHowAreYou"]
    assert brain.command_of("AlfieHowAreYou") == "how_are_you"
    assert brain.command_of("HassTurnOn") is None


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


def test_config_brain_defaults_and_checks():
    cfg = validate_config(default_config())
    assert cfg["brain"] == DEFAULTS
    raw = default_config()
    raw["brain"] = {**DEFAULTS, "delegate": "conversation.ollama",
                    "extra_sentences": {"how_are_you": ["  you   good  "]}}
    got = validate_config(raw)["brain"]
    assert got["delegate"] == "conversation.ollama"
    assert got["extra_sentences"] == {"whats_wrong": [], "how_are_you": ["you good"]}


@pytest.mark.parametrize("change,where", [
    ({"delegate": "conversation.alfie"}, "brain delegate"),
    ({"delegate": "tts.piper"}, "brain delegate"),
    ({"extra_sentences": {"how_are_you": ["how (are you"]}}, "how_are_you sentence 1"),
    ({"extra_sentences": {"how_are_you": ["how are] you"]}}, "how_are_you sentence 1"),
    ({"commands": ["dance"]}, "brain commands"),
    ({"local_icon": "bolt"}, "brain local icon"),
    ({"log_size": 0}, "brain log size"),
])
def test_config_brain_errors(change, where):
    raw = default_config()
    raw["brain"] = {**DEFAULTS, **change}
    with pytest.raises(ConfigError, match=where):
        validate_config(raw)
