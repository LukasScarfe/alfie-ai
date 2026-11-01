"""Alfie's agent (design.md "Brain" → Agent): an OpenAI-compatible agent
server, such as Hermes Agent's API server, that answers whatever Home
Assistant's own intents don't (`brain.agent_url`). The agent runs its tools on
its own side; Alfie streams its reply to the speaker and, when it starts on
something slow (a web search) before saying anything, says a short "give me
a second" line so nobody waits in silence.

PURE (no HA import), so the tests run under plain python: the request, the
server-sent events parser and the wait lines. conversation.py does the HTTP
(HA's own aiohttp session) and feeds the chat log.
"""

from __future__ import annotations

import json
import random
from collections.abc import Iterable, Mapping
from typing import Any

PATH = "/v1/chat/completions"


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


def body(text: str, model: str, prompt: str = "") -> dict[str, Any]:
    """Only the new message: the server keeps the conversation (by its
    session id). `prompt` is a system message for this turn ("a spoken request
    from the kitchen speaker")."""
    messages = [{"role": "system", "content": prompt}] if prompt.strip() else []
    messages.append({"role": "user", "content": text})
    return {"model": model or "hermes-agent", "messages": messages, "stream": True}


def where_prompt(template: str, where: str) -> str:
    return template.replace("{where}", where) if template else ""


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
