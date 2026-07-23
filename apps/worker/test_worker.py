"""Tests for the worker's test-command detector.

Run with:  cd apps/worker && python -m pytest test_worker.py -v
"""
import os
import tempfile
from worker import detect_test_command


def _write(dirpath, filename):
    """Create an empty file inside dirpath."""
    open(os.path.join(dirpath, filename), "w").close()


def test_detects_npm_when_package_json_present():
    with tempfile.TemporaryDirectory() as d:
        _write(d, "package.json")
        assert detect_test_command(d) == ["npm", "test"]


def test_detects_pytest_when_requirements_present():
    # Skip if pytest isn't installed on this machine (shutil.which check).
    import shutil
    if not shutil.which("pytest"):
        return
    with tempfile.TemporaryDirectory() as d:
        _write(d, "requirements.txt")
        _write(d, "test_app.py")  # so pytest has something to find
        assert detect_test_command(d) == ["pytest", "-q"]


def test_returns_none_for_empty_dir():
    with tempfile.TemporaryDirectory() as d:
        assert detect_test_command(d) is None