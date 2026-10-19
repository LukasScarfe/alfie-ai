"""The provider cache: ttl, backoff, single flight, with a fake clock."""
import asyncio

import pytest

from alfie import providers
from alfie.providers import BACKOFF_START, FetchCache, Provider, register


class Clock:
    def __init__(self):
        self.t = 1000.0

    def __call__(self):
        return self.t


def make():
    clock = Clock()
    return clock, FetchCache(clock=clock, wall=lambda: 1_700_000_000 + clock.t)


class Fetcher:
    def __init__(self, fail=False, delay=0.0):
        self.calls, self.fail, self.delay = 0, fail, delay

    async def __call__(self):
        self.calls += 1
        if self.delay:
            await asyncio.sleep(self.delay)
        if self.fail:
            raise RuntimeError("boom")
        return {"n": self.calls}


KEY = ("plants", "abc")


def test_ttl():
    async def go():
        clock, c = make()
        f = Fetcher()
        a = await c.get(KEY, 100, f)
        assert a == {"data": {"n": 1}, "at": 1_700_001_000, "error": None}
        clock.t += 99
        assert (await c.get(KEY, 100, f))["data"] == {"n": 1} and f.calls == 1
        clock.t += 2
        assert (await c.get(KEY, 100, f))["data"] == {"n": 2} and f.calls == 2
    asyncio.run(go())


def test_single_flight():
    async def go():
        _, c = make()
        f = Fetcher(delay=0.05)
        rs = await asyncio.gather(*(c.get(KEY, 100, f) for _ in range(5)))
        assert f.calls == 1 and all(r == rs[0] for r in rs)
        # A different key is its own fetch.
        await c.get(("other", "x"), 100, f)
        assert f.calls == 2
    asyncio.run(go())


def test_single_flight_survives_a_cancelled_waiter():
    async def go():
        _, c = make()
        f = Fetcher(delay=0.05)
        t = asyncio.ensure_future(c.get(KEY, 100, f))
        await asyncio.sleep(0.01)
        t.cancel()
        r = await c.get(KEY, 100, f)
        assert f.calls == 1 and r["data"] == {"n": 1}
    asyncio.run(go())


def test_backoff_doubles_and_caps_at_ttl():
    async def go():
        clock, c = make()
        f = Fetcher(fail=True)
        r = await c.get(KEY, 100, f)
        assert r["data"] is None and r["error"] == "boom" and f.calls == 1
        for fails, wait in ((1, BACKOFF_START), (2, 60), (3, 100), (4, 100)):
            # within the wait: cached error, no new fetch
            clock.t += wait - 1
            await c.get(KEY, 100, f)
            assert f.calls == fails
            clock.t += 2
            await c.get(KEY, 100, f)
            assert f.calls == fails + 1
        f.fail = False
        clock.t += 101
        ok = await c.get(KEY, 100, f)
        assert ok["error"] is None and ok["data"] is not None
        # success resets the backoff
        f.fail = True
        clock.t += 101
        await c.get(KEY, 100, f)
        n = f.calls
        clock.t += BACKOFF_START + 1
        await c.get(KEY, 100, f)
        assert f.calls == n + 1
    asyncio.run(go())


def test_error_keeps_last_good_data():
    async def go():
        clock, c = make()
        f = Fetcher()
        await c.get(KEY, 100, f)
        f.fail = True
        clock.t += 101
        r = await c.get(KEY, 100, f)
        assert r["error"] == "boom" and r["data"] == {"n": 1}
    asyncio.run(go())


def test_changed_options_drop_the_old_entry():
    async def go():
        _, c = make()
        f = Fetcher()
        await c.get(("s", "one"), 100, f)
        await c.get(("s", "two"), 100, f)
        assert list(c._entries) == [("s", "two")]
    asyncio.run(go())


def test_registry_and_provider_get():
    @register("unit_test_kind")
    class P(Provider):
        ttl = 10
        calls = 0

        async def fetch(self, hass, screen):
            P.calls += 1
            return {"id": screen["id"]}

    try:
        p = providers.provider_for("unit_test_kind")
        assert p is providers.provider_for("unit_test_kind")
        assert providers.provider_for("nothing") is None
        s = {"id": "a", "options": {"x": 1}}

        async def go():
            r1, r2 = await asyncio.gather(p.get(None, s), p.get(None, s))
            assert r1["data"] == {"id": "a"} and r1["error"] is None and P.calls == 1
            await p.get(None, {**s, "options": {"x": 2}})   # new options, new fetch
            assert P.calls == 2
        asyncio.run(go())
    finally:
        providers.PROVIDERS.pop("unit_test_kind")
        providers._instances.pop("unit_test_kind", None)
