"""Tests for the worker's test-command detector.

Run with:  cd apps/worker && python -m pytest test_worker.py -v
"""
import os
import tempfile
import worker
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


def test_post_comments_uses_configured_api_and_key(monkeypatch):
    captured = {}

    class Response:
        def raise_for_status(self):
            captured["checked"] = True

    def fake_post(url, **kwargs):
        captured.update(url=url, **kwargs)
        return Response()

    monkeypatch.setenv("API_BASE_URL", "https://api.internal/")
    monkeypatch.setenv("API_KEY", "secret")
    monkeypatch.setattr(worker.httpx, "post", fake_post)

    worker.post_comments(42)

    assert captured["url"] == "https://api.internal/api/analyses/42/post-comments"
    assert captured["headers"] == {"X-API-Key": "secret"}
    assert captured["checked"] is True



def test_git_clone_environment_uses_transient_header(monkeypatch):
    monkeypatch.delenv("GIT_CONFIG_COUNT", raising=False)
    env = worker.git_clone_environment("github-token")
    assert env["GIT_CONFIG_KEY_0"] == "http.extraHeader"
    assert env["GIT_CONFIG_VALUE_0"] == "Authorization: Bearer github-token"
    assert os.environ.get("GIT_CONFIG_COUNT") is None



def test_repository_execution_requires_opt_in_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("RUN_REPOSITORY_TESTS", raising=False)
    assert worker.repository_execution_enabled() is False
    monkeypatch.setenv("RUN_REPOSITORY_TESTS", "true")
    assert worker.repository_execution_enabled() is True


def test_repository_subprocess_environment_removes_credentials(monkeypatch):
    monkeypatch.setenv("DATABASE_URL", "postgres://secret")
    monkeypatch.setenv("API_KEY", "secret")
    monkeypatch.setenv("PATH", "safe-path")
    env = worker.repository_subprocess_environment()
    assert "DATABASE_URL" not in env
    assert "API_KEY" not in env
    assert env["PATH"] == "safe-path"


def _http_status_error(status_code):
    """Build an httpx.HTTPStatusError carrying the given response status."""
    import httpx
    request = httpx.Request("POST", "http://localhost:8000/review")
    response = httpx.Response(status_code, request=request)
    return httpx.HTTPStatusError(f"HTTP {status_code}", request=request, response=response)


def test_ai_service_5xx_is_not_retryable():
    # The exact bug behind runs stuck 'running': the LLM read times out, the
    # ai-service retries internally and returns 502. Retrying the whole worker
    # pipeline can't help, so a 5xx must be non-retryable.
    assert worker.is_retryable(_http_status_error(502)) is False
    assert worker.is_retryable(_http_status_error(500)) is False
    assert worker.is_retryable(_http_status_error(503)) is False


def test_timeouts_are_not_retryable():
    import httpx
    import subprocess
    assert worker.is_retryable(httpx.ReadTimeout("read timed out")) is False
    assert worker.is_retryable(subprocess.TimeoutExpired("git", 60)) is False


def test_transient_failures_stay_retryable():
    import httpx
    # ai-service actually down (restarting) -> ConnectError, worth a retry.
    assert worker.is_retryable(httpx.ConnectError("connection refused")) is True
    # A 4xx (e.g. bad request) is not a 5xx; classification only fast-fails 5xx.
    assert worker.is_retryable(_http_status_error(400)) is True
    # A generic hiccup (DB blip) is retryable.
    assert worker.is_retryable(RuntimeError("db connection reset")) is True
