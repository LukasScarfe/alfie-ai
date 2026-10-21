"""His own expressions (config section `expressions`): checked, merged into
every name check, and handed to the cards (face_extras)."""
from alfie.config import default_config, face_extras

from test_config import FACE, errors, valid


def test_missing_section_is_empty():
    cfg = default_config()
    del cfg["expressions"]
    assert valid(cfg)["expressions"] == []


def test_custom_expression_is_checked_and_usable_everywhere():
    cfg = default_config()
    cfg["expressions"] = [{"id": "smug", "name": "Smug", "left": [0.4, -0.2, -0.6, 0.1],
                           "size": 0.9, "look": [0.1, 0], "shapes": {"eye": {"type": "star"}}}]
    cfg["mood"]["expressions"]["content"] = "smug"
    cfg["behaviour"]["sleep_expression"] = "smug"
    out = valid(cfg)
    e = out["expressions"][0]
    assert e["right"] == e["left"] == [0.4, -0.2, -0.6, 0.1]      # right defaults to the left
    assert e["shapes"] == {"eye": {"type": "star"}}
    assert out["mood"]["expressions"]["content"] == "smug"
    extras = face_extras(out)["expressions"]
    assert extras["smug"] == {"left": [0.4, -0.2, -0.6, 0.1], "right": [0.4, -0.2, -0.6, 0.1],
                              "size": 0.9, "look": [0.1, 0], "shapes": {"eye": {"type": "star"}}}


def test_builtin_override_keeps_its_name():
    cfg = default_config()
    cfg["expressions"] = [{"id": "happy", "left": [1, 0, 0.3, 0]}]
    out = valid(cfg)
    assert out["expressions"][0]["name"] == "happy"
    assert "happy" in FACE["expressions"]


def test_bad_expressions_are_reported():
    cfg = default_config()
    cfg["expressions"] = [{"id": "Bad Id"}, {"id": "x", "left": [1, 2]}, {"id": "y", "size": 9},
                          {"id": "y"}, {"id": "z", "shapes": {"head": {"type": "circle"}}}]
    errs = " | ".join(errors(cfg))
    for want in ("expression 1", "expression x left", "expression y size", "used twice", "unknown shape 'head'"):
        assert want in errs, want


def test_unknown_expression_still_refused():
    cfg = default_config()
    cfg["behaviour"]["sleep_expression"] = "nope"
    assert any("sleep expression" in e for e in errors(cfg))


# ------------------------------------------------------------- animations

def test_custom_animation_is_checked_and_usable():
    cfg = default_config()
    cfg["animations"] = [{"id": "wiggle", "name": "Wiggle",
                          "keys": [[0.2, {"dx": 0.1, "shut_l": 0.5}, "spring"], ["0.3", {}]]}]
    cfg["behaviour"]["idle_fidgets"] = ["wiggle", "nod"]
    out = valid(cfg)
    assert out["animations"][0]["keys"] == [[0.2, {"dx": 0.1, "shut_l": 0.5}, "spring"], [0.3, {}, "ease"]]
    assert out["behaviour"]["idle_fidgets"] == ["wiggle", "nod"]
    assert face_extras(out)["animations"] == {"wiggle": {"keys": out["animations"][0]["keys"]}}


def test_bad_animations_are_reported():
    cfg = default_config()
    cfg["animations"] = [{"id": "a", "keys": []}, {"id": "b", "keys": [[0.2, {"spin": 1}]]},
                         {"id": "c", "keys": [[99, {"dx": 3}, "bouncy"]]}, {"id": "d"}]
    errs = " | ".join(errors(cfg))
    for want in ("animation a keys", "unknown channel 'spin'", "animation c key 1 seconds",
                 "animation c key 1 dx", "animation c key 1 ease", "animation d keys"):
        assert want in errs, want
