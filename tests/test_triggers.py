import json
import os

import pytest

from alfie.config import ConfigError, default_config, validate
from alfie.triggers import (
    allowed,
    busy_action,
    choose,
    default_trigger,
    entity_fires,
    mood_fires,
    signal_fires,
    wake_fires,
    watches,
)

FACE_PATH = os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                         "frontend", "alfie-face.json")
with open(FACE_PATH) as f:
    FACE = json.load(f)


def valid(cfg):
    return validate(cfg, FACE)


def errors(cfg):
    with pytest.raises(ConfigError) as e:
        valid(cfg)
    return "\n".join(e.value.errors)


def trig(kind="entity", **kw):
    return {**default_trigger(kind), "id": "t", "story": "alarm", **kw}


def test_default_triggers_validate_in_order():
    cfg = valid(default_config())
    assert [t["id"] for t in cfg["triggers"]] == ["critical", "mood_worse", "fixed",
                                                  "mood_better", "wake"]
    assert json.dumps(cfg["triggers"]) == json.dumps(default_config()["triggers"])


def test_trigger_checks():
    text = errors({"triggers": [
        trig(entities=[]),
        trig(id="b", story="nope", entities=["sensor.x"]),
        trig("signal", id="c", signals=["ghost"]),
        trig("mood", id="d", to=["ecstatic"]),
        trig(id="e", entities=["sensor.x"], op="above", value="warm"),
        {"id": "f", "kind": "telepathy"},
    ]})
    for want in ("needs at least one entity", "'nope' does not exist", "'ghost'", "ecstatic",
                 "needs a number", "telepathy"):
        assert want in text, want


def test_kind_fields_only():
    t = valid({"triggers": [trig("wake", entities=["x"], edge="sleeps")]})["triggers"][0]
    assert t["edge"] == "sleeps" and "entities" not in t


def test_entity_edges():
    above = trig(entities=["sensor.co2"], op="above", value=1200)
    assert entity_fires(above, "900", "1300")
    assert not entity_fires(above, "1300", "1400")      # already passing
    assert not entity_fires(above, "1300", "900")
    assert entity_fires(above, None, "1300")             # appeared passing
    assert not entity_fires(above, "900", "unavailable")
    changes = trig(entities=["sensor.x"])
    assert entity_fires(changes, "a", "b") and not entity_fires(changes, "a", "a")
    assert not entity_fires(changes, None, "a") and not entity_fires(changes, "a", None)


def test_motion_edges_and_patterns():
    m = trig("motion", entities=["binary_sensor.*_motion"])
    assert watches(m, "binary_sensor.hall_motion") and not watches(m, "sensor.hall_motion")
    assert entity_fires(m, "off", "on") and entity_fires(m, None, "on")
    assert not entity_fires(m, "on", "on") and not entity_fires(m, "on", "off")
    assert not watches({**m, "enabled": False}, "binary_sensor.hall_motion")


def test_mood_directions():
    worse = trig("mood", direction="worse")
    assert mood_fires(worse, "content", "uneasy") and not mood_fires(worse, "uneasy", "content")
    assert not mood_fires(worse, "content", "content")
    crit = trig("mood", direction="worse", to=["miserable"])
    assert mood_fires(crit, "uneasy", "miserable") and not mood_fires(crit, "content", "uneasy")
    from_sad = trig("mood", direction="any", **{"from": ["sad"]})
    assert mood_fires(from_sad, "sad", "bubbly") and not mood_fires(from_sad, "uneasy", "sad")


def test_signal_edges():
    any_fix = trig("signal", signals=[], edge="recovers")
    assert signal_fires(any_fix, {"a"}, {"b", "c"}) == ["b", "c"]
    assert signal_fires(trig("signal", signals=["c"], edge="either"), {"a"}, {"b", "c"}) == ["c"]
    assert signal_fires(trig("signal", signals=[], edge="goes_bad"), set(), {"b"}) == []


def test_wake_and_shared_conditions():
    assert wake_fires(trig("wake", edge="wakes"), True, False)
    assert not wake_fires(trig("wake", edge="wakes"), False, True)
    t = trig(moods=["sad", "miserable"])
    assert allowed(t, "sad", False) and not allowed(t, "content", False)
    assert not allowed(t, "sad", True) and allowed({**t, "while_asleep": True}, "sad", True)
    assert not allowed({**t, "enabled": False}, "sad", False)


def test_choose_and_busy():
    a, b, c = trig(id="a", priority=40), trig(id="b", priority=90), trig(id="c", priority=90)
    assert choose([a, b, c])["id"] == "b"
    assert choose([]) is None
    assert busy_action("auto", 50, None) == "play"
    assert busy_action("auto", 90, 50) == "interrupt"
    assert busy_action("auto", 50, 50) == "queue"
    assert busy_action("skip", 99, 10) == "skip"
    assert busy_action("interrupt", 1, 99) == "interrupt"
