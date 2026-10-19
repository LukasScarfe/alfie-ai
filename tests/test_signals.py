from alfie.signals import Signal, compare, evaluate, matching, watches


def test_numbers_compare_as_numbers():
    assert compare("12", "below", 25)
    assert not compare("25", "below", 25)
    assert compare("1300", "above", "1200")
    assert compare("21.0", "is", 21)


def test_no_reading_never_passes():
    for s in ("unavailable", "unknown", None, ""):
        assert not compare(s, "below", 25)
        assert not compare(s, "is", "on")
        assert not compare(s, "is_not", "on")


def test_non_numeric_against_above_is_false():
    assert not compare("on", "above", 3)


def test_on_off_words_are_booleans():
    assert compare("on", "is", "on")
    assert compare("open", "is", "on")
    assert compare("off", "is_not", "on")
    assert compare("home", "is", True)


def test_text_is_case_insensitive():
    assert compare("Rainy", "is", "rainy")
    assert compare("sunny", "is_not", "rainy")


def test_wildcards():
    ids = ["binary_sensor.nas_drive_1", "binary_sensor.nas_drive_2", "sensor.other"]
    assert matching(["binary_sensor.nas_*"], ids) == ids[:2]
    s = Signal(id="x", label="x", entities=("binary_sensor.nas_*",))
    assert watches(s, "binary_sensor.nas_drive_9")
    assert not watches(s, "sensor.other")


def test_evaluate_any_and_all():
    states = {"binary_sensor.a": "on", "binary_sensor.b": "off"}
    any_ = Signal(id="a", label="a", entities=("binary_sensor.a", "binary_sensor.b"))
    all_ = Signal(id="b", label="b", entities=("binary_sensor.a", "binary_sensor.b"), match="all")
    r = evaluate(any_, states)
    assert r.active and r.entities == ("binary_sensor.a",)
    assert not evaluate(all_, states).active


def test_missing_entity_is_not_active():
    s = Signal(id="p", label="p", entities=("sensor.gone",), op="below", value=25)
    assert not evaluate(s, {}).active


def test_bad_operator_rejected():
    import pytest
    with pytest.raises(ValueError):
        Signal(id="x", label="x", entities=("a.b",), op="between")
