"""Report which build of the backend is running.

The desktop shell runs the backend two different ways: live source in a dev
build, and a PyInstaller binary in a release build. A release build bundles a
frozen binary that was built at some earlier moment, so it can fall behind the
frontend it is paired with -- a new route then answers 404 with no hint about
why. Reporting a version lets the frontend say so plainly.

Version resolution, in order:

1. ``src-tauri/tauri.conf.json`` next to the running source. Available in a dev
   checkout, and always current, so no manual syncing is needed.
2. ``_baked_version.py``, written by ``scripts/build_backend_binary.sh`` at
   freeze time. This is what a frozen binary carries.
3. ``"unknown"`` -- the frontend treats this as "cannot compare" and stays quiet
   rather than warning on a guess.
"""

from __future__ import annotations

import json
import sys
from pathlib import Path


def _version_from_tauri_config() -> str | None:
    config_path = Path(__file__).resolve().parents[2] / "src-tauri" / "tauri.conf.json"
    try:
        version = json.loads(config_path.read_text(encoding="utf-8")).get("version")
    except (OSError, ValueError):
        return None
    return version if isinstance(version, str) and version.strip() else None


def _baked_version() -> str | None:
    try:
        from ._baked_version import BAKED_VERSION
    except ImportError:
        return None
    return BAKED_VERSION if isinstance(BAKED_VERSION, str) and BAKED_VERSION.strip() else None


def get_backend_version() -> str:
    return _version_from_tauri_config() or _baked_version() or "unknown"


def is_frozen() -> bool:
    """True when running from the PyInstaller bundle rather than source."""
    return bool(getattr(sys, "frozen", False))
