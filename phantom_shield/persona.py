"""Persona - the unit of identity.

A persona file declares everything that should rotate together: TLS
profile, region, upstream proxy pool, cookie jar location, DNS mode,
rate limit, jitter, block detection policy, log path.

Load from YAML:

    alice = Persona.load("alice")            # ~/.phantom/personas/alice.yaml
    alice = Persona.from_path("./alice.yml")

Or build programmatically:

    Persona(name="alice", profile="chrome146", region="us-east")
"""

from __future__ import annotations

import os
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any, Optional

import yaml

from phantom_shield.catalog import find_profile, find_region, DEFAULT_PROFILE, DEFAULT_REGION, accept_language


DEFAULT_PERSONA_DIR = Path(os.environ.get("PHANTOM_PERSONA_DIR", "~/.phantom/personas")).expanduser()


@dataclass
class Persona:
    name: str
    profile: str = DEFAULT_PROFILE
    region: str = DEFAULT_REGION
    upstream: dict[str, Any] = field(default_factory=dict)
    cookies: dict[str, Any] = field(default_factory=dict)
    dns: dict[str, Any] = field(default_factory=dict)
    rate_limit: dict[str, Any] = field(default_factory=dict)
    jitter_ms: Optional[list[int]] = None
    on_block: dict[str, Any] = field(default_factory=dict)
    log: dict[str, Any] = field(default_factory=dict)
    user_agent_override: Optional[str] = None
    extra_headers: dict[str, str] = field(default_factory=dict)

    @classmethod
    def load(cls, name: str, search_dir: Optional[Path] = None) -> "Persona":
        """Load a persona by name from the persona directory."""
        d = Path(search_dir).expanduser() if search_dir else DEFAULT_PERSONA_DIR
        for ext in (".yaml", ".yml"):
            path = d / f"{name}{ext}"
            if path.exists():
                return cls.from_path(path)
        raise FileNotFoundError(f"persona {name!r} not found in {d}")

    @classmethod
    def from_path(cls, path) -> "Persona":
        path = Path(path).expanduser()
        with path.open("r", encoding="utf-8") as fh:
            data = yaml.safe_load(fh) or {}
        if "name" not in data:
            data["name"] = path.stem
        return cls.from_dict(data)

    @classmethod
    def from_dict(cls, data: dict[str, Any]) -> "Persona":
        # Drop unknown keys with a clear error rather than silent.
        known = {f for f in cls.__dataclass_fields__}
        unknown = set(data.keys()) - known
        if unknown:
            raise ValueError(f"unknown persona fields: {sorted(unknown)}")
        return cls(**data)

    def to_dict(self) -> dict[str, Any]:
        out = {
            "name": self.name,
            "profile": self.profile,
            "region": self.region,
        }
        if self.upstream:
            out["upstream"] = self.upstream
        if self.cookies:
            out["cookies"] = self.cookies
        if self.dns:
            out["dns"] = self.dns
        if self.rate_limit:
            out["rate_limit"] = self.rate_limit
        if self.jitter_ms is not None:
            out["jitter_ms"] = self.jitter_ms
        if self.on_block:
            out["on_block"] = self.on_block
        if self.log:
            out["log"] = self.log
        if self.user_agent_override:
            out["user_agent_override"] = self.user_agent_override
        if self.extra_headers:
            out["extra_headers"] = self.extra_headers
        return out

    def save(self, path: Optional[Path] = None) -> Path:
        """Write the persona to disk as YAML. Defaults to DEFAULT_PERSONA_DIR/<name>.yaml."""
        target = Path(path).expanduser() if path else DEFAULT_PERSONA_DIR / f"{self.name}.yaml"
        target.parent.mkdir(parents=True, exist_ok=True)
        with target.open("w", encoding="utf-8") as fh:
            yaml.safe_dump(self.to_dict(), fh, sort_keys=False, default_flow_style=False)
        return target

    # Convenience accessors that resolve through the catalogue.

    @property
    def profile_data(self) -> dict[str, Any]:
        return find_profile(self.profile)

    @property
    def region_data(self) -> dict[str, Any]:
        return find_region(self.region)

    @property
    def effective_user_agent(self) -> str:
        return self.user_agent_override or self.profile_data["ua"]

    @property
    def accept_language(self) -> str:
        return accept_language(self.region_data["languages"])

    @property
    def timezone(self) -> str:
        return self.region_data["tz"]

    def request_headers(self) -> dict[str, str]:
        """Build the persona's outgoing HTTP headers (excluding host-specific ones)."""
        h: dict[str, str] = {
            "User-Agent": self.effective_user_agent,
            "Accept-Language": self.accept_language,
            "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
        }
        # Sec-CH-UA brands are sent by Chromium-family profiles only.
        brands = self.profile_data.get("brands") or []
        if brands:
            h["Sec-CH-UA"] = ", ".join(f'"{b["brand"]}";v="{b["version"]}"' for b in brands)
            h["Sec-CH-UA-Mobile"] = "?1" if self.profile_data.get("mobile") else "?0"
            h["Sec-CH-UA-Platform"] = f'"{self.profile_data.get("platform", "Windows")}"'
        h.update(self.extra_headers)
        return h
