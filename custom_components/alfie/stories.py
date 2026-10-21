"""Stories: what Alfie does when a trigger fires.

PURE (no HA import), so the tests run under plain python. A story is an
ordered list of steps that every display performs together:

  expression  wear an expression (or @mood / @old_mood) and hold it a while
  animation   play one, optionally waiting for it to finish
  screen      present a screen (or @why / @wrong, the signals' own screens)
  wait        do nothing for a while
  move        spring to a place on the card
  resize      spring to a size
  speak       say something out loud: TTS on chosen speakers (media players or
              voice satellites), or the Voice settings' speakers. Its text
              takes {name} {mood} {reason} {wrong} fill-ins
  icon        show a Home Assistant icon: he turns into it, it shows beside
              him (his corner), or it is added onto the card as a badge

A story's form is either `simple` (fill in: react, show a screen, close)
or free `steps`; `compile_simple` turns the first into the second. `expand` resolves the tokens against the moment the story plays and
flattens it into timed actions, which the engine walks with one timer per
action. The config's validator calls `validate_stories` with its collector.
"""

from __future__ import annotations

from collections.abc import Callable, Mapping, Sequence
from dataclasses import dataclass
from typing import Any

STEP_KINDS = ("expression", "animation", "screen", "wait", "move", "resize", "speak", "icon")
MOOD_TOKENS = ("@mood", "@old_mood")
SCREEN_TOKENS = ("@why", "@wrong")
PRESENTS = ("card", "handover", "corner")     # "card": whatever the card is set to
# Places on the card as fractions of the room Alfie has to move in, y up.
PLACES = {"centre": (0.0, 0.0), "top_left": (-1.0, 1.0), "top_right": (1.0, 1.0),
          "bottom_left": (-1.0, -1.0), "bottom_right": (1.0, -1.0)}
SCALE = (0.3, 1.5)
SCREEN_SECONDS = (3.0, 3600.0)
FORMS = ("simple", "steps")
# Icons (design.md "Icons"). transform: he turns into it (whole: ring and eyes;
# ring: the ring only, his eyes stay); beside: his corner, like a corner screen;
# overlay: a badge on the card while he carries on.
ICON_STYLES = ("transform", "beside", "overlay")
ICON_TRANSFORMS = ("whole", "ring")
ICON_CORNERS = ("card", "top_left", "top_right", "bottom_left", "bottom_right")
# Overlay places: beside his ring (above, below, left, right), the card's
# corners or centre, or custom x/y (fractions of the card, y up).
ICON_PLACES = ("above", "below", "left", "right", "top_left", "top_right", "bottom_left",
               "bottom_right", "centre", "custom")
ICON_COLORS = ("line", "accent", "text")     # the ring's colour, the eyes', the text's
ICON_FILLS = ("none", "soft", "solid")       # outlines only, a faint fill, filled in
ICON_SIZE = (0.3, 2.0)                       # times the style's natural size
ICON_SECONDS = (1.0, 3600.0)
ICON_SCREEN = "@icon"                        # the screen id an icon shows as
SPEAK_FILLS = ("name", "mood", "reason", "wrong")
SPEAK_RATE = 14.0                            # characters a second, for a speak step's wait


def is_icon_name(v: Any) -> bool:
    """`prefix:name`, as HA writes icons (mdi:lightbulb, hass:home, a custom set's)."""
    if not isinstance(v, str) or v.count(":") != 1:
        return False
    a, b = v.split(":")
    ok = lambda x: x != "" and all(c.isalnum() or c in "_-" for c in x)  # noqa: E731
    return ok(a) and ok(b)


def default_simple() -> dict[str, Any]:
    return {"expression": "", "animation": "", "icon": "", "icon_style": "transform",
            "screen": "@why", "seconds": 15, "present": "card", "transition": "",
            "closing": ""}


def default_icon() -> dict[str, Any]:
    """An icon's options, as a story step has them and alfie.show_icon takes them."""
    return {"icon": "mdi:lightbulb-on", "style": "transform", "transform": "whole",
            "seconds": 5, "transition": "", "corner": "card", "place": "top_right",
            "x": 0, "y": 0, "size": 1, "color": "line", "fill": "soft"}


def default_step(kind: str) -> dict[str, Any]:
    """A fresh step of `kind`, with every field, in the stored key order."""
    return {
        "expression": {"kind": "expression", "name": "@mood", "hold": 1.5, "blend": 0},
        "animation": {"kind": "animation", "name": "nod", "wait": True},
        "screen": {"kind": "screen", "screen": "@why", "seconds": 15, "present": "card",
                   "transition": ""},
        "wait": {"kind": "wait", "seconds": 2},
        "move": {"kind": "move", "to": "centre", "x": 0, "y": 0, "seconds": 0.8},
        "resize": {"kind": "resize", "scale": 1, "seconds": 0.8},
        "speak": {"kind": "speak", "text": "", "targets": [], "tts_entity": "",
                  "wait": False},
        "icon": {"kind": "icon", **default_icon(), "wait": True},
    }[kind]


def compile_simple(t: Mapping[str, Any]) -> list[dict[str, Any]]:
    """The steps a (validated) simple story stands for."""
    steps: list[dict[str, Any]] = []
    if t.get("expression"):
        steps.append({**default_step("expression"), "name": t["expression"], "hold": 1})
    if t.get("animation"):
        steps.append({**default_step("animation"), "name": t["animation"]})
    if t.get("icon"):
        steps.append({**default_step("icon"), "icon": t["icon"],
                      "style": t.get("icon_style") or "transform"})
    if t.get("screen"):
        steps.append({**default_step("screen"), "screen": t["screen"], "seconds": t["seconds"],
                      "present": t["present"], "transition": t["transition"]})
    if t.get("closing"):
        steps.append({**default_step("animation"), "name": t["closing"]})
    return steps


def steps_of(story: Mapping[str, Any]) -> list[dict[str, Any]]:
    return compile_simple(story["simple"]) if story["form"] == "simple" \
        else list(story["steps"])


# ---------------------------------------------------------------- validating

def _num(x: float) -> int | float:
    return int(x) if float(x).is_integer() else x


def _slug(v: Any) -> bool:
    return isinstance(v, str) and v != "" and all(c.islower() or c.isdigit() or c == "_"
                                                  for c in v)


def _step(raw: Any, where: str, ck: Any, expressions: Sequence[str],
          animations: Sequence[str], screen_ids: set[str]) -> dict[str, Any] | None:
    if not isinstance(raw, Mapping):
        ck.bad(where, "must be a mapping")
        return None
    kind = raw.get("kind")
    if kind not in STEP_KINDS:
        ck.bad(where, f"unknown kind {kind!r}")
        return None
    s = {**default_step(kind), **{k: v for k, v in raw.items() if k in default_step(kind)}}
    where = f"{where} ({kind})"
    if kind == "expression":
        s["name"] = ck.choice(f"{where} expression", s["name"], (*MOOD_TOKENS, *expressions),
                              "@mood")
        s["hold"] = _num(ck.number(f"{where} hold", s["hold"], 0, 3600, 1.5))
        s["blend"] = _num(ck.number(f"{where} blend", s["blend"], 0, 10, 0))
    elif kind == "animation":
        s["name"] = ck.choice(f"{where} animation", s["name"], animations, "nod")
        s["wait"] = bool(s["wait"])
    elif kind == "screen":
        if s["screen"] not in SCREEN_TOKENS and s["screen"] not in screen_ids:
            ck.bad(where, f"screen {s['screen']!r} does not exist")
        s["seconds"] = _num(ck.number(f"{where} seconds", s["seconds"], *SCREEN_SECONDS, 15))
        s["present"] = ck.choice(f"{where} present", s["present"], PRESENTS, "card")
        s["transition"] = _transition(where, s["transition"], ck)
    elif kind == "wait":
        s["seconds"] = _num(ck.number(f"{where} seconds", s["seconds"], 0, 3600, 2))
    elif kind == "move":
        s["to"] = ck.choice(f"{where} place", s["to"], (*PLACES, "custom"), "centre")
        s["x"] = _num(ck.number(f"{where} x", s["x"], -1, 1, 0))
        s["y"] = _num(ck.number(f"{where} y", s["y"], -1, 1, 0))
        s["seconds"] = _num(ck.number(f"{where} seconds", s["seconds"], 0, 10, 0.8))
    elif kind == "resize":
        s["scale"] = _num(ck.number(f"{where} size", s["scale"], *SCALE, 1))
        s["seconds"] = _num(ck.number(f"{where} seconds", s["seconds"], 0, 10, 0.8))
    elif kind == "icon":
        s.update(check_icon(s, where, ck))
        s["wait"] = bool(s["wait"])
    else:
        s["text"] = str(s["text"] or "").strip()
        s["targets"] = _entities(f"{where} speakers", s["targets"], ("media_player",
                                                                    "assist_satellite"), ck)
        tts = str(s["tts_entity"] or "").strip()
        if tts and not tts.startswith("tts."):
            ck.bad(f"{where} TTS engine", f"{tts!r} is not a tts entity")
            tts = ""
        s["tts_entity"] = tts
        s["wait"] = bool(s["wait"])
    return s


def _entities(where: str, v: Any, domains: Sequence[str], ck: Any) -> list[str]:
    """Entity ids in `domains`, as a list (a comma string is split)."""
    if isinstance(v, str):
        v = [x for x in v.split(",")]
    if not isinstance(v, list):
        ck.bad(where, "must be a list")
        return []
    out: list[str] = []
    for x in v:
        x = str(x).strip()
        if not x:
            continue
        if x.split(".")[0] not in domains or x.count(".") != 1:
            ck.bad(where, f"{x!r} is not a {' or '.join(domains)} entity")
        elif x not in out:
            out.append(x)
    return out


def fill(text: str, ctx: "Context") -> str:
    """A speak step's text with its {name} {mood} {reason} {wrong} filled in;
    any other braces stay as they are."""
    vals = {"name": ctx.name, "mood": ctx.level, "reason": ctx.reason,
            "wrong": ", ".join(ctx.wrong_names) or "nothing"}
    for k in SPEAK_FILLS:
        text = text.replace("{" + k + "}", vals[k])
    return text


def check_icon(raw: Mapping[str, Any], where: str, ck: Any) -> dict[str, Any]:
    """An icon's options, checked, with defaults filled (a step's, or a service call's)."""
    base = default_icon()
    d = {**base, **{k: v for k, v in raw.items() if k in base and v is not None}}
    icon = str(d["icon"] or "").strip()
    if not is_icon_name(icon):
        ck.bad(f"{where} icon", f"{icon!r} is not an icon name (like mdi:lightbulb)")
        icon = base["icon"]
    return {
        "icon": icon,
        "style": ck.choice(f"{where} style", d["style"], ICON_STYLES, "transform"),
        "transform": ck.choice(f"{where} transform", d["transform"], ICON_TRANSFORMS, "whole"),
        "seconds": _num(ck.number(f"{where} seconds", d["seconds"], *ICON_SECONDS, 5)),
        "transition": _transition(where, d["transition"], ck),
        "corner": ck.choice(f"{where} corner", d["corner"], ICON_CORNERS, "card"),
        "place": ck.choice(f"{where} place", d["place"], ICON_PLACES, "top_right"),
        "x": _num(ck.number(f"{where} x", d["x"], -1, 1, 0)),
        "y": _num(ck.number(f"{where} y", d["y"], -1, 1, 0)),
        "size": _num(ck.number(f"{where} size", d["size"], *ICON_SIZE, 1)),
        "color": ck.choice(f"{where} colour", d["color"], ICON_COLORS, "line"),
        "fill": ck.choice(f"{where} fill", d["fill"], ICON_FILLS, "soft"),
    }


def icon_action(icon: Mapping[str, Any], wait: bool = True) -> Action:
    """What one (checked) icon does. Transform and beside are screens: he turns
    into it by morph, or goes to his corner; an overlay is a badge of its own."""
    look = {"name": icon["icon"], "size": icon["size"], "color": icon["color"],
            "fill": icon["fill"]}
    if icon["style"] == "overlay":
        return Action("icon", {**look, "place": icon["place"], "x": icon["x"], "y": icon["y"],
                               "seconds": icon["seconds"], "transition": icon["transition"]},
                      icon["seconds"] if wait else 0.0)
    if icon["style"] == "transform":
        look["ring"] = icon["transform"] == "ring"
        present, transition = "handover", "morph"
    else:
        look["corner"] = icon["corner"]
        present, transition = "corner", icon["transition"]
    return Action("screen", {"id": ICON_SCREEN, "icon": look, "seconds": icon["seconds"],
                             "present": present, "transition": transition}, icon["seconds"])


def _transition(where: str, v: Any, ck: Any) -> str:
    """"" (the card's own) or an intro name; the names live in the frontend."""
    v = str(v or "").strip()
    if v and not _slug(v):
        ck.bad(f"{where} transition", "must be a name (lower-case letters, digits and _)")
        return ""
    return v


def _simple(raw: Any, where: str, ck: Any, expressions: Sequence[str],
              animations: Sequence[str], screen_ids: set[str]) -> dict[str, Any]:
    base = default_simple()
    t = {**base, **{k: v for k, v in raw.items() if k in base}} \
        if isinstance(raw, Mapping) else base
    out = {
        "expression": ck.choice(f"{where} expression", t["expression"] or "",
                                ("", *MOOD_TOKENS, *expressions), ""),
        "animation": ck.choice(f"{where} animation", t["animation"] or "", ("", *animations), ""),
        "icon": str(t["icon"] or "").strip(),
        "icon_style": ck.choice(f"{where} icon style", t["icon_style"], ICON_STYLES, "transform"),
        "screen": str(t["screen"] or "").strip(),
        "seconds": _num(ck.number(f"{where} seconds", t["seconds"], *SCREEN_SECONDS, 15)),
        "present": ck.choice(f"{where} present", t["present"], PRESENTS, "card"),
        "transition": _transition(where, t["transition"], ck),
        "closing": ck.choice(f"{where} closing", t["closing"] or "", ("", *animations), ""),
    }
    if out["icon"] and not is_icon_name(out["icon"]):
        ck.bad(f"{where} icon", f"{out['icon']!r} is not an icon name (like mdi:lightbulb)")
        out["icon"] = ""
    if out["screen"] and out["screen"] not in SCREEN_TOKENS and out["screen"] not in screen_ids:
        ck.bad(where, f"screen {out['screen']!r} does not exist")
    return out


def validate_stories(raw: Any, ck: Any, expressions: Sequence[str],
                     animations: Sequence[str], screen_ids: set[str]) -> list[dict[str, Any]]:
    """Checked stories from `raw`; problems go to `ck` (config._Check)."""
    if not isinstance(raw, list):
        ck.bad("stories", "must be a list")
        return []
    out: list[dict[str, Any]] = []
    seen: set[str] = set()
    for i, s in enumerate(raw):
        where = f"story {i + 1}"
        if not isinstance(s, Mapping):
            ck.bad(where, "must be a mapping")
            continue
        sid = str(s.get("id") or "").strip()
        if not _slug(sid):
            ck.bad(where, "id must be lower-case letters, digits and _")
            continue
        where = f"story {sid}"
        if sid in seen:
            ck.bad(where, "id is used twice")
            continue
        seen.add(sid)
        steps_raw = s.get("steps", [])
        if not isinstance(steps_raw, list):
            ck.bad(f"{where} steps", "must be a list")
            steps_raw = []
        steps = [step for j, raw_step in enumerate(steps_raw)
                 if (step := _step(raw_step, f"{where} step {j + 1}", ck, expressions,
                                   animations, screen_ids)) is not None]
        out.append({
            "id": sid,
            "name": str(s.get("name") or "").strip() or sid,
            "form": ck.choice(f"{where} form", s.get("form", "steps"), FORMS, "steps"),
            "simple": _simple(s.get("simple"), f"{where} simple", ck, expressions,
                                  animations, screen_ids),
            "steps": steps,
        })
    return out


# ------------------------------------------------------------------ playing

@dataclass(frozen=True)
class Context:
    """The moment a story plays in, for its tokens."""
    mood_expression: str = "neutral"
    old_mood_expression: str = "neutral"
    why: tuple[str, ...] = ()       # screens of the signals that just changed
    wrong: tuple[str, ...] = ()     # screens of every active bad signal
    name: str = "Alfie"
    level: str = "content"          # the mood level
    reason: str = ""                # the mood's reason, as the panel shows it
    wrong_names: tuple[str, ...] = ()   # names of every active bad signal


@dataclass(frozen=True)
class Action:
    """One timed thing to do. `seconds` is how long until the next action."""
    kind: str                       # expression, animation, screen, place, speak, icon
    value: Any
    seconds: float


def expand(steps: Sequence[Mapping[str, Any]], ctx: Context,
           animation_seconds: Callable[[str], float]) -> list[Action]:
    """The flat timeline of `steps` in `ctx`. @why/@wrong become one screen
    action per screen (none when no signal has one); `animation_seconds`
    says how long an animation runs on the displays."""
    out: list[Action] = []
    place = {"x": 0.0, "y": 0.0, "scale": 1.0}
    for s in steps:
        kind = s["kind"]
        if kind == "expression":
            name = {"@mood": ctx.mood_expression,
                    "@old_mood": ctx.old_mood_expression}.get(s["name"], s["name"])
            out.append(Action("expression", {"name": name, "blend": s["blend"]}, s["hold"]))
        elif kind == "animation":
            out.append(Action("animation", s["name"],
                              animation_seconds(s["name"]) if s["wait"] else 0.0))
        elif kind == "screen":
            ids = {"@why": ctx.why, "@wrong": ctx.wrong}.get(s["screen"], (s["screen"],))
            for sid in dict.fromkeys(ids):     # each once, in order
                out.append(Action("screen", {"id": sid, "seconds": s["seconds"],
                                             "present": s["present"],
                                             "transition": s["transition"]}, s["seconds"]))
        elif kind == "wait":
            if s["seconds"]:
                out.append(Action("wait", None, s["seconds"]))
        elif kind in ("move", "resize"):
            if kind == "move":
                x, y = PLACES.get(s["to"], (s["x"], s["y"]))
                place = {**place, "x": float(x), "y": float(y)}
            else:
                place = {**place, "scale": float(s["scale"])}
            out.append(Action("place", {**place, "seconds": s["seconds"]}, s["seconds"]))
        elif kind == "speak" and s["text"]:
            text = fill(s["text"], ctx)
            out.append(Action("speak", {"text": text, "targets": list(s.get("targets") or []),
                                        "tts_entity": s.get("tts_entity") or ""},
                              round(len(text) / SPEAK_RATE + 1, 1) if s.get("wait") else 0.0))
        elif kind == "icon":
            out.append(icon_action(s, s["wait"]))
    return out


def animation_length(face: Mapping[str, Any], name: str) -> float:
    """An animation's length at rate 1, as the card compiles it (a non-rest
    last key gets a 0.45 s spring home)."""
    a = (face.get("animations") or {}).get(name)
    if not a:
        return 0.0
    if a.get("procedural"):
        return float(a.get("length", 1.0))
    keys = a.get("keys") or []
    t = sum(float(k[0]) for k in keys)
    if keys and keys[-1][1]:
        t += 0.45
    return t


def play_rate(energy: float, speed: float) -> float:
    """The card's animation rate (alfie-card.js `rate`)."""
    return (0.65 + 0.55 * max(0.0, min(1.5, energy))) * speed
