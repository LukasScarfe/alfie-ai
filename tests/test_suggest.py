from alfie.config import default_config
from alfie.suggest import suggest


def st(eid, state="off", **attrs):
    return (eid, state, attrs)


HOUSE = [
    st("sensor.plant_moisture", "40", device_class="moisture", friendly_name="Fern moisture"),
    st("sensor.phone_battery", "80", device_class="battery"),          # the starter pattern has it
    st("sensor.remote_level", "80", device_class="battery", friendly_name="Remote"),
    st("binary_sensor.front_door", device_class="door", friendly_name="Front door"),
    st("binary_sensor.nas_problem", device_class="problem", friendly_name="NAS"),
    st("binary_sensor.hall_motion", device_class="motion", friendly_name="Hall motion"),
    st("binary_sensor.desk_presence", device_class="presence", friendly_name="Desk"),
    st("input_boolean.sleep_mode", friendly_name="Sleep mode"),
    st("switch.kettle", friendly_name="Kettle"),
    st("light.lamp", "on"),
    st("binary_sensor.back_window", device_class="window"),        # no friendly name
]


def test_suggestions_from_the_house():
    r = suggest(HOUSE, default_config())
    names = {s["name"]: s for s in r["signals"]}
    assert set(names) == {"Fern moisture is low", "Remote is low", "Front door is open",
                          "NAS reports a problem", "Back window is open"}
    assert [m["name"] for m in r["motion"]] == ["Desk", "Hall motion"]
    assert names["Fern moisture is low"]["op"] == "below"
    assert names["Front door is open"]["severity"] == "minor"
    assert [m["entity"] for m in r["motion"]] == ["binary_sensor.desk_presence",
                                                 "binary_sensor.hall_motion"]
    assert [s["entity"] for s in r["sleep"]] == ["input_boolean.sleep_mode"]


def test_what_the_config_covers_is_skipped():
    cfg = default_config()
    cfg["signals"].append({"id": "fern", "name": "Fern", "entities": ["sensor.plant_*"]})
    cfg["behaviour"]["motion_sensors"] = [{"entity": "binary_sensor.hall_motion", "action": "notice"}]
    r = suggest(HOUSE, cfg)
    assert "Fern moisture is low" not in {s["name"] for s in r["signals"]}
    assert [m["entity"] for m in r["motion"]] == ["binary_sensor.desk_presence"]
