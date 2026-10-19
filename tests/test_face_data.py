import json
import os

FACE = os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                    "frontend", "alfie-face.json")
EXPRESSIONS = {"neutral", "angry", "sad", "bored", "skeptical", "happy", "surprised",
               "alarmed", "suspicious", "sleepy", "confused", "closed"}
ANIMATIONS = {"wink_left", "wink_right", "look_around", "glance_left", "glance_right", "nod",
              "shake", "eye_roll", "startle", "double_take", "laugh", "sigh", "squint",
              "flinch", "scan", "processing", "glitch", "dizzy", "nod_off", "wake_up"}
CHANNELS = {"shut", "shut_l", "shut_r", "open", "droop", "size", "dx", "dy", "lx", "ly",
            "rx", "ry", "fx", "fy"}
EASES = {"ease", "spring", "cut", "linear"}


def face():
    with open(FACE) as f:
        return json.load(f)


def test_all_expressions_and_animations():
    d = face()
    assert set(d["expressions"]) == EXPRESSIONS
    assert set(d["animations"]) == ANIMATIONS


def test_expressions_are_well_formed():
    for name, e in face()["expressions"].items():
        assert len(e["left"]) == 4 and len(e["right"]) == 4, name
        assert e["size"] > 0 and len(e["look"]) == 2, name


def test_keyframes_are_well_formed():
    for name, a in face()["animations"].items():
        if "procedural" in a:
            assert a["length"] > 0, name
            continue
        assert a["keys"], name
        for dt, ch, ease in a["keys"]:
            assert dt > 0 and ease in EASES, name
            assert set(ch) <= CHANNELS, (name, set(ch) - CHANNELS)


def test_engine_defaults_only_name_real_animations():
    from alfie import defaults
    import house
    names = set(face()["animations"])
    used = set(defaults.NOTICE) | set(defaults.IDLE_FIDGETS) | {defaults.ON_CRITICAL, defaults.ON_RECOVER, defaults.ON_WAKE}
    used |= {v for v in house.MOTION_SENSORS.values() if v != "notice"}
    assert used <= names, used - names
    assert defaults.SLEEP_EXPRESSION in face()["expressions"]


def test_version_matches_manifest():
    from alfie.const import VERSION
    with open(os.path.join(os.path.dirname(FACE), "..", "manifest.json")) as f:
        assert json.load(f)["version"] == VERSION


SHAPE_TYPES = {"circle", "polygon", "star", "superellipse", "path"}
SHAPE_PARTS = {"head", "eye", "left_eye", "right_eye"}


def _check_shapes(shapes, where):
    assert set(shapes) <= SHAPE_PARTS, (where, set(shapes) - SHAPE_PARTS)
    for part, spec in shapes.items():
        assert spec.get("type", "circle") in SHAPE_TYPES, (where, part)
        if spec.get("type") == "polygon":
            assert spec.get("sides", 4) >= 3, (where, part)
        if spec.get("type") == "star":
            assert spec.get("points", 5) >= 2 and 0 < spec.get("inner", 0.5) <= 1, (where, part)
        if spec.get("type") == "path":
            assert len(spec["points"]) >= 3, (where, part)
        if "stretch" in spec:
            assert len(spec["stretch"]) == 2 and all(v > 0 for v in spec["stretch"]), (where, part)


def test_shapes_are_well_formed():
    d = face()
    _check_shapes(d["shapes"], "face")
    for name, e in d["expressions"].items():
        if "shapes" in e:
            assert set(e["shapes"]) <= {"eye", "left_eye", "right_eye"}, name
            _check_shapes(e["shapes"], name)
