"""Alfie's Wikipedia answers (design.md "Brain" → Local answers, M15 F):
"who is X", "what is X", "tell me about X", from an offline Wikipedia that
kiwix-serve serves (`brain.wiki_url`). Only an article whose title is X
(or that X redirects to) answers, with its lead's first `wiki_sentences`
sentences; anything else, a disambiguation page included, goes on to the
delegate.

PURE (no HA import), so the tests run under plain python. local.py does the
fetching (HA's own aiohttp session, a page streamed only up to its first
section) and keeps the answers in a small cache. The HTML reader is ported from
the assistant stack's wiki-api (containers/assistant/wiki-api/wiki_api.py).
"""

from __future__ import annotations

import html
import re
import urllib.parse
from collections.abc import Mapping
from html.parser import HTMLParser
from typing import Any

# Elements whose text never belongs in the answer.
# <sup> stays ("km2"): references are caught by their class.
SKIP_TAGS = {"head", "h1", "script", "style", "table", "figure", "math", "noscript", "nav"}
# Matched against whole class tokens, never substrings.
SKIP_CLASSES = {"mw-ref", "reference", "references", "mw-references-wrap", "reflist", "infobox",
                "navbox", "sidebar", "hatnote", "shortdescription", "metadata", "ambox", "thumb",
                "mw-editsection", "noprint", "toc", "mw-empty-elt"}
VOID_TAGS = {"br", "img", "hr", "meta", "link", "input", "wbr", "source", "area", "col"}
END = "<h2"              # the lead ends at the first section
ENOUGH = 1_500_000        # bytes read at most, for a page with no sections
# A sentence doesn't end after these ("St. Paul", "c. 1900", "U.S. state").
ABBREVIATIONS = frozenset({"st", "mt", "dr", "mr", "mrs", "ms", "jr", "sr", "no", "vs", "c",
                           "ca", "approx", "inc", "ltd", "co", "corp", "fl", "jan", "feb", "mar",
                           "apr", "jun", "jul", "aug", "sep", "sept", "oct", "nov", "dec",
                           "gen", "col", "lt", "sgt", "prof", "rev", "hon", "pres", "gov",
                           "e.g", "i.e", "etc", "u.s", "u.k", "a.d", "b.c"})


class _Lead(HTMLParser):
    """The page's title and its lead paragraphs (before the first h2)."""

    def __init__(self) -> None:
        super().__init__(convert_charrefs=True)
        self.title = ""
        self.paras: list[str] = []
        self.disambiguation = False
        self.done = False
        self._in_title = False
        self._skip = 0
        self._stack: list[tuple[str, bool]] = []
        self._buf: list[str] | None = None

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if self.done or tag in VOID_TAGS:
            return
        a = dict(attrs)
        classes = set((a.get("class") or "").split())
        if "disambiguation" in classes or "dmbox-disambig" in classes or \
                a.get("id") == "disambigbox":
            self.disambiguation = True
        if tag == "title":
            self._in_title = True
        if tag == "h2":
            self._end_para()
            self.done = True
            return
        skipping = tag in SKIP_TAGS or bool(classes & SKIP_CLASSES)
        self._stack.append((tag, skipping))
        if skipping:
            self._skip += 1
        elif tag == "p" and not self._skip:
            self._buf = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "title":
            self._in_title = False
        if self.done or tag in VOID_TAGS:
            return
        while self._stack:
            t, skipping = self._stack.pop()
            if skipping:
                self._skip -= 1
            if t == tag:
                break
        if tag == "p" and not self._skip:
            self._end_para()

    def handle_data(self, data: str) -> None:
        if self._in_title:
            self.title += data
        elif not self.done and not self._skip and self._buf is not None:
            self._buf.append(data)

    def _end_para(self) -> None:
        if self._buf is not None:
            text = " ".join("".join(self._buf).split())
            if text:
                self.paras.append(text)
        self._buf = None


def read_lead(page: str) -> tuple[str, list[str], bool]:
    """(title, lead paragraphs, is a disambiguation page) of an article's HTML."""
    p = _Lead()
    p.feed(page)
    p._end_para()
    title = " ".join(html.unescape(p.title).split())
    disamb = p.disambiguation or any(re.search(r"\b(may|might|can|commonly) refers? to\b|"
                                               r"\bmay also refer to\b", x) for x in p.paras[:2])
    return title, p.paras, disamb


def lead_done(page: str) -> bool:
    """Whether enough of a streamed page has come for its lead."""
    return END in page or len(page) >= ENOUGH


# ------------------------------------------------------------ names and titles

def clean_name(name: str) -> str:
    """What was asked about, tidied: "the beatles?" -> "the beatles"."""
    name = re.sub(r"[?!.]+$", "", " ".join(name.split()))
    return name.strip(" ,'\"")


def titles_for(name: str) -> list[str]:
    """Titles to try for a name, the likeliest first: as said with its first
    letter up ("Cat", "Albert einstein"), each word up ("Albert Einstein"),
    and without a leading article ("a cat" -> "Cat")."""
    name = clean_name(name)
    out: list[str] = []

    def add(t: str) -> None:
        if t and t not in out:
            out.append(t)

    bare = re.sub(r"^(a|an|the)\s+", "", name, flags=re.I)
    # "The Beatles" keeps its "the"; "a cat" is "Cat".
    tries = (name,) if bare == name else (name, bare) if name[:3].lower() == "the" else (bare,)
    for n in tries:
        add(n[:1].upper() + n[1:])
        add(" ".join(w[:1].upper() + w[1:] for w in n.split()))
        if len(n) <= 5 and " " not in n:
            add(n.upper())          # "nasa", "fbi"
    return out


def path_of(book: str, title: str) -> str:
    return f"/content/{book}/" + urllib.parse.quote(title.replace(" ", "_"))


def book_of(catalog: str, want: str = "") -> str | None:
    """The book to read from kiwix-serve's catalog (OPDS XML): `want` by name
    (or the start of one), else the first Wikipedia, else the first."""
    books = list(dict.fromkeys(re.findall(r'href="/content/([^/"]+)', catalog)))
    if want:
        return next((b for b in books if b == want), None) or \
            next((b for b in books if b.startswith(want)), None)
    return next((b for b in books if b.startswith("wikipedia")), books[0] if books else None)


def asks_about(name: str, words: Mapping[str, Any]) -> bool:
    """Whether a name could be an article: not "my name", "it", "going on"
    (the language's `wiki.skip`, whole names or first words)."""
    name = clean_name(name).lower()
    w = (words or {}).get("wiki") or {}
    if not re.search(r"[a-z0-9]", name):
        return False
    first = name.split()[0]
    return first not in set(w.get("skip_first") or []) and name not in set(w.get("skip") or [])


# ------------------------------------------------------------ the reply

def _drop_brackets(text: str) -> str:
    """Bracketed asides out ("Paris (French pronunciation: …) is" -> "Paris is"),
    nested ones too."""
    prev = None
    while prev != text:
        prev = text
        text = re.sub(r"\s*\([^()]*\)", "", text)
        text = re.sub(r"\s*\[[^\[\]]*\]", "", text)
    return re.sub(r"\s+([,.;:])", r"\1", " ".join(text.split()))


def sentences(text: str, most: int) -> str:
    """The first `most` sentences of a paragraph."""
    out, start = [], 0
    for m in re.finditer(r"[.!?](?=\s+[\"'“(]?[A-Z0-9])", text):
        word = re.findall(r"[\w.]+$", text[start:m.start()])
        last = (word[0] if word else "").lower().rstrip(".")
        if last in ABBREVIATIONS or (len(last) == 1 and last.isalpha()):
            continue        # "St. Paul", "J. R. R. Tolkien"
        out.append(text[start:m.end()].strip())
        start = m.end()
        if len(out) >= most:
            return " ".join(out)
    rest = text[start:].strip()
    if rest:
        out.append(rest)
    return " ".join(out[:most])


def lead_reply(paras: list[str], most: int, brackets: bool = False) -> str | None:
    """What he says: the lead's first sentences. None for no lead."""
    text = " ".join(paras)
    if not text:
        return None
    if not brackets:
        text = _drop_brackets(text)
    said = sentences(text, max(1, most))
    return said or None


def say(words: Mapping[str, Any], key: str, **kw: Any) -> str:
    text = (((words or {}).get("wiki") or {}).get("replies") or {}).get(key) or key
    return text.format(**kw) if kw else text
