"""Screen types, option validation and the screens/rotations config sections."""
import json

import pytest

from alfie.config import SECTIONS, ConfigError, default_config, reset, validate
from alfie.screen_types import load_types, validate_options

from test_config import FACE

PLOT = {"type": "plot", "title": "Plot", "needs": "history", "options": [
    {"key": "entities", "kind": "entities", "label": "Series", "required": True,
     "domain": ["sensor"]},
    {"key": "hours", "kind": "number", "label": "Span", "default": 72, "min": 1, "max": 2160},
    {"key": "unit", "kind": "text", "label": "Unit", "default": ""},
    {"key": "style", "kind": "choice", "label": "Line", "default": "solid",
     "choices": ["solid", "dotted"]},
    {"key": "markers", "kind": "bool", "label": "Markers", "default": True},
    {"key": "tint", "kind": "color", "label": "Tint", "default": "#ffcc00"},
    {"key": "focus", "kind": "entity", "label": "Focus"},
]}
LABEL = {"type": "label", "title": "Label", "needs": None, "options": [
    {"key": "text", "kind": "text", "label": "Text", "required": True},
    {"key": "size", "kind": "number", "label": "Size", "default": 0.3, "min": 0.05, "max": 1},
]}


@pytest.fixture
def types(tmp_path):
    for m in (PLOT, LABEL):
        (tmp_path / f"{m['type']}.json").write_text(json.dumps(m))
    (tmp_path / "broken.json").write_text("{nope")
    (tmp_path / "odd.json").write_text(json.dumps({"type": "odd", "needs": "magic"}))
    return load_types(str(tmp_path))


def cfg_with(**kw):
    return {**default_config(), **kw}


def errs(types, **kw):
    with pytest.raises(ConfigError) as e:
        validate(cfg_with(**kw), FACE, types)
    return e.value.errors


def test_load_types_skips_broken_files(types):
    assert set(types) == {"plot", "label"}
    assert load_types("/nonexistent") == {}


def test_defaults_filled(types):
    o = validate_options(types["plot"], {"entities": ["sensor.a"]})
    assert o == {"entities": ["sensor.a"], "hours": 72, "unit": "", "style": "solid",
                 "markers": True, "tint": "#ffcc00", "focus": ""}
    assert list(o) == [x["key"] for x in PLOT["options"]]   # the type's order
    assert validate_options(types["label"], {"text": "hi"}) == {"text": "hi", "size": 0.3}


@pytest.mark.parametrize("opts,word", [
    ({}, "required"),
    ({"entities": ["sensor.a"], "hours": 0}, "between"),
    ({"entities": ["sensor.a"], "hours": 5000}, "between"),
    ({"entities": ["sensor.a"], "hours": "x"}, "number"),
    ({"entities": ["sensor.a"], "style": "wavy"}, "not one of"),
    ({"entities": ["Sensor A"]}, "entity id"),
    ({"entities": ["light.kitchen"]}, "must be in sensor"),
    ({"entities": ["sensor.a"], "focus": "nodot"}, "entity id"),
    ({"entities": ["sensor.a"], "tint": "red"}, "colour"),
])
def test_option_errors(types, opts, word):
    with pytest.raises(ConfigError) as e:
        validate_options(types["plot"], opts)
    assert any(word in m for m in e.value.errors)


def test_option_coercions(types):
    o = validate_options(types["plot"], {"entities": "sensor.a", "hours": "24",
                                         "markers": False, "focus": "light.x"})
    assert o["entities"] == ["sensor.a"] and o["hours"] == 24 and o["markers"] is False
    assert o["focus"] == "light.x"
    # Unknown keys are dropped, not errors.
    assert "junk" not in validate_options(types["label"], {"text": "a", "junk": 1})


SCREENS = [{"id": "hello", "type": "label", "title": "", "options": {"text": "Hello"}},
           {"id": "plants", "type": "plot", "title": "Plants",
            "options": {"entities": ["sensor.a"]}}]
ROTS = [{"id": "living", "name": "", "transition": "random",
         "steps": [{"screen": "hello", "seconds": 20}, {"screen": "plants", "seconds": "45"}]}]


def test_sections_and_defaults(types):
    assert SECTIONS[5:7] == ("screens", "rotations")
    d = default_config()
    assert d["screens"] == [] and d["rotations"] == []
    assert reset(cfg_with(screens=SCREENS), "screens")["screens"] == []
    out = validate(cfg_with(screens=SCREENS, rotations=ROTS), FACE, types)
    assert out["screens"][0]["title"] == "Label"          # the type's title
    assert out["rotations"][0]["name"] == "living"
    assert out["rotations"][0]["steps"][1]["seconds"] == 45
    assert out["screens"][1]["options"]["hours"] == 72


def test_key_order_is_stable(types):
    out = validate(cfg_with(screens=SCREENS, rotations=ROTS), FACE, types)
    again = validate(json.loads(json.dumps(out)), FACE, types)
    assert json.dumps(again) == json.dumps(out)
    assert list(out) == list(default_config())
    assert list(out["screens"][0]) == ["id", "type", "title", "options"]
    assert list(out["rotations"][0]) == ["id", "name", "transition", "face_seconds", "steps"]
    assert json.dumps(validate(default_config(), FACE)) == json.dumps(default_config())


def test_existing_calls_work_without_types():
    assert validate(default_config(), FACE) == default_config()


def test_screen_errors(types):
    ok = SCREENS[0]
    assert any("used twice" in e for e in errs(types, screens=[ok, dict(ok)]))
    assert any("unknown type" in e for e in errs(types, screens=[{**ok, "type": "nope"}]))
    assert any("id must be" in e for e in errs(types, screens=[{**ok, "id": "Bad Id"}]))
    assert any("required" in e for e in errs(types, screens=[{**ok, "options": {}}]))
    assert any("must be a list" in e for e in errs(types, screens="x"))
    assert any("unknown type" in e for e in errs({}, screens=[ok]))   # no types loaded


def test_rotation_errors(types):
    step = {"screen": "hello", "seconds": 20}
    rot = {"id": "r", "name": "R", "transition": "fade", "steps": [step]}
    kw = {"screens": SCREENS}
    assert any("does not exist" in e for e in errs(types, **kw, rotations=[
        {**rot, "steps": [{"screen": "ghost", "seconds": 20}]}]))
    for bad in (2, 3601, "soon"):
        assert errs(types, **kw, rotations=[{**rot, "steps": [{**step, "seconds": bad}]}])
    assert any("used twice" in e for e in errs(types, **kw, rotations=[rot, dict(rot)]))
    assert any("transition" in e for e in errs(types, **kw, rotations=[
        {**rot, "transition": "Not A Slug"}]))
    # Edges are fine, and so is any slug transition (the intro names grow).
    validate(cfg_with(**kw, rotations=[{**rot, "transition": "condense_x", "steps": [
        {**step, "seconds": 3}, {**step, "seconds": 3600}]}]), FACE, types)
