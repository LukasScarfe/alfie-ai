"""What Alfie tells a voice agent: what is wrong, and how he feels.

PURE (no HA import), so the tests run under plain python. voice.py hands it
the mood and a lookup for entity names and states; it returns the
alfie__whats_wrong tool's data, the intent's spoken answer, and the mood line
for the persona prompt.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping
from typing import Any

from .mood import SEVERITY_RANK, Mood

ENTITIES_TOLD = 5      # per problem: an LLM needs a few, not a hundred batteries

# An entity id -> (friendly name, state, unit) or None when it is gone.
Lookup = Callable[[str], "tuple[str, str, str] | None"]


def _problems(mood: Mood | None, lookup: Lookup,
              since: Mapping[str, float], now: float) -> list[dict[str, Any]]:
    bad = sorted(mood.bad if mood else (), key=lambda r: -SEVERITY_RANK[r.signal.severity])
    out = []
    for r in bad:
        ents = []
        for e in r.entities[:ENTITIES_TOLD]:
            got = lookup(e)
            if got is not None:
                name, state, unit = got
                ents.append({"entity_id": e, "name": name,
                             "state": f"{state} {unit}".strip() if unit else state})
        p: dict[str, Any] = {"problem": r.signal.name, "severity": r.signal.severity,
                             "entities": ents}
        if len(r.entities) > ENTITIES_TOLD:
            p["more_entities"] = len(r.entities) - ENTITIES_TOLD
        if r.signal.id in since:
            p["minutes"] = max(0, round((now - since[r.signal.id]) / 60))
        out.append(p)
    return out


def whats_wrong(mood: Mood | None, lookup: Lookup, since: Mapping[str, float],
                now: float) -> dict[str, Any]:
    """The tool's answer: the mood, and each bad signal worst first."""
    problems = _problems(mood, lookup, since, now)
    return {"all_well": not problems, "mood": mood.level if mood else "content",
            "reason": mood.reason if mood else "", "problems": problems,
            "good": [r.signal.name for r in (mood.good if mood else ())]}


def _join(names: list[str]) -> str:
    if len(names) <= 1:
        return "".join(names)
    return ", ".join(names[:-1]) + " and " + names[-1]


def _said(e: Mapping[str, Any]) -> str:
    """An entity as said aloud: a reading with its value, a switch by name."""
    try:
        float(e["state"].split()[0])
    except (ValueError, IndexError):
        return e["name"]
    return f"{e['name']} at {e['state']}"


def spoken(mood: Mood | None, lookup: Lookup) -> str:
    """A short spoken answer, for the intent (no LLM to phrase it)."""
    problems = _problems(mood, lookup, {}, 0.0)
    if not problems:
        return "Nothing's wrong. All is well."
    parts = []
    for p in problems[:3]:
        names = [_said(e) for e in p["entities"][:2]]
        more = len(p["entities"]) - len(names) + p.get("more_entities", 0)
        what = p["problem"]
        if names:
            what += f": {_join(names)}" + (f" and {more} more" if more else "")
        parts.append(what)
    head = "One thing" if len(problems) == 1 else f"{len(problems)} things"
    tail = f" And {len(problems) - 3} more." if len(problems) > 3 else ""
    return f"{head}. " + ". ".join(parts) + "." + tail


def mood_line(name: str, mood: Mood | None, persona: bool = True) -> str:
    """How he feels right now, for the agent's prompt: replies follow it. As
    the persona he is the one speaking; otherwise the agent hears about him."""
    level = mood.level if mood else "content"
    why = mood.reason.rstrip(".") if mood and (mood.bad or mood.good) else ""
    who = "you feel" if persona else f"{name}, the home's face, feels"
    line = f"Right now {who} {level}" + (f", because: {why}." if why else ".")
    if level in ("miserable", "sad", "uneasy"):
        line += " Let a little of that show in your tone, but stay helpful."
    elif level == "bubbly":
        line += " You may sound a little cheerful."
    return line


def summary(mood: Mood | None, lookup: Lookup) -> str:
    """One line for sensor.alfie_mood's `problems` attribute (names only: no
    values, which would go stale between the entity's writes)."""
    names = [p["problem"] + (f" ({_join([e['name'] for e in p['entities'][:3]])})"
                             if p["entities"] else "")
             for p in _problems(mood, lookup, {}, 0.0)]
    return "; ".join(names) if names else "All is well."
