import copy

from alfie import defaults
from alfie.config import default_config
from alfie.modes import choose, held_back, mood_level, personality, wakes
from alfie.triggers import mode_fires

from test_config import errors, valid


def modes_of(cfg):
    return {m["id"]: m for m in cfg["modes"]}


def test_default_modes_validate():
    cfg = valid(default_config())
    assert [m["id"] for m in cfg["modes"]] == ["night", "away"]
    assert cfg["modes"] == default_config()["modes"]
    assert modes_of(cfg)["night"]["presence"] == "asleep"
    assert modes_of(cfg)["away"]["condition"]["value"] == 1


def test_choose_first_match_and_manual_pick():
    ms = valid(default_config())["modes"]
    night_and_out = {"switch.global_sleep_switches": "on", "zone.home": "0"}
    m, why = choose(ms, night_and_out)
    assert m["id"] == "night" and why.entities == ("switch.global_sleep_switches",)
    assert choose(ms, {"switch.global_sleep_switches": "off", "zone.home": "0"})[0]["id"] == "away"
    assert choose(ms, {"switch.global_sleep_switches": "off", "zone.home": "2"})[0] is None
    assert choose(ms, night_and_out, "normal")[0] is None
    assert choose(ms, {}, "away")[0]["id"] == "away"
    assert choose(ms, night_and_out, "ghost")[0]["id"] == "night"   # unknown pick: auto
    off = copy.deepcopy(ms)
    off[0]["enabled"] = False
    assert choose(off, night_and_out)[0]["id"] == "away"


def test_overrides():
    m = {**defaults.MODES[1], "hold_back": "major", "mood_floor": "uneasy", "mood_fixed": "",
         "personality": "sleepy", "energy_bias": -0.2, "fidget_rate": None, "wake": "major"}
    assert held_back(m, "minor") and held_back(m, "major") and not held_back(m, "critical")
    assert not held_back(None, "minor")
    assert mood_level(m, "miserable") == "uneasy" and mood_level(m, "bubbly") == "bubbly"
    assert mood_level({**m, "mood_fixed": "sad"}, "bubbly") == "sad"
    assert wakes(m, ["major"]) and not wakes(m, ["minor"]) and not wakes({**m, "wake": "never"}, ["critical"])
    p = personality(m, {"speed": 1.0, "energy_bias": 0.0, "fidget_rate": 1.0},
                    {"sleepy": {"speed": 0.6, "fidget_rate": 0.3}})
    assert p == {"speed": 0.6, "energy_bias": -0.2, "fidget_rate": 0.3}


def test_mode_checks():
    cfg = default_config()
    cfg["modes"].append({"id": "normal"})
    assert any("not normal or auto" in e for e in errors(cfg))
    cfg = default_config()
    cfg["modes"][1]["rotation"] = "ghost"
    cfg["modes"][1]["triggers_off"] = ["nope"]
    cfg["modes"][0]["condition"]["entities"] = []
    errs = errors(cfg)
    assert any("rotation 'ghost'" in e for e in errs)
    assert any("trigger 'nope'" in e for e in errs)
    assert any("needs an entity" in e for e in errs)
    cfg = default_config()
    cfg["modes"][0]["condition"] = None        # picked by hand only
    cfg["modes"][1]["rotation"] = "pause"
    assert valid(cfg)["modes"][0]["condition"] is None
    cfg["triggers"][-1]["modes"] = ["ghost"]
    assert any("mode 'ghost'" in e for e in errors(cfg))


def test_v2_sleep_entity_becomes_night():
    old = default_config()
    old["version"] = 2
    del old["modes"]
    old["behaviour"]["sleep_entity"] = "input_boolean.bedtime"
    old["stories"] = [s for s in old["stories"] if s["id"] != "welcome_home"]
    old["triggers"] = [t for t in old["triggers"] if t["id"] not in ("welcome", "fixed")]
    cfg = valid(old)
    assert "sleep_entity" not in cfg["behaviour"]
    night = modes_of(cfg)["night"]
    assert night["condition"]["entities"] == ["input_boolean.bedtime"]
    assert "fixed" not in modes_of(cfg)["away"]["triggers_off"]     # a deleted trigger is dropped
    assert any(t["id"] == "welcome" for t in cfg["triggers"])
    old["behaviour"]["sleep_entity"] = ""
    assert modes_of(valid(old))["night"]["condition"] is None


def test_mode_trigger_fires():
    t = {"modes": ["away"], "edge": "leave"}
    assert mode_fires(t, "away", "normal") and not mode_fires(t, "normal", "away")
    assert mode_fires({**t, "edge": "enter"}, "normal", "away")
    assert mode_fires({**t, "edge": "either"}, "normal", "away")
    assert mode_fires({"modes": [], "edge": "enter"}, "normal", "night")
    assert not mode_fires({"modes": [], "edge": "enter"}, "night", "normal")
    assert not mode_fires(t, "away", "away")
