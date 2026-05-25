"""Upstream proxy management - the GeoIP-evasion piece.

Personas declare an upstream pool (SOCKS5 or HTTP/HTTPS proxies). The Session
picks one and tracks it; rotation strategy decides when to switch.

Rotation strategies:
  - 'sticky-Nh' / 'sticky-Nm' / 'sticky-Ns': keep one proxy for N time units
  - 'round-robin':                            cycle every request
  - 'per-request':                            random pick every request
  - 'on-failure':                             rotate only when explicitly told to

Direct (no upstream) is also supported - the Session sends straight to the
target without going through anything. Mostly for testing.
"""

from __future__ import annotations

import random
import re
import time
from dataclasses import dataclass, field
from typing import Optional


_STICKY_RE = re.compile(r"^sticky-(\d+)([smh])$")


def _parse_sticky(s: str) -> Optional[float]:
    """Parse 'sticky-30m' -> seconds. Returns None if not a sticky strategy."""
    m = _STICKY_RE.match(s)
    if not m:
        return None
    n = int(m.group(1))
    unit = m.group(2)
    return {"s": n, "m": n * 60, "h": n * 3600}[unit]


class Upstream:
    """Base class. Subclasses override `current()` and `rotate()`."""

    def current(self) -> Optional[str]:
        """Return the proxy URL to use right now, or None for direct."""
        raise NotImplementedError

    def rotate(self) -> Optional[str]:
        """Force advance to the next proxy. Returns the new current value."""
        raise NotImplementedError

    def reset(self) -> None:
        """Reset internal rotation state."""
        pass


@dataclass
class DirectUpstream(Upstream):
    """No proxy - hit the target directly. Honest about what it does."""

    def current(self) -> Optional[str]:
        return None

    def rotate(self) -> Optional[str]:
        return None


@dataclass
class PoolUpstream(Upstream):
    """Cycle through a pool of proxies according to a rotation strategy."""

    servers: list[str]
    rotation: str = "sticky-1h"
    _idx: int = field(default=0, init=False)
    _last_rotate_at: float = field(default_factory=time.monotonic, init=False)

    def __post_init__(self) -> None:
        if not self.servers:
            raise ValueError("PoolUpstream requires at least one server")

    def current(self) -> Optional[str]:
        sticky_window = _parse_sticky(self.rotation)
        if sticky_window is not None:
            if time.monotonic() - self._last_rotate_at >= sticky_window:
                self._advance()
                self._last_rotate_at = time.monotonic()
        elif self.rotation == "round-robin":
            # Advance per-request: cycle on every read.
            srv = self.servers[self._idx % len(self.servers)]
            self._idx = (self._idx + 1) % len(self.servers)
            return srv
        elif self.rotation == "per-request":
            return random.choice(self.servers)
        elif self.rotation == "on-failure":
            pass  # stay put until rotate() called explicitly
        else:
            raise ValueError(f"unknown rotation strategy: {self.rotation!r}")
        return self.servers[self._idx % len(self.servers)]

    def rotate(self) -> Optional[str]:
        self._advance()
        self._last_rotate_at = time.monotonic()
        return self.servers[self._idx % len(self.servers)]

    def reset(self) -> None:
        self._idx = 0
        self._last_rotate_at = time.monotonic()

    def _advance(self) -> None:
        self._idx = (self._idx + 1) % len(self.servers)


def build_upstream(cfg: Optional[dict]) -> Upstream:
    """Construct an Upstream from a persona's `upstream:` block.

    Accepted shapes:
      None or {} or {'type': 'direct'} -> DirectUpstream
      {'type': 'pool', 'servers': [...], 'rotation': '...'} -> PoolUpstream
      {'type': 'tor'} -> PoolUpstream pointing at the local Tor SOCKS5 port
    """
    if not cfg:
        return DirectUpstream()
    t = cfg.get("type", "direct")
    if t == "direct":
        return DirectUpstream()
    if t == "pool":
        servers = cfg.get("servers") or []
        rotation = cfg.get("rotation", "sticky-1h")
        return PoolUpstream(servers=list(servers), rotation=rotation)
    if t == "tor":
        port = cfg.get("port", 9050)
        host = cfg.get("host", "127.0.0.1")
        return PoolUpstream(
            servers=[f"socks5h://{host}:{port}"],
            rotation=cfg.get("rotation", "on-failure"),
        )
    raise ValueError(f"unknown upstream type: {t!r}")
