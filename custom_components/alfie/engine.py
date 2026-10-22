"""Alfie's engine: watches the house, keeps his mood, decides what he does.

It runs entirely on HA's event loop and does nothing heavy there: a state
change costs a dict lookup to filter, and a recompute evaluates a handful of
signals. It holds *what Alfie is* (the scene state, see docs/design.md
"Scene state") and pushes it to listeners (the WS subscriptions, the
entities); the cards do all per-frame animation themselves.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import random
import time
from collections.abc import Callable
from typing import Any

from homeassistant.config_entries import ConfigEntry
from homeassistant.const import EVENT_STATE_CHANGED
from homeassistant.core import CALLBACK_TYPE, Event, HomeAssistant, callback
from homeassistant.helpers.event import async_call_later

from . import modes as md
from . import triggers as trig
from .config import NOTICE, build, face_extras, reset, validate
from .config import _Check as Check
from .const import (
    CONF_NAME,
    DEFAULT_NAME,
    EVENT_ANIMATION,
    EVENT_ICON,
    EVENT_SIGNAL,
    EVENT_STORY,
    EVENT_VOICE,
    FACE_FILE,
    HOUSE_MODES,
    SCENE_VERSION,
)
from .mood import LEVELS, Mood, MoodSettings, combine
from .providers import FetchCache, provider_for
from .providers.picture import store_for as picture_store
from .screen_types import load_types
from .signals import Signal, SignalResult, evaluate, evaluate_all, is_pattern, matching, watches
from .stories import (
    ICON_SCREEN,
    Action,
    Context,
    animation_length,
    check_icon,
    expand,
    icon_action,
    play_rate,
    steps_of,
)
from .store import AlfieStore

_LOGGER = logging.getLogger(__name__)

SLEEP_ENERGY = 0.15
IDLE_QUIET_AFTER = 10.0      # seconds after any animation before a fidget may play
PREVIEW_ENTITIES = 25        # per signal, in a panel preview
QUEUE_MAX = 3                # stories waiting behind the one playing
QUEUE_STALE = 60.0           # seconds a queued story may wait before it is dropped
REPEAT_GAP = 900.0           # seconds between one signal's walk-in replays
ANIMATION_SLACK = 0.25       # seconds added to an animation a story waits for
OVERLAYS_MAX = 4             # icon badges on the cards at once; the oldest goes first
SATELLITE = "assist_satellite."

Listener = Callable[[dict[str, Any]], None]


VOICE_SCREEN = "@voice"       # voice screens' ids: @voice:<seq>
VOICE_HOLD = 90.0             # seconds a voice screen waits for its satellite to be done
VOICE_SCREENS_KEPT = 4


def _load_face() -> dict[str, Any]:
    path = os.path.join(os.path.dirname(__file__), "frontend", FACE_FILE)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


def _load_types() -> dict[str, dict[str, Any]]:
    return load_types(os.path.join(os.path.dirname(__file__), "frontend", "screens"))


class AlfieEngine:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.name: str = entry.data.get(CONF_NAME) or DEFAULT_NAME
        self.store = AlfieStore(hass)
        # All of these come from the stored config, set by _apply.
        self.face: dict[str, Any] = {}
        self.config: dict[str, Any] = {}
        self.types: dict[str, dict[str, Any]] = {}
        self.screens_rev = ""
        self.pictures_rev = ""
        self.face_rev = ""          # his own expressions (and animations): cards refetch on change
        self.signals: tuple[Signal, ...] = ()
        self.settings = MoodSettings()
        self.behaviour: dict[str, Any] = {}
        self.personality: dict[str, float] = {}
        self.motion_sensors: dict[str, str] = {}
        self._base_personality: dict[str, float] = {}   # before the mode's overrides
        self._mode_signals: tuple[Signal, ...] = ()      # the modes' conditions

        self.expressions: set[str] = set()
        self.animations: set[str] = set()
        self.mode = md.AUTO                 # select.alfie_mode: auto, normal or a mode id
        self.active: dict[str, Any] | None = None   # the house mode now (None: normal)
        # Held by automations (alfie.set_mood, ...): kind -> value, laid over
        # the mode (modes.with_holds); `effective` is that mode, what he follows.
        self.holds: dict[str, str] = {}
        self.hold_until: dict[str, float | None] = {}   # kind -> epoch s, None: until changed
        self._hold_unsubs: dict[str, CALLBACK_TYPE] = {}
        self._mode_unsub: CALLBACK_TYPE | None = None   # set_mode's duration
        self.effective: dict[str, Any] | None = None
        self._effective_key: Any = None
        self.config_hooks: list[Callable[[], None]] = []   # after each config change
        self.mode_why: SignalResult | None = None   # the condition that chose it
        self.mood: Mood | None = None
        self.asleep = False
        self.override: str | None = None
        self.animation: dict[str, Any] | None = None
        self.seq = 0
        self._anim_id = 0
        self._last_anim = 0.0            # monotonic
        self._last_motion = -1e9         # monotonic
        self._listeners: set[Listener] = set()
        self._unsubs: list[CALLBACK_TYPE] = []
        self._idle_unsub: CALLBACK_TYPE | None = None
        self._override_unsub: CALLBACK_TYPE | None = None
        self.screen: dict[str, Any] | None = None   # being shown now; not entity state
        self._screen_seq = 0
        self._screen_unsub: CALLBACK_TYPE | None = None
        # Icon badges on the cards (an icon's overlay style); not entity state.
        self.overlays: list[dict[str, Any]] = []
        self._overlay_unsubs: dict[int, CALLBACK_TYPE] = {}
        self._relevant_cache: dict[str, bool] = {}
        self._signal_entities: set[str] = set()   # resolved, patterns included
        self.state_key: tuple = ()                # what the entities show; see _push

        # Triggers and stories (triggers.py, stories.py). None of this is
        # entity state: a story never writes the recorder.
        self.stories: dict[str, dict[str, Any]] = {}
        self.triggers: list[dict[str, Any]] = []        # enabled ones only
        self._entity_triggers: list[dict[str, Any]] = []
        self._thresholds: dict[str, list[dict[str, Any]]] = {}   # threshold entity -> triggers
        self.story: dict[str, Any] | None = None        # playing now
        self._story_seq = 0
        self._story_unsub: CALLBACK_TYPE | None = None
        self._queue: list[dict[str, Any]] = []
        self._last_fired: dict[str, float] = {}         # trigger id -> monotonic
        self.trigger_status: dict[str, dict[str, Any]] = {}
        self._bad_since: dict[str, float] = {}          # signal id -> monotonic
        self._repeated: dict[str, float] = {}           # signal id -> monotonic
        self._repeat_unsub: CALLBACK_TYPE | None = None
        self._old_expression: str | None = None         # the mood's, before this change
        # Voice (design.md "Voice"): the satellites he follows that are
        # listening, thinking or answering now. Not entity state.
        self.voice: dict[str, dict[str, Any]] = {}
        self._voice_triggers: list[dict[str, Any]] = []
        # Voice screens (design.md "Voice screens"): the last few made, by
        # their @voice:<seq> id, for alfie/screen_data. Not entity state.
        self._voice_screens: dict[str, dict[str, Any]] = {}

    # ------------------------------------------------------------ lifecycle

    async def async_start(self) -> None:
        self.face = await self.hass.async_add_executor_job(_load_face)
        self.expressions = set(self.face["expressions"])
        self.animations = set(self.face["animations"])
        self.types = await self.hass.async_add_executor_job(_load_types)
        self.pictures_rev = await self.hass.async_add_executor_job(picture_store(self.hass).rev)
        self._apply(await self.store.async_load(self.face, self.entry.options, self.types))
        self._unsubs.append(self.hass.bus.async_listen(
            EVENT_STATE_CHANGED, self._on_state, event_filter=self._relevant))
        self._recompute(react=False)
        self._schedule_idle()

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for u in (self._idle_unsub, self._override_unsub, self._screen_unsub,
                  self._story_unsub, self._repeat_unsub, self._mode_unsub,
                  *self._hold_unsubs.values()):
            if u:
                u()
        self._hold_unsubs.clear()
        self._mode_unsub = None
        self._idle_unsub = self._override_unsub = self._screen_unsub = None
        self._story_unsub = self._repeat_unsub = None
        for u in self._overlay_unsubs.values():
            u()
        self._overlay_unsubs.clear()
        # Tell the cards this engine is gone, so they resubscribe to the next.
        for listener in list(self._listeners):
            listener({"v": SCENE_VERSION, "ended": True})
        self._listeners.clear()

    @callback
    def add_listener(self, listener: Listener) -> CALLBACK_TYPE:
        self._listeners.add(listener)

        @callback
        def remove() -> None:
            self._listeners.discard(listener)
        return remove

    # --------------------------------------------------------------- config

    def _apply(self, cfg: dict[str, Any]) -> None:
        built = build(cfg)
        self.config = cfg
        self._effective_key = None    # the modes may have changed: _recompute rebuilds
        self._set_screens_rev()
        extras = face_extras(cfg)
        self.face_rev = hashlib.sha1(json.dumps(extras, sort_keys=True).encode()).hexdigest()[:10]
        self.expressions = set(self.face["expressions"]) | set(extras["expressions"])
        self.animations = set(self.face["animations"]) | set(extras["animations"])
        if self.screen and not self.screen.get("icon") and not self.screen.get("inline") \
                and self.screen["id"] not in {s["id"] for s in cfg["screens"]}:
            self._clear_screen(None)   # the screen being shown was deleted
        self.signals = built.signals
        self.settings = built.mood
        self.behaviour = built.behaviour
        self._base_personality = built.personality
        self.personality = md.personality(self.effective, built.personality,
                                          self.face.get("personalities") or {})
        self.motion_sensors = {g["entity"]: g["action"] for g in self.behaviour["motion_sensors"]}
        self._mode_signals = tuple(sig for m in cfg["modes"] if HOUSE_MODES
                                   if (sig := md.condition_signal(m)) is not None)
        self.stories = {s["id"]: s for s in cfg["stories"]}
        self.triggers = [t for t in cfg["triggers"] if t["enabled"]]
        self._entity_triggers = [t for t in self.triggers if t["kind"] in ("entity", "motion")]
        self._voice_triggers = [t for t in self.triggers if t["kind"] == "voice"]
        self.voice = {e: v for e, v in self.voice.items() if self._follows(e)}
        self._thresholds = {}
        for t in self._entity_triggers:
            if (eid := trig.threshold_entity(t)) is not None:
                self._thresholds.setdefault(eid, []).append(t)
        self._queue = [q for q in self._queue if q["story"] in self.stories]
        self._relevant_cache.clear()
        # Patterns are resolved against all states once, here (at start and on
        # a save); afterwards only a brand-new entity can add a match. Nothing
        # ever scans every state per change.
        self._signal_entities = {st.entity_id for st in self.hass.states.async_all()
                                 if self._is_signal_entity(st.entity_id)}
        self._signal_entities |= {p for sig in (*self.signals, *self._mode_signals)
                                  for p in sig.entities if not is_pattern(p)}
        # A held rotation that was deleted lets go.
        rot = self.holds.get("rotation")
        if rot and rot != md.PAUSE and rot not in {r["id"] for r in cfg["rotations"]}:
            self._release("rotation")
        for hook in list(self.config_hooks):
            hook()

    @callback
    def apply_config(self, raw: Any) -> dict[str, Any]:
        """Validate, run and save a config from the panel, live: no reload.
        Raises config.ConfigError. A save never plays a reaction."""
        cfg = validate(raw, self.face, self.types)
        self._apply(cfg)
        self.store.save(cfg)
        self._recompute(react=False)
        self._schedule_idle()
        self._schedule_repeat()
        self._push()
        return cfg

    @callback
    def reset_config(self, section: str | None = None) -> dict[str, Any]:
        return self.apply_config(reset(self.config, section))

    @callback
    def preview(self, raw: Any) -> dict[str, Any]:
        """What a draft config would make of the house right now, unsaved:
        each signal's entities and whether it is active, and the mood. Only
        on an admin's request from the panel, so the full scan is fine."""
        cfg = validate(raw, self.face, self.types)
        built = build(cfg)
        ids = self.hass.states.async_entity_ids()
        results, out = [], []
        for sig in built.signals:
            names = matching(sig.entities, ids)
            states = {e: st.state for e in names if (st := self.hass.states.get(e))}
            res = evaluate(sig, states)
            results.append(res)
            ents = []
            for e in names[:PREVIEW_ENTITIES]:
                st = self.hass.states.get(e)
                ents.append({"entity_id": e, "state": st.state if st else None,
                             "name": st.name if st else None,
                             "unit": st.attributes.get("unit_of_measurement") if st else None,
                             "passing": e in res.entities})
            out.append({"id": sig.id, "active": res.active, "count": len(names),
                        "entities": ents})
        mood = combine(results, built.mood)
        return {"config": cfg, "signals": out, "mood": {
            "level": mood.level, "score": mood.score, "expression": mood.expression,
            "energy": self._biased(mood.energy, built.personality), "reason": mood.reason}}

    # -------------------------------------------------------------- reading

    def _is_signal_entity(self, entity_id: str) -> bool:
        """A signal's entity, or a mode condition's: both feed _recompute."""
        return any(watches(s, entity_id) for s in (*self.signals, *self._mode_signals))

    @callback
    def _relevant(self, event_data: Any) -> bool:
        eid = event_data["entity_id"]
        hit = self._relevant_cache.get(eid)
        if hit is None:
            hit = (eid in self.motion_sensors or self._is_signal_entity(eid)
                   or eid in self._thresholds
                   or (eid.startswith(SATELLITE)
                       and (self.config["voice"]["enabled"] or bool(self._voice_triggers)))
                   or any(trig.watches(t, eid) for t in self._entity_triggers))
            self._relevant_cache[eid] = hit
        return hit

    def _signal_states(self) -> dict[str, str]:
        get = self.hass.states.get
        return {eid: st.state for eid in self._signal_entities if (st := get(eid)) is not None}

    @callback
    def _on_state(self, event: Event) -> None:
        eid = event.data["entity_id"]
        new, old = event.data.get("new_state"), event.data.get("old_state")
        if eid in self.motion_sensors and new is not None and new.state == "on" \
                and (old is None or old.state != "on"):
            self._motion(eid)
        if eid not in self._signal_entities and self._is_signal_entity(eid):
            self._signal_entities.add(eid)
        fired: list[tuple[dict[str, Any], tuple[str, ...]]] = []
        if eid in self._signal_entities:
            fired = self._recompute(react=True)
        if self._entity_triggers:
            ns, os_ = (new.state if new else None), (old.state if old else None)
            fired += [(t, ()) for t in self._entity_triggers
                      if trig.watches(t, eid)
                      and trig.entity_fires(t, os_, ns, *self._limits(t))
                      and (t["kind"] != "motion" or not t["only_if_bad"]
                           or (self.mood and self.mood.bad))]
        # A threshold entity moved: its triggers re-check their entities against it.
        for t in self._thresholds.get(eid, ()):
            ns, os_ = (new.state if new else None), (old.state if old else None)
            for e in self._trigger_states(t):
                if trig.entity_fires(t, e, e, ns, os_) and all(t is not f for f, _ in fired):
                    fired.append((t, ()))
                    break
        if eid.startswith(SATELLITE):
            fired += self._voice_change(eid, old.state if old else None,
                                        new.state if new else None)
        if fired:
            self._fire(fired)

    # -------------------------------------------------------------- voice

    def _follows(self, entity_id: str) -> bool:
        """Whether Alfie takes the face role for this satellite."""
        v = self.config.get("voice") or {}
        return bool(v.get("enabled")) and (not v.get("satellites") or entity_id in v["satellites"])

    @callback
    def _voice_change(self, eid: str, old: str | None,
                      new: str | None) -> list[tuple[dict[str, Any], tuple[str, ...]]]:
        """A satellite moved: follow it in the scene, fire its event, and
        return the voice triggers its new phase fires."""
        phase = trig.voice_phase(old, new)
        if phase is None:
            return []
        self.hass.bus.async_fire(EVENT_VOICE, {"satellite": eid, "phase": phase})
        _LOGGER.debug("voice %s: %s", eid, phase)
        if self._follows(eid):
            v = self.config["voice"]
            if phase == "done":
                self.voice.pop(eid, None)
                if not self.voice and self.screen and self.screen.get("hold"):
                    self._linger()
                if v["after"] and not self.asleep and not self.voice:
                    st = self.hass.states.get(eid)
                    self.play(v["after"], f"Voice: {st.name if st else eid} is done.", "voice",
                              push=False)
            elif not self.asleep or v["while_asleep"]:
                st = self.hass.states.get(eid)
                self.voice[eid] = {"state": phase, "since": time.time(),
                                   "name": st.name if st else eid}
            self._push()
        return [(t, ()) for t in self._voice_triggers if trig.voice_fires(t, eid, phase)]

    def _voice_scene(self) -> dict[str, Any]:
        v = self.config.get("voice") or {}
        return {"satellites": {e: dict(x) for e, x in self.voice.items()},
                "look": {k: v.get(k) for k in ("listening_expression", "listening_animation",
                                                "processing_animation", "speak_style",
                                                "speak_strength")}}

    @callback
    def speak(self, text: str, targets: list[str] | None = None,
              tts_entity: str = "", language: str = "") -> list[str]:
        """Say `text` out loud, without waiting: satellites announce it, media
        players get TTS. With no targets, the Voice settings' speakers, else
        every satellite he follows. Returns where it went."""
        v = self.config["voice"]
        targets = list(targets or v["speak_targets"])
        if not targets:
            targets = [e for e in self.hass.states.async_entity_ids("assist_satellite")
                       if self._follows(e)]
        sats = [t for t in targets if t.startswith(SATELLITE)]
        players = [t for t in targets if t.startswith("media_player.")]
        if sats:
            self.hass.async_create_task(self.hass.services.async_call(
                "assist_satellite", "announce", {"message": text},
                target={"entity_id": sats}, blocking=False))
        if players:
            tts = tts_entity or v["tts_entity"] or next(
                iter(self.hass.states.async_entity_ids("tts")), "")
            if not tts:
                _LOGGER.warning("Alfie can't say %r: no TTS engine is set up", text)
                players = []
            else:
                data: dict[str, Any] = {"message": text, "media_player_entity_id": players}
                if language or v["language"]:
                    data["language"] = language or v["language"]
                self.hass.async_create_task(self.hass.services.async_call(
                    "tts", "speak", data, target={"entity_id": tts}, blocking=False))
        if not sats and not players:
            _LOGGER.info("Alfie had nothing to say %r on", text)
        return [*sats, *players]

    def _limits(self, t: dict[str, Any]) -> tuple[Any, Any]:
        """A trigger's threshold now, twice (it didn't move), or Nones for a fixed value."""
        eid = trig.threshold_entity(t)
        if eid is None:
            return None, None
        st = self.hass.states.get(eid)
        return (st.state, st.state) if st is not None else (None, None)

    def _trigger_states(self, t: dict[str, Any]) -> list[str]:
        """The states of a trigger's entities now (named ones; a pattern's
        matches are only looked up when a threshold moves, which is rare)."""
        get = self.hass.states.get
        out = [st.state for e in t["entities"] if not is_pattern(e) and (st := get(e))]
        if any(is_pattern(e) for e in t["entities"]):
            out += [st.state for st in self.hass.states.async_all() if trig.watches(t, st.entity_id)]
        return out

    # ------------------------------------------------------------- thinking

    @property
    def mode_id(self) -> str:
        """The house mode now, "normal" when none."""
        return self.active["id"] if self.active else md.NORMAL

    @property
    def alfie_state(self) -> str:
        """What the house mode makes Alfie: awake, asleep, quiet or hidden."""
        return self.effective["alfie"] if self.effective else "awake"

    @property
    def quiet(self) -> bool:
        """Quiet or hidden: no fidgets, no glances."""
        return self.alfie_state in ("quiet", "hidden")

    @callback
    def _recompute(self, react: bool) -> list[tuple[dict[str, Any], tuple[str, ...]]]:
        """Re-evaluate the house mode and the mood. With `react`, returns the
        mood, signal, wake and mode triggers this change fires (each with the
        signals behind it), for the caller to coalesce with its own; it never
        plays them."""
        old, old_mode = self.mood, self.mode_id
        states = self._signal_states()
        mode, self.mode_why = (md.choose(self.config["modes"], states, self.mode)
                               if HOUSE_MODES else (None, None))
        key = (mode["id"] if mode else None, tuple(sorted(self.holds.items())))
        if key != self._effective_key:
            self.active, self._effective_key = mode, key
            self.effective = mode = md.with_holds(mode, self.holds)
            self.personality = md.personality(mode, self._base_personality,
                                              self.face.get("personalities") or {})
            if self.config.get("modes") is not None and self._unsubs:
                self._schedule_idle()      # the mode may change the fidget rate
        mode = self.effective
        # A mode may hold back lesser bad news, and set a floor or a fixed mood.
        results = [SignalResult(r.signal, False) if r.active and r.signal.kind == "bad"
                   and md.held_back(mode, r.signal.severity) else r
                   for r in evaluate_all(self.signals, states)]
        mood = combine(results, self.settings)
        level = md.mood_level(mode, mood.level)
        if level != mood.level:
            mood = Mood(level, mood.score, self.settings.expressions[level],
                        self.settings.energy[level], mood.bad, mood.good)
        asleep = self.alfie_state == "asleep" and not md.wakes(
            mode, [r.signal.severity for r in mood.bad])
        changed = (old is None or old.level != mood.level or asleep != self.asleep
                   or old_mode != self.mode_id
                   or {r.signal.id for r in old.bad} != {r.signal.id for r in mood.bad}
                   or {r.signal.id for r in old.good} != {r.signal.id for r in mood.good})
        woke, slept = self.asleep and not asleep, asleep and not self.asleep
        self.mood, self.asleep = mood, asleep
        if not changed:
            return []
        if old is not None:
            self._signal_events(old, mood)
        _LOGGER.debug("mode %s, mood %s (%s) asleep=%s: %s", self.mode_id, mood.level, mood.score,
                      asleep, mood.reason)
        now = time.monotonic()
        bad_now = {r.signal.id for r in mood.bad}
        self._bad_since = {s: self._bad_since.get(s, now) for s in bad_now}
        self._schedule_repeat()
        fired: list[tuple[dict[str, Any], tuple[str, ...]]] = []
        if react and old is not None:
            bad_then = {r.signal.id for r in old.bad}
            went_bad, recovered = bad_now - bad_then, bad_then - bad_now
            changed_ids = tuple(sorted(
                went_bad | recovered
                | ({r.signal.id for r in mood.good} ^ {r.signal.id for r in old.good})))
            self._old_expression = old.expression
            for t in self.triggers:
                k = t["kind"]
                if k == "mood" and trig.mood_fires(t, old.level, mood.level):
                    fired.append((t, changed_ids))
                elif k == "signal" and (ids := trig.signal_fires(t, went_bad, recovered)):
                    fired.append((t, tuple(ids)))
                elif k == "wake" and trig.wake_fires(t, woke, slept):
                    fired.append((t, changed_ids))
                elif k == "mode" and trig.mode_fires(t, old_mode, self.mode_id):
                    fired.append((t, ()))
        self._push()
        return fired

    @callback
    def _motion(self, entity_id: str) -> None:
        if self.asleep or self.quiet:
            return
        now = time.monotonic()
        if now - self._last_motion < self.behaviour["motion_debounce"]:
            return
        action = self.motion_sensors[entity_id]
        if action == NOTICE:
            if not self.behaviour["notice"]:
                return
            name = random.choice(self.behaviour["notice"])
        else:
            name = action
        self._last_motion = now
        st = self.hass.states.get(entity_id)
        where = st.name if st is not None else entity_id
        self.play(name, f"Movement: {where}.", "motion")
        # Walk-in replays: a bad signal that asks for it tells its news again.
        for r in (self.mood.bad if self.mood else ()):
            rep = self._repeat_of(r.signal.id)
            if rep and rep["on_motion"] and \
                    now - self._repeated.get(r.signal.id, -1e9) > REPEAT_GAP:
                self._repeated[r.signal.id] = now
                self._queue_repeat(r.signal.id, rep["story"], f"Still: {r.signal.name}.")
                break

    def _schedule_idle(self) -> None:
        if self._idle_unsub:
            self._idle_unsub()
        self._idle_unsub = None
        rate = self.personality.get("fidget_rate", 1.0)
        if rate <= 0 or not self.behaviour.get("idle_fidgets"):
            return            # a save that turns fidgets back on reschedules
        # Lively Alfie fidgets more often; a miserable one barely moves.
        delay = (self.behaviour["idle_interval"] * (0.8 / max(self.energy, 0.1)) / rate
                 * random.uniform(0.7, 1.3))
        self._idle_unsub = async_call_later(self.hass, max(delay, 5.0), self._idle)

    @callback
    def _idle(self, _now: Any) -> None:
        self._idle_unsub = None
        if not self.asleep and not self.quiet and time.monotonic() - self._last_anim > IDLE_QUIET_AFTER:
            self.play(random.choice(self.behaviour["idle_fidgets"]), "Idle fidget.", "idle")
        self._schedule_idle()

    # -------------------------------------------------------------- doing

    @property
    def expression(self) -> str:
        if self.override:
            return self.override
        if self.story and self.story.get("expression"):
            return self.story["expression"]
        if self.asleep:
            return self.behaviour.get("sleep_expression", "closed")
        return self.mood.expression if self.mood else "neutral"

    @staticmethod
    def _biased(energy: float, personality: dict[str, float]) -> float:
        return round(min(1.5, max(0.05, energy + personality.get("energy_bias", 0.0))), 3)

    @property
    def energy(self) -> float:
        if self.asleep:
            return SLEEP_ENERGY
        e = self._biased(self.mood.energy if self.mood else 0.8, self.personality)
        return round(e * md.QUIET_ENERGY, 3) if self.quiet else e

    @callback
    def play(self, name: str, reason: str = "", source: str = "service",
             push: bool = True) -> None:
        if name not in self.animations:
            raise ValueError(f"unknown animation {name!r}")
        self._anim_id += 1
        self._last_anim = time.monotonic()
        self.animation = {"name": name, "id": self._anim_id, "at": time.time(),
                          "reason": reason, "source": source}
        self.hass.bus.async_fire(EVENT_ANIMATION, {"animation": name, "reason": reason,
                                                   "source": source})
        if push:
            self._push()

    @callback
    def set_expression(self, expression: str, duration: float | None = None) -> None:
        if self._override_unsub:
            self._override_unsub()
            self._override_unsub = None
        if expression == "auto":
            self.override = None
        elif expression not in self.expressions:
            raise ValueError(f"unknown expression {expression!r}")
        else:
            self.override = expression
            if duration:
                @callback
                def clear(_now: Any) -> None:
                    self._override_unsub = None
                    self.override = None
                    self._push()
                self._override_unsub = async_call_later(self.hass, duration, clear)
        self._push()

    @callback
    def set_mode(self, mode: str, duration: float | None = None) -> None:
        """select.alfie_mode, or alfie.set_mode: for `duration` seconds, then
        back to what was picked before."""
        if self._mode_unsub:
            self._mode_unsub()
            self._mode_unsub = None
        before = self.mode
        self.mode = mode
        if duration:
            @callback
            def back(_now: Any) -> None:
                self._mode_unsub = None
                self.set_mode(before if before != mode else md.AUTO)
            self._mode_unsub = async_call_later(self.hass, duration, back)
        self._react()

    @callback
    def _react(self) -> None:
        fired = self._recompute(react=True)
        if fired:
            self._fire(fired)
        self._push()

    def hold_choices(self, kind: str) -> list[str]:
        """What `kind` may be held at (besides auto, which lets go)."""
        if kind == "mood":
            return list(LEVELS)
        if kind == "alfie":
            return list(md.ALFIE_STATES)
        if kind == "rotation":
            return [md.PAUSE, *(r["id"] for r in self.config.get("rotations", []))]
        return list((self.face.get("personalities") or {}).keys())

    @callback
    def hold(self, kind: str, value: str, duration: float | None = None) -> None:
        """An automation holds one of the mode's overrides (modes.HOLDS) for
        `duration` seconds, or until changed; `auto` lets go. Raises ValueError."""
        if value == md.AUTO:
            self._release(kind)
            self._react()
            return
        if value not in self.hold_choices(kind):
            raise ValueError(f"{kind} can't be {value!r}: one of auto, {', '.join(self.hold_choices(kind))}")
        if (u := self._hold_unsubs.pop(kind, None)) is not None:
            u()
        self.holds[kind] = value
        self.hold_until[kind] = time.time() + duration if duration else None
        if duration:
            @callback
            def done(_now: Any) -> None:
                self._hold_unsubs.pop(kind, None)
                self._release(kind)
                self._react()
            self._hold_unsubs[kind] = async_call_later(self.hass, duration, done)
        self._react()

    def _release(self, kind: str) -> None:
        if (u := self._hold_unsubs.pop(kind, None)) is not None:
            u()
        self.holds.pop(kind, None)
        self.hold_until.pop(kind, None)

    def switchable(self) -> list[tuple[str, str]]:
        """[(item, name)] that alfie.set_enabled can turn on and off:
        signal.<id> and trigger.<id>."""
        return [(f"{k}.{x['id']}", f"{'Signal' if k == 'signal' else 'Trigger'}: {x.get('name') or x['id']}")
                for k, sec in (("signal", "signals"), ("trigger", "triggers"))
                for x in self.config.get(sec, [])]

    @callback
    def set_enabled(self, item: str, enabled: bool) -> None:
        """Turn a signal or trigger on or off, saved, as the panel's switch
        does. `item` is signal.<id> or trigger.<id>, or a bare id that only
        one of them has. Raises ValueError."""
        kind, _, iid = item.partition(".") if "." in item else ("", "", item)
        found = [(sec, x) for k, sec in (("signal", "signals"), ("trigger", "triggers"))
                 if kind in ("", k) for x in self.config.get(sec, []) if x["id"] == iid]
        if len(found) != 1:
            raise ValueError(f"no single signal or trigger {item!r}" if found
                             else f"no signal or trigger {item!r}")
        sec, x = found[0]
        if x["enabled"] == enabled:
            return
        cfg = json.loads(json.dumps(self.config))
        next(y for y in cfg[sec] if y["id"] == iid)["enabled"] = enabled
        self.apply_config(cfg)

    def _signal_events(self, old: Mood, new: Mood) -> None:
        """alfie_signal for each signal whose state changed: bad, good or clear."""
        def states(m: Mood) -> dict[str, tuple[Signal, str]]:
            return {**{r.signal.id: (r.signal, "good") for r in m.good},
                    **{r.signal.id: (r.signal, "bad") for r in m.bad}}
        then, now = states(old), states(new)
        for sid in sorted(then.keys() | now.keys()):
            was, st = then.get(sid, (None, "clear"))[1], now.get(sid, (None, "clear"))[1]
            if was == st:
                continue
            sig = (now.get(sid) or then[sid])[0]
            self.hass.bus.async_fire(EVENT_SIGNAL, {"signal": sid, "name": sig.name, "kind": sig.kind,
                                                    "severity": sig.severity, "state": st, "was": was})

    # ------------------------------------------------------------ stories

    def _repeat_of(self, signal_id: str) -> dict[str, Any] | None:
        for s in self.config.get("signals", []):
            if s["id"] == signal_id:
                return s.get("repeat")
        return None

    def _screens_of(self, signal_ids: Any) -> tuple[str, ...]:
        """The screens linked to these signals, each once, that still exist."""
        have = {s["id"] for s in self.config.get("screens", [])}
        by_id = {s.id: s for s in self.signals}
        out: list[str] = []
        for sid in signal_ids:
            sc = by_id[sid].screen if sid in by_id else None
            if sc and sc in have and sc not in out:
                out.append(sc)
        return tuple(out)

    def _note(self, trigger_id: str, outcome: str) -> None:
        self.trigger_status[trigger_id] = {"at": time.time(), "outcome": outcome}

    @callback
    def _fire(self, fired: list[tuple[dict[str, Any], tuple[str, ...]]]) -> None:
        """Triggers fired by one change: one plays (the highest priority)."""
        level = self.mood.level if self.mood else "content"
        old_expression, self._old_expression = self._old_expression, None
        now = time.monotonic()
        ok = []
        off = set(self.effective["triggers_off"]) if self.effective else set()
        for t, why in fired:
            if t["id"] in off or not trig.allowed(t, level, self.asleep):
                continue
            if t["cooldown"] and now - self._last_fired.get(t["id"], -1e9) < t["cooldown"]:
                self._note(t["id"], "cooldown")
                continue
            ok.append((t, why))
        t = trig.choose([t for t, _ in ok])
        if t is None:
            return
        why = next(w for x, w in ok if x is t)
        for other, _ in ok:
            if other is not t:
                self._note(other["id"], "outranked")
        self._last_fired[t["id"]] = now
        self.request_story(t["story"], priority=t["priority"], busy=t["busy"],
                           trigger=t["id"], reason=t["name"], why=why,
                           old_expression=old_expression)

    @callback
    def _queue_repeat(self, signal_id: str, story_id: str, reason: str) -> None:
        if story_id in self.stories:
            self.request_story(story_id, priority=20, busy="queue",
                               trigger=f"repeat:{signal_id}", reason=reason, why=(signal_id,))

    @callback
    def request_story(self, story_id: str, priority: int = 50, busy: str = "auto",
                      trigger: str = "service", reason: str = "",
                      why: tuple[str, ...] = (), story: dict[str, Any] | None = None,
                      old_expression: str | None = None) -> str:
        """Play a story now, after the current one, or not at all, by the
        busy rules (triggers.busy_action). `story` plays an unsaved draft.
        Returns the outcome. Raises ValueError for an unknown story."""
        if story is None and story_id not in self.stories:
            raise ValueError(f"unknown story {story_id!r}")
        req = {"story": story_id, "draft": story, "priority": priority, "trigger": trigger,
               "reason": reason, "why": tuple(why), "at": time.monotonic(),
               "old_expression": old_expression}
        playing = self.story["priority"] if self.story else None
        outcome = trig.busy_action(busy, priority, playing)
        if outcome == "interrupt":
            self._end_story("interrupted", run_queue=False)
            self._start_story(req)
        elif outcome == "play":
            self._start_story(req)
        elif outcome == "queue":
            self._queue.append(req)
            self._queue.sort(key=lambda q: -q["priority"])   # stable: FIFO within one
            del self._queue[QUEUE_MAX:]
        self._note(trigger, {"play": "played", "interrupt": "played"}.get(outcome, outcome))
        return outcome

    def _anim_seconds(self, name: str) -> float:
        rate = play_rate(self.energy, self.personality.get("speed", 1.0))
        return animation_length(self.face, name) / max(rate, 0.05) + ANIMATION_SLACK

    def _context(self, why: Any, old_expression: str | None = None) -> Context:
        """The moment a story plays in: the mood's face and what is wrong."""
        m = self.mood
        mood_expr = m.expression if m else "neutral"
        return Context(mood_expression=mood_expr,
                       old_mood_expression=old_expression or mood_expr,
                       why=self._screens_of(why),
                       wrong=self._screens_of(r.signal.id for r in (m.bad if m else ())),
                       name=self.name, level=m.level if m else "content",
                       reason=m.reason if m else "",
                       wrong_names=tuple(r.signal.name for r in (m.bad if m else ())))

    def appear_story(self) -> str:
        """The most relevant story for Alfie appearing in a rotation, mood-led:
        the bad one while something is wrong, otherwise the ok one ("" none)."""
        b = self.config["behaviour"]
        bad = bool(self.mood and self.mood.bad)
        return b.get("appear_story_bad" if bad else "appear_story_ok", "")

    def expand_story(self, story_id: str) -> list[Action]:
        """A story's timed actions for one card to play by itself (an Alfie
        step in its rotation). Nothing plays here, no state or event. With no
        change to explain, @why is what sets his mood now: what is wrong, or
        while nothing is, what is right. ValueError if unknown."""
        story = self.stories.get(story_id)
        if story is None:
            raise ValueError(f"unknown story {story_id!r}")
        m = self.mood
        why = [r.signal.id for r in ((m.bad or m.good) if m else ())]
        return expand(steps_of(story), self._context(why), self._anim_seconds)

    @callback
    def _start_story(self, req: dict[str, Any]) -> None:
        story = req["draft"] or self.stories.get(req["story"])
        if story is None:
            return
        actions = expand(steps_of(story), self._context(req["why"], req["old_expression"]),
                         self._anim_seconds)
        self._story_seq += 1
        self.story = {"id": story["id"], "name": story["name"], "seq": self._story_seq,
                      "trigger": req["trigger"], "reason": req["reason"] or story["name"],
                      "priority": req["priority"], "actions": actions, "step": 0,
                      "expression": None, "blend": 0, "place": None}
        _LOGGER.debug("story %s starts (%s): %s", story["id"], req["trigger"],
                      [(a.kind, a.value if a.kind != "screen" else a.value["id"], a.seconds)
                       for a in actions])
        self.hass.bus.async_fire(EVENT_STORY, {"story": story["id"], "trigger": req["trigger"],
                                               "phase": "start"})
        self._run_story(self._story_seq)

    @callback
    def _run_story(self, seq: int) -> None:
        """Do the story's actions up to the next one that takes time, push
        once, and set one timer for it."""
        self._story_unsub = None
        st = self.story
        if st is None or st["seq"] != seq:
            return
        acts: list[Action] = st["actions"]
        while st["step"] < len(acts):
            a = acts[st["step"]]
            st["step"] += 1
            if a.kind != "screen" and self.screen and self.screen.get("story"):
                self._clear_screen(None)
            if a.kind == "expression":
                if a.value["name"] in self.expressions:
                    st["expression"], st["blend"] = a.value["name"], a.value["blend"]
            elif a.kind == "animation":
                self.play(a.value, st["reason"], "story", push=False)
            elif a.kind == "screen":
                self._present(a.value)
            elif a.kind == "place":
                st["place"] = a.value
            elif a.kind == "icon":
                self._overlay(a.value)
            elif a.kind == "speak":
                self.speak(a.value["text"], a.value["targets"], a.value["tts_entity"])
            if a.seconds > 0:
                self._push()
                self._story_unsub = async_call_later(
                    self.hass, a.seconds, callback(lambda _now: self._run_story(seq)))
                return
        self._end_story("end")

    @callback
    def _present(self, step: dict[str, Any]) -> None:
        icon = step.get("icon")
        if not icon and step["id"] not in {s["id"] for s in self.config.get("screens", [])}:
            return
        if self._screen_unsub:
            self._screen_unsub()
            self._screen_unsub = None
        self._screen_seq += 1
        self.screen = {"id": f"{ICON_SCREEN}:{self._screen_seq}" if icon else step["id"],
                       "until": time.time() + step["seconds"],
                       "seq": self._screen_seq, "story": True,
                       "present": None if step["present"] == "card" else step["present"],
                       "transition": step["transition"] or None}
        if icon:
            self.screen["icon"] = icon
            self._icon_event("show", icon["name"],
                             {"style": "beside" if step["present"] == "corner" else "transform"})

    @callback
    def _end_story(self, phase: str, run_queue: bool = True) -> None:
        st = self.story
        if st is None:
            return
        if self._story_unsub:
            self._story_unsub()
            self._story_unsub = None
        if self.screen and self.screen.get("story"):
            self._clear_screen(None)
        self.story = None
        _LOGGER.debug("story %s %s", st["id"], phase)
        self.hass.bus.async_fire(EVENT_STORY, {"story": st["id"], "trigger": st["trigger"],
                                               "phase": phase})
        if run_queue:
            now = time.monotonic()
            self._queue = [q for q in self._queue if now - q["at"] < QUEUE_STALE]
            if self._queue:
                self._start_story(self._queue.pop(0))
                return
        self._push()

    @callback
    def stop_story(self) -> None:
        """End the story playing now and forget the queue."""
        self._queue.clear()
        self._end_story("interrupted", run_queue=False)
        self._push()

    def _schedule_repeat(self) -> None:
        """One timer for the next "every N hours" replay that is due."""
        if self._repeat_unsub:
            self._repeat_unsub()
            self._repeat_unsub = None
        now, due = time.monotonic(), None
        for sid, since in self._bad_since.items():
            rep = self._repeat_of(sid)
            if not rep or not rep["every_hours"]:
                continue
            at = max(since, self._repeated.get(sid, since)) + rep["every_hours"] * 3600
            due = at if due is None else min(due, at)
        if due is not None:
            self._repeat_unsub = async_call_later(self.hass, max(due - now, 1.0), self._repeat)

    @callback
    def _repeat(self, _now: Any) -> None:
        self._repeat_unsub = None
        now = time.monotonic()
        for r in (self.mood.bad if self.mood else ()):
            sid = r.signal.id
            rep = self._repeat_of(sid)
            if not rep or not rep["every_hours"] or sid not in self._bad_since:
                continue
            last = max(self._bad_since[sid], self._repeated.get(sid, self._bad_since[sid]))
            if now - last >= rep["every_hours"] * 3600 - 1:
                self._repeated[sid] = now
                if not self.asleep:
                    self._queue_repeat(sid, rep["story"], f"Still: {r.signal.name}.")
        self._schedule_repeat()

    # ------------------------------------------------------------ screens

    @callback
    def show_screen(self, screen_id: str, seconds: float) -> None:
        """Every card presents `screen_id` for `seconds`, then goes back to
        what it was doing. Not entity state, so it never writes the recorder."""
        if screen_id not in {s["id"] for s in self.config.get("screens", [])}:
            raise ValueError(f"unknown screen {screen_id!r}")
        if self._screen_unsub:
            self._screen_unsub()
        self._screen_seq += 1
        seq = self._screen_seq
        self.screen = {"id": screen_id, "until": time.time() + seconds, "seq": seq}
        self._screen_unsub = async_call_later(
            self.hass, seconds, callback(lambda _now: self._clear_screen(seq)))
        self._push()

    @callback
    def _clear_screen(self, seq: int | None) -> None:
        """End the presentation (only if it is still `seq`'s; None always)."""
        if self.screen is None or (seq is not None and self.screen["seq"] != seq):
            return
        if self._screen_unsub:
            self._screen_unsub()
        self._screen_unsub = None
        if self.screen.get("icon"):
            self._icon_event("end", self.screen["icon"]["name"],
                             {"style": "beside" if self.screen["present"] == "corner"
                              else "transform"})
        self.screen = None
        if seq is not None:
            self._push()

    @callback
    def show_voice_screen(self, screen: dict[str, Any], seconds: float, hold: bool) -> None:
        """Every card presents a screen made from a voice turn (converse.py):
        while a satellite is still answering (`hold`) until it is done and
        then the voice settings' linger, else for `seconds`. A story or an
        automation's screen beats it. Not entity state."""
        if self.story is not None or (self.screen and not self.screen.get("inline")):
            return
        if self._screen_unsub:
            self._screen_unsub()
        self._screen_seq += 1
        seq = self._screen_seq
        sid = f"{VOICE_SCREEN}:{seq}"
        self._voice_screens[sid] = screen
        for old in list(self._voice_screens)[:-VOICE_SCREENS_KEPT]:
            del self._voice_screens[old]
        present = self.config["voice"]["screen_present"]
        wait = VOICE_HOLD if hold else seconds
        self.screen = {"id": sid, "until": time.time() + wait, "seq": seq, "inline": screen,
                       "present": None if present == "card" else present, "transition": None,
                       "hold": hold}
        self._screen_unsub = async_call_later(
            self.hass, wait, callback(lambda _now: self._clear_screen(seq)))
        self._push()

    @callback
    def music_reaction(self) -> None:
        """Someone asked for music (voice screens): his happy face for a while,
        the music animation, and a note badge beside him. Off by leaving the
        voice settings' music_* empty."""
        v = self.config["voice"]
        anim = v["music_animation"] if v["music_animation"] in self.animations else ""
        seconds = max(self._anim_seconds(anim) if anim else 0.0, 3.0) + 0.5
        if v["music_expression"] and v["music_expression"] in self.expressions:
            self.set_expression(v["music_expression"], seconds)
        if anim:
            self.play(anim, "Voice: music.", "voice", push=False)
        if v["music_icon"]:
            ck = Check()
            icon = check_icon({"icon": v["music_icon"], "style": "overlay", "place": "top_right",
                               "seconds": seconds}, "music", ck)
            if not ck.errors:
                self.show_icon(icon)
        self._push()

    @callback
    def _linger(self) -> None:
        """The satellite is done: the held voice screen stays its linger, then goes."""
        sc = self.screen
        if sc is None:
            return
        seq, wait = sc["seq"], float(self.config["voice"]["linger_seconds"])
        if self._screen_unsub:
            self._screen_unsub()
        self.screen = {**sc, "until": time.time() + wait, "hold": False}
        self._screen_unsub = async_call_later(
            self.hass, wait, callback(lambda _now: self._clear_screen(seq)))

    def _set_screens_rev(self) -> None:
        """Cards refetch screens (and their data) when this changes: the
        screens, the rotations, or any picture."""
        self.screens_rev = hashlib.sha1(json.dumps(
            [self.config["screens"], self.config["rotations"], self.pictures_rev],
            sort_keys=True).encode()).hexdigest()[:10]

    async def pictures_changed(self) -> None:
        """A picture was uploaded, replaced, renamed or deleted: drop the cached
        SVGs and tell the cards, which fetch them again."""
        self.pictures_rev = await self.hass.async_add_executor_job(picture_store(self.hass).rev)
        if (prov := provider_for("picture")) is not None:
            prov.cache = FetchCache()
        self._set_screens_rev()
        self._push()

    async def screen_data(self, screen_id: str) -> dict[str, Any]:
        """The cached provider answer for a screen, fetching if it is stale.
        Raises ValueError for an unknown screen."""
        screen = next((s for s in self.config["screens"] if s["id"] == screen_id), None)
        if screen is None and screen_id in self._voice_screens:
            # One cache key for every voice screen: its options pick the answer.
            screen = {**self._voice_screens[screen_id], "id": VOICE_SCREEN}
        if screen is None:
            raise ValueError(f"unknown screen {screen_id!r}")
        needs = self.types[screen["type"]].get("needs") if screen["type"] in self.types else None
        if needs is None:
            return {"data": None, "at": time.time(), "error": None}
        provider = provider_for(needs)
        if provider is None:
            return {"data": None, "at": time.time(), "error": f"no provider for {needs} yet"}
        return await provider.get(self.hass, screen)

    # -------------------------------------------------------------- icons

    @callback
    def show_icon(self, icon: dict[str, Any]) -> None:
        """Every card shows a (checked, stories.check_icon) icon: he turns
        into it, it shows beside him, or it goes on the card as a badge.
        Like show_screen it is not entity state, so no recorder rows."""
        a = icon_action(icon)
        if a.kind == "icon":
            self._overlay(a.value)
        else:
            if self._screen_unsub:
                self._screen_unsub()
            self._screen_seq += 1
            seq = self._screen_seq
            v = a.value
            self.screen = {"id": f"{ICON_SCREEN}:{seq}", "until": time.time() + v["seconds"],
                           "seq": seq, "present": v["present"],
                           "transition": v["transition"] or None, "icon": v["icon"]}
            self._screen_unsub = async_call_later(
                self.hass, v["seconds"], callback(lambda _now: self._clear_screen(seq)))
            self._icon_event("show", icon["icon"], icon)
        self._push()

    @callback
    def _overlay(self, v: dict[str, Any]) -> None:
        """Add a badge; it clears itself after its seconds (one timer each)."""
        self._screen_seq += 1
        seq = self._screen_seq
        while len(self.overlays) >= OVERLAYS_MAX:
            self._drop_overlay(self.overlays[0]["seq"], push=False)
        self.overlays.append({**v, "seq": seq, "until": time.time() + v["seconds"]})
        self._overlay_unsubs[seq] = async_call_later(
            self.hass, v["seconds"], callback(lambda _now: self._drop_overlay(seq)))
        self._icon_event("show", v["name"], {"style": "overlay", **v})

    @callback
    def _drop_overlay(self, seq: int, push: bool = True) -> None:
        if (u := self._overlay_unsubs.pop(seq, None)) is not None:
            u()
        gone = [o for o in self.overlays if o["seq"] == seq]
        self.overlays = [o for o in self.overlays if o["seq"] != seq]
        for o in gone:
            self._icon_event("end", o["name"], {"style": "overlay"})
        if push and gone:
            self._push()

    @callback
    def clear_icons(self) -> None:
        """Take every icon off the cards: badges, and one he has become."""
        for seq in [o["seq"] for o in self.overlays]:
            self._drop_overlay(seq, push=False)
        if self.screen and self.screen.get("icon"):
            self._clear_screen(None)
        self._push()

    def _icon_event(self, phase: str, name: str, how: dict[str, Any]) -> None:
        self.hass.bus.async_fire(EVENT_ICON, {"icon": name, "phase": phase,
                                              "style": how.get("style") or "transform"})

    # ------------------------------------------------------------ telling

    def scene(self) -> dict[str, Any]:
        m = self.mood
        signals = []
        if m is not None:
            for r in (*m.bad, *m.good):
                s = r.signal
                rep = self._repeat_of(s.id) or {}
                signals.append({"id": s.id, "name": s.name, "kind": s.kind,
                                "severity": s.severity, "entities": list(r.entities),
                                "screen": s.screen, "in_rotation": bool(rep.get("in_rotation"))})
        return {
            "v": SCENE_VERSION,
            "seq": self.seq,
            "name": self.name,
            "mood": {
                "level": m.level if m else "content",
                "score": m.score if m else 0.0,
                "expression": m.expression if m else "neutral",
                "energy": self.energy,
            },
            "expression": self.expression,
            "asleep": self.asleep,
            "gaze": None,
            "animation": self.animation,
            "mode": self.mode_id,
            "mode_pick": self.mode,
            # name None: house modes are off (const.HOUSE_MODES) and the cards say nothing of them.
            "mode_info": {"name": (self.active["name"] if self.active else "Normal") if HOUSE_MODES else None,
                          "alfie": self.alfie_state,
                          "rotation": self.effective["rotation"] if self.effective else "",
                          "why": list(self.mode_why.entities) if self.mode_why else []},
            "personality": {"preset": self.config.get("personality", {}).get("preset"),
                            **self.personality},
            "look": self.config.get("look") or {},
            "signals": signals,
            "reason": "Asleep." if self.asleep else "An automation holds his mood." if "mood" in self.holds
                      else (m.reason if m else ""),
            "story": self._story_scene(),
            "voice": self._voice_scene(),
            "screen": self.screen,
            "icons": self.overlays,
            "screens_rev": self.screens_rev,
            "face_rev": self.face_rev,
            "holds": {k: {"value": v, "until": self.hold_until.get(k)} for k, v in self.holds.items()},
            "now": time.time(),
        }

    def _story_scene(self) -> dict[str, Any] | None:
        st = self.story
        if st is None:
            return None
        return {"id": st["id"], "seq": st["seq"], "step": st["step"],
                "total": len(st["actions"]), "trigger": st["trigger"], "reason": st["reason"],
                "blend": st["blend"], "place": st["place"]}

    @callback
    def _push(self) -> None:
        self.seq += 1
        m = self.mood
        # Entities write state (a recorder row each) only when this changes,
        # never for an animation: fidgets and glances must not churn the DB.
        self.state_key = (m.level if m else None, self.expression, self.asleep, self.mode,
                          self.mode_id, tuple(x["id"] for x in self.config.get("modes", [])),
                          tuple(r.signal.id for r in (*m.bad, *m.good)) if m else ())
        scene = self.scene()
        for listener in list(self._listeners):
            try:
                listener(scene)
            except Exception:  # one broken listener must not silence the rest
                _LOGGER.exception("Alfie listener failed")
