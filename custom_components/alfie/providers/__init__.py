"""Server-side data sources for screens, with one shared cache.

PURE (no HA import; `hass` is only passed through to the providers). A
provider fetches the data for one kind of screen (history, forecast,
calendar, streets). It runs only when a card asks for a screen's data (lazy,
never on a timer), then the answer is kept for the provider's `ttl`. See
docs/screens-contract.md "Providers".

The cache lives in `FetchCache`, apart from the registry, so it can be tested
with a fake clock and no Home Assistant.
"""

from __future__ import annotations

import asyncio
import hashlib
import json
import logging
import time
from collections.abc import Awaitable, Callable
from typing import Any

_LOGGER = logging.getLogger(__name__)

BACKOFF_START = 30.0     # seconds to wait after the first failure; doubles each time

Result = dict[str, Any]   # {"data": json | None, "at": epoch s | None, "error": str | None}


class _Entry:
    __slots__ = ("data", "at", "error", "fresh_until", "fails")

    def __init__(self) -> None:
        self.data: Any = None
        self.at: float | None = None      # wall clock of the last good fetch
        self.error: str | None = None
        self.fresh_until = 0.0            # monotonic: serve from cache until then
        self.fails = 0


class FetchCache:
    """A ttl cache with one in-flight fetch per key and exponential backoff.

    `clock` is monotonic seconds and `wall` epoch seconds; both are injectable
    for tests. The cache keeps one key per screen id: a screen whose options
    changed drops its old answer instead of leaking it.
    """

    def __init__(self, clock: Callable[[], float] = time.monotonic,
                 wall: Callable[[], float] = time.time) -> None:
        self._clock, self._wall = clock, wall
        self._entries: dict[tuple[str, str], _Entry] = {}
        self._flying: dict[tuple[str, str], asyncio.Task[None]] = {}

    async def get(self, key: tuple[str, str], ttl: float,
                  fetch: Callable[[], Awaitable[Any]]) -> Result:
        # A screen's key is (id, options hash): anything else under the same id is stale.
        for k in [k for k in self._entries if k[0] == key[0] and k != key]:
            del self._entries[k]
        entry = self._entries.get(key)
        if entry is not None and self._clock() < entry.fresh_until:
            return self._result(entry)
        task = self._flying.get(key)
        if task is None:
            entry = self._entries.setdefault(key, _Entry())
            task = asyncio.ensure_future(self._run(key, entry, ttl, fetch))
            self._flying[key] = task
        await asyncio.shield(task)    # a cancelled caller must not cancel the fetch
        return self._result(self._entries[key])

    async def _run(self, key: tuple[str, str], entry: _Entry, ttl: float,
                   fetch: Callable[[], Awaitable[Any]]) -> None:
        try:
            try:
                data = await fetch()
            except asyncio.CancelledError:
                raise
            except Exception as e:  # a provider failing is an answer, not a crash
                _LOGGER.warning("Alfie provider failed for %s: %s", key[0], e)
                entry.fails += 1
                entry.error = str(e) or type(e).__name__
                wait = min(BACKOFF_START * 2 ** (entry.fails - 1), ttl)
                entry.fresh_until = self._clock() + wait
            else:
                entry.data, entry.at, entry.error, entry.fails = data, self._wall(), None, 0
                entry.fresh_until = self._clock() + ttl
        finally:
            self._flying.pop(key, None)

    @staticmethod
    def _result(e: _Entry) -> Result:
        return {"data": e.data, "at": e.at, "error": e.error}


class Provider:
    """Base class. A subclass sets `ttl` and implements `fetch`."""

    ttl: float = 3600.0      # seconds a cached answer stays fresh

    def __init__(self) -> None:
        self.cache = FetchCache()

    async def fetch(self, hass: Any, screen: dict) -> Any:
        """The screen's data as small JSON. Blocking work goes to
        `hass.async_add_executor_job`. Raise to report a failure."""
        raise NotImplementedError

    async def get(self, hass: Any, screen: dict) -> Result:
        opts = json.dumps(screen.get("options"), sort_keys=True, default=str)
        key = (screen["id"], hashlib.sha1(opts.encode()).hexdigest()[:12])
        res = await self.cache.get(key, self.ttl, lambda: self.fetch(hass, screen))
        # `at` is when the data was made; a provider that never succeeded has none.
        return {**res, "at": res["at"] if res["at"] is not None else time.time()}


PROVIDERS: dict[str, type[Provider]] = {}
_instances: dict[str, Provider] = {}


def register(kind: str) -> Callable[[type[Provider]], type[Provider]]:
    def deco(cls: type[Provider]) -> type[Provider]:
        PROVIDERS[kind] = cls
        return cls
    return deco


def provider_for(kind: str) -> Provider | None:
    """The one shared instance for `kind` (so its cache is shared), or None."""
    if kind not in PROVIDERS:
        return None
    if kind not in _instances:
        _instances[kind] = PROVIDERS[kind]()
    return _instances[kind]


# --- Providers. Each data kind adds exactly one import line here, after the
# registry above is defined (the module registers itself on import).
from . import calendar  # noqa: E402,F401
from . import forecast  # noqa: E402,F401
from . import history  # noqa: E402,F401
from . import streets  # noqa: E402,F401
