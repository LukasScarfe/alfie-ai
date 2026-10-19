"""Icons in stories (stories.py) and threshold entities on triggers (triggers.py)."""

import json
import os

import pytest

from alfie.config import ConfigError, _Check, default_config, validate
from alfie.stories import (
    ICON_SCREEN,
    Context,
    check_icon,
    compile_simple,
    default_icon,
    default_simple,
    default_step,
    expand,
    icon_action,
    is_icon_name,
)
from alfie.triggers import entity_fires, is_entity_id, threshold_entity, validate_triggers

FACE_PATH = os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                         "frontend", "alfie-face.json")
with open(FACE_PATH) as f:
    FACE = json.load(f)


def checked(**kw):
    ck = _Check()
    out = check_icon({**default_icon(), **kw}, "icon", ck)
    return out, ck.errors


def test_icon_names():
    assert is_icon_name("mdi:white-balance-sunny")
    assert is_icon_name("hass:home") and is_icon_name("phu:my_icon")
    for bad in ("", "mdi", "mdi:", ":x", "mdi:a b", "a:b:c", None, 3):
        assert not is_icon_name(bad)


def test_check_icon_fills_and_rejects():
    out, errs = checked()
    assert not errs and out == default_icon()
    out, errs = checked(icon="nope", style="spin", size=9, place="moon")
    assert len(errs) == 4
    assert out["icon"] == default_icon()["icon"] and out["style"] == "transform"
    assert out["size"] == 1 and out["place"] == "top_right"


def test_icon_actions_by_style():
    t = icon_action(checked(style="transform", transform="ring")[0])
    assert t.kind == "screen" and t.value["id"] == ICON_SCREEN
    assert t.value["present"] == "handover" and t.value["transition"] == "morph"
    assert t.value["icon"]["ring"] is True and t.seconds == 5
    b = icon_action(checked(style="beside", corner="top_left", transition="zoom")[0])
    assert b.value["present"] == "corner" and b.value["icon"]["corner"] == "top_left"
    assert b.value["transition"] == "zoom"
    o = icon_action(checked(style="overlay", place="above", seconds=8)[0], wait=False)
    assert o.kind == "icon" and o.value["place"] == "above" and o.seconds == 0
    assert icon_action(checked(style="overlay")[0]).seconds == 5


def test_icon_step_in_a_story():
    cfg = default_config()
    cfg["stories"].append({"id": "bright", "name": "Bright", "form": "steps",
                           "simple": default_simple(),
                           "steps": [{"kind": "icon", "icon": "mdi:white-balance-sunny"},
                                     {"kind": "icon", "style": "overlay", "wait": False}]})
    s = next(x for x in validate(cfg, FACE)["stories"] if x["id"] == "bright")
    assert s["steps"][0] == {**default_step("icon"), "icon": "mdi:white-balance-sunny"}
    acts = expand(s["steps"], Context(), lambda n: 1.0)
    assert [a.kind for a in acts] == ["screen", "icon"]
    assert [a.seconds for a in acts] == [5, 0]


def test_bad_icon_step_is_an_error():
    cfg = default_config()
    cfg["stories"].append({"id": "x", "name": "X", "form": "steps", "simple": default_simple(),
                           "steps": [{"kind": "icon", "icon": "lightbulb"}]})
    with pytest.raises(ConfigError) as e:
        validate(cfg, FACE)
    assert "not an icon name" in "\n".join(e.value.errors)


def test_simple_form_icon():
    steps = compile_simple({**default_simple(), "icon": "mdi:heart", "icon_style": "overlay",
                            "screen": ""})
    assert [s["kind"] for s in steps] == ["icon"]
    assert steps[0]["icon"] == "mdi:heart" and steps[0]["style"] == "overlay"
    cfg = default_config()
    cfg["stories"].append({"id": "y", "name": "Y", "form": "simple",
                           "simple": {**default_simple(), "icon": "bad"}, "steps": []})
    with pytest.raises(ConfigError):
        validate(cfg, FACE)


def trigger(value, op="above"):
    ck = _Check()
    out = validate_triggers([{"id": "t", "kind": "entity", "story": "s", "op": op,
                              "entities": ["sensor.lux"], "value": value}], ck, {"s"}, set())
    return out[0], ck.errors


def test_threshold_entity_trigger():
    assert is_entity_id("input_number.living_room_lights_on_lux")
    assert not is_entity_id("300") and not is_entity_id("a.b.c")
    t, errs = trigger("input_number.lux_on")
    assert not errs and threshold_entity(t) == "input_number.lux_on"
    # The lux crosses the threshold's value now.
    assert entity_fires(t, "200", "400", "300", "300")
    assert not entity_fires(t, "350", "400", "300", "300")     # already above
    assert not entity_fires(t, "200", "400", None, None)       # no threshold reading
    # The threshold moves below the lux: a crossing too.
    assert entity_fires(t, "250", "250", "200", "300")
    assert not entity_fires(t, "250", "250", "300", "200")


def test_fixed_threshold_still_works():
    t, errs = trigger("300")
    assert not errs and t["value"] == 300.0 and threshold_entity(t) is None
    assert entity_fires(t, "200", "400")
    _, errs = trigger("bright")
    assert errs and "number or an entity" in errs[0]
    t, _ = trigger("input_number.x", op="is")
    assert threshold_entity(t) is None     # only above / below take an entity
