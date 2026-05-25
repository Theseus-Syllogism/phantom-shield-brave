"""Per-persona cookie jar persistence.

Each persona's cookies live in their own JSON file. The Session loads on
construction and saves on close. Format is a flat list of dicts so it
diffs cleanly in version control if anyone wants to inspect.
"""

from __future__ import annotations

import json
from pathlib import Path
from typing import Optional


class CookieStore:
    """Disk-backed cookie store. Holds cookies as a list of dicts that
    curl_cffi.Session can accept via its cookies parameter.

    Lifecycle:
        store = CookieStore(path)   # reads existing file, or starts empty
        store.update_from_session(session)   # sync from curl_cffi
        store.save()                         # write back to disk
    """

    def __init__(self, path: Optional[Path]):
        self.path = Path(path).expanduser() if path else None
        self._cookies: list[dict] = []
        if self.path and self.path.exists():
            self._load()

    def _load(self) -> None:
        assert self.path is not None
        try:
            with self.path.open("r", encoding="utf-8") as fh:
                data = json.load(fh)
                if isinstance(data, list):
                    self._cookies = data
        except (OSError, json.JSONDecodeError):
            self._cookies = []

    def as_dict(self) -> dict[str, str]:
        """Return cookies as a flat {name: value} dict for curl_cffi.Session."""
        out: dict[str, str] = {}
        for c in self._cookies:
            name = c.get("name")
            value = c.get("value")
            if name and value is not None:
                out[name] = value
        return out

    def update_from_session(self, session) -> None:
        """Capture the session's current cookie jar into self._cookies."""
        try:
            jar = session.cookies
        except AttributeError:
            return
        new: list[dict] = []
        for cookie in jar:
            new.append(
                {
                    "name": getattr(cookie, "name", None),
                    "value": getattr(cookie, "value", None),
                    "domain": getattr(cookie, "domain", None),
                    "path": getattr(cookie, "path", "/"),
                    "secure": getattr(cookie, "secure", False),
                    "expires": getattr(cookie, "expires", None),
                }
            )
        self._cookies = new

    def save(self) -> None:
        if not self.path:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.path.open("w", encoding="utf-8") as fh:
            json.dump(self._cookies, fh, indent=2, sort_keys=True)
            fh.write("\n")

    def clear(self) -> None:
        self._cookies = []
        if self.path and self.path.exists():
            self.path.unlink()
