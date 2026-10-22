from alfie.converse import Turn, screen_for, speech_seconds, subject
from alfie.finder import Entry, Index

INDEX = Index([
    Entry("switch.coffee", "Coffee maker", ("espresso machine",), "", "Dining", True),
    Entry("sensor.monstera", "Monstera soil moisture", ("monstera",), "", "Living Room", True),
    Entry("sensor.office_temp", "Office temperature", (), "", "Office", True),
    Entry("weather.home", "Weather", ("forecast",), "", "", True),
])
STATES = {
    "switch.coffee": ("on", {"friendly_name": "Coffee maker"}),
    "light.a": ("off", {"friendly_name": "Floor lamp"}),
    "light.b": ("off", {"friendly_name": "Table lamp"}),
    "sensor.monstera": ("33", {"friendly_name": "Monstera soil moisture", "unit_of_measurement": "%",
                               "state_class": "measurement"}),
    "sensor.office_temp": ("25.1", {"friendly_name": "Office temperature",
                                    "unit_of_measurement": "°C"}),
    "sensor.bath_temp": ("22.4", {"friendly_name": "Bathroom temperature",
                                  "unit_of_measurement": "°C"}),
    "weather.home": ("cloudy", {"friendly_name": "Weather"}),
    "script.pc": ("off", {"friendly_name": "Gaming PC"}),
}
SETTINGS = {"action_screens": True, "answer_screens": True, "plot_hours": 24, "max_grid": 6,
            "screen_skip": ["script", "scene"]}


def state_of(eid):
    return STATES.get(eid)


class Call:
    """A ToolInput as the chat log holds it in process (an object, not a dict)."""

    def __init__(self, tool_name, tool_args, id_):
        self.tool_name, self.tool_args, self.id = tool_name, tool_args, id_


def intent_result(tool, call_id, response_type, ids):
    return {"role": "tool_result", "agent_id": "x", "tool_call_id": call_id, "tool_name": tool,
            "result": {"data": {"speech": {}, "response_type": response_type,
                                "data": {"targets": [], "failed": [],
                                         "success": [{"name": i, "type": "entity", "id": i}
                                                     for i in ids]}}}}


def turn_of(*contents):
    t = Turn()
    for c in contents:
        t.feed(c)
    return t


def test_a_local_intent_turn_is_an_action_with_its_from_state():
    t = turn_of({"role": "user", "content": "turn on the espresso machine"},
                {"role": "assistant", "agent_id": "x", "tool_calls": [Call("HassTurnOn", {"name": "espresso machine"}, "1")]},
                intent_result("HassTurnOn", "1", "action_done", ["switch.coffee"]),
                {"role": "assistant", "agent_id": "x", "content": "Turned on the switch"})
    assert t.done and t.reply == "Turned on the switch"
    assert subject(t, INDEX) == ("action", ["switch.coffee"])
    assert t.froms == {"switch.coffee": "off"}
    s = screen_for(*subject(t, INDEX), state_of, SETTINGS, t.froms)
    assert s["type"] == "toggle"
    assert s["options"] == {"entities": ["switch.coffee"], "from": ["off"], "more": 0, "action": True}


def test_an_llm_turn_with_namespaced_tools_and_a_query():
    t = turn_of({"role": "user", "content": "is the coffee maker on"},
                {"role": "assistant", "agent_id": "x",
                 "tool_calls": [{"tool_name": "assist__HassGetState", "tool_args": {"name": "Coffee maker"}, "id": "a"}]},
                intent_result("assist__HassGetState", "a", "query_answer", ["switch.coffee"]),
                {"role": "assistant", "agent_id": "x", "content": "It's on."})
    assert subject(t, INDEX) == ("answer", ["switch.coffee"])
    s = screen_for("answer", ["switch.coffee"], state_of, SETTINGS)
    assert s["type"] == "toggle" and s["options"]["action"] is False and s["options"]["from"] == []


def test_a_live_context_lookup_goes_by_the_name_it_was_given():
    t = turn_of({"role": "user", "content": "how dry is it"},
                {"role": "assistant", "agent_id": "x", "tool_calls": [
                    Call("assist__homeassistant__GetLiveContext", {"name": "Monstera moisture"}, "c")]},
                {"role": "tool_result", "agent_id": "x", "tool_call_id": "c",
                 "tool_name": "assist__homeassistant__GetLiveContext",
                 "result": {"data": {"success": True, "result": "big yaml"}}},
                {"role": "assistant", "agent_id": "x", "content": "Thirty-three percent."})
    assert subject(t, INDEX) == ("answer", ["sensor.monstera"])
    s = screen_for("answer", ["sensor.monstera"], state_of, SETTINGS)
    assert s == {"type": "plot", "title": "Monstera soil moisture",
                 "options": {"entities": ["sensor.monstera"], "hours": 24,
                             "title": "Monstera soil moisture"}}


def test_with_no_tools_the_words_name_the_entity():
    t = turn_of({"role": "user", "content": "what's the office temperature"},
                {"role": "assistant", "agent_id": "x", "content": "About 25 degrees."})
    assert subject(t, INDEX) == ("answer", ["sensor.office_temp"])
    t = turn_of({"role": "user", "content": "who wrote Pride and Prejudice"},
                {"role": "assistant", "agent_id": "x", "content": "Jane Austen."})
    assert subject(t, INDEX) == ("", [])


def test_the_find_tool_answer_counts_as_asked():
    t = turn_of({"role": "user", "content": "how hot is the server"},
                {"role": "assistant", "agent_id": "x", "tool_calls": [Call("alfie__find_entity", {"name": "server"}, "f")]},
                {"role": "tool_result", "agent_id": "x", "tool_call_id": "f", "tool_name": "alfie__find_entity",
                 "result": {"data": {"results": [{"entity_id": "sensor.cpu", "name": "Server CPU"}]}}},
                {"role": "assistant", "agent_id": "x", "content": "57 degrees."})
    assert subject(t, INDEX) == ("answer", ["sensor.cpu"])


def test_a_new_question_starts_a_new_turn():
    t = turn_of({"role": "user", "content": "a"}, {"role": "assistant", "agent_id": "x", "content": "b"})
    t.feed({"role": "user", "content": "c"})
    assert not t.done and t.said == "c" and t.reply == ""


def test_tool_calls_with_text_are_not_the_final_reply():
    t = turn_of({"role": "user", "content": "a"},
                {"role": "assistant", "agent_id": "x", "content": "Let me check",
                 "tool_calls": [Call("HassGetState", {}, "1")]})
    assert not t.done


def test_several_numbers_with_one_unit_share_a_plot_else_bars():
    s = screen_for("answer", ["sensor.office_temp", "sensor.bath_temp"], state_of, SETTINGS)
    assert s["type"] == "plot" and s["options"]["entities"] == ["sensor.office_temp", "sensor.bath_temp"]
    s = screen_for("answer", ["sensor.office_temp", "sensor.monstera"], state_of, SETTINGS)
    assert s["type"] == "bars" and s["options"]["range"] == "auto"


def test_weather_gets_the_weather_screen():
    s = screen_for("answer", ["weather.home"], state_of, SETTINGS)
    assert s == {"type": "weather", "title": "Weather", "options": {"weather": "weather.home"}}


def test_many_switches_are_a_grid_with_the_rest_counted():
    ids = ["light.a", "light.b", "switch.coffee"]
    s = screen_for("action", ids, state_of, {**SETTINGS, "max_grid": 2}, {"light.a": "on", "light.b": "on"})
    assert s["options"] == {"entities": ["light.a", "light.b"], "from": ["on", "on"], "more": 1,
                            "action": True}


def test_settings_and_skips_turn_screens_off():
    assert screen_for("action", ["script.pc"], state_of, SETTINGS) is None
    assert screen_for("action", ["switch.coffee"], state_of, {**SETTINGS, "action_screens": False}) is None
    assert screen_for("answer", ["sensor.monstera"], state_of, {**SETTINGS, "answer_screens": False}) is None
    assert screen_for("answer", ["switch.coffee"], state_of,
                      {**SETTINGS, "screen_skip": ["switch.coffee"]}) is None
    assert screen_for("answer", ["light.gone"], state_of, SETTINGS) is None
    assert screen_for("", [], state_of, SETTINGS) is None


def test_speech_seconds():
    assert speech_seconds("x" * 28) == 2
    assert speech_seconds("") == 0


def test_an_llm_turn_is_read_back_from_the_whole_log():
    # HA tells subscribers of an LLM agent's turn only what was said and the
    # tool results; the finished log has the calls and the reply too.
    from alfie.converse import last_turn
    log = [{"role": "system", "content": "prompt"},
           {"role": "user", "content": "is the coffee maker on"},
           {"role": "assistant", "agent_id": "g", "content": "It was off."},
           {"role": "user", "content": "how dry is the monstera"},
           {"role": "assistant", "agent_id": "g",
            "tool_calls": [Call("assist__homeassistant__GetLiveContext", {"name": "Monstera moisture"}, "1")]},
           {"role": "tool_result", "agent_id": "g", "tool_call_id": "1",
            "tool_name": "assist__homeassistant__GetLiveContext", "result": {"data": {"success": True}}},
           {"role": "assistant", "agent_id": "g", "content": "Thirty-three percent."}]
    t = last_turn(log)
    assert t.done and t.said == "how dry is the monstera" and t.reply == "Thirty-three percent."
    assert subject(t, INDEX) == ("answer", ["sensor.monstera"])
    # Not finished yet: no reply after the last thing said.
    assert not last_turn(log[:5]).done
