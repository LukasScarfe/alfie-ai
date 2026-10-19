from alfie import defaults
from alfie.mood import MoodSettings, combine
from alfie.signals import evaluate_all

GOOD_HOUSE = {
    **{e: "off" for e in defaults.NAS_SENSORS},
    "sensor.fineoffset_wh51_0ee63f_moisture": "48",
    "sensor.fineoffset_wh51_0ee64d_moisture": "52",
    "binary_sensor.bathroom_motion_sensor_battery_low": "off",
    "binary_sensor.hallway_motion_sensor_battery_low": "off",
    "binary_sensor.hallway_closet_motion_sensor_battery_low": "off",
    "input_boolean.guest_mode": "off",
}


def mood(changes=None, **kw):
    states = {**GOOD_HOUSE, **(changes or {})}
    return combine(evaluate_all(defaults.SIGNALS, states), MoodSettings(**kw))


def test_lukas_ladder_reproduces_the_old_face():
    # The old sensor.superintendent_mood: neutral / skeptical / alarmed / happy.
    assert mood().expression == "neutral"
    assert mood({"sensor.fineoffset_wh51_0ee63f_moisture": "12"}).expression == "skeptical"
    assert mood({"binary_sensor.hallway_motion_sensor_battery_low": "on"}).expression == "skeptical"
    assert mood({"binary_sensor.scarfe_218j_security_status": "on"}).expression == "alarmed"
    assert mood({"input_boolean.guest_mode": "on"}).expression == "happy"


def test_worst_wins_over_good():
    m = mood({"input_boolean.guest_mode": "on", "sensor.fineoffset_wh51_0ee64d_moisture": "3"})
    assert m.level == "uneasy"
    assert m.reason == "The Ficus is dry"


def test_critical_sorts_first_in_reason():
    m = mood({"sensor.fineoffset_wh51_0ee64d_moisture": "3",
              "binary_sensor.scarfe_218j_security_status": "on"})
    assert m.level == "miserable"
    assert m.reason == "The NAS is reporting a drive problem (and 1 more)"


def test_weighted_mode_adds_up():
    both_plants = {"sensor.fineoffset_wh51_0ee63f_moisture": "3",
                   "sensor.fineoffset_wh51_0ee64d_moisture": "3"}
    assert mood(combine="weighted").level == "content"
    assert mood({"sensor.fineoffset_wh51_0ee63f_moisture": "3"}, combine="weighted").level == "uneasy"
    assert mood(both_plants, combine="weighted").level == "sad"
    assert mood({**both_plants, "binary_sensor.scarfe_218j_security_status": "on"},
                combine="weighted").level == "miserable"
    assert mood({"input_boolean.guest_mode": "on"}, combine="weighted").level == "bubbly"


def test_count_mode_cancels():
    m = mood({"input_boolean.guest_mode": "on", "sensor.fineoffset_wh51_0ee63f_moisture": "3"},
             combine="count")
    assert m.level == "content"


def test_energy_falls_with_mood():
    assert mood({"input_boolean.guest_mode": "on"}).energy > mood().energy
    assert mood().energy > mood({"binary_sensor.scarfe_218j_security_status": "on"}).energy


def test_all_well_reason():
    assert mood().reason == "All's well."
