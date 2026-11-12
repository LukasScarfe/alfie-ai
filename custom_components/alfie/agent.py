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

import difflib
import json
import random
import re
from datetime import datetime
from collections.abc import Iterable, Mapping
from typing import Any

PATH = "/v1/chat/completions"
THINK = ("default", "off", "low", "medium", "high")   # "default": the server decides


EARLIER_TURNS = 6      # turns the agent missed, passed on with the next one it gets
EARLIER_CHARS = 400    # of each said and answered


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


def profile_url(house_url: str, url: str) -> str:
    """A profile's server: its own address, a path on the house's server
    ("/p/lukas" on "http://pc:8642" -> "http://pc:8642/p/lukas"), or "" when
    neither is known."""
    url = (url or "").strip().rstrip("/")
    if not url:
        return ""
    if not url.startswith("/"):
        return url
    m = re.match(r"^(https?://[^/]+)", (house_url or "").strip())
    return m.group(1) + url if m else ""


def for_user(profiles: Iterable[Mapping[str, Any]], user_id: str | None) -> Mapping[str, Any] | None:
    """The profile of the HA user typing, or None (the house's)."""
    return next((p for p in profiles if user_id and p.get("user") == user_id), None)


def by_id(profiles: Iterable[Mapping[str, Any]], pid: str | None) -> Mapping[str, Any] | None:
    return next((p for p in profiles if pid and p.get("id") == pid), None)


def same_words(a: str, b: str, floor: float = 0.85) -> bool:
    """Whether ears heard what HA was given: case, punctuation and spacing
    aside, at least `floor` alike (HA's STT post-processing may change a word)."""
    a, b = _norm(a), _norm(b)
    if not a or not b:
        return False
    return a == b or difflib.SequenceMatcher(None, a, b).ratio() >= floor


def ears_usable(verdict: Any, text: str, now: float, fresh: float,
                floor: float = 0.85) -> bool:
    """An alfie-ears verdict that is about this request: heard within `fresh`
    seconds and saying the same words."""
    if not isinstance(verdict, Mapping):
        return False
    try:
        age = now - float(verdict.get("heard_ts") or 0)
    except (TypeError, ValueError):
        return False
    return -2 <= age <= fresh and same_words(str(verdict.get("text") or ""), text, floor)


def ears_summary(verdict: Mapping[str, Any] | None) -> dict[str, Any]:
    """The small part of a verdict worth keeping (turn log, sensor)."""
    if not verdict:
        return {}
    keep = ("speaker", "profile", "confidence", "addressed", "drop", "watch_only", "heard_at")
    return {k: verdict.get(k) for k in keep if k in verdict}


def named(text: str, name: str) -> str:
    """The user message with who said it ("Lukas: turn it down"), for one
    shared agent profile; unchanged when nobody is known."""
    return f"{name}: {text}" if name else text


def speaker_prompt(prompt: str, name: str, words: Mapping[str, Any]) -> str:
    """The turn's system message plus who is speaking (recognised by voice)."""
    line = (words.get("speaking_with") or
            "You are speaking with {name}, recognised by voice, in a shared room.")
    return f"{prompt}\n{line.replace('{name}', name)}".strip()


def earlier_prompt(prompt: str, turns: Iterable[tuple[str, str]], words: Mapping[str, Any],
                   keep: int = EARLIER_TURNS) -> str:
    """The turn's system message with the conversation's earlier turns that
    the agent never saw (answered by Home Assistant's intents, Alfie's own
    sentences or the delegate), so a follow-up ("and which is brightest?")
    makes sense to it. Only the last `keep`, each cut short."""
    turns = [(str(a)[:EARLIER_CHARS], str(b)[:EARLIER_CHARS]) for a, b in turns][-keep:]
    if not turns:
        return prompt
    w = words.get("earlier") or {}
    head = w.get("head") or "Earlier in this conversation, answered before it reached you:"
    said, answer = w.get("said") or "They said", w.get("answer") or "The answer was"
    lines = "\n".join(f"- {said}: {a}\n  {answer}: {b}" for a, b in turns)
    return f"{prompt}\n\n{head}\n{lines}".strip()


ROOM_KEEP = 20         # spoken turns kept per room for `room_context`
ROOM_ROOMS = 30        # rooms remembered


class Room:
    """The spoken turns heard in each room lately, whoever answered them
    (design.md "Brain" → People and voices → Shared room). Each knows who
    asked (a name, "" not known), and, when the agent server answered it,
    which profile ("house" or a person's id) and conversation, since that
    profile's session already holds it."""

    def __init__(self) -> None:
        self._rooms: dict[str, list[dict[str, Any]]] = {}

    def add(self, room: str, at: float, who: str, said: str, reply: str,
            audience: str | None, conversation: str) -> None:
        if not room or not (said or reply):
            return
        turns = self._rooms.pop(room, [])
        turns.append({"at": at, "who": who, "said": said, "reply": reply,
                      "audience": audience, "conversation": conversation})
        self._rooms[room] = turns[-ROOM_KEEP:]
        while len(self._rooms) > ROOM_ROOMS:
            self._rooms.pop(next(iter(self._rooms)))

    def recent(self, room: str, now: float, minutes: float, keep: int, audience: str,
               conversation: str) -> list[tuple[str, str, str]]:
        """(who, said, reply) heard in `room` in the last `minutes`, the last
        `keep`, leaving out what `audience` answered in this very conversation."""
        out = [(t["who"], t["said"], t["reply"]) for t in self._rooms.get(room, [])
               if now - t["at"] <= minutes * 60
               and not (t["audience"] == audience and t["conversation"] == conversation)]
        return out[-keep:] if keep > 0 else []


def room_prompt(prompt: str, turns: Iterable[tuple[str, str, str]], words: Mapping[str, Any]) -> str:
    """The turn's system message with what was said in the room lately and
    hasn't reached this profile, so "turn it back down" after someone else's
    "play music" makes sense to it."""
    turns = [(w, str(a)[:EARLIER_CHARS], str(b)[:EARLIER_CHARS]) for w, a, b in turns]
    if not turns:
        return prompt
    w = words.get("room") or {}
    head = w.get("head") or ("Said aloud in this room in the last few minutes, "
                             "so everyone here heard it:")
    said = w.get("said") or "{who} said"
    someone = w.get("someone") or "Someone"
    answer = w.get("answer") or "The answer was"
    lines = "\n".join(f"- {said.replace('{who}', who or someone)}: {a}\n  {answer}: {b}"
                      for who, a, b in turns)
    return f"{prompt}\n\n{head}\n{lines}".strip()


def sticky(last: tuple[str, float] | None, now: float, seconds: float,
           verdict: Mapping[str, Any] | None, profiles: Iterable[Mapping[str, Any]]) -> str:
    """The profile id to keep for a spoken turn ears couldn't place: the
    last recognised one at this speaker, within `seconds`, when ears heard
    someone it wasn't sure of (not the TV, not another person it knows)."""
    if not last or seconds <= 0 or not verdict or verdict.get("profile"):
        return ""
    pid, at = last
    if now - at > seconds:
        return ""
    speaker = str(verdict.get("speaker") or "")
    if speaker == "tv" or (speaker and speaker != pid and by_id(profiles, speaker)):
        return ""
    return pid if by_id(profiles, pid) else ""


# ------------------------------------------------------------ the stream

class SSE:
    """Server-sent events, a line at a time, as (kind, value):
    ("text", str) reply text; ("tool", {tool, label, status, toolCallId}) a
    tool starting or finished; ("approval", {...}) the agent waits for a
    person to approve a command; ("turn", {expects_reply}) what the agent says
    about its reply (event `alfie.turn`); ("error", str); ("done", None)."""

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
        if event == "alfie.turn":
            return [("turn", dict(obj))]
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


def wait_for(tool: str, settings: Mapping[str, Any]) -> bool:
    """Whether a tool starting gets a wait line (`agent_wait_on`): "web" only
    the web's tools, else any that isn't quick."""
    if settings.get("agent_wait_on") == "web":
        return quick(tool, settings.get("agent_web_tools") or ())
    return not quick(tool, settings.get("agent_quick_tools") or ())


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
