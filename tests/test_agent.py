import json
import random

import pytest

from alfie import agent, brain

EN = brain.load_language("en")


@pytest.mark.parametrize("url", ["http://pc:8642", "http://pc:8642/", "http://pc:8642/v1",
                                 "http://pc:8642/v1/chat/completions"])
def test_endpoint(url):
    assert agent.endpoint(url) == "http://pc:8642/v1/chat/completions"


def test_headers():
    h = agent.headers("k", "alfie-01abc", "alfie:assist_satellite.echo")
    assert h["Authorization"] == "Bearer k"
    assert h["X-Hermes-Session-Id"] == "alfie-01abc"
    assert h["X-Hermes-Session-Key"] == "alfie:assist_satellite.echo"
    bare = agent.headers("", "a\nb", "")
    assert "Authorization" not in bare and bare["X-Hermes-Session-Id"] == "ab"
    assert "X-Hermes-Session-Key" not in bare


def test_body_sends_only_the_new_message():
    b = agent.body("is the coffee machine on", "", "From the kitchen.")
    assert b == {"model": "hermes-agent", "stream": True, "messages": [
        {"role": "system", "content": "From the kitchen."},
        {"role": "user", "content": "is the coffee machine on"}]}
    assert agent.body("hi", "m")["messages"] == [{"role": "user", "content": "hi"}]


def test_prompt_names_the_speaker():
    said = agent.where_prompt(EN["agent"]["prompt"], "living room")
    assert "the living room speaker" in said and "{where}" not in said


def chunk(content=None, finish=None, **extra):
    delta = {} if content is None else {"content": content}
    return "data: " + json.dumps({"object": "chat.completion.chunk", "choices": [
        {"index": 0, "delta": delta, "finish_reason": finish}], **extra})


def feed(lines):
    sse, out = agent.SSE(), []
    for line in lines:
        out += sse.line(line)
    return out + sse.end()


def test_sse_reply_with_a_tool():
    progress = {"tool": "web_search", "emoji": "🔍", "label": "web_search: hermes",
                "toolCallId": "c1", "status": "running"}
    got = feed([
        chunk(None) + "\n", "\n",
        ": keepalive\n", "\n",
        "event: hermes.tool.progress\n", "data: " + json.dumps(progress) + "\n", "\n",
        chunk("It's ") + "\n", "\n", (chunk("sunny.") + "\n").encode(), b"\n",
        chunk(None, "stop") + "\n", "\n", "data: [DONE]\n", "\n"])
    assert got == [("tool", progress), ("text", "It's "), ("text", "sunny."), ("done", None)]


def test_sse_errors_and_other_events():
    got = feed([chunk(None, "error", error={"message": "model down"}), "",
                "event: hermes.status", 'data: {"x": 1}', "",
                "event: approval.request", 'data: {"command": "rm -rf"}', "",
                chunk("partial", "length")])
    assert got == [("error", "model down"), ("approval", {"command": "rm -rf"}),
                   ("text", "partial")]
    assert feed(['data: {"error": {"message": "bad key"}}', ""]) == [("error", "bad key")]
    assert feed(["data: not json", ""]) == []


@pytest.mark.parametrize("tool,fast", [
    ("ha_get_state", True), ("memory", True), ("memory_search", False), ("tool_call", True),
    ("web_search", False), ("terminal", False)])
def test_quick_tools(tool, fast):
    assert agent.quick(tool, brain.default_settings()["agent_quick_tools"]) is fast


def test_wait_lines():
    r = random.Random(1)
    w = EN["agent"]["wait"]
    assert agent.wait_line(EN, "web_search", r) in w["web_"]
    assert agent.wait_line(EN, "web_extract", r) in w["web_"]
    assert agent.wait_line(EN, "terminal", r) in w["terminal"]
    assert agent.wait_line(EN, "vision_analyze", r) in w["_"]
    assert agent.wait_line(EN, "slow", r) in w["slow"]
    assert agent.wait_line({}, "web_search", r) == ""
    assert agent.say(EN, "approval")


def test_settings_check():
    from alfie.config import ConfigError, validate
    from test_config import FACE
    b = validate({"brain": {"agent_url": "http://pc:8642/", "agent_seconds": 300,
                            "agent_quick_tools": ["ha_", " ", 3]}}, FACE)["brain"]
    assert b["agent_url"] == "http://pc:8642" and b["agent_seconds"] == 300
    assert b["agent_quick_tools"] == ["ha_", "3"] and b["agent_model"] == "hermes-agent"
    with pytest.raises(ConfigError):
        validate({"brain": {"agent_url": "pc:8642"}}, FACE)
    with pytest.raises(ConfigError):
        validate({"brain": {"agent_seconds": 9999}}, FACE)
