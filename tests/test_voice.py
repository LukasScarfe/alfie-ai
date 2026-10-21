import json
import os

import pytest

from alfie import defaults
from alfie.config import ConfigError, default_config, default_voice, validate
from alfie.stories import Context, expand, fill
from alfie.triggers import default_trigger, voice_fires, voice_phase

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


def with_voice(**kw):
    return {**default_config(), "voice": {**default_voice(), **kw}}


# ------------------------------------------------------------------ config

def test_voice_defaults_validate_unchanged():
    assert valid(default_config())["voice"] == default_voice()


def test_a_config_without_voice_gets_the_defaults():
    cfg = default_config()
    del cfg["voice"]
    assert valid(cfg)["voice"] == default_voice()


def test_voice_values_are_checked():
    msg = errors(with_voice(satellites=["light.kitchen"], speak_style="mouth",
                            processing_animation="juggle", speak_targets=["switch.x"],
                            tts_entity="media_player.x", speak_strength=9))
    for bit in ("voice satellites", "voice speaking style", "voice thinking animation",
                "voice speakers", "voice TTS engine", "voice speaking strength"):
        assert bit in msg


def test_voice_keeps_good_values():
    v = valid(with_voice(satellites=["assist_satellite.s7", "assist_satellite.s7"],
                         speak_style="wave", after="", persona=True, persona_prompt="  Be terse. ",
                         speak_targets=["media_player.bedroom_speaker", "assist_satellite.s7"],
                         tts_entity="tts.piper"))["voice"]
    assert v["satellites"] == ["assist_satellite.s7"]
    assert v["speak_style"] == "wave" and v["after"] == ""
    assert v["persona"] and v["persona_prompt"] == "Be terse."
    assert v["speak_targets"] == ["media_player.bedroom_speaker", "assist_satellite.s7"]


def test_an_empty_persona_prompt_is_the_default():
    assert valid(with_voice(persona_prompt=""))["voice"]["persona_prompt"] == \
        defaults.PERSONA_PROMPT


# ------------------------------------------------------------------ triggers

def test_voice_phases():
    assert voice_phase("idle", "listening") == "listening"
    assert voice_phase("listening", "processing") == "processing"
    assert voice_phase("processing", "responding") == "responding"
    assert voice_phase("responding", "idle") == "done"
    assert voice_phase("listening", "unavailable") == "done"
    assert voice_phase("idle", "idle") is None
    assert voice_phase(None, "idle") is None
    assert voice_phase("unavailable", "idle") is None


def vtrig(**kw):
    return {**default_trigger("voice"), "id": "v", "story": "alarm", **kw}


def test_voice_trigger_validates_and_matches():
    cfg = default_config()
    cfg["triggers"] = [*cfg["triggers"], vtrig(satellites=["assist_satellite.s7*"], phase="done")]
    t = valid(cfg)["triggers"][-1]
    assert t["satellites"] == ["assist_satellite.s7*"] and t["phase"] == "done"
    assert voice_fires(t, "assist_satellite.s7_assist_satellite", "done")
    assert not voice_fires(t, "assist_satellite.s7_assist_satellite", "listening")
    assert not voice_fires(t, "assist_satellite.kitchen", "done")
    anyone = valid({**cfg, "triggers": [*cfg["triggers"][:-1], vtrig()]})["triggers"][-1]
    assert voice_fires(anyone, "assist_satellite.kitchen", "listening")
    assert not voice_fires({**anyone, "enabled": False}, "assist_satellite.kitchen", "listening")


def test_voice_trigger_phase_is_checked():
    cfg = default_config()
    cfg["triggers"] = [*cfg["triggers"], vtrig(phase="shouting")]
    assert "trigger v phase" in errors(cfg)


# ------------------------------------------------------------------ speak step

def test_speak_fill_ins():
    ctx = Context(name="Alfie", level="uneasy", reason="A battery is low.",
                  wrong_names=("A battery is low", "An update is available"))
    assert fill("{name} feels {mood}: {wrong}. {other}", ctx) == \
        "Alfie feels uneasy: A battery is low, An update is available. {other}"
    assert fill("{wrong}", Context()) == "nothing"


def test_speak_step_validates_and_expands():
    cfg = default_config()
    cfg["stories"] = [*cfg["stories"], {"id": "say", "name": "Say", "form": "steps", "steps": [
        {"kind": "speak", "text": "Hello from {name}", "targets": "media_player.a, tts.bad",
         "tts_entity": "tts.piper", "wait": True}]}]
    assert "speakers" in errors(cfg)
    cfg["stories"][-1]["steps"][0]["targets"] = "media_player.a"
    st = next(s for s in valid(cfg)["stories"] if s["id"] == "say")
    step = st["steps"][0]
    assert step["targets"] == ["media_player.a"] and step["wait"] is True
    (act,) = expand(st["steps"], Context(name="Alfie"), lambda n: 1.0)
    assert act.kind == "speak"
    assert act.value == {"text": "Hello from Alfie", "targets": ["media_player.a"],
                         "tts_entity": "tts.piper"}
    assert act.seconds == pytest.approx(round(16 / 14 + 1, 1))


def test_an_old_speak_step_still_loads():
    cfg = default_config()
    cfg["stories"] = [*cfg["stories"], {"id": "say", "name": "Say", "form": "steps",
                                        "steps": [{"kind": "speak", "text": "Hi"}]}]
    step = next(s for s in valid(cfg)["stories"] if s["id"] == "say")["steps"][0]
    assert step == {"kind": "speak", "text": "Hi", "targets": [], "tts_entity": "",
                    "wait": False}
