"""Tests for the worker's test-command detector.

Run with:  cd apps/worker && python -m pytest test_worker.py -v
"""
import os
import tempfile
from worker import detect_test_command, map_semgrep_severity


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


def test_map_semgrep_severity_known_levels():
    assert map_semgrep_severity("ERROR") == "high"
    assert map_semgrep_severity("WARNING") == "medium"
    assert map_semgrep_severity("INFO") == "low"


def test_map_semgrep_severity_is_case_insensitive():
    assert map_semgrep_severity("error") == "high"
    assert map_semgrep_severity("Warning") == "medium"


def test_map_semgrep_severity_unknown_defaults_to_low():
    # Unknown severities are safer as "low" than a guessed "high".
    assert map_semgrep_severity("SOMETHING_ELSE") == "low"


def test_npm_takes_precedence_over_python_markers():
    # A repo with BOTH package.json and requirements.txt -> npm is checked first.
    with tempfile.TemporaryDirectory() as d:
        _write(d, "package.json")
        _write(d, "requirements.txt")
        assert detect_test_command(d) == ["npm", "test"]


def test_detects_pytest_from_pyproject():
    import shutil
    if not shutil.which("pytest"):
        return
    with tempfile.TemporaryDirectory() as d:
        _write(d, "pyproject.toml")
        assert detect_test_command(d) == ["pytest", "-q"]
