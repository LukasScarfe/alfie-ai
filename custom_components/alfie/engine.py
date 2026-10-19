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

from .config import NOTICE, build, reset, validate
from .const import CONF_NAME, DEFAULT_NAME, EVENT_ANIMATION, FACE_FILE, SCENE_VERSION
from .mood import Mood, MoodSettings, combine
from .providers import provider_for
from .screen_types import load_types
from .signals import Signal, evaluate, evaluate_all, is_pattern, matching, watches
from .store import AlfieStore

_LOGGER = logging.getLogger(__name__)

SLEEP_ENERGY = 0.15
IDLE_QUIET_AFTER = 10.0      # seconds after any animation before a fidget may play
PREVIEW_ENTITIES = 25        # per signal, in a panel preview

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
        for u in (self._idle_unsub, self._override_unsub, self._screen_unsub):
            if u:
                u()
        self._idle_unsub = self._override_unsub = self._screen_unsub = None
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
        if self.mode != "auto" or not self.sleep_entity:
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
        b = self.behaviour
        if react and old is not None:
            if critical and old.level != "miserable":
                self._react(b["on_critical"], "Something critical is wrong.", "mood")
            elif woke:
                self._react(b["on_wake"], "Waking up.", "mode")
            elif b["celebrate"] and not asleep and \
                    {r.signal.id for r in old.bad} - {r.signal.id for r in mood.bad}:
                self._react(b["on_recover"], "Something got fixed.", "recover")
        self._push()

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
    def _react(self, name: str, reason: str, source: str) -> None:
        """A configured reaction; an empty name means the user chose none."""
        if name in self.animations:
            self.play(name, reason, source, push=False)

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
            self.hass, seconds, lambda _now: self._clear_screen(seq))
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
            "personality": {"preset": self.config.get("personality", {}).get("preset"),
                            **self.personality},
            "look": self.config.get("look") or {},
            "signals": signals,
            "reason": "Asleep." if self.asleep else (m.reason if m else ""),
            "story": None,
            "screen": self.screen,
            "screens_rev": self.screens_rev,
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
