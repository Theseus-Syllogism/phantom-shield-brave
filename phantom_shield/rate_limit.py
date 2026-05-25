"""Token-bucket rate limiter, scoped to a single persona/session.

`per_minute` requests average. `burst` is the bucket capacity (max requests
in a single instantaneous spike). `acquire()` blocks until a token is
available.

Threading: not safe for use across threads. Sessions are single-threaded
by design (curl_cffi sessions hold a curl handle).
"""

from __future__ import annotations

import time
from dataclasses import dataclass


@dataclass
class TokenBucket:
    per_minute: float
    burst: int
    _tokens: float = 0.0
    _last_refill: float = 0.0

    def __post_init__(self) -> None:
        if self.per_minute <= 0:
            raise ValueError("per_minute must be > 0")
        if self.burst < 1:
            raise ValueError("burst must be >= 1")
        self._tokens = float(self.burst)
        self._last_refill = time.monotonic()

    @property
    def rate_per_second(self) -> float:
        return self.per_minute / 60.0

    def _refill(self) -> None:
        now = time.monotonic()
        elapsed = now - self._last_refill
        self._tokens = min(float(self.burst), self._tokens + elapsed * self.rate_per_second)
        self._last_refill = now

    def acquire(self, sleeper=time.sleep) -> float:
        """Block until a token is available. Returns the time spent waiting."""
        self._refill()
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return 0.0
        deficit = 1.0 - self._tokens
        wait = deficit / self.rate_per_second
        sleeper(wait)
        self._refill()
        self._tokens = max(0.0, self._tokens - 1.0)
        return wait

    def try_acquire(self) -> bool:
        """Non-blocking acquire. Returns True on success, False if no token."""
        self._refill()
        if self._tokens >= 1.0:
            self._tokens -= 1.0
            return True
        return False


def build_rate_limiter(cfg: dict | None) -> TokenBucket | None:
    """Construct a TokenBucket from a persona's `rate_limit:` block."""
    if not cfg:
        return None
    per_minute = float(cfg.get("per_minute", 0))
    if per_minute <= 0:
        return None
    burst = int(cfg.get("burst", max(1, int(per_minute / 6))))
    return TokenBucket(per_minute=per_minute, burst=burst)
