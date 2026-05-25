import time

import pytest

from phantom_shield.upstream import (
    DirectUpstream,
    PoolUpstream,
    build_upstream,
    _parse_sticky,
)


def test_parse_sticky():
    assert _parse_sticky("sticky-1h") == 3600
    assert _parse_sticky("sticky-30m") == 1800
    assert _parse_sticky("sticky-15s") == 15
    assert _parse_sticky("round-robin") is None
    assert _parse_sticky("garbage") is None


def test_direct_upstream_returns_none():
    u = DirectUpstream()
    assert u.current() is None
    assert u.rotate() is None


def test_pool_round_robin_cycles_per_request():
    u = PoolUpstream(servers=["a", "b", "c"], rotation="round-robin")
    seen = [u.current() for _ in range(6)]
    # First call returns a, second b, third c, then wraps.
    assert seen == ["a", "b", "c", "a", "b", "c"]


def test_pool_per_request_returns_some_server():
    u = PoolUpstream(servers=["a", "b", "c"], rotation="per-request")
    for _ in range(20):
        assert u.current() in {"a", "b", "c"}


def test_pool_on_failure_holds_until_rotate():
    u = PoolUpstream(servers=["a", "b", "c"], rotation="on-failure")
    assert u.current() == "a"
    assert u.current() == "a"  # no rotation without explicit call
    assert u.rotate() == "b"
    assert u.current() == "b"
    assert u.rotate() == "c"
    assert u.rotate() == "a"  # wraps


def test_pool_sticky_advances_after_window():
    u = PoolUpstream(servers=["a", "b"], rotation="sticky-1s")
    first = u.current()
    assert u.current() == first  # within window
    time.sleep(1.05)
    second = u.current()
    assert second != first


def test_pool_reset_returns_to_start():
    u = PoolUpstream(servers=["a", "b", "c"], rotation="on-failure")
    u.rotate()
    u.rotate()
    assert u.current() == "c"
    u.reset()
    assert u.current() == "a"


def test_pool_rejects_empty_servers():
    with pytest.raises(ValueError):
        PoolUpstream(servers=[], rotation="round-robin")


def test_pool_rejects_unknown_rotation():
    u = PoolUpstream(servers=["a"], rotation="weird")
    with pytest.raises(ValueError):
        u.current()


def test_build_upstream_direct_from_none():
    assert isinstance(build_upstream(None), DirectUpstream)
    assert isinstance(build_upstream({}), DirectUpstream)
    assert isinstance(build_upstream({"type": "direct"}), DirectUpstream)


def test_build_upstream_pool():
    u = build_upstream({"type": "pool", "servers": ["a", "b"]})
    assert isinstance(u, PoolUpstream)
    assert u.servers == ["a", "b"]


def test_build_upstream_tor():
    u = build_upstream({"type": "tor"})
    assert isinstance(u, PoolUpstream)
    assert u.servers == ["socks5h://127.0.0.1:9050"]


def test_build_upstream_unknown_type():
    with pytest.raises(ValueError):
        build_upstream({"type": "rocket"})
