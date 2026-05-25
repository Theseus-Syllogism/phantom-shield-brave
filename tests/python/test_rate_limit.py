import pytest

from phantom_shield.rate_limit import TokenBucket, build_rate_limiter


def test_bucket_rejects_invalid_params():
    with pytest.raises(ValueError):
        TokenBucket(per_minute=0, burst=5)
    with pytest.raises(ValueError):
        TokenBucket(per_minute=60, burst=0)


def test_burst_capacity_satisfied_immediately():
    b = TokenBucket(per_minute=60, burst=5)
    # 5 immediate acquires without sleeping.
    sleeps = []
    for _ in range(5):
        waited = b.acquire(sleeper=sleeps.append)
        assert waited == 0
    assert sleeps == []


def test_blocks_after_burst_exhausted():
    b = TokenBucket(per_minute=60, burst=2)
    sleeps = []
    b.acquire(sleeper=sleeps.append)
    b.acquire(sleeper=sleeps.append)
    # third must wait approximately 1 second (60 per_minute = 1/s).
    b.acquire(sleeper=lambda s: sleeps.append(s))
    assert sleeps  # at least one sleep call recorded
    assert sleeps[-1] > 0


def test_try_acquire_non_blocking():
    b = TokenBucket(per_minute=60, burst=1)
    assert b.try_acquire() is True
    assert b.try_acquire() is False


def test_build_returns_none_when_no_rate():
    assert build_rate_limiter(None) is None
    assert build_rate_limiter({}) is None
    assert build_rate_limiter({"per_minute": 0}) is None


def test_build_returns_bucket():
    b = build_rate_limiter({"per_minute": 120, "burst": 4})
    assert isinstance(b, TokenBucket)
    assert b.per_minute == 120
    assert b.burst == 4


def test_build_picks_default_burst():
    b = build_rate_limiter({"per_minute": 60})
    assert b.burst >= 1
