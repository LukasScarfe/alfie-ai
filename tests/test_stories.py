import copy
import json
import os

import pytest

from alfie import defaults
from alfie.config import ConfigError, default_config, migrate_v1, validate
from alfie.stories import (
    Context,
    animation_length,
    compile_template,
    default_template,
    expand,
    play_rate,
    steps_of,
)

FACE_PATH = os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie",
                         "frontend", "alfie-face.json")
with open(FACE_PATH) as f:
    FACE = json.load(f)


def valid(cfg):
    return validate(cfg, FACE)


def errors(cfg):
    with pytest.raises(ConfigError) as e:
        valid(cfg)
    return "\n".join(e.value.errors)


def story(**kw):
    return {"id": "s", "name": "S", "mode": "steps", "template": default_template(),
            "steps": [], **kw}


def test_default_stories_validate_and_survive_json():
    cfg = valid(default_config())
    assert [s["id"] for s in cfg["stories"]] == [s["id"] for s in defaults.STORIES]
    assert valid(json.loads(json.dumps(cfg)))["stories"] == cfg["stories"]
    assert json.dumps(cfg["stories"]) == json.dumps(default_config()["stories"])


def test_step_checks_collect_every_problem():
    text = errors({"stories": [story(steps=[
        {"kind": "animation", "name": "moonwalk"},
        {"kind": "expression", "name": "grin"},
        {"kind": "screen", "screen": "nowhere"},
        {"kind": "resize", "scale": 9},
        {"kind": "dance"},
    ])], "triggers": []})
    for want in ("moonwalk", "grin", "nowhere", "between 0.3", "dance"):
        assert want in text, want


def test_steps_fill_defaults_and_drop_unknown_keys():
    cfg = valid({"stories": [story(steps=[{"kind": "wait", "junk": 1},
                                          {"kind": "move", "to": "top_left"}])],
                 "triggers": []})
    wait, move = cfg["stories"][0]["steps"]
    assert wait == {"kind": "wait", "seconds": 2}
    assert move["to"] == "top_left" and set(move) == {"kind", "to", "x", "y", "seconds"}


def test_template_compiles_in_order():
    t = {**default_template(), "expression": "happy", "animation": "nod", "screen": "@wrong",
         "seconds": 8, "closing": "shake"}
    kinds = [(s["kind"], s.get("name") or s.get("screen")) for s in compile_template(t)]
    assert kinds == [("expression", "happy"), ("animation", "nod"), ("screen", "@wrong"),
                     ("animation", "shake")]
    assert compile_template({**default_template(), "screen": ""}) == []


def test_template_mode_plays_the_template():
    s = valid({"stories": [story(mode="template",
                                 template={"animation": "wake_up", "screen": ""})],
               "triggers": []})["stories"][0]
    assert [x["name"] for x in steps_of(s)] == ["wake_up"]


def test_expand_resolves_tokens():
    steps = [{"kind": "expression", "name": "@old_mood", "hold": 1, "blend": 0},
             {"kind": "expression", "name": "@mood", "hold": 1.5, "blend": 1.5},
             {"kind": "screen", "screen": "@wrong", "seconds": 10, "present": "corner",
              "transition": "draw"},
             {"kind": "animation", "name": "shake", "wait": True},
             {"kind": "animation", "name": "nod", "wait": False}]
    ctx = Context(mood_expression="skeptical", old_mood_expression="neutral",
                  wrong=("plants", "nas", "plants"))
    acts = expand(steps, ctx, lambda name: 2.0)
    assert [(a.kind, a.seconds) for a in acts] == [
        ("expression", 1), ("expression", 1.5), ("screen", 10), ("screen", 10),
        ("animation", 2.0), ("animation", 0.0)]
    assert acts[0].value["name"] == "neutral" and acts[1].value == {"name": "skeptical",
                                                                    "blend": 1.5}
    assert [a.value["id"] for a in acts[2:4]] == ["plants", "nas"]   # each once
    assert acts[2].value["present"] == "corner"


def test_expand_skips_empty_screens_and_tracks_place():
    steps = [{"kind": "screen", "screen": "@why", "seconds": 5, "present": "card",
              "transition": ""},
             {"kind": "move", "to": "custom", "x": 0.5, "y": -0.25, "seconds": 1},
             {"kind": "resize", "scale": 0.5, "seconds": 0.5},
             {"kind": "speak", "text": ""}]
    acts = expand(steps, Context(), lambda name: 1.0)
    assert [a.kind for a in acts] == ["place", "place"]
    assert acts[1].value == {"x": 0.5, "y": -0.25, "scale": 0.5, "seconds": 0.5}


def test_animation_length_matches_the_card():
    nod = FACE["animations"]["nod"]
    t = sum(k[0] for k in nod["keys"]) + (0.45 if nod["keys"][-1][1] else 0)
    assert animation_length(FACE, "nod") == pytest.approx(t)
    assert animation_length(FACE, "glitch") == 0.5
    assert animation_length(FACE, "nope") == 0.0
    assert play_rate(1.0, 1.0) == pytest.approx(1.2)


# ------------------------------------------------------------------ migration

def v1(**behaviour):
    cfg = copy.deepcopy(default_config())
    cfg["version"] = 1
    del cfg["stories"], cfg["triggers"]
    cfg["behaviour"].update({"celebrate": True, "on_critical": "startle",
                             "on_recover": "nod", "on_wake": "wake_up", **behaviour})
    return cfg


def by_id(items, i):
    return next(x for x in items if x["id"] == i)


def test_v1_defaults_migrate_to_the_v2_defaults():
    assert valid(v1()) == valid(default_config())


def test_v1_reactions_carry_over():
    cfg = valid(v1(on_critical="flinch", on_recover="", on_wake="", celebrate=True))
    assert by_id(cfg["stories"], "alarm")["steps"][0]["name"] == "flinch"
    assert not by_id(cfg["triggers"], "fixed")["enabled"]
    assert not by_id(cfg["triggers"], "wake")["enabled"]
    assert by_id(cfg["triggers"], "critical")["enabled"]
    assert "on_critical" not in cfg["behaviour"] and "celebrate" not in cfg["behaviour"]
    cfg = valid(v1(celebrate=False, on_wake="dizzy"))
    assert not by_id(cfg["triggers"], "fixed")["enabled"]
    assert by_id(cfg["stories"], "wake_up")["template"]["animation"] == "dizzy"


def test_migration_leaves_v2_alone():
    cfg = default_config()
    assert migrate_v1(cfg) == cfg


def test_appear_stories():
    cfg = valid(default_config())
    assert cfg["behaviour"]["appear_story_bad"] == "bad_news"
    assert cfg["behaviour"]["appear_story_ok"] == "hello"
    assert any(s["id"] == "hello" for s in cfg["stories"])
    # Either may be "" (nothing plays), but a story that is missing is an error.
    off = default_config()
    off["behaviour"]["appear_story_ok"] = ""
    assert valid(off)["behaviour"]["appear_story_ok"] == ""
    off["behaviour"]["appear_story_bad"] = "ghost"
    with pytest.raises(ConfigError) as e:
        valid(off)
    assert any("ghost" in x for x in e.value.errors)


def test_configs_before_appear_stories_get_hello_once():
    old = default_config()
    del old["behaviour"]["appear_story_bad"], old["behaviour"]["appear_story_ok"]
    old["stories"] = [s for s in old["stories"] if s["id"] != "hello"]
    cfg = valid(old)
    assert [s["id"] for s in cfg["stories"]][-1] == "hello"
    # Once the keys are saved, a deleted hello stays deleted.
    cfg["stories"] = [s for s in cfg["stories"] if s["id"] != "hello"]
    cfg["behaviour"]["appear_story_ok"] = ""
    assert not any(s["id"] == "hello" for s in valid(cfg)["stories"])


def test_old_config_without_bad_news_still_validates():
    old = default_config()
    del old["behaviour"]["appear_story_bad"], old["behaviour"]["appear_story_ok"]
    old["stories"] = [s for s in old["stories"] if s["id"] != "bad_news"]
    old["triggers"] = [t for t in old["triggers"] if t["story"] != "bad_news"]
    assert valid(old)["behaviour"]["appear_story_bad"] == ""
