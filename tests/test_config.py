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
    migrate,
    migrate_options,
    reset,
    validate,
)
from alfie.mood import combine
from alfie.signals import evaluate_all

import house
from alfie.screen_types import load_types
from test_mood import GOOD_HOUSE

TYPES = load_types(os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                                "frontend", "screens"))

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


def test_defaults_build_the_starter_signals():
    assert build(valid(default_config())).signals == defaults.SIGNALS
    assert all(any(c in e for c in "*?[") for s in defaults.SIGNALS for e in s.entities)


def test_lukas_house_rebuilds_exactly():
    # devenv/house.json is the old seed (and the dev screens): it still is his house.
    built = build(validate(house.CONFIG, FACE, TYPES))
    assert built.signals == house.SIGNALS
    for changes in ({}, {"sensor.fineoffset_wh51_0ee63f_moisture": "12"},
                    {"binary_sensor.scarfe_218j_security_status": "on"},
                    {"input_boolean.guest_mode": "on"}):
        states = {**GOOD_HOUSE, **changes}
        assert combine(evaluate_all(built.signals, states), built.mood) == \
            combine(evaluate_all(house.SIGNALS, states), built.mood)


def test_key_order_matches_the_defaults():
    # The panel compares configs as JSON text; a reset section must not look edited.
    assert json.dumps(valid(default_config())) == json.dumps(default_config())


def test_missing_sections_take_defaults():
    assert valid({}) == default_config()
    cfg = valid({"mood": {"combine": "count"}, "behaviour": {"idle_interval": 60}})
    assert cfg["mood"]["combine"] == "count"
    assert cfg["mood"]["ladder"] == default_config()["mood"]["ladder"]
    assert cfg["behaviour"]["idle_interval"] == 60
    assert cfg["signals"] == default_config()["signals"]


def test_a_new_signal_from_the_panel():
    cfg = valid({"signals": [{"id": "co2", "name": "Stuffy", "entities": "sensor.co2",
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
                                 "motion_sensors": [{"entity": "binary_sensor.m", "action": "wave"}],
                                 "idle_interval": 2}})
    text = "\n".join(errs)
    for want in ("moonwalk", "wave", "between 10"):
        assert want in text, want


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
    assert not next(t for t in cfg["triggers"] if t["id"] == "fixed")["enabled"]
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


# ------------------------------------------------------------- version 4 words

def test_v3_store_migrates_to_the_house_json():
    with open(os.path.join(os.path.dirname(__file__), "house_v3.json")) as f:
        v3 = json.load(f)
    cfg = validate(v3, FACE, TYPES)
    expect = {**house.CONFIG, "overview": cfg["overview"]}   # house.json hides Get started
    assert cfg == expect
    assert cfg["version"] == 6


def test_migrate_v3_renames_every_key():
    from alfie.config import migrate
    old = {"version": 3,
           "signals": [{"id": "a", "label": "Dry", "entities": ["sensor.a"]}],
           "stories": [{"id": "s", "mode": "template", "template": {"animation": "nod"}},
                       {"id": "t", "mode": "steps", "template": {}, "steps": []}],
           "modes": [{"id": "m1", "presence": "normal"}, {"id": "m2", "presence": "idle"},
                     {"id": "m3", "presence": "blank"}, {"id": "m4", "presence": "asleep"}],
           "behaviour": {"gaze_map": [{"entity": "binary_sensor.m", "action": "notice"}]},
           "look": {"face_color": "#fff"}}
    new = migrate(copy.deepcopy(old))
    assert new["signals"][0] == {"id": "a", "name": "Dry", "entities": ["sensor.a"]}
    assert new["stories"][0] == {"id": "s", "form": "simple", "simple": {"animation": "nod"}}
    assert new["stories"][1]["form"] == "steps"
    assert [m["alfie"] for m in new["modes"]] == ["awake", "quiet", "hidden", "asleep"]
    assert new["behaviour"]["motion_sensors"] == old["behaviour"]["gaze_map"]
    assert "gaze_map" not in new["behaviour"]
    assert new["look"] == {"ring_color": "#fff"}
    assert migrate(copy.deepcopy(new)) == new          # idempotent


def test_a_v1_config_ends_in_v4_words():
    cfg = valid({"version": 1, "behaviour": {"on_wake": "dizzy", "sleep_entity": "switch.zz"}})
    night = next(m for m in cfg["modes"] if m["id"] == "night")
    assert night["alfie"] == "asleep" and night["condition"]["entities"] == ["switch.zz"]
    assert all("form" in st and "simple" in st for st in cfg["stories"])


def test_overview_section():
    assert valid({})["overview"] == {"dismissed": False, "done": []}
    assert valid({"overview": {"dismissed": True, "done": ["motion", "motion"]}})["overview"] \
        == {"dismissed": True, "done": ["motion"]}
    assert errors({"overview": {"done": ["nope"]}})


def test_label_and_text_size_becomes_text_size():
    raw = {"screens": [{"id": "l", "type": "label", "options": {"text": "Hi", "size": 0.6}},
                       {"id": "t", "type": "text", "options": {"size": 0.3, "text_size": 2}},
                       {"id": "p", "type": "plot", "options": {"size": 9}}]}
    out = migrate(raw)
    assert out["screens"][0]["options"] == {"text": "Hi", "text_size": 2.0}
    assert out["screens"][1]["options"] == {"text_size": 2}
    assert out["screens"][2]["options"] == {"size": 9}
