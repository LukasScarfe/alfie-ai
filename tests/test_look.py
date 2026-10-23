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
    assert look()["aspect"] == 1 and look(aspect=2.5)["aspect"] == 2.5
    assert errors(aspect=0.2) and errors(aspect=4)


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


def test_motion_defaults_match_the_card():
    """look.motion: config.py MOTION and alfie-face.js MOTION hold the same defaults."""
    import re
    from alfie.config import MOTION
    with open(os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                           "frontend", "alfie-face.js")) as f:
        block = re.search(r"export const MOTION = \{(.*?)\};", f.read(), re.S).group(1)
    js = {k: float(v) for k, v in re.findall(r"(\w+): (-?[\d.]+)", block)}
    assert js == {k: d for k, (d, _, _) in MOTION.items()}
    m = default_config()["look"]["motion"]
    assert m["wave_depth"] == 0.028 and m["wave_bumps"] == 7 and m["transition_seconds"] == {}
    assert look()["motion"] == m


def test_motion_validation():
    m = look(motion={"wave_depth": 0.1, "wave_bumps": 11.6, "transition_seconds": {"zoom": 2}})
    assert m["motion"]["wave_depth"] == 0.1 and m["motion"]["wave_bumps"] == 12
    assert m["motion"]["transition_seconds"] == {"zoom": 2} and m["motion"]["speak_rate"] == 1
    assert errors(motion={"wave_depth": 1})
    assert errors(motion={"wiggle": 1})[0].endswith("unknown setting 'wiggle'")
    assert errors(motion={"transition_seconds": {"zoom": 9}})
    assert errors(motion="fast")
    # a partial motion keeps the rest at their defaults, and a reset clears it
    cfg = validate({"look": {"motion": {"breath_depth": 2}}}, FACE)
    assert cfg["look"]["motion"]["breath_seconds"] == 3.6
    assert reset(cfg, "look")["look"]["motion"] == default_config()["look"]["motion"]
