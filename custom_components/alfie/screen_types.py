"""Screen types: what each screen template is and which options it takes.

PURE (no HA import). Every `frontend/screens/<type>.json` describes one type
(see docs/screens-contract.md): its title, the provider kind it needs, and an
option schema. The panel renders a form from that schema and this module
checks a user's options against it, filling defaults, so the engine and the
card only ever see complete, valid options.
"""

from __future__ import annotations

import json
import logging
import os
import re
from collections.abc import Mapping
from typing import Any

from .config import ConfigError, _Check

_LOGGER = logging.getLogger(__name__)

OPTION_KINDS = ("entity", "entities", "number", "text", "choice", "bool", "color", "icon",
                "picture", "layout")
# Kinds that can hold one value per item of an entities option (`"per": key`).
PER_KINDS = ("text", "choice", "icon")
NEEDS = (None, "history", "forecast", "calendar", "streets", "picture")

_ENTITY = re.compile(r"^[a-z0-9_]+\.[a-z0-9_]+$")
_COLOR = re.compile(r"^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$")
# An icon name as the card draws it (alfie-screens.js isIcon): mdi:account.
_ICON = re.compile(r"^[a-z][a-z0-9_-]*:[a-z0-9_-]*[a-z][a-z0-9_-]*$")
# A picture's id (pictures.py): whether the file exists is the provider's to say.
_PICTURE = re.compile(r"^[a-z0-9_]+$")
# A layout element's text alignment ("auto": the type's own).
ALIGNS = ("auto", "left", "centre", "right")
SIZE_RANGE = (0.25, 4.0)


def _meta_ok(meta: Any) -> str | None:
    """Why a type file is unusable, or None."""
    if not isinstance(meta, dict) or not isinstance(meta.get("type"), str) or not meta["type"]:
        return "needs a 'type' name"
    if meta.get("needs") not in NEEDS:
        return f"unknown needs {meta.get('needs')!r}"
    opts = meta.get("options", [])
    if not isinstance(opts, list):
        return "'options' must be a list"
    for o in opts:
        if not isinstance(o, dict) or not o.get("key") or o.get("kind") not in OPTION_KINDS:
            return f"bad option {o!r}"
        if o["kind"] == "choice" and not o.get("choices"):
            return f"choice option {o['key']!r} has no choices"
        if o["kind"] == "layout" and not (isinstance(o.get("elements"), list) and all(
                isinstance(e, dict) and e.get("key") for e in o["elements"])):
            return f"layout option {o['key']!r} needs a list of elements"
        if o.get("per") and (o["kind"] not in PER_KINDS or not any(
                x.get("key") == o["per"] and x.get("kind") == "entities" for x in opts if isinstance(x, dict))):
            return f"option {o['key']!r}: per needs a {'/'.join(PER_KINDS)} option and an entities option"
    return None


def load_types(directory: str) -> dict[str, dict[str, Any]]:
    """Every usable `*.json` in `directory`, by type name. Blocking file reads:
    call from an executor. A broken file is skipped and logged, so one bad
    screen type can't stop Alfie from starting."""
    out: dict[str, dict[str, Any]] = {}
    try:
        names = sorted(n for n in os.listdir(directory) if n.endswith(".json"))
    except OSError:
        return out
    for name in names:
        try:
            with open(os.path.join(directory, name), encoding="utf-8") as f:
                meta = json.load(f)
        except (OSError, ValueError) as e:
            _LOGGER.warning("Alfie screen type %s unreadable: %s", name, e)
            continue
        why = _meta_ok(meta)
        if why:
            _LOGGER.warning("Alfie screen type %s skipped: %s", name, why)
            continue
        meta.setdefault("options", [])
        out[meta["type"]] = meta
    return out


def _entity_ok(v: str, domains: Any) -> str | None:
    if not _ENTITY.match(v):
        return f"{v!r} is not an entity id (domain.object_id)"
    if domains and v.split(".", 1)[0] not in domains:
        return f"{v!r} must be in {', '.join(domains)}"
    return None


def _one(o: Mapping[str, Any], v: str, ck: _Check, label: str) -> str:
    """One text, choice or icon value (stripped), checked; bad ones are reported
    and become the default."""
    v = v.strip()
    if o["kind"] == "choice":
        return ck.choice(label, v, o["choices"], o.get("default", o["choices"][0]))
    if o["kind"] == "icon" and v and not _ICON.match(v):
        if v.lower() not in o.get("presets", []):
            ck.bad(label, f"must be {', '.join(o.get('presets', []))} or an icon such as mdi:account")
            return o.get("default", "")
        v = v.lower()
    return v


def _per(o: Mapping[str, Any], v: Any, ck: _Check, label: str) -> str:
    """A per-item option: comma separated, one value per entity, each checked.
    An empty item means that entity's default; trailing empties are dropped."""
    items = v if isinstance(v, list) else str(v).split(",")
    out = [_one({**o, "default": ""}, str(x), ck, f"{label} {i + 1}") if str(x).strip() else ""
           for i, x in enumerate(items)]
    while out and not out[-1]:
        out.pop()
    return ", ".join(out)


def _layout(o: Mapping[str, Any], v: Any, ck: _Check, label: str) -> dict[str, Any]:
    """A layout option: per element, only what differs from auto. `box` is
    [x, y, w, h] in % of the screen from its top left, `size` scales the
    element's text, `show: false` hides it. Unknown elements are dropped."""
    if not isinstance(v, Mapping):
        ck.bad(label, "must be a mapping of elements")
        return {}
    out: dict[str, Any] = {}
    for el in o["elements"]:
        k, e = el["key"], v.get(el["key"])
        if e is None:
            continue
        where = f"{label} {k}"
        if not isinstance(e, Mapping):
            ck.bad(where, "must be a mapping (show, box, size, align)")
            continue
        item: dict[str, Any] = {}
        if e.get("show") is not None and e["show"] in (False, "false", "off", 0):
            item["show"] = False
        box = e.get("box")
        if box not in (None, "", "auto"):
            if not isinstance(box, list) or len(box) != 4:
                ck.bad(where, "box must be [x, y, w, h] in % of the screen, or auto")
            else:
                b = [ck.number(f"{where} box", x, 0, 100, -1) for x in box]
                if all(x >= 0 for x in b):
                    if b[2] <= 0 or b[3] <= 0:
                        ck.bad(where, "box needs a width and height above 0")
                    else:
                        item["box"] = [_num(round(x, 2)) for x in b]
        if e.get("size") not in (None, ""):
            size = ck.number(f"{where} size", e["size"], *SIZE_RANGE, 1)
            if size != 1:
                item["size"] = _num(size)
        if e.get("align") not in (None, "", "auto"):
            item["align"] = ck.choice(f"{where} align", e["align"], ALIGNS, "auto")
            if item["align"] == "auto":
                del item["align"]
        if item:
            out[k] = item
    return out


def _option(o: Mapping[str, Any], v: Any, ck: _Check, where: str) -> Any:
    kind, label = o["kind"], f"{where} {o.get('label') or o['key']}"
    if kind == "layout":
        return {} if v is None or v == "" else _layout(o, v, ck, label)
    required = bool(o.get("required"))
    empty = v is None or v == "" or v == []
    if empty:
        if required:
            ck.bad(label, "is required")
        return o["default"] if "default" in o and not required else (
            [] if kind == "entities" else False if kind == "bool" else
            o.get("min", 0) if kind == "number" else "")
    if kind == "bool":
        return v if isinstance(v, bool) else v in ("true", "on", 1)
    if kind == "number":
        return _num(ck.number(label, v, o.get("min"), o.get("max"), o.get("default", 0)))
    if o.get("per") and isinstance(v, (str, list)):
        return _per(o, v, ck, label) or o.get("default", "")
    if kind in ("text", "color", "choice", "entity", "icon", "picture"):
        if not isinstance(v, str):
            ck.bad(label, "must be text")
            return o.get("default", "")
        v = v.strip()
        if kind in ("choice", "icon"):
            return _one(o, v, ck, label)
        if kind == "color" and not _COLOR.match(v):
            ck.bad(label, "must be a colour like #ffcc00")
            return o.get("default", "")
        if kind == "picture" and not _PICTURE.match(v):
            ck.bad(label, "must be a picture's id")
            return o.get("default", "")
        if kind == "entity" and (why := _entity_ok(v, o.get("domain"))):
            ck.bad(label, why)
            return o.get("default", "")
        return v
    # entities: a list (a lone string is accepted), each an entity id
    items = [v] if isinstance(v, str) else v
    if not isinstance(items, list):
        ck.bad(label, "must be a list of entity ids")
        return []
    out: list[str] = []
    for e in items:
        e = str(e).strip()
        if why := _entity_ok(e, o.get("domain")):
            ck.bad(label, why)
        elif e not in out:
            out.append(e)
    return out


def _num(x: float) -> int | float:
    return int(x) if float(x).is_integer() else x


def check_options(meta: Mapping[str, Any], options: Any, ck: _Check, where: str) -> dict[str, Any]:
    """`options` checked against the type, problems added to `ck`. Keys are in
    the type's order (stable JSON); keys the type doesn't know are dropped, so
    a type that loses an option doesn't break saved screens."""
    if options is None:
        options = {}
    if not isinstance(options, Mapping):
        ck.bad(where, "options must be a mapping")
        options = {}
    return {o["key"]: _option(o, options.get(o["key"]), ck, where)
            for o in meta.get("options", [])}


def validate_options(meta: Mapping[str, Any], options: Any) -> dict[str, Any]:
    """The filled, checked options of one screen, or ConfigError."""
    ck = _Check()
    out = check_options(meta, options, ck, meta.get("type", "screen"))
    if ck.errors:
        raise ConfigError(ck.errors)
    return out


def options_yaml(meta: Mapping[str, Any], options: Any) -> str:
    """A screen's options as YAML for the panel's text editor: every option,
    defaults filled, in the type's order; short lists inline."""
    import yaml   # HA ships PyYAML; imported here so the checks above stay importable bare
    full = check_options(meta, options, _Check(), "")
    head = "".join(
        f"# {o['key']}: per element ({', '.join(e['key'] for e in o['elements'])}): show, "
        "box [x, y, w, h] in % from the top left (or auto), size, align\n"
        for o in meta.get("options", []) if o["kind"] == "layout")
    return head + yaml.safe_dump(full, sort_keys=False, default_flow_style=None,
                                 allow_unicode=True, width=100)


def options_from_yaml(meta: Mapping[str, Any], text: str) -> tuple[dict[str, Any], list[str]]:
    """The editor's YAML back as options (only what differs from the defaults)
    and the problems found. Unknown keys are problems here, to catch typos."""
    import yaml
    try:
        raw = yaml.safe_load(text) if text.strip() else {}
    except yaml.YAMLError as e:
        return {}, [f"YAML: {e}"]
    raw = {} if raw is None else raw
    if not isinstance(raw, dict):
        return {}, ["YAML: must be a mapping of options"]
    ck = _Check()
    known = {o["key"]: o for o in meta.get("options", [])}
    for k in raw:
        if k not in known:
            ck.bad(str(k), "is not an option of this screen")
    full = check_options(meta, raw, ck, "")
    lean = {k: v for k, v in full.items()
            if not (v == known[k].get("default", {} if known[k]["kind"] == "layout" else None)
                    or (known[k]["kind"] == "layout" and not v))}
    return lean, [e.lstrip(" ") for e in ck.errors]
