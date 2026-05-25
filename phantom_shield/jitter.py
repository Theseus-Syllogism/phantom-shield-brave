"""Inter-request timing jitter.

Naive scripts make requests as fast as the CPU can issue them. That timing
pattern is itself a fingerprint - a human pauses to read, scroll, click.
The persona configures a uniform jitter window in milliseconds; the
Session sleeps that long between requests.
"""

from __future__ import annotations

import random
import time
from dataclasses import dataclass


@dataclass
class Jitter:
    min_ms: int
    max_ms: int

    def __post_init__(self) -> None:
        if self.min_ms < 0 or self.max_ms < 0:
            raise ValueError("jitter bounds must be >= 0")
        if self.max_ms < self.min_ms:
            raise ValueError("jitter max_ms must be >= min_ms")

    def sleep(self, sleeper=time.sleep) -> float:
        """Sleep for a uniform-random duration. Returns the actual sleep ms."""
        ms = random.uniform(self.min_ms, self.max_ms)
        sleeper(ms / 1000.0)
        return ms


def build_jitter(spec) -> Jitter | None:
    """Construct from a persona's `jitter_ms: [min, max]` value."""
    if not spec:
        return None
    if isinstance(spec, (int, float)):
        return Jitter(min_ms=int(spec), max_ms=int(spec))
    if isinstance(spec, (list, tuple)) and len(spec) == 2:
        return Jitter(min_ms=int(spec[0]), max_ms=int(spec[1]))
    raise ValueError(f"invalid jitter spec: {spec!r}")
