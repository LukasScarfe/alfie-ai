"""Finding the entity someone means, by the words they use (design.md "Voice
screens"): the alfie__find_entity tool's search, and the names a voice turn
mentions.

PURE (no HA import), so the tests run under plain python. voice.py builds an
`Index` from HA's registries once, and again only when a registry changes;
searching it is a walk over a few thousand short phrases, cheap enough to run
per question, never per state change.
"""

from __future__ import annotations

import re
from collections.abc import Iterable
from dataclasses import dataclass, field
from typing import Any

# Words that say nothing about which thing is meant.
STOP = frozenset("""a an the my our your his her their its this that these those is are was
were be am do does did of in on at to for from by with and or what whats what's how hows
which who where when please can could would will shall tell me us show give check turn
switch set get there it any some all much many right now currently current""".split())

MIN_SCORE = 30      # weaker matches are noise, not an answer
LIMIT = 5


def words(text: str) -> list[str]:
    """Lowercase words, apostrophes dropped (Michelle's -> michelles), plurals
    folded (lights -> light), so "the kitchen lights" meets "kitchen light"."""
    out = []
    for w in re.findall(r"[a-z0-9']+", str(text).lower().replace("’", "'")):
        w = w.replace("'", "")
        if len(w) > 3 and w.endswith("s") and not w.endswith("ss"):
            w = w[:-1]
        if w:
            out.append(w)
    return out


def _key(text: str) -> tuple[str, ...]:
    return tuple(w for w in words(text) if w not in STOP)


@dataclass
class Entry:
    entity_id: str
    name: str
    aliases: tuple[str, ...] = ()
    device: str = ""
    area: str = ""
    exposed: bool = False
    phrases: tuple[tuple[str, ...], ...] = field(default=(), repr=False)
    area_key: tuple[str, ...] = field(default=(), repr=False)

    def __post_init__(self) -> None:
        obj = self.entity_id.split(".", 1)[-1].replace("_", " ")
        keys = [_key(p) for p in (self.name, *self.aliases, self.device, obj) if p]
        self.phrases = tuple(dict.fromkeys(k for k in keys if k))
        self.area_key = _key(self.area)


def _score(q: tuple[str, ...], e: Entry) -> float:
    """How well the query words name this entity, 0 to about 120."""
    qs, best = set(q), 0.0
    # The room may come with the thing ("office temperature"): it counts for
    # the area, and the rest of the words still have to name the thing.
    in_area = bool(e.area_key) and set(e.area_key) <= qs
    rest = tuple(w for w in q if not (in_area and w in e.area_key)) or q
    for p in e.phrases:
        ps = set(p)
        for words_ in (q, rest):
            ws = set(words_)
            if words_ == p:
                s = 100.0
            elif ps <= ws:              # the whole phrase is in the query
                s = 70.0 + 10 * len(ps) / len(ws)
            elif ws <= ps:              # the query is part of the phrase
                s = 55.0 + 25 * len(ws) / len(ps)
            else:
                s = 45.0 * len(ws & ps) / max(len(ws), len(ps))
            best = max(best, s)
    if best and in_area:
        best += 15
    return best + (3 if e.exposed and best else 0)


class Index:
    """Every entity Alfie may name, with the phrases it goes by."""

    def __init__(self, entries: Iterable[Entry]) -> None:
        self.entries = [e for e in entries if e.phrases]
        self.by_id = {e.entity_id: e for e in self.entries}

    def search(self, query: str, limit: int = LIMIT,
               domains: Iterable[str] = ()) -> list[tuple[float, Entry]]:
        q = _key(query)
        if not q:
            return []
        dom = tuple(domains)
        scored = []
        for e in self.entries:
            if dom and e.entity_id.split(".", 1)[0] not in dom:
                continue
            s = _score(q, e)
            if s >= MIN_SCORE:
                scored.append((s, e))
        scored.sort(key=lambda x: (-x[0], x[1].entity_id))
        return scored[:limit]

    def best(self, query: str, domains: Iterable[str] = (), floor: float = 70) -> Entry | None:
        """The one entity a name surely means, else None (two equally good: None)."""
        hits = self.search(query, 2, domains)
        if not hits or hits[0][0] < floor or (len(hits) > 1 and hits[1][0] == hits[0][0]):
            return None
        return hits[0][1]

    def mentioned(self, text: str, exposed_only: bool = True) -> list[str]:
        """Entities whose name or alias appears whole in `text`, in the order
        they come up. A longer phrase wins over one inside it, so "kitchen
        light" doesn't also bring the "kitchen" sensor."""
        t = _key(text)
        if not t:
            return []
        spans: list[tuple[int, int, str]] = []
        for e in self.entries:
            if exposed_only and not e.exposed:
                continue
            for p in e.phrases:
                n = len(p)
                for i in range(len(t) - n + 1):
                    if t[i:i + n] == p:
                        spans.append((i, i + n, e.entity_id))
        # Longest first; drop any span inside one already taken.
        spans.sort(key=lambda s: (-(s[1] - s[0]), s[0]))
        taken: list[tuple[int, int, str]] = []
        for s in spans:
            if not any(a <= s[0] and s[1] <= b and eid != s[2] for a, b, eid in taken):
                taken.append(s)
        out: list[str] = []
        for _, _, eid in sorted(taken):
            if eid not in out:
                out.append(eid)
        return out


def result(hits: list[tuple[float, Entry]], state_of: Any) -> dict[str, Any]:
    """The tool's answer: the best matches with their states. `state_of(id)`
    gives (state, unit) or None."""
    rows = []
    for _score_, e in hits:
        st = state_of(e.entity_id)
        if st is None:
            continue
        state, unit = st
        row = {"entity_id": e.entity_id, "name": e.name, "state": state}
        if unit:
            row["unit"] = unit
        if e.area:
            row["area"] = e.area
        if e.aliases:
            row["aliases"] = list(e.aliases[:4])
        row["can_control"] = e.exposed
        rows.append(row)
    return {"results": rows,
            "note": "Read-only. Only entities with can_control true can be switched, by name "
                    "with the Assist tools." if rows else "Nothing in the house matched."}
