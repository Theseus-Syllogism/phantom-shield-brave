"""Per-persona JSONL request log.

One line per request. Captures method, URL, status, latency, the upstream
that served it, any block signals, and errors. Useful for after-the-fact
analysis of which personas/proxies got challenged and why.
"""

from __future__ import annotations

import json
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Optional


@dataclass
class RequestLogEntry:
    ts: float
    persona: str
    method: str
    url: str
    status: int
    latency_ms: float
    upstream: Optional[str] = None
    blocked: bool = False
    block_signals: list[dict] = field(default_factory=list)
    error: Optional[str] = None
    bytes_in: int = 0

    def to_json(self) -> str:
        return json.dumps(
            {
                "ts": round(self.ts, 3),
                "persona": self.persona,
                "method": self.method,
                "url": self.url,
                "status": self.status,
                "latency_ms": round(self.latency_ms, 1),
                "upstream": self.upstream,
                "blocked": self.blocked,
                "block_signals": self.block_signals,
                "error": self.error,
                "bytes_in": self.bytes_in,
            },
            separators=(",", ":"),
        )


class RequestLogger:
    """Append-only JSONL logger. One file per persona, opened on first
    write and held open for the session lifetime."""

    def __init__(self, path: Optional[Path], persona: str, enabled: bool = True):
        self.path = Path(path).expanduser() if path else None
        self.persona = persona
        self.enabled = enabled and self.path is not None
        self._fh = None

    def _open(self) -> None:
        if not self.enabled or self._fh or not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._fh = open(self.path, "a", encoding="utf-8")

    def log(self, entry: RequestLogEntry) -> None:
        if not self.enabled:
            return
        self._open()
        if self._fh:
            self._fh.write(entry.to_json() + "\n")
            self._fh.flush()

    def close(self) -> None:
        if self._fh:
            self._fh.close()
            self._fh = None

    def __enter__(self):
        self._open()
        return self

    def __exit__(self, *exc):
        self.close()


def now_ts() -> float:
    return time.time()
