"""Pictures: SVG files the user uploads for the Picture screen (design.md "Screens").

PURE (no HA import). An upload is sanitised into a small SVG that keeps only
what Alfie draws: the basic shapes and paths, their groups and transforms, and
the paint that says whether a shape is filled or stroked. Scripts, styles,
links, text, images, defs and every other attribute are dropped, and a DOCTYPE
(entities) is refused outright, so the stored file is inert. `<style>` class
rules (`.cls-1{fill:#f00}`, Illustrator's habit) are folded into each element's
own style first.

Files live in `<config>/alfie/pictures/<id>.svg` with `index.json` holding
each one's name. The store's methods block (file I/O): run them in an executor.
"""

from __future__ import annotations

import hashlib
import json
import os
import re
import time
import xml.etree.ElementTree as ET
from typing import Any

MAX_UPLOAD = 2 * 1024 * 1024     # bytes of SVG text accepted
MAX_STORED = 512 * 1024          # bytes after sanitising
MAX_SHAPES = 5000                # drawable elements in one picture
MAX_PICTURES = 200

SVG_NS = "http://www.w3.org/2000/svg"
CONTAINERS = ("svg", "g", "a", "switch")
SHAPES = ("path", "rect", "circle", "ellipse", "line", "polyline", "polygon")
GEOMETRY = {
    "svg": ("x", "y", "width", "height", "viewBox"),
    "path": ("d",), "rect": ("x", "y", "width", "height", "rx", "ry"),
    "circle": ("cx", "cy", "r"), "ellipse": ("cx", "cy", "rx", "ry"),
    "line": ("x1", "y1", "x2", "y2"), "polyline": ("points",), "polygon": ("points",),
}
PAINT = ("fill", "stroke", "stroke-width", "fill-rule", "opacity", "fill-opacity",
         "stroke-opacity", "display", "visibility")
COMMON = ("transform",)

_ID = re.compile(r"^[a-z0-9_]+$")
_SAFE_VALUE = re.compile(r"^[\w\s.,#%()+\-]*$")


class PictureError(ValueError):
    """An upload Alfie can't take, with a reason for the user."""


def _local(tag: str) -> str:
    return tag.rsplit("}", 1)[-1] if isinstance(tag, str) else ""


def _style_props(text: str) -> dict[str, str]:
    out = {}
    for part in (text or "").split(";"):
        if ":" in part:
            k, v = part.split(":", 1)
            k, v = k.strip().lower(), v.strip()
            if k in PAINT and _SAFE_VALUE.match(v) and "url" not in v.lower():
                out[k] = v
    return out


def _class_rules(root: ET.Element) -> dict[str, dict[str, str]]:
    """`.name{...}` rules from every <style>, as {class: props}. Grouped
    selectors (`.a,.b{}`) apply to each; anything fancier is ignored."""
    rules: dict[str, dict[str, str]] = {}
    for el in root.iter():
        if _local(el.tag) != "style":
            continue
        css = re.sub(r"/\*.*?\*/", "", "".join(el.itertext()), flags=re.S)
        for sel, body in re.findall(r"([^{}]+)\{([^{}]*)\}", css):
            props = _style_props(body)
            for one in sel.split(","):
                one = one.strip()
                if re.fullmatch(r"\.[\w-]+", one):
                    rules.setdefault(one[1:], {}).update(props)
    return rules


def sanitise(text: str) -> tuple[str, dict[str, Any]]:
    """The upload as a small, inert SVG, and {shapes, view_box}. Raises
    PictureError when it is not a usable SVG."""
    if not isinstance(text, str) or not text.strip():
        raise PictureError("The file is empty.")
    if len(text.encode()) > MAX_UPLOAD:
        raise PictureError(f"The file is over {MAX_UPLOAD // (1024 * 1024)} MB.")
    if re.search(r"<!DOCTYPE|<!ENTITY", text, re.I):
        raise PictureError("SVGs with a DOCTYPE aren't accepted. Export it as plain SVG.")
    try:
        root = ET.fromstring(text.lstrip("﻿"))
    except ET.ParseError as e:
        raise PictureError(f"Not a readable SVG ({e}).") from None
    if _local(root.tag) != "svg":
        raise PictureError("Not an SVG: the file's root isn't <svg>.")
    rules = _class_rules(root)
    count = 0

    def copy(el: ET.Element) -> ET.Element | None:
        nonlocal count
        name = _local(el.tag)
        if name not in CONTAINERS and name not in SHAPES:
            return None
        out = ET.Element(name)
        props: dict[str, str] = {}
        for cls in (el.get("class") or "").split():
            props.update(rules.get(cls, {}))
        for k in PAINT:
            v = el.get(k)
            if v is not None and _SAFE_VALUE.match(v) and "url" not in v.lower():
                props[k] = v.strip()
        props.update(_style_props(el.get("style", "")))
        for k in GEOMETRY.get(name, ()) + COMMON:
            v = el.get(k)
            if v is not None:
                out.set(k, v.strip())
        if props:
            out.set("style", ";".join(f"{k}:{v}" for k, v in props.items()))
        if name in SHAPES:
            count += 1
            if count > MAX_SHAPES:
                raise PictureError(f"Too detailed: over {MAX_SHAPES} shapes.")
            return out
        for child in el:
            c = copy(child)
            if c is not None:
                out.append(c)
        return out

    clean = copy(root)
    if not count:
        raise PictureError("Nothing to draw: no paths or shapes (text must be turned into paths).")
    clean.set("xmlns", SVG_NS)
    out = ET.tostring(clean, encoding="unicode")
    if len(out.encode()) > MAX_STORED:
        raise PictureError(f"Too detailed: over {MAX_STORED // 1024} KB once cleaned.")
    return out, {"shapes": count, "view_box": root.get("viewBox") or ""}


def picture_id(name: str, taken: set[str]) -> str:
    """A new id from a name, following the signal id rule, unique."""
    base = re.sub(r"[^a-z0-9]+", "_", os.path.splitext(name or "")[0].lower()).strip("_") or "picture"
    base = base[:40]
    pid, n = base, 2
    while pid in taken:
        pid, n = f"{base}_{n}", n + 1
    return pid


def _name(name: str, pid: str) -> str:
    """A picture's shown name: the file's, without .svg."""
    name = re.sub(r"\.svg$", "", (name or "").strip(), flags=re.I)
    return name[:80] or pid


def rev_of(text: str) -> str:
    return hashlib.sha1(text.encode()).hexdigest()[:10]


class PictureStore:
    """The pictures folder. Every method does file I/O."""

    def __init__(self, root: str) -> None:
        self.root = root
        self._index_path = os.path.join(root, "index.json")

    def _index(self) -> dict[str, dict[str, Any]]:
        try:
            with open(self._index_path, encoding="utf-8") as f:
                got = json.load(f)
            return got if isinstance(got, dict) else {}
        except (OSError, ValueError):
            return {}

    def _write_index(self, index: dict[str, dict[str, Any]]) -> None:
        os.makedirs(self.root, exist_ok=True)
        tmp = self._index_path + ".tmp"
        with open(tmp, "w", encoding="utf-8") as f:
            json.dump(index, f, indent=1, sort_keys=True)
        os.replace(tmp, self._index_path)

    def _path(self, pid: str) -> str:
        if not _ID.match(pid or ""):
            raise PictureError(f"Bad picture id {pid!r}.")
        return os.path.join(self.root, f"{pid}.svg")

    def list(self) -> list[dict[str, Any]]:
        """[{id, name, size, shapes, rev, added}], by name. Files dropped in the
        folder by hand show too, named after their id."""
        index = self._index()
        out = []
        try:
            files = sorted(f for f in os.listdir(self.root) if f.endswith(".svg"))
        except OSError:
            files = []
        for f in files:
            pid = f[:-4]
            if not _ID.match(pid):
                continue
            meta = index.get(pid, {})
            out.append({"id": pid, "name": meta.get("name") or pid,
                        "size": os.path.getsize(os.path.join(self.root, f)),
                        "shapes": meta.get("shapes"), "rev": meta.get("rev", ""),
                        "added": meta.get("added")})
        return sorted(out, key=lambda m: m["name"].lower())

    def read(self, pid: str) -> str:
        """The stored (sanitised) SVG. A hand-copied file is sanitised as it is read."""
        try:
            with open(self._path(pid), encoding="utf-8") as f:
                text = f.read(MAX_UPLOAD + 1)
        except OSError:
            raise PictureError(f"No picture called {pid!r}.") from None
        if pid not in self._index():
            text, _ = sanitise(text)
        return text

    def save(self, name: str, text: str, pid: str | None = None) -> dict[str, Any]:
        """Sanitise and store an upload: a new picture, or replace `pid`."""
        clean, info = sanitise(text)
        index = self._index()
        existing = {m["id"] for m in self.list()}
        if pid is None:
            if len(existing) >= MAX_PICTURES:
                raise PictureError(f"There are already {MAX_PICTURES} pictures.")
            pid = picture_id(name, existing)
        elif pid not in existing:
            raise PictureError(f"No picture called {pid!r}.")
        path = self._path(pid)
        os.makedirs(self.root, exist_ok=True)
        with open(path + ".tmp", "w", encoding="utf-8") as f:
            f.write(clean)
        os.replace(path + ".tmp", path)
        meta = {"name": _name(name, pid), "shapes": info["shapes"],
                "rev": rev_of(clean), "added": index.get(pid, {}).get("added") or int(time.time())}
        index[pid] = meta
        self._write_index(index)
        return {"id": pid, "size": len(clean.encode()), **meta}

    def rename(self, pid: str, name: str) -> None:
        index = self._index()
        if not os.path.exists(self._path(pid)):
            raise PictureError(f"No picture called {pid!r}.")
        index.setdefault(pid, {})["name"] = _name(name, pid)
        self._write_index(index)

    def delete(self, pid: str) -> None:
        try:
            os.remove(self._path(pid))
        except FileNotFoundError:
            pass
        index = self._index()
        if index.pop(pid, None) is not None:
            self._write_index(index)

    def rev(self) -> str:
        """Changes whenever any picture is added, replaced, renamed or removed."""
        return rev_of(json.dumps([(m["id"], m["rev"], m["name"], m["size"]) for m in self.list()]))
