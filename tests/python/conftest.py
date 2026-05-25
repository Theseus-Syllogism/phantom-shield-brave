"""Shared pytest fixtures."""
from __future__ import annotations

import sys
from pathlib import Path

# Ensure the package is importable without `pip install -e .` for ad-hoc test runs.
_ROOT = Path(__file__).resolve().parents[2]
if str(_ROOT) not in sys.path:
    sys.path.insert(0, str(_ROOT))
