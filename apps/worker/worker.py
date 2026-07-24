"""
worker.py — background worker that processes code-review jobs.

The Go API receives a GitHub webhook, persists it, and LPUSHes a JSON job onto
a Redis queue. This worker BRPOPs one job at a time and does the heavy lifting
(clone -> tests -> semgrep -> npm audit -> AI review), writing results to
Postgres. A crash on one job marks that run 'failed'; the loop continues.

Run: `cd apps/worker && python worker.py`. Config comes from apps/worker/.env
(DATABASE_URL, REDIS_URL, AI_SERVICE_URL). Requires git, npm, semgrep, and
pytest on PATH.
"""

import os
import json
import time
import tempfile
import stat
import shutil
import subprocess
import sys

import psycopg2
import redis
import httpx
from dotenv import load_dotenv

# start_http_server is non-blocking -- runs in a daemon thread so metrics stay
# available while process_job crunches a clone.
from prometheus_client import Counter, Histogram, start_http_server

# retrieval.py uses ripgrep to find files related to the changed ones (e.g.
# callers of a changed function), giving the AI reviewer context beyond the diff.
from retrieval import retrieve_related_files, read_file_contents

# Force line-buffered stdout/stderr. When start.ps1 / benchmark.ps1 / Docker
# launch this worker they redirect output to a FILE, and Python defaults to
# BLOCK buffering (not line buffering) for non-TTY streams -- so print()s sit
# in an ~8KB buffer and never reach logs\worker.log until it fills or the
# process exits. That made a perfectly healthy worker look dead (0-byte log,
# nothing in start.ps1's live tail). Line-buffering here fixes every launch
# path at the source, no `-u` flag or PYTHONUNBUFFERED needed on each caller.
sys.stdout.reconfigure(line_buffering=True)
sys.stderr.reconfigure(line_buffering=True)

# Load apps/worker/.env so os.getenv(...) below picks up config; a missing .env
# falls back to defaults (or None).
load_dotenv()


# --------------------------------------------------------------------------
# Prometheus metrics. start_http_server launches a daemon thread that serves
# /metrics. Bound once at import time (OUTSIDE main()) so the objects persist
# for the process lifetime and a scrape during an idle BRPOP still returns the
# latest counter values.
# --------------------------------------------------------------------------
# Per-type job duration histogram, sliced by job_type (test/semgrep/npm_audit/
# ai_review). The label set is open; new job_types need no code change.
JOB_DURATION = Histogram(
    "analysis_job_duration_seconds",
    "Time spent on analysis jobs",
    ["job_type"],
)
# Total jobs processed, labelled by terminal status. Only incremented at a final
# state, so a scrape never sees an inflated "running" count.
JOBS_TOTAL = Counter(
    "analysis_jobs_total",
    "Total analysis jobs processed",
    ["status"],
)
# Latency of just the LLM call -- the most expensive single step -- sampled
# separately from total job duration to reveal whether the LLM is the bottleneck.
AI_LATENCY = Histogram(
    "ai_review_latency_seconds",
    "Time spent on AI review",
)
# Token usage summed across jobs from the /review response's `tokens_used`
# field, enabling a cost dashboard via rate(ai_token_usage_total[30d]).
TOKEN_USAGE = Counter(
    "ai_token_usage_total",
    "Total LLM tokens used",
)
# Patch verification latency -- one observation per AI-suggested patch we
# apply+test in a throwaway workspace copy (verify_patch).
PATCH_VERIFY = Histogram(
    "patch_verify_seconds",
    "Time spent verifying one AI-suggested patch",
)

# Start the metrics server once per worker process. METRICS_PORT overrides the
# default 9090 so several workers on one machine can each expose their own
# /metrics. The try/except keeps a second worker on the same port (dev mistake)
# from crashing on a bind error -- the existing server keeps serving.
METRICS_PORT = int(os.getenv("METRICS_PORT", "9090"))
try:
    start_http_server(METRICS_PORT)
    print(f"Prometheus metrics server started on http://localhost:{METRICS_PORT}/metrics")
except OSError as e:
    print(f"Could not bind metrics server on :{METRICS_PORT} ({e}); metrics disabled for this process")


# Short identifier for THIS worker process, used to prefix log lines so output
# from multiple workers sharing the queue is distinguishable. Defaults to "1".
WORKER_ID = os.getenv("WORKER_ID", "1")


def get_db_connection():
    """Open a fresh Postgres connection from DATABASE_URL. One connection per
    job (simpler than pooling for this workload)."""
    return psycopg2.connect(os.getenv("DATABASE_URL"))


def get_redis_connection():
    """Open a Redis connection from REDIS_URL. Redis is used purely as a queue:
    the Go API LPUSHes jobs, we BRPOP them."""
    return redis.Redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379/0"))


def api_headers():
    """Headers shared by worker-to-API calls; empty in unauthenticated dev."""
    api_key = os.getenv("API_KEY")
    return {"X-API-Key": api_key} if api_key else {}


def post_comments(run_id):
    """Ask the API to publish this run's GitHub review comments."""
    base_url = os.getenv("API_BASE_URL", "http://localhost:8080").rstrip("/")
    response = httpx.post(
        f"{base_url}/api/analyses/{run_id}/post-comments",
        headers=api_headers(),
        timeout=30,
    )
    response.raise_for_status()


def get_github_token(run_id):
    """Return the OAuth token mapped to this run's repository, if one exists."""
    base_url = os.getenv("API_BASE_URL", "http://localhost:8080").rstrip("/")
    response = httpx.get(
        f"{base_url}/internal/analyses/{run_id}/github-token",
        headers=api_headers(),
        timeout=10,
    )
    if response.status_code == 204:
        return None
    response.raise_for_status()
    return response.json().get("token")


def git_clone_environment(token):
    """Use Git's transient config environment so credentials never enter URLs."""
    env = os.environ.copy()
    # A background worker must NEVER pop an interactive credential prompt.
    # Two inherited hooks cause that and must be neutralised:
    #   1. GIT_ASKPASS -- when this worker is launched from an editor terminal
    #      (Kiro/VS Code), it points at the editor's GUI password prompt. On an
    #      auth failure git calls it and BLOCKS forever on a dialog nobody
    #      answers (the real cause of jobs stuck 'running' for 40+ minutes).
    #   2. Git Credential Manager -- the "fatal: User cancelled dialog" popup.
    # Removing GIT_ASKPASS/SSH_ASKPASS, forcing GIT_TERMINAL_PROMPT=0, and
    # clearing credential.helper (below) leaves git with NO interactive
    # fallback, so a bad/missing token fails FAST as a clean, retryable error.
    for var in ("GIT_ASKPASS", "SSH_ASKPASS", "GIT_CREDENTIAL_HELPER"):
        env.pop(var, None)
    env["GIT_TERMINAL_PROMPT"] = "0"
    env["GCM_INTERACTIVE"] = "never"
    if token:
        env.update({
            "GIT_CONFIG_COUNT": "2",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": f"Authorization: Bearer {token}",
            # Empty helper = don't consult (or pop up) any credential store.
            "GIT_CONFIG_KEY_1": "credential.helper",
            "GIT_CONFIG_VALUE_1": "",
        })
    else:
        env.update({
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "credential.helper",
            "GIT_CONFIG_VALUE_0": "",
        })
    return env


def repository_execution_enabled():
    """Run repository-controlled tests by default only in development/test."""
    configured = os.getenv("RUN_REPOSITORY_TESTS")
    if configured is not None and configured.strip():
        return configured.strip().lower() in {"1", "true", "yes"}
    return os.getenv("ENVIRONMENT", "development").lower() in {"", "development", "test"}


def repository_subprocess_environment():
    """Remove platform credentials before executing repository-controlled code."""
    sensitive_markers = ("KEY", "TOKEN", "SECRET", "PASSWORD")
    sensitive_names = {"DATABASE_URL", "REDIS_URL", "REDIS_ADDR", "API_BASE_URL", "AI_SERVICE_URL"}
    return {
        key: value
        for key, value in os.environ.items()
        if key.upper() not in sensitive_names
        and not any(marker in key.upper() for marker in sensitive_markers)
    }


def process_job(job_data):
    """Process a single analysis job end-to-end.

    job_data is a dict from the Redis queue, e.g.:
        {"run_id": 42, "repo_full_name": "owner/repo", "pr_number": 7,
         "pr_title": "Fix login", "head_sha": "abc123", "branch": "feature/login"}

    Flow: (1) mark running, (2) clone & checkout, (3) tests + semgrep + npm
    audit, (4) diff + changed files, (5) gather related-file context, (6) read
    back tool logs, (7) call the AI service, (8) persist findings, (9) mark
    completed. On any exception the `except` block marks the run 'failed' and
    `finally` always cleans up the temp directory.
    """
    run_id = job_data["run_id"]
    repo_full_name = job_data["repo_full_name"]
    pr_number = job_data["pr_number"]
    pr_title = job_data.get("pr_title", "")
    head_sha = job_data["head_sha"]   # kept for reference; not currently used below
    branch = job_data["branch"]

    print(f"Starting analysis for run #{run_id}: {repo_full_name} PR #{pr_number}")

    db = get_db_connection()
    cursor = db.cursor()
    # None until Step 2 assigns it, so `finally` knows there's nothing to clean
    # up if we crash earlier.
    workspace = None

    try:
        # Step 1: mark the run running.
        cursor.execute(
            "UPDATE analysis_runs SET status = 'running', started_at = now() WHERE id = %s",
            (run_id,)
        )
        db.commit()

        # Step 2: clone into a per-job temp dir and check out the PR's branch.
        workspace = tempfile.mkdtemp(prefix=f"analysis_{run_id}_")
        print(f"Cloning repository {repo_full_name} into {workspace}")

        # Anonymous clone first: public repos (the common case) need no auth, so
        # a stale/expired stored OAuth token never enters the picture. Only if
        # the anonymous clone fails do we fetch and retry with the token, which
        # means the repo is actually private (or we're rate-limited).
        clone_url = f"https://github.com/{repo_full_name}.git"
        clone_result = subprocess.run(
            ["git", "clone", clone_url, workspace],
            capture_output=True, text=True, timeout=60,
            env=git_clone_environment(None),
        )
        if clone_result.returncode != 0:
            # Anonymous clone failed -- likely a private repo. Fetch the OAuth
            # token now (lazily) and retry with it.
            github_token = None
            try:
                github_token = get_github_token(run_id)
            except Exception as token_error:
                print(f"Could not load repository token for run #{run_id}: {token_error}")
            if github_token:
                print(f"Public clone unavailable for run #{run_id}; retrying with repository credentials")
                # git clone needs an empty target dir; the failed attempt may
                # have left a partial one. Clear it (same path so `finally`
                # still cleans it up) before the second try.
                safe_rmtree(workspace)
                os.makedirs(workspace, exist_ok=True)
                clone_result = subprocess.run(
                    ["git", "clone", clone_url, workspace],
                    capture_output=True, text=True, timeout=60,
                    env=git_clone_environment(github_token),
                )
        if clone_result.returncode != 0:
            raise Exception(f"git clone failed: {clone_result.stderr}")

        # cwd=workspace is required: git operates on the repo in the current dir.
        checkout_result = subprocess.run(
            ["git", "checkout", branch],
            cwd=workspace,
            capture_output=True, text=True, timeout=30
        )
        if checkout_result.returncode != 0:
            raise Exception(f"git checkout failed: {checkout_result.stderr}")

        # Step 3: run tests (if any), semgrep, and npm audit. Each tool's output
        # is saved as an analysis_jobs row for the dashboard and for the AI to
        # read in Step 6. Create the 'test' job row first so we have an id.
        test_job_id = create_job(cursor, run_id, "test")
        test_command = detect_test_command(workspace)
        if test_command is None:
            test_log = "no tests configured for this project"
        elif not repository_execution_enabled():
            test_log = "repository tests disabled; set RUN_REPOSITORY_TESTS=true only for trusted repositories"
        else:
            test_log = None
            print(f"Detected test command for run #{run_id}: {' '.join(test_command)}")
            run_command(cursor, db, test_job_id, workspace, test_command)

        if test_log is not None:
            cursor.execute(
                "UPDATE analysis_jobs SET status = 'completed', exit_code = 0, logs = %s, completed_at = now() WHERE id = %s",
                (test_log, test_job_id)
            )
            db.commit()
            print(f"{test_log} (run #{run_id})")

        # Static scans do not execute repository test scripts and run even when
        # the repository has no detected test command.
        run_semgrep(cursor, db, run_id, workspace)
        run_npm_audit(cursor, db, run_id, workspace)

        # Step 4: get the diff and the list of changed files. `main...HEAD` is
        # the set of changes since the branches diverged (what a PR shows).
        diff_result = subprocess.run(
            ["git", "diff", "main...HEAD"],
            cwd=workspace, capture_output=True, text=True, timeout=30
        )
        diff = diff_result.stdout

        files_result = subprocess.run(
            ["git", "diff", "--name-only", "main...HEAD"],
            cwd=workspace, capture_output=True, text=True, timeout=30
        )
        changed_files = [f for f in files_result.stdout.strip().split("\n") if f]

        # Step 5: build related-file context for the AI. Cap at 3 related files
        # per change so the prompt stays within the model's input limit.
        related = retrieve_related_files(workspace, changed_files)
        context_files = {}
        for changed, related_list in related.items():
            for rel_file in related_list[:3]:
                content = read_file_contents(workspace, rel_file)
                if content:
                    context_files[rel_file] = content

        # Step 6: read back the tool logs saved in Step 3, truncating each to
        # 2000 chars to keep the prompt small.
        cursor.execute(
            "SELECT job_type, logs FROM analysis_jobs WHERE run_id = %s AND logs IS NOT NULL",
            (run_id,)
        )
        tool_results = {}
        for job_type, logs in cursor.fetchall():
            tool_results[job_type] = logs[:2000]

        # Step 7: call the AI service. Time only the LLM round-trip so AI_LATENCY
        # excludes clone/scan/test time and shows whether the model is the
        # bottleneck. tokens_used is 0 when the provider didn't surface it, so
        # inc(0) is a harmless no-op.
        ai_t0 = time.time()
        findings, tokens_used = call_ai_service(
            run_id, diff, changed_files, context_files, tool_results,
            pr_title, repo_full_name, pr_number
        )
        AI_LATENCY.observe(time.time() - ai_t0)
        if tokens_used:
            TOKEN_USAGE.inc(tokens_used)

        # Step 8: save the AI findings (verification_status='unverified' since an
        # LLM suggested them, unlike the static-analysis findings).
        saved = save_findings(cursor, db, run_id, findings)

        # Step 8.5: patch verification. For each finding with a suggested_patch,
        # apply it in a throwaway workspace copy and run the tests; success flips
        # the finding to 'verified_by_test', failure to 'failed_verification'.
        # An LLM fix with a passing test is a much stronger signal than one
        # without, and surfacing that saves a reviewer re-checking it. This is
        # best-effort: if it raises we leave the finding 'unverified' and do NOT
        # fail the run.
        if findings and not repository_execution_enabled():
            print("Patch verification skipped: repository tests are disabled for this environment")
        elif findings:
            test_command = detect_test_command(workspace)
            if test_command is not None:
                try:
                    verify_ai_findings(cursor, db, run_id, workspace, saved, test_command)
                except Exception as ve:
                    print(f"Patch verification skipped for run #{run_id}: {ve}")
            else:
                print(f"Patch verification skipped for run #{run_id}: no test command detected")

        # Post the completed review through the configured API service. Comment
        # delivery remains best-effort so a transient GitHub failure does not
        # discard analysis results already stored in Postgres.
        try:
            post_comments(run_id)
            print(f"Posted comment for run #{run_id}")
        except Exception as e:
            print(f"Failed to post comment: {e}")

        # Step 9: mark the run finished.
        cursor.execute(
            "UPDATE analysis_runs SET status = 'completed', completed_at = now() WHERE id = %s",
            (run_id,)
        )
        db.commit()
        JOBS_TOTAL.labels(status="completed").inc()
        print(f"Analysis for run #{run_id} completed successfully.")

    except Exception as exc:
        print(f"Analysis failed for run #{run_id}: {exc}")
        cursor.execute(
            "UPDATE analysis_runs SET status = 'failed', error = %s, completed_at = now() WHERE id = %s",
            (str(exc), run_id)
        )
        db.commit()
        JOBS_TOTAL.labels(status="failed").inc()
        # Re-raise so process_job_with_retry can decide whether to retry.
        raise

    finally:
        # Always release the temp directory (can be hundreds of MB) and the DB
        # connection. workspace is None if we crashed before Step 2.
        if workspace and os.path.exists(workspace):
            safe_rmtree(workspace)
        cursor.close()
        db.close()


def safe_rmtree(path):
    """Delete a directory tree, working around a Windows gotcha.

    shutil.rmtree can't delete git's read-only "pack" files on Windows. The
    custom error handler chmods the offending file back to writable and retries.
    The handler param is `onexc` on Python 3.10+ and `onerror` before; we try
    the new name first and fall back via TypeError. (Don't replace this with a
    bare shutil.rmtree -- it WILL fail on Windows.)
    """
    def _on_error(func, p, _exc_info):
        try:
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            # If even chmod fails, give up rather than crash the worker over
            # one stubborn temp file.
            pass
    try:
        shutil.rmtree(path, onexc=_on_error)
    except TypeError:
        shutil.rmtree(path, onerror=_on_error)


def detect_test_command(workspace):
    """Pick a test command from the files present, or None if the repo has no
    detectable tests. Heuristic (covers the two common ecosystems):
        package.json           -> ["npm", "test"]
        Python markers / tests -> ["pytest", "-q"]
        neither                -> None
    """
    if os.path.exists(os.path.join(workspace, "package.json")):
        return ["npm", "test"]
    python_markers = [
        "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
        "Pipfile", "poetry.lock",
    ]
    has_python_marker = any(
        os.path.exists(os.path.join(workspace, marker))
        for marker in python_markers
    )
    # A tests/ or test/ dir is a strong signal even without a dependency file.
    has_test_dir = (
        os.path.isdir(os.path.join(workspace, "tests")) or
        os.path.isdir(os.path.join(workspace, "test"))
    )
    if (has_python_marker or has_test_dir) and shutil.which("pytest"):
        return ["pytest", "-q"]
    # Fallback: if any .py files exist, try pytest (it auto-discovers tests).
    # No tests -> pytest exits non-zero, which is fine for patch verification.
    # Only return pytest if it's on PATH, else subprocess.run raises WinError 2
    # and crashes the job.
    if shutil.which("pytest"):
        for root_dir, dirs, files in os.walk(workspace):
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            if any(f.endswith(".py") for f in files):
                return ["pytest", "-q"]
    return None


def create_job(cursor, run_id, job_type):
    """Insert an analysis_jobs row (status 'running') and return its new id.
    Each tool (test, semgrep, npm_audit) gets its own row so the dashboard can
    show each step separately."""
    cursor.execute(
        "INSERT INTO analysis_jobs (run_id, job_type, status) VALUES (%s, %s, 'running') RETURNING id",
        (run_id, job_type)
    )
    return cursor.fetchone()[0]


def run_command(cursor, db, job_id, workspace, command):
    """Run a command in `workspace`, capture output, and record the result on
    the analysis_jobs row. Used for the test step."""
    try:
        # timeout=120: tests over 2 minutes are treated as hung. JOB_DURATION
        # records wall-clock time sliced by job_type.
        t0 = time.time()
        result = subprocess.run(
            command, cwd=workspace, env=repository_subprocess_environment(),
            capture_output=True, text=True, timeout=120
        )
        JOB_DURATION.labels(job_type="test").observe(time.time() - t0)
        # Save stdout+stderr concatenated so the dashboard shows full output.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout + result.stderr, job_id)
        )
        db.commit()
        return result
    except subprocess.TimeoutExpired:
        # Record the observation even on timeout -- ">120s" is a signal we want.
        JOB_DURATION.labels(job_type="test").observe(time.time() - t0)
        # exit_code 124 is the conventional timeout code. Re-raise via the
        # returned CompletedProcess so the run is marked failed.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 124, logs = 'Command timed out', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        return subprocess.CompletedProcess(args=command, returncode=124, stdout="Command timed out", stderr="")


def run_semgrep(cursor, db, run_id, workspace):
    """Run a Semgrep security scan and save findings with verification_status
    'verified_by_static_analysis' (Semgrep matched a rule, it's not a guess)."""
    job_id = create_job(cursor, run_id, "semgrep")

    # If semgrep isn't installed, mark skipped and bail cleanly -- otherwise
    # subprocess.run raises WinError 2 and crashes the run.
    semgrep_path = shutil.which("semgrep")
    if not semgrep_path:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = 'semgrep not found on PATH -- install it to enable static analysis', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        print(f"Semgrep skipped for run #{run_id}: not installed")
        return

    # Prefer our custom rules if present; otherwise fall back to "auto".
    custom_rules = os.path.join(os.path.dirname(__file__), "custom_semgrep_rule.yml")
    config = custom_rules if os.path.exists(custom_rules) else "auto"

    try:
        t0 = time.time()
        try:
            result = subprocess.run(
                [semgrep_path, "scan", "--json", f"--config={config}", workspace],
                capture_output=True, text=True, timeout=120
            )
        except FileNotFoundError:
            cursor.execute(
                "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = 'semgrep executable not found (WinError 2).', completed_at = now() WHERE id = %s",
                (job_id,)
            )
            db.commit()
            print(f"Semgrep skipped for run #{run_id}: not found")
            return
        JOB_DURATION.labels(job_type="semgrep").observe(time.time() - t0)

        semgrep_output = json.loads(result.stdout)

        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout, job_id)
        )
        db.commit()

        # .get(...) with defaults keeps us alive if Semgrep's schema shifts.
        for finding in semgrep_output.get("results", []):
            severity = map_semgrep_severity(finding.get("extra", {}).get("severity", "INFO"))
            cursor.execute(
                """INSERT INTO findings (run_id, file_path, line_start, line_end, severity, category,
                   title, description, evidence, confidence, verification_status)
                   VALUES (%s, %s, %s, %s, %s, 'security', %s, %s, %s, 0.9, 'verified_by_static_analysis')""",
                (run_id, finding.get("path", ""),
                 finding.get("start", {}).get("line"),
                 finding.get("end", {}).get("line"),
                 severity,
                 finding.get("check_id", "semgrep finding"),
                 finding.get("extra", {}).get("message", ""),
                 finding.get("extra", {}).get("lines", ""))
            )
        db.commit()
        print(f"Semgrep found {len(semgrep_output.get('results', []))} issues")

    except Exception as e:
        # A failed security scan is worth surfacing -- record it and re-raise.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = %s, completed_at = now() WHERE id = %s",
            (str(e), job_id)
        )
        db.commit()
        raise


def map_semgrep_severity(semgrep_severity):
    """Map Semgrep's ERROR/WARNING/INFO to our high/medium/low. Case-insensitive;
    unknown values default to "low" (safer than guessing "high")."""
    mapping = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
    return mapping.get(semgrep_severity.upper(), "low")


def run_npm_audit(cursor, db, run_id, workspace):
    """Run `npm audit --json` and save vulnerable dependencies as findings
    (category 'dependency_risk', verification_status 'verified_by_static_analysis')."""
    job_id = create_job(cursor, run_id, "npm_audit")

    npm_path = shutil.which("npm")
    if not npm_path:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = 'npm not found on PATH -- install it to enable dependency scanning', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        print(f"npm audit skipped for run #{run_id}: not installed")
        return

    try:
        # npm audit EXITS NON-ZERO when vulnerabilities exist -- that's expected;
        # we read the JSON, not the exit code, to decide findings.
        t0 = time.time()
        try:
            result = subprocess.run(
                [npm_path, "audit", "--json"],
                cwd=workspace, capture_output=True, text=True, timeout=60
            )
        except FileNotFoundError:
            cursor.execute(
                "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = 'npm executable not found (WinError 2).', completed_at = now() WHERE id = %s",
                (job_id,)
            )
            db.commit()
            print(f"npm audit skipped for run #{run_id}: not found")
            return
        JOB_DURATION.labels(job_type="npm_audit").observe(time.time() - t0)

        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout, job_id)
        )
        db.commit()

        try:
            audit = json.loads(result.stdout)
            vulnerabilities = audit.get("vulnerabilities", {})

            # One row per vulnerable package. `via` is a list of advisories/paths
            # joined into the description; empty -> "unknown".
            for pkg_name, pkg_info in vulnerabilities.items():
                severity = pkg_info.get("severity", "low")
                via_list = pkg_info.get("via", [])
                via_str = ", ".join(str(v) for v in via_list) if via_list else "unknown"

                cursor.execute(
                    """INSERT INTO findings (run_id, file_path, severity, category, title, description,
                       confidence, verification_status)
                       VALUES (%s, 'package.json', %s, 'dependency_risk', %s, %s, 0.95, 'verified_by_static_analysis')""",
                    (run_id, severity,
                     f"Vulnerable dependency: {pkg_name}",
                     f"Package '{pkg_name}' has {severity} severity vulnerability. Via: {via_str}")
                )
            db.commit()
            print(f"npm audit found {len(vulnerabilities)} vulnerable packages")

        except json.JSONDecodeError:
            # npm audit sometimes prints non-JSON (e.g. no package-lock.json).
            # The job row is already 'completed' with raw stdout, so nothing is
            # lost -- log and move on without findings.
            print("npm audit output was not valid JSON")

    except Exception as e:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', logs = %s, completed_at = now() WHERE id = %s",
            (str(e), job_id)
        )
        db.commit()
        raise


def call_ai_service(run_id, diff, changed_files, context_files, tool_results, pr_title, repo_full_name, pr_number):
    """POST the gathered inputs to the AI service's /review endpoint and return
    (findings, tokens_used). raise_for_status propagates 4xx/5xx to process_job's
    except block; we deliberately don't retry here."""
    response = httpx.post(
        os.getenv("AI_SERVICE_URL", "http://localhost:8000") + "/review",
        json={
            "run_id": run_id,
            "repo_full_name": repo_full_name,
            "pr_number": pr_number,
            "pr_title": pr_title,
            "diff": diff,
            "changed_files": changed_files,
            "context_files": context_files,
            "tool_results": tool_results,
        },
        # Must exceed the ai-service's WORST-CASE response time or the worker
        # gives up while the ai-service is still successfully retrying a slow
        # LLM call. ai-service budget = OPENCODE_GO_TIMEOUT * (retries+1) +
        # backoff ~= 60*3 + 3 = 183s, so default here is 200s.
        timeout=int(os.getenv("AI_REQUEST_TIMEOUT", "200")),
    )
    response.raise_for_status()
    # tokens_used defaults to 0 when the provider didn't surface it, so the
    # TOKEN_USAGE inc(0) is a harmless no-op.
    response_json = response.json()
    findings = response_json.get("findings", [])
    tokens_used = int(response_json.get("tokens_used") or 0)
    return findings, tokens_used


def save_findings(cursor, db, run_id, findings):
    """Insert every AI-supplied finding with verification_status='unverified'
    (an LLM guessed them). Returns a list of (finding_id, finding_dict) pairs so
    verify_ai_findings can UPDATE each row by primary key rather than a fragile
    re-SELECT on (run_id, file_path, title). .get(...) defaults guard against an
    LLM that omitted a field."""
    saved = []
    for finding in findings:
        cursor.execute(
            """INSERT INTO findings (run_id, file_path, line_start, line_end, severity, category,
               title, description, evidence, confidence, verification_status, suggested_patch)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'unverified', %s)
               RETURNING id""",
            (run_id,
             finding.get("file_path", "unknown"),
             finding.get("line_start"),
             finding.get("line_end"),
             finding.get("severity", "low"),
             finding.get("category", "maintainability"),
             finding.get("title", "Untitled finding"),
             finding.get("description", ""),
             finding.get("evidence"),
             finding.get("confidence", 0.5),
             finding.get("suggested_patch"))
        )
        finding_id = cursor.fetchone()[0]
        saved.append((finding_id, finding))
    # One commit for all rows -- cheaper than per row.
    db.commit()
    return saved


def verify_patch(workspace, patch, test_command):
    """Apply a patch in a COPY of `workspace` and run the tests there.

    The copy is essential: `git apply` modifies files in place and we mustn't
    pollute the real workspace the rest of process_job still uses.

    Returns a (status, message) tuple where status is "verified_by_test" or
    "failed_verification" -- values the frontend's VERIFICATION_STYLES map
    expects, so the dashboard badge lights up without frontend changes.
    """
    import tempfile
    import shutil
    # One histogram observation per patch (benchmark.ps1's patch test reads it).
    with PATCH_VERIFY.time(), tempfile.TemporaryDirectory() as tmpdir:
        shutil.copytree(workspace, tmpdir, dirs_exist_ok=True)
        # `git apply -` reads the diff from stdin (input=patch).
        patch_result = subprocess.run(
            ["git", "apply", "-"],
            cwd=tmpdir, input=patch, text=True, capture_output=True
        )
        if patch_result.returncode != 0:
            return "failed_verification", f"Patch did not apply cleanly: {patch_result.stderr.strip()[:500]}"
        try:
            test_result = subprocess.run(
                test_command, cwd=tmpdir, env=repository_subprocess_environment(),
                capture_output=True, text=True, timeout=60
            )
        except subprocess.TimeoutExpired:
            return "failed_verification", "Tests timed out"
        if test_result.returncode == 0:
            return "verified_by_test", "Tests passed with patch applied"
        else:
            return "failed_verification", f"Tests failed: {test_result.stderr.strip()[:500]}"


def verify_ai_findings(cursor, db, run_id, workspace, findings, test_command):
    """For each finding with a suggested_patch, verify it via verify_patch and
    UPDATE the row's verification_status plus an appended verification message.
    Findings without a patch stay 'unverified'."""
    verified_count = 0
    failed_count = 0
    skipped_count = 0
    for finding_id, finding in findings:
        patch = finding.get("suggested_patch")
        if not patch:
            skipped_count += 1
            continue
        status, msg = verify_patch(workspace, patch, test_command)
        # Append the result to the description so the dashboard shows WHY the
        # badge is green/red, keeping the original AI description on top.
        cursor.execute(
            """UPDATE findings
               SET verification_status = %s,
                   description = description || E'\\n\\n[Verification]: ' || %s
               WHERE id = %s""",
            (status, msg, finding_id)
        )
        if status == "verified_by_test":
            verified_count += 1
        else:
            failed_count += 1
    db.commit()
    print(f"Patch verification for run #{run_id}: {verified_count} verified, {failed_count} failed, {skipped_count} skipped")
    JOBS_TOTAL.labels(status=f"verified_by_test").inc(verified_count)
    JOBS_TOTAL.labels(status="failed_verification").inc(failed_count)


STALE_RUN_MINUTES = int(os.getenv("STALE_RUN_MINUTES", "15"))


def reap_stale_runs():
    """Mark orphaned 'running' rows as failed on startup.

    A job is dequeued (removed from Redis) BEFORE it's marked 'running', so if
    the worker dies mid-job (crash, kill, machine reboot) nothing ever updates
    that row -- it's stuck 'running' forever and can't be re-run (the payload is
    gone from the queue). The honest recovery is to fail it, not re-queue it.

    We only touch rows older than STALE_RUN_MINUTES (default 15). A healthy job
    finishes in seconds; even hitting every step's timeout tops out around 8
    minutes, so 15 is safely above any legitimately-running job -- meaning a job
    actively running on ANOTHER live worker is never reaped out from under it.
    ponytail: startup-only reap (no heartbeat/lease). Ceiling -- a job orphaned
    while this worker keeps running won't be cleaned until the next restart;
    upgrade path is a periodic reap tick or a per-run worker heartbeat.
    """
    try:
        db = get_db_connection()
        cursor = db.cursor()
        cursor.execute(
            """UPDATE analysis_runs
               SET status = 'failed',
                   error = 'reaped: run was left in progress by a worker that exited',
                   completed_at = now()
               WHERE status = 'running'
                 AND started_at < now() - make_interval(mins => %s)""",
            (STALE_RUN_MINUTES,)
        )
        reaped = cursor.rowcount
        db.commit()
        cursor.close()
        db.close()
        if reaped > 0:
            print(f"[worker-{WORKER_ID}] reaped {reaped} stale 'running' run(s) older than {STALE_RUN_MINUTES}m")
    except Exception as e:
        # Reaping is best-effort housekeeping; never block worker startup on it.
        print(f"[worker-{WORKER_ID}] stale-run reap skipped: {e}")


def main():
    """The worker's event loop: connect to Redis, then forever BRPOP jobs and
    hand each to process_job_with_retry(). One job at a time, in order; run
    multiple worker processes for throughput."""
    reap_stale_runs()
    redis_conn = get_redis_connection()
    print(f"[worker-{WORKER_ID}] started. Waiting for jobs on Redis queue 'ai_review_jobs'...")
    while True:
        # BRPOP (blocking right pop) sleeps inside Redis until an item is
        # available. LPUSH (API) + BRPOP (here) gives FIFO order -- the Go API
        # MUST keep using LPUSH to match, or ordering breaks silently.
        # timeout=1 returns None after 1s so the loop stays Ctrl+C responsive.
        result = redis_conn.brpop("ai_review_jobs", timeout=1)
        if result is None:
            continue

        # BRPOP returns (queue_name, raw_message); we only need the message.
        _, message = result
        job_data = json.loads(message)

        try:
            process_job_with_retry(job_data)
        except Exception as e:
            # Backstop: process_job_with_retry swallows its own exceptions, so
            # reaching here means something failed before its try/except.
            print(f"Error processing job: {e}")


def is_retryable(exc):
    """Decide whether a process_job failure is worth re-running the pipeline for.

    Retries exist for SELF-HEALING hiccups (DB blip, ai-service restarting,
    a transient connection drop). They are NOT for deterministic slowness:

      - httpx.TimeoutException / subprocess.TimeoutExpired: a step hung once
        and will hang again; re-running just re-hangs.
      - AI-service 5xx: the ai-service is up (we got an HTTP response) but its
        upstream LLM already failed AFTER the ai-service's own internal retries
        -- classically an LLM read timeout laundered into a 502. Our pipeline
        can't fix a slow/broken LLM; a retry only re-runs clone + tests + a
        fresh 183s LLM budget and pins the run 'running' for 10-15 min.

    A genuine ai-service restart surfaces as httpx.ConnectError (a
    TransportError, NOT an HTTPStatusError), so it stays retryable.
    """
    if isinstance(exc, (httpx.TimeoutException, subprocess.TimeoutExpired)):
        return False
    if isinstance(exc, httpx.HTTPStatusError) and exc.response.status_code >= 500:
        return False
    return True


def process_job_with_retry(job_data, max_retries=3):
    """Process a job with exponential-backoff retries.

    On each failure we sleep 30 * 2^attempt seconds (30s, 60s, 120s) and try
    again, up to max_retries. Exponential backoff gives a struggling upstream
    time to recover; only TRANSIENT failures (see is_retryable) are retried.
    After the last attempt the job is parked on a dead-letter queue.
    """
    for attempt in range(max_retries):
        try:
            process_job(job_data)
            return
        except Exception as e:
            print(f"Job failed (attempt {attempt + 1}/{max_retries}): {e}")

            # Only retry transient failures. A timeout is deterministic: the
            # step hung once and will hang again, so re-running the whole
            # pipeline just pins the run 'running' for 10-15 min before failing.
            non_retryable = not is_retryable(e)
            last_attempt = attempt >= max_retries - 1

            if not non_retryable and not last_attempt:
                wait_time = 30 * (2 ** attempt)
                print(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
                continue

            if non_retryable:
                print("Deterministic failure (timeout or AI-service 5xx) -- not retrying (a retry would just re-run the same hang). Dead-lettering.")
            else:
                print(f"Job permanently failed after {max_retries} attempts -- pushing to dead-letter queue")
            # Park the job on a second Redis list instead of losing it, with the
            # last error attached for the dashboard. A DLQ push failure must
            # never crash the worker.
            dead_payload = {
                "run_id": job_data.get("run_id"),
                "repo_full_name": job_data.get("repo_full_name"),
                "pr_number": job_data.get("pr_number"),
                "error": str(e),
                "failed_at": time.time(),
            }
            try:
                get_redis_connection().lpush("ai_review_jobs_dead", json.dumps(dead_payload))
            except Exception as dlq_err:
                print(f"Failed to push to dead-letter queue: {dlq_err}")
            return


if __name__ == "__main__":
    main()
