"""Alfie's engine: watches the house, keeps his mood, decides what he does.

It runs entirely on HA's event loop and does nothing heavy there: a state
change costs a dict lookup to filter, and a recompute evaluates a handful of
signals. It holds *what Alfie is* (the scene state, see docs/design.md
"Scene state") and pushes it to listeners (the WS subscriptions, the
entities); the cards do all per-frame animation themselves.
"""

from __future__ import annotations

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

from . import defaults
from .const import (
    CONF_CELEBRATE,
    CONF_COMBINE,
    CONF_IDLE_INTERVAL,
    CONF_MOTION_DEBOUNCE,
    CONF_NAME,
    DEFAULT_NAME,
    EVENT_ANIMATION,
    FACE_FILE,
    SCENE_VERSION,
)
from .mood import Mood, MoodSettings, combine
from .signals import evaluate_all, is_pattern, watches

_LOGGER = logging.getLogger(__name__)

SLEEP_ENERGY = 0.15
IDLE_QUIET_AFTER = 10.0      # seconds after any animation before a fidget may play

Listener = Callable[[dict[str, Any]], None]


def _load_face() -> dict[str, Any]:
    path = os.path.join(os.path.dirname(__file__), "frontend", FACE_FILE)
    with open(path, encoding="utf-8") as f:
        return json.load(f)


class AlfieEngine:
    def __init__(self, hass: HomeAssistant, entry: ConfigEntry) -> None:
        self.hass = hass
        self.entry = entry
        self.name: str = entry.data.get(CONF_NAME) or DEFAULT_NAME
        opts = entry.options
        self.settings = MoodSettings(combine=opts.get(CONF_COMBINE, "worst"))
        self.idle_interval = float(opts.get(CONF_IDLE_INTERVAL, defaults.IDLE_INTERVAL))
        self.motion_debounce = float(opts.get(CONF_MOTION_DEBOUNCE, defaults.MOTION_DEBOUNCE))
        self.celebrate = bool(opts.get(CONF_CELEBRATE, True))
        self.signals = defaults.SIGNALS
        self.gaze_map = dict(defaults.GAZE_MAP)
        self.sleep_entity = defaults.SLEEP_ENTITY

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
        self._relevant_cache: dict[str, bool] = {}
        self._signal_entities: set[str] = set()   # resolved, patterns included
        self.state_key: tuple = ()                # what the entities show; see _push

    # ------------------------------------------------------------ lifecycle

    async def async_start(self) -> None:
        face = await self.hass.async_add_executor_job(_load_face)
        self.expressions = set(face["expressions"])
        self.animations = set(face["animations"])
        # Patterns are resolved against all states once, here; afterwards only
        # a brand-new entity (old_state None) can add a match. Nothing ever
        # scans every state per change.
        self._signal_entities = {st.entity_id for st in self.hass.states.async_all()
                                 if self._is_signal_entity(st.entity_id)}
        self._signal_entities |= {p for sig in self.signals for p in sig.entities
                                  if not is_pattern(p)}
        self._unsubs.append(self.hass.bus.async_listen(
            EVENT_STATE_CHANGED, self._on_state, event_filter=self._relevant))
        self._recompute(react=False)
        self._schedule_idle()

    @callback
    def async_stop(self) -> None:
        for unsub in self._unsubs:
            unsub()
        self._unsubs.clear()
        for u in (self._idle_unsub, self._override_unsub):
            if u:
                u()
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

    # -------------------------------------------------------------- reading

    def _is_signal_entity(self, entity_id: str) -> bool:
        return any(watches(s, entity_id) for s in self.signals)

    @callback
    def _relevant(self, event_data: Any) -> bool:
        eid = event_data["entity_id"]
        hit = self._relevant_cache.get(eid)
        if hit is None:
            hit = (eid in self.gaze_map or eid == self.sleep_entity
                   or self._is_signal_entity(eid))
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
        if eid == self.sleep_entity or eid in self._signal_entities:
            self._recompute(react=True)

    # ------------------------------------------------------------- thinking

    def _sleep_wanted(self) -> bool:
        if self.mode == "night":
            return True
        if self.mode != "auto":
            return False
        st = self.hass.states.get(self.sleep_entity)
        return st is not None and st.state == "on"

    @callback
    def _recompute(self, react: bool) -> None:
        old = self.mood
        mood = combine(evaluate_all(self.signals, self._signal_states()), self.settings)
        critical = mood.level == "miserable"
        asleep = self._sleep_wanted() and not critical   # only critical wakes him
        changed = (old is None or old.level != mood.level or asleep != self.asleep
                   or {r.signal.id for r in old.bad} != {r.signal.id for r in mood.bad}
                   or {r.signal.id for r in old.good} != {r.signal.id for r in mood.good})
        woke = self.asleep and not asleep
        self.mood, self.asleep = mood, asleep
        if not changed:
            return
        _LOGGER.debug("mood %s (%s) asleep=%s: %s", mood.level, mood.score, asleep, mood.reason)
        if react and old is not None:
            if critical and old.level != "miserable":
                self.play(defaults.ON_CRITICAL, "Something critical is wrong.", "mood", push=False)
            elif woke:
                self.play("wake_up", "Waking up.", "mode", push=False)
            elif self.celebrate and not asleep and \
                    {r.signal.id for r in old.bad} - {r.signal.id for r in mood.bad}:
                self.play(defaults.ON_RECOVER, "Something got fixed.", "recover", push=False)
        self._push()

    @callback
    def _motion(self, entity_id: str) -> None:
        if self.asleep:
            return
        now = time.monotonic()
        if now - self._last_motion < self.motion_debounce:
            return
        self._last_motion = now
        action = self.gaze_map[entity_id]
        name = random.choice(defaults.NOTICE) if action == "notice" else action
        st = self.hass.states.get(entity_id)
        where = st.name if st is not None else entity_id
        self.play(name, f"Movement: {where}.", "motion")

    def _schedule_idle(self) -> None:
        energy = self.energy
        # Lively Alfie fidgets more often; a miserable one barely moves.
        delay = self.idle_interval * (0.8 / max(energy, 0.1)) * random.uniform(0.7, 1.3)
        self._idle_unsub = async_call_later(self.hass, max(delay, 5.0), self._idle)

    @callback
    def _idle(self, _now: Any) -> None:
        self._idle_unsub = None
        if not self.asleep and time.monotonic() - self._last_anim > IDLE_QUIET_AFTER:
            self.play(random.choice(defaults.IDLE_FIDGETS), "Idle fidget.", "idle")
        self._schedule_idle()

    # -------------------------------------------------------------- doing

    @property
    def expression(self) -> str:
        if self.override:
            return self.override
        if self.asleep:
            return defaults.SLEEP_EXPRESSION
        return self.mood.expression if self.mood else "neutral"

    @property
    def energy(self) -> float:
        if self.asleep:
            return SLEEP_ENERGY
        return self.mood.energy if self.mood else 0.8

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
        self._recompute(react=True)
        self._push()

    # ------------------------------------------------------------ telling

    def scene(self) -> dict[str, Any]:
        m = self.mood
        signals = []
        if m is not None:
            for r in (*m.bad, *m.good):
                s = r.signal
                signals.append({"id": s.id, "label": s.label, "kind": s.kind,
                                "severity": s.severity, "entities": list(r.entities),
                                "screen": s.screen})
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
            "signals": signals,
            "reason": "Asleep." if self.asleep else (m.reason if m else ""),
            "story": None,
            "screen": None,
            "now": time.time(),
        }

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
