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

from . import triggers as trig
from .config import NOTICE, build, reset, validate
from .const import (
    CONF_NAME,
    DEFAULT_NAME,
    EVENT_ANIMATION,
    EVENT_STORY,
    FACE_FILE,
    SCENE_VERSION,
)
from .mood import Mood, MoodSettings, combine
from .providers import provider_for
from .screen_types import load_types
from .signals import Signal, evaluate, evaluate_all, is_pattern, matching, watches
from .stories import Action, Context, animation_length, expand, play_rate, steps_of
from .store import AlfieStore

_LOGGER = logging.getLogger(__name__)

SLEEP_ENERGY = 0.15
IDLE_QUIET_AFTER = 10.0      # seconds after any animation before a fidget may play
PREVIEW_ENTITIES = 25        # per signal, in a panel preview
QUEUE_MAX = 3                # stories waiting behind the one playing
QUEUE_STALE = 60.0           # seconds a queued story may wait before it is dropped
REPEAT_GAP = 900.0           # seconds between one signal's walk-in replays
ANIMATION_SLACK = 0.25       # seconds added to an animation a story waits for

Listener = Callable[[dict[str, Any]], None]


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
        self.signals: tuple[Signal, ...] = ()
        self.settings = MoodSettings()
        self.behaviour: dict[str, Any] = {}
        self.personality: dict[str, float] = {}
        self.gaze_map: dict[str, str] = {}
        self.sleep_entity: str | None = None

        self.expressions: set[str] = set()
        self.animations: set[str] = set()
        self.mode = "auto"
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
        self._relevant_cache: dict[str, bool] = {}
        self._signal_entities: set[str] = set()   # resolved, patterns included
        self.state_key: tuple = ()                # what the entities show; see _push

        # Triggers and stories (triggers.py, stories.py). None of this is
        # entity state: a story never writes the recorder.
        self.stories: dict[str, dict[str, Any]] = {}
        self.triggers: list[dict[str, Any]] = []        # enabled ones only
        self._entity_triggers: list[dict[str, Any]] = []
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

    # ------------------------------------------------------------ lifecycle

    async def async_start(self) -> None:
        self.face = await self.hass.async_add_executor_job(_load_face)
        self.expressions = set(self.face["expressions"])
        self.animations = set(self.face["animations"])
        self.types = await self.hass.async_add_executor_job(_load_types)
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
                  self._story_unsub, self._repeat_unsub):
            if u:
                u()
        self._idle_unsub = self._override_unsub = self._screen_unsub = None
        self._story_unsub = self._repeat_unsub = None
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
        self.screens_rev = hashlib.sha1(json.dumps(
            [cfg["screens"], cfg["rotations"]], sort_keys=True).encode()).hexdigest()[:10]
        if self.screen and self.screen["id"] not in {s["id"] for s in cfg["screens"]}:
            self._clear_screen(None)   # the screen being shown was deleted
        self.signals = built.signals
        self.settings = built.mood
        self.behaviour = built.behaviour
        self.personality = built.personality
        self.gaze_map = {g["entity"]: g["action"] for g in self.behaviour["gaze_map"]}
        self.sleep_entity = self.behaviour["sleep_entity"] or None
        self.stories = {s["id"]: s for s in cfg["stories"]}
        self.triggers = [t for t in cfg["triggers"] if t["enabled"]]
        self._entity_triggers = [t for t in self.triggers if t["kind"] in ("entity", "motion")]
        self._queue = [q for q in self._queue if q["story"] in self.stories]
        self._relevant_cache.clear()
        # Patterns are resolved against all states once, here (at start and on
        # a save); afterwards only a brand-new entity can add a match. Nothing
        # ever scans every state per change.
        self._signal_entities = {st.entity_id for st in self.hass.states.async_all()
                                 if self._is_signal_entity(st.entity_id)}
        self._signal_entities |= {p for sig in self.signals for p in sig.entities
                                  if not is_pattern(p)}

    @callback
    def apply_config(self, raw: Any) -> dict[str, Any]:
        """Validate, run and save a config from the panel, live: no reload.
        Raises config.ConfigError. A save never plays a reaction."""
        cfg = validate(raw, self.face, self.types)
        self._apply(cfg)
        self.store.save(cfg)
        self._recompute(react=False)
        if self._idle_unsub:
            self._idle_unsub()
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
        return {"signals": out, "mood": {
            "level": mood.level, "score": mood.score, "expression": mood.expression,
            "energy": self._biased(mood.energy, built.personality), "reason": mood.reason}}

    # -------------------------------------------------------------- reading

    def _is_signal_entity(self, entity_id: str) -> bool:
        return any(watches(s, entity_id) for s in self.signals)

    @callback
    def _relevant(self, event_data: Any) -> bool:
        eid = event_data["entity_id"]
        hit = self._relevant_cache.get(eid)
        if hit is None:
            hit = (eid in self.gaze_map or eid == self.sleep_entity
                   or self._is_signal_entity(eid)
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
        if eid in self.gaze_map and new is not None and new.state == "on" \
                and (old is None or old.state != "on"):
            self._motion(eid)
        if eid not in self._signal_entities and self._is_signal_entity(eid):
            self._signal_entities.add(eid)
        fired: list[tuple[dict[str, Any], tuple[str, ...]]] = []
        if eid == self.sleep_entity or eid in self._signal_entities:
            fired = self._recompute(react=True)
        if self._entity_triggers:
            ns, os_ = (new.state if new else None), (old.state if old else None)
            fired += [(t, ()) for t in self._entity_triggers
                      if trig.watches(t, eid) and trig.entity_fires(t, os_, ns)
                      and (t["kind"] != "motion" or not t["only_if_bad"]
                           or (self.mood and self.mood.bad))]
        if fired:
            self._fire(fired)

    # ------------------------------------------------------------- thinking

    def _sleep_wanted(self) -> bool:
        if self.mode == "night":
            return True
        if self.mode != "auto" or not self.sleep_entity:
            return False
        st = self.hass.states.get(self.sleep_entity)
        return st is not None and st.state == "on"

    @callback
    def _recompute(self, react: bool) -> list[tuple[dict[str, Any], tuple[str, ...]]]:
        """Re-evaluate the mood. With `react`, returns the mood, signal and
        wake triggers this change fires (each with the signals behind it),
        for the caller to coalesce with its own; it never plays them."""
        old = self.mood
        mood = combine(evaluate_all(self.signals, self._signal_states()), self.settings)
        critical = mood.level == "miserable"
        asleep = self._sleep_wanted() and not critical   # only critical wakes him
        changed = (old is None or old.level != mood.level or asleep != self.asleep
                   or {r.signal.id for r in old.bad} != {r.signal.id for r in mood.bad}
                   or {r.signal.id for r in old.good} != {r.signal.id for r in mood.good})
        woke, slept = self.asleep and not asleep, asleep and not self.asleep
        self.mood, self.asleep = mood, asleep
        if not changed:
            return []
        _LOGGER.debug("mood %s (%s) asleep=%s: %s", mood.level, mood.score, asleep, mood.reason)
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
        self._push()
        return fired

    @callback
    def _motion(self, entity_id: str) -> None:
        if self.asleep:
            return
        now = time.monotonic()
        if now - self._last_motion < self.behaviour["motion_debounce"]:
            return
        action = self.gaze_map[entity_id]
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
                self._queue_repeat(r.signal.id, rep["story"], f"Still: {r.signal.label}.")
                break

    def _schedule_idle(self) -> None:
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
        if not self.asleep and time.monotonic() - self._last_anim > IDLE_QUIET_AFTER:
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
        return self._biased(self.mood.energy if self.mood else 0.8, self.personality)

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
    def set_mode(self, mode: str) -> None:
        self.mode = mode
        fired = self._recompute(react=True)
        if fired:
            self._fire(fired)
        self._push()

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
        for t, why in fired:
            if not trig.allowed(t, level, self.asleep):
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

    @callback
    def _start_story(self, req: dict[str, Any]) -> None:
        story = req["draft"] or self.stories.get(req["story"])
        if story is None:
            return
        m = self.mood
        mood_expr = m.expression if m else "neutral"
        ctx = Context(mood_expression=mood_expr,
                      old_mood_expression=req["old_expression"] or mood_expr,
                      why=self._screens_of(req["why"]),
                      wrong=self._screens_of(r.signal.id for r in (m.bad if m else ())))
        actions = expand(steps_of(story), ctx, self._anim_seconds)
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
            elif a.kind == "speak":
                _LOGGER.debug("story %s would say %r (speaking comes with Voice)",
                              st["id"], a.value)
            if a.seconds > 0:
                self._push()
                self._story_unsub = async_call_later(
                    self.hass, a.seconds, callback(lambda _now: self._run_story(seq)))
                return
        self._end_story("end")

    @callback
    def _present(self, step: dict[str, Any]) -> None:
        if step["id"] not in {s["id"] for s in self.config.get("screens", [])}:
            return
        if self._screen_unsub:
            self._screen_unsub()
            self._screen_unsub = None
        self._screen_seq += 1
        self.screen = {"id": step["id"], "until": time.time() + step["seconds"],
                       "seq": self._screen_seq, "story": True,
                       "present": None if step["present"] == "card" else step["present"],
                       "transition": step["transition"] or None}

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
                    self._queue_repeat(sid, rep["story"], f"Still: {r.signal.label}.")
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
        self.screen = None
        if seq is not None:
            self._push()

    async def screen_data(self, screen_id: str) -> dict[str, Any]:
        """The cached provider answer for a screen, fetching if it is stale.
        Raises ValueError for an unknown screen."""
        screen = next((s for s in self.config["screens"] if s["id"] == screen_id), None)
        if screen is None:
            raise ValueError(f"unknown screen {screen_id!r}")
        needs = self.types[screen["type"]].get("needs") if screen["type"] in self.types else None
        if needs is None:
            return {"data": None, "at": time.time(), "error": None}
        provider = provider_for(needs)
        if provider is None:
            return {"data": None, "at": time.time(), "error": f"no provider for {needs} yet"}
        return await provider.get(self.hass, screen)

    # ------------------------------------------------------------ telling

    def scene(self) -> dict[str, Any]:
        m = self.mood
        signals = []
        if m is not None:
            for r in (*m.bad, *m.good):
                s = r.signal
                rep = self._repeat_of(s.id) or {}
                signals.append({"id": s.id, "label": s.label, "kind": s.kind,
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
            "mode": self.mode,
            "personality": {"preset": self.config.get("personality", {}).get("preset"),
                            **self.personality},
            "look": self.config.get("look") or {},
            "signals": signals,
            "reason": "Asleep." if self.asleep else (m.reason if m else ""),
            "story": self._story_scene(),
            "screen": self.screen,
            "screens_rev": self.screens_rev,
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
                          tuple(r.signal.id for r in (*m.bad, *m.good)) if m else ())
        scene = self.scene()
        for listener in list(self._listeners):
            try:
                listener(scene)
            except Exception:  # one broken listener must not silence the rest
                _LOGGER.exception("Alfie listener failed")
