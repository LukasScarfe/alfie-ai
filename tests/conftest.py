"""Make the integration's PURE modules importable as `alfie.<module>` without
running its __init__.py (which imports Home Assistant). The tests only touch
modules with no HA import, so they run on plain python + pytest."""

import os
import sys
import types

_PKG = os.path.join(os.path.dirname(__file__), "..", "custom_components", "alfie")

if "alfie" not in sys.modules:
    pkg = types.ModuleType("alfie")
    pkg.__path__ = [os.path.abspath(_PKG)]
    sys.modules["alfie"] = pkg
