"""
conftest.py - Pytest configuration and path setup.
"""

import sys
from pathlib import Path

# Add project root to sys.path so tests can import app and services
ROOT_DIR = Path(__file__).resolve().parent
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))
