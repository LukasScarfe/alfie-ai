"""The global default look: defaults, validation, colours, shapes, key order."""
import copy
import json
import os

import pytest

from alfie.config import ConfigError, default_config, reset, validate

with open(os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                       "frontend", "alfie-face.json")) as f:
    FACE = json.load(f)


def look(**kw):
    return validate({"look": kw}, FACE)["look"]


def errors(**kw):
    with pytest.raises(ConfigError) as e:
        look(**kw)
    return e.value.errors


def test_defaults_are_the_cards_own():
    d = default_config()["look"]
    assert d["style"] == "neon" and d["glow"] is None and d["padding"] == 0.08
    assert d["shapes"] == {"head": {"type": "circle"}, "eye": {"type": "circle"}}
    assert validate({}, FACE)["look"] == d


def test_key_order_is_stable_json():
    d = default_config()["look"]
    assert json.dumps(look(**d)) == json.dumps(d)
    # a scrambled input still comes out in the defaults' order
    scrambled = dict(reversed(list(d.items())))
    assert json.dumps(look(**scrambled)) == json.dumps(d)
    full = validate({}, FACE)
    assert json.dumps(validate(full, FACE)) == json.dumps(full)


def test_reset_look():
    cfg = validate({"look": {"style": "crt"}}, FACE)
    assert reset(cfg, "look")["look"] == default_config()["look"]


def test_ranges_and_style():
    assert "not one of" in errors(style="matrix")[0]
    assert errors(padding=0.9) and errors(line_width=0) and errors(glow=3)
    assert errors(screen_line_width=1)
    assert look(glow=2)["glow"] == 2 and look(glow="")["glow"] is None
    assert look(eye_fill=True)["eye_fill"] is True


def test_colours():
    assert look(ring_color="#4dffa0", eye_color="#fff",
                text_color="var(--primary-color)", accent_color="var(--a, #fff)",
                background="#00000080")["text_color"] == "var(--primary-color)"
    assert look(background="none")["background"] == ""
    for bad in ("red", "#12", "var(primary)", "rgb(1,2,3)", 5):
        assert errors(ring_color=bad), bad


def test_shapes():
    s = look(shapes={"head": {"type": "polygon", "sides": 6, "roundness": 0.3, "rotation": 30,
                              "stretch": [1.2, 0.8], "bogus": 1},
                     "eye": {"type": "star", "points": 5, "inner": 0.4},
                     "left_eye": {"type": "superellipse", "n": 4},
                     "right_eye": {"type": "path",
                                   "points": [[1, 0], [0, 1], [-1, 0], [0, -1]]}})["shapes"]
    assert list(s) == ["head", "eye", "left_eye", "right_eye"]
    assert s["head"] == {"type": "polygon", "sides": 6, "roundness": 0.3, "rotation": 30,
                         "stretch": [1.2, 0.8]}
    assert s["eye"] == {"type": "star", "points": 5, "inner": 0.4}
    # a missing slot keeps its default
    assert look(shapes={"eye": {"type": "circle"}})["shapes"]["head"] == {"type": "circle"}


@pytest.mark.parametrize("spec", [
    {"type": "blob"}, {"type": "polygon", "sides": 2}, {"type": "polygon", "sides": 13},
    {"type": "star", "points": 1}, {"type": "star", "inner": 0.01},
    {"type": "star", "inner": 1.5}, {"type": "polygon", "roundness": 2},
    {"type": "superellipse", "n": 0.1}, {"type": "superellipse", "n": 11},
    {"type": "circle", "rotation": 400}, {"type": "circle", "stretch": [0.1, 1]},
    {"type": "circle", "stretch": [1]}, {"type": "path", "points": [[0, 0], [1, 1]]},
    {"type": "path", "points": [[0, 0], [1, 1], [2, 0]]},
    {"type": "path", "points": [[0, 0]] * 201}, "circle",
])
def test_bad_shapes(spec):
    assert errors(shapes={"head": spec})


def test_unknown_slot_and_shapes_type():
    assert errors(shapes={"nose": {"type": "circle"}})
    assert errors(shapes={"head": {"type": "circle"}, "eye": []})


def test_unknown_keys_dropped():
    assert "wat" not in look(wat=1)
