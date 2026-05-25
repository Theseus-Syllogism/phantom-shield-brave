import pytest

from phantom_shield.jitter import Jitter, build_jitter


def test_sleeps_within_bounds_many_iterations():
    j = Jitter(min_ms=50, max_ms=150)
    seen: list[float] = []
    for _ in range(40):
        j.sleep(sleeper=seen.append)
    for s in seen:
        # s is seconds, original is ms.
        assert 0.05 <= s <= 0.15 + 1e-9


def test_zero_window_sleeps_zero():
    j = Jitter(min_ms=0, max_ms=0)
    seen: list[float] = []
    j.sleep(sleeper=seen.append)
    assert seen == [0.0]


def test_rejects_negative_bounds():
    with pytest.raises(ValueError):
        Jitter(min_ms=-1, max_ms=10)


def test_rejects_inverted_bounds():
    with pytest.raises(ValueError):
        Jitter(min_ms=100, max_ms=50)


def test_build_from_int_treats_as_constant():
    j = build_jitter(200)
    assert j.min_ms == 200 and j.max_ms == 200


def test_build_from_pair():
    j = build_jitter([100, 500])
    assert j.min_ms == 100 and j.max_ms == 500


def test_build_returns_none_when_unset():
    assert build_jitter(None) is None
    assert build_jitter(0) is None


def test_build_rejects_garbage():
    with pytest.raises(ValueError):
        build_jitter("nope")
