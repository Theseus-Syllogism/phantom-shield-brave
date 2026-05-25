import json
from pathlib import Path

from phantom_shield.logger import RequestLogger, RequestLogEntry, now_ts


def _entry(persona="alice", url="https://example.com", status=200, **extra):
    return RequestLogEntry(
        ts=now_ts(),
        persona=persona,
        method=extra.get("method", "GET"),
        url=url,
        status=status,
        latency_ms=extra.get("latency_ms", 123.4),
        upstream=extra.get("upstream"),
        blocked=extra.get("blocked", False),
        block_signals=extra.get("block_signals", []),
        error=extra.get("error"),
        bytes_in=extra.get("bytes_in", 0),
    )


def test_entry_serializes_to_compact_json():
    e = _entry(blocked=True, block_signals=[{"detector": "cloudflare", "reason": "x"}])
    s = e.to_json()
    parsed = json.loads(s)
    assert parsed["persona"] == "alice"
    assert parsed["blocked"] is True
    assert parsed["block_signals"][0]["detector"] == "cloudflare"


def test_logger_appends_jsonl(tmp_path: Path):
    log_path = tmp_path / "alice.jsonl"
    with RequestLogger(log_path, persona="alice") as lg:
        lg.log(_entry())
        lg.log(_entry(status=429, blocked=True))
    lines = log_path.read_text().splitlines()
    assert len(lines) == 2
    for line in lines:
        parsed = json.loads(line)
        assert parsed["persona"] == "alice"


def test_disabled_logger_writes_nothing(tmp_path: Path):
    log_path = tmp_path / "x.jsonl"
    lg = RequestLogger(log_path, persona="x", enabled=False)
    lg.log(_entry())
    lg.close()
    assert not log_path.exists()


def test_logger_with_no_path_silently_noops():
    lg = RequestLogger(None, persona="x")
    lg.log(_entry())
    lg.close()  # must not raise
