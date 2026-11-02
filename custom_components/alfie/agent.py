"""Alfie's agent (design.md "Brain" → Agent): an OpenAI-compatible agent
server, such as Hermes Agent's API server, that answers whatever Home
Assistant's own intents don't (`brain.agent_url`). The agent runs its tools on
its own side; Alfie passes on its reply, only the final answer when spoken
(`agent_final_only`), and, when it starts on something slow (a web search)
before saying anything, can say a short "give me a second" line
(`agent_wait`).

PURE (no HA import), so the tests run under plain python: the request, the
server-sent events parser and the wait lines. conversation.py does the HTTP
(HA's own aiohttp session) and feeds the chat log.
"""

from __future__ import annotations

import json
import random
from datetime import datetime
from collections.abc import Iterable, Mapping
from typing import Any

PATH = "/v1/chat/completions"
THINK = ("default", "off", "low", "medium", "high")   # "default": the server decides


def endpoint(url: str) -> str:
    """The chat completions address of a server: "http://pc:8642" or
    "http://pc:8642/v1" -> "http://pc:8642/v1/chat/completions"."""
    url = url.rstrip("/")
    if url.endswith(PATH):
        return url
    return (url[:-3] if url.endswith("/v1") else url) + PATH


def headers(key: str, session: str, memory: str) -> dict[str, str]:
    """`session` keeps one conversation's history on the server (a new HA
    conversation is a new one); `memory` scopes long-term memory (one per
    speaker)."""
    out = {"Content-Type": "application/json", "Accept": "text/event-stream"}
    if key:
        out["Authorization"] = f"Bearer {key}"
    for name, value in (("X-Hermes-Session-Id", session), ("X-Hermes-Session-Key", memory)):
        value = "".join(c for c in value if c.isprintable())[:200]
        if value:
            out[name] = value
    return out


def body(text: str, model: str, prompt: str = "", think: str = "default") -> dict[str, Any]:
    """Only the new message: the server keeps the conversation (by its
    session id). `prompt` is a system message for this turn ("a spoken request
    from the kitchen speaker"). `think` (THINK) asks for reasoning off or at an
    effort for this request alone (Hermes's `model_options.reasoning`)."""
    messages = [{"role": "system", "content": prompt}] if prompt.strip() else []
    messages.append({"role": "user", "content": text})
    out: dict[str, Any] = {"model": model or "hermes-agent", "messages": messages, "stream": True}
    if think == "off":
        out["model_options"] = {"reasoning": {"enabled": False}}
    elif think in THINK and think != "default":
        out["model_options"] = {"reasoning": {"enabled": True, "effort": think}}
    return out


def _norm(text: str) -> str:
    return " ".join("".join(c if c.isalnum() else " " for c in text.lower()).split())


def asks_to_think(text: str, phrases: Iterable[str]) -> bool:
    """Whether the request asks for thought ("think hard about...", "...take
    your time"): one of the phrases, as whole words, anywhere in it."""
    said = f" {_norm(text)} "
    return any(p and f" {p} " in said for p in map(_norm, phrases))


def think_level(text: str, voice: bool, settings: Mapping[str, Any],
                phrases: Iterable[str]) -> str:
    """How hard the agent thinks on this request: the asked level when it asks
    for thought, else the spoken or typed default."""
    if settings["agent_think_asked"] != "default" and asks_to_think(text, phrases):
        return settings["agent_think_asked"]
    return settings["agent_think_voice" if voice else "agent_think_typed"]


def where_prompt(template: str, where: str, now: datetime | None = None) -> str:
    """The turn's system message: {where} the speaker's area, {time} and
    {day} the local time and date (the agent's cached prompt has only the
    date, and a small model guesses the time)."""
    if not template:
        return ""
    out = template.replace("{where}", where)
    if now is not None:
        hour = now.hour % 12 or 12
        out = out.replace("{time}", f"{hour}:{now.minute:02d} {'AM' if now.hour < 12 else 'PM'}")
        out = out.replace("{day}", f"{now:%A}, {now:%B} {now.day}, {now.year}")
    return out


# ------------------------------------------------------------ the stream

class SSE:
    """Server-sent events, a line at a time, as (kind, value):
    ("text", str) reply text; ("tool", {tool, label, status, toolCallId}) a
    tool starting or finished; ("approval", {...}) the agent waits for a
    person to approve a command; ("error", str); ("done", None)."""

    def __init__(self) -> None:
        self._event = ""
        self._data: list[str] = []

    def line(self, raw: str | bytes) -> list[tuple[str, Any]]:
        if isinstance(raw, bytes):
            raw = raw.decode("utf-8", "replace")
        line = raw.rstrip("\r\n")
        if not line:
            return self._dispatch()
        if line.startswith(":"):
            return []           # ": keepalive"
        field, _, value = line.partition(":")
        value = value[1:] if value.startswith(" ") else value
        if field == "event":
            self._event = value
        elif field == "data":
            self._data.append(value)
        return []

    def end(self) -> list[tuple[str, Any]]:
        """What's left when the connection closes."""
        return self._dispatch() if self._data else []

    def _dispatch(self) -> list[tuple[str, Any]]:
        event, data = self._event or "message", "\n".join(self._data)
        self._event, self._data = "", []
        if not data:
            return []
        if data.strip() == "[DONE]":
            return [("done", None)]
        try:
            obj = json.loads(data)
        except ValueError:
            return []
        if not isinstance(obj, Mapping):
            return []
        if event == "hermes.tool.progress":
            return [("tool", dict(obj))]
        if event == "approval.request":
            return [("approval", dict(obj))]
        if event != "message":
            return []           # hermes.status and the like
        out: list[tuple[str, Any]] = []
        for choice in obj.get("choices") or []:
            delta = choice.get("delta") or {}
            if isinstance(delta.get("content"), str) and delta["content"]:
                out.append(("text", delta["content"]))
            finish = choice.get("finish_reason")
            # "length": out of steps, but what it says is still its answer
            if finish and finish not in ("stop", "length"):
                err = obj.get("error") or {}
                out.append(("error", (err.get("message") if isinstance(err, Mapping) else "")
                            or str(finish)))
        if not obj.get("choices") and isinstance(obj.get("error"), Mapping):
            out.append(("error", str(obj["error"].get("message") or "error")))
        return out


class Final:
    """A spoken turn's reply, held until the agent is done: what it says before
    a tool call ("I'll look that up") is working aloud, not the answer, and only
    the end of the stream tells which text was which."""

    def __init__(self) -> None:
        self._held: list[str] = []

    def text(self, value: str) -> None:
        self._held.append(value)

    def tool(self) -> None:
        self._held.clear()

    def take(self) -> str:
        out = "".join(self._held).strip()
        self._held.clear()
        return out


# ------------------------------------------------------------ waiting

def quick(tool: str, quick_tools: Iterable[str]) -> bool:
    """Whether a tool answers fast enough to need no "give me a second"
    (reading the house, memory): `quick_tools` are names or name starts."""
    return any(tool == q or (q.endswith(("_", ".", ":")) and tool.startswith(q))
               for q in quick_tools if q)


def wait_line(words: Mapping[str, Any], tool: str, rng: random.Random) -> str:
    """What he says while the agent works: the language's lines for this
    tool (by name or name start), else its general ones."""
    waits = (((words or {}).get("agent") or {}).get("wait")) or {}
    pick = waits.get(tool)
    if not pick:
        starts = sorted((k for k in waits if k.endswith(("_", ".", ":")) and tool.startswith(k)),
                        key=len, reverse=True)
        pick = waits[starts[0]] if starts else waits.get("_")
    if isinstance(pick, list):
        pick = rng.choice(pick) if pick else ""
    return str(pick or "")


def say(words: Mapping[str, Any], key: str) -> str:
    return str((((words or {}).get("agent") or {}).get("replies") or {}).get(key) or "")
