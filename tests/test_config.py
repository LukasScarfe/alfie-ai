import copy
import json
import os

import pytest

from alfie import defaults
from alfie.config import (
    PERSONALITY,
    ConfigError,
    build,
    default_config,
    migrate_options,
    reset,
    validate,
)
from alfie.mood import combine
from alfie.signals import evaluate_all

from test_mood import GOOD_HOUSE

FACE_PATH = os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                         "frontend", "alfie-face.json")
with open(FACE_PATH) as f:
    FACE = json.load(f)


def valid(cfg):
    return validate(cfg, FACE)


def errors(cfg):
    with pytest.raises(ConfigError) as e:
        valid(cfg)
    return e.value.errors


def test_defaults_are_valid_and_stable():
    cfg = valid(default_config())
    assert cfg == default_config()
    assert valid(json.loads(json.dumps(cfg))) == cfg   # survives the Store's JSON


def test_defaults_rebuild_lukas_house_exactly():
    built = build(valid(default_config()))
    assert built.signals == defaults.SIGNALS
    for changes in ({}, {"sensor.fineoffset_wh51_0ee63f_moisture": "12"},
                    {"binary_sensor.scarfe_218j_security_status": "on"},
                    {"input_boolean.guest_mode": "on"}):
        states = {**GOOD_HOUSE, **changes}
        assert combine(evaluate_all(built.signals, states), built.mood) == \
            combine(evaluate_all(defaults.SIGNALS, states))


def test_missing_sections_take_defaults():
    assert valid({}) == default_config()
    cfg = valid({"mood": {"combine": "count"}, "behaviour": {"idle_interval": 60}})
    assert cfg["mood"]["combine"] == "count"
    assert cfg["mood"]["ladder"] == default_config()["mood"]["ladder"]
    assert cfg["behaviour"]["idle_interval"] == 60
    assert cfg["signals"] == default_config()["signals"]


def test_a_new_signal_from_the_panel():
    cfg = valid({"signals": [{"id": "co2", "label": "Stuffy", "entities": "sensor.co2",
                              "op": "above", "value": "1200"}]})
    s = cfg["signals"][0]
    assert s["value"] == 1200.0 and s["entities"] == ["sensor.co2"]
    assert s["kind"] == "bad" and s["severity"] == "major" and s["enabled"]
    mood = combine(evaluate_all(build(cfg).signals, {"sensor.co2": "1500"}), build(cfg).mood)
    assert mood.level == "uneasy" and mood.reason == "Stuffy"


def test_disabled_signal_is_never_active():
    cfg = default_config()
    cfg["signals"][0]["enabled"] = False
    built = build(valid(cfg))
    states = {**GOOD_HOUSE, "binary_sensor.scarfe_218j_security_status": "on"}
    assert combine(evaluate_all(built.signals, states), built.mood).level == "content"


def test_every_problem_is_reported():
    errs = errors({"signals": [
        {"id": "a", "entities": ["x.y"], "op": "sideways"},
        {"id": "a", "entities": ["x.z"]},
        {"id": "Bad Id", "entities": ["x.z"]},
        {"id": "b", "entities": [], "op": "below", "value": "dry"},
    ], "mood": {"combine": "vibes", "expressions": {"sad": "grinning"}}})
    text = "\n".join(errs)
    for want in ("sideways", "used twice", "lower-case", "at least one entity",
                 "needs a number", "vibes", "grinning"):
        assert want in text, want


def test_thresholds_must_be_ordered():
    errs = errors({"mood": {"thresholds": {"content": 5}}})
    assert any("thresholds" in e for e in errs)


def test_behaviour_names_are_checked():
    errs = errors({"behaviour": {"idle_fidgets": ["squint", "moonwalk"],
                                 "gaze_map": [{"entity": "binary_sensor.m", "action": "wave"}],
                                 "on_critical": "explode", "idle_interval": 2}})
    text = "\n".join(errs)
    for want in ("moonwalk", "wave", "explode", "between 10"):
        assert want in text, want
    # An empty reaction means "play nothing".
    assert valid({"behaviour": {"on_recover": ""}})["behaviour"]["on_recover"] == ""


def test_personality_presets_fill_sliders():
    cfg = valid({"personality": {"preset": "stoic", "speed": 2.0}})
    assert cfg["personality"]["speed"] == FACE["personalities"]["stoic"]["speed"]
    custom = valid({"personality": {"preset": "custom", "speed": 2.0}})["personality"]
    assert custom["speed"] == 2.0 and custom["bounce"] == 1.0
    assert "between" in errors({"personality": {"preset": "custom", "speed": 9}})[0]
    assert "nope" in errors({"personality": {"preset": "nope"}})[0]


def test_bubbly_is_the_identity():
    bubbly = FACE["personalities"]["bubbly"]
    assert bubbly == {k: d for k, (d, _, _) in PERSONALITY.items()}
    assert build(valid({})).personality == bubbly
    for name, p in FACE["personalities"].items():
        assert set(p) == set(PERSONALITY), name
        assert valid({"personality": {"preset": name}})


def test_migrate_m1_options():
    cfg = migrate_options(default_config(), {"combine": "weighted", "idle_interval": 90,
                                             "motion_debounce": 5, "celebrate_fix": False})
    assert cfg["mood"]["combine"] == "weighted"
    assert cfg["behaviour"]["idle_interval"] == 90.0
    assert cfg["behaviour"]["motion_debounce"] == 5.0
    assert cfg["behaviour"]["celebrate"] is False
    assert migrate_options(default_config(), {}) == default_config()


def test_reset_one_section():
    cfg = valid({"mood": {"combine": "count"}, "behaviour": {"idle_interval": 60}})
    back = reset(cfg, "mood")
    assert back["mood"] == default_config()["mood"]
    assert back["behaviour"]["idle_interval"] == 60
    assert reset(cfg) == default_config()
    with pytest.raises(ConfigError):
        reset(cfg, "everything")


def test_validate_does_not_alias_input():
    raw = copy.deepcopy(default_config())
    cfg = valid(raw)
    cfg["signals"][0]["entities"].append("x.y")
    assert raw == default_config()
