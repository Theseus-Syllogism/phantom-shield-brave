from unittest.mock import patch

from phantom_shield.dns import DoHResolver, build_resolver, DOH_ENDPOINTS


def test_resolver_falls_back_to_empty_on_network_error():
    r = DoHResolver(endpoint="http://127.0.0.1:1", timeout_s=0.1)
    assert r.resolve("example.com") == []


def test_resolver_caches_results():
    r = DoHResolver(endpoint="https://example.com", cache_ttl_s=60.0)
    # Prime the cache.
    r._cache["host.example"] = type("E", (), {"addrs": ["1.2.3.4"], "expires_at": float("inf")})()
    assert r.resolve("host.example") == ["1.2.3.4"]


def test_build_resolver_returns_none_when_system_mode():
    assert build_resolver(None) is None
    assert build_resolver({"mode": "system"}) is None


def test_build_resolver_constructs_doh():
    r = build_resolver({"mode": "doh", "resolver": "cloudflare"})
    assert r is not None
    assert r.endpoint == DOH_ENDPOINTS["cloudflare"]


def test_build_resolver_rejects_unknown_resolver():
    import pytest

    with pytest.raises(ValueError):
        build_resolver({"mode": "doh", "resolver": "totally-fake"})


def test_resolver_parses_mock_response():
    fake_response_bytes = b'{"Status":0,"Answer":[{"name":"x.com","type":1,"TTL":300,"data":"1.2.3.4"},{"name":"x.com","type":1,"TTL":300,"data":"5.6.7.8"}]}'

    class _FakeResp:
        def read(self):
            return fake_response_bytes

        def __enter__(self):
            return self

        def __exit__(self, *a):
            return False

    with patch("phantom_shield.dns.urlopen", return_value=_FakeResp()):
        r = DoHResolver(endpoint="https://example.test")
        addrs = r.resolve("x.com")
    assert "1.2.3.4" in addrs and "5.6.7.8" in addrs
