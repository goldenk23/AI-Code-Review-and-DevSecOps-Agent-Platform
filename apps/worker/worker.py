"""
worker.py — The background worker that processes code-review jobs.

ROLE IN THE SYSTEM
------------------
The Go API receives a GitHub webhook, saves it to Postgres, and pushes a small
JSON "job" onto a Redis queue. It does NOT do the actual review — that's slow
work (cloning repos, running tests, calling an LLM), so it hands it off to us.

This file is the "us": an infinite loop that pulls one job at a time off Redis,
does the heavy lifting (clone → tests → semgrep → npm audit → AI review), and
writes the results into Postgres. If we crash on a job, that one run is marked
'failed' but the loop keeps going for the next one.

HOW TO RUN
----------
    cd apps/worker
    python worker.py

It reads its config from apps/worker/.env (DATABASE_URL, REDIS_URL, AI_SERVICE_URL).
Requires git, npm, semgrep, and pytest to be installed and on PATH — we shell
out to them like a human would in a terminal.
"""

# --- Standard library imports (built into Python, nothing to install) ---
import os          # read environment variables (config loaded from .env)
import json        # parse JSON job messages from Redis; parse semgrep/npm audit output
import time        # time.time() for the JOB_DURATION / AI_LATENCY histogram measurements; sleep() for retry backoff
import tempfile    # tempfile.mkdtemp() — create a unique temp dir to clone repos into
import stat        # stat.S_IWRITE — file permission flag used by safe_rmtree()
import shutil      # shutil.rmtree() — delete a whole directory tree (the temp workspace)

# subprocess is the key one: it lets us run external programs (git, npm, semgrep,
# pytest) from inside Python and capture their output. Think of it as a way to
# "type a terminal command and read back what it printed".
import subprocess

# --- Third-party imports (installed via apps/worker/requirement.txt) ---
import psycopg2    # PostgreSQL driver — lets us run SQL from Python
import redis       # Redis client — we use it to POP jobs off the queue
import httpx       # HTTP client — used to POST to the AI service's /review endpoint
from dotenv import load_dotenv   # reads .env file and populates os.environ

# Prometheus client -- exports 4 metrics on a separate HTTP server (port 9090)
# so any Prometheus/Grafana scraper can pull them. Light touch: we're not
# adding a full tracing layer here, just the four numbers the spec asks for.
# `start_http_server` is non-blocking -- runs in a daemon thread so it can
# keep serving while process_job crunches a clone.
from prometheus_client import Counter, Histogram, start_http_server

# retrieval.py sits next to this file in apps/worker/. It uses ripgrep to find
# files related to the ones that changed (e.g. callers of a changed function),
# which gives the AI reviewer helpful context beyond the raw diff.
from retrieval import retrieve_related_files, read_file_contents

# Read apps/worker/.env so os.getenv(...) calls below pick up our config.
# If .env is missing, the getenv calls will return their fallback defaults
# (or None), which usually means "can't connect" later — so keep .env present.
load_dotenv()


# --------------------------------------------------------------------------
# Prometheus metrics -- 4 gauges/counters per the observability spec.
# `start_http_server(9090)` launches a daemon thread that serves /metrics.
# It's intentionally OUTSIDE `main()` so it survives even if the BRPOP loop
# is mid-sleep -- a scrape during a 1s idle still gets back the latest
# counter values. We bind once at import time, not per-job, so the objects
# persist for the process's lifetime.
# --------------------------------------------------------------------------
# 1) Per-type job duration histogram. Labels let us slice by `test` /
#    `semgrep` / `npm_audit` / `ai_review`. (The label set is open; new
#    job_types don't need a code change to be observed.)
JOB_DURATION = Histogram(
    "analysis_job_duration_seconds",
    "Time spent on analysis jobs",
    ["job_type"],
)
# 2) Total jobs processed, labelled by terminal status (completed/failed).
#    A status="running" label is never written here -- the counter is only
#    incremented when a job reaches a final state, so a scrape never sees
#    an inflated "running" count.
JOBS_TOTAL = Counter(
    "analysis_jobs_total",
    "Total analysis jobs processed",
    ["status"],
)
# 3) Latency of just the LLM call -- the most expensive single step. Sampling
#    this separately from total job duration tells us whether the LLM is the
#    bottleneck (likely) or whether clones/scans are. Recording happens in
#    step 7 of process_job, around the `call_ai_service` call.
AI_LATENCY = Histogram(
    "ai_review_latency_seconds",
    "Time spent on AI review",
)
# 4) Token usage -- the AI service's /review endpoint includes a
#    `tokens_used` field in its response when the underlying LLM provider
#    surfaces it. We sum across all jobs so a 30-day cost dashboard is
#    literally `rate(ai_token_usage_total[30d]) * $/1M`.
TOKEN_USAGE = Counter(
    "ai_token_usage_total",
    "Total LLM tokens used",
)
# 5) Patch verification latency -- one observation per AI-suggested patch we
#    apply+test in a throwaway workspace copy (verify_patch). benchmark.ps1's
#    `-Only patch` test reads patch_verify_seconds_sum/_count off /metrics.
PATCH_VERIFY = Histogram(
    "patch_verify_seconds",
    "Time spent verifying one AI-suggested patch",
)

# Start the metrics server ONCE per worker process. METRICS_PORT overrides the
# default 9090 so several workers on one machine can each expose their own
# /metrics (benchmark.ps1's scaling test spawns its extra workers on 9091/9092).
# We use a try/except so that two workers on the SAME port (dev mistake)
# doesn't crash the second one with a bind error -- it just logs and moves on,
# and the existing server keeps serving.
METRICS_PORT = int(os.getenv("METRICS_PORT", "9090"))
try:
    start_http_server(METRICS_PORT)
    print(f"Prometheus metrics server started on http://localhost:{METRICS_PORT}/metrics")
except OSError as e:
    # Most common: "Address already in use" when another worker (or another
    # dev on the same machine) has the port. Don't crash -- the existing
    # metrics server is fine.
    print(f"Could not bind metrics server on :{METRICS_PORT} ({e}); metrics disabled for this process")


# Short identifier for THIS worker process, used to prefix log lines so output
# from multiple workers sharing the queue is distinguishable. Defaults to "1";
# set WORKER_ID=2, =3, ... when running extra workers.
WORKER_ID = os.getenv("WORKER_ID", "1")


def get_db_connection():
    """Open a fresh connection to Postgres using the DATABASE_URL env var.

    psycopg2.connect returns a "connection" object. A connection can have one or
    more "cursors" — a cursor is what actually runs SQL and returns results.
    We open one connection per job (simpler than pooling for this workload)."""
    return psycopg2.connect(os.getenv("DATABASE_URL"))


def get_redis_connection():
    """Open a connection to Redis using the REDIS_URL env var.

    We only create this once (in main()) and reuse it for the whole worker loop.
    Redis here is used purely as a queue: the Go API LPUSHes jobs, we BRPOP them."""
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
    if token:
        env.update({
            "GIT_CONFIG_COUNT": "1",
            "GIT_CONFIG_KEY_0": "http.extraHeader",
            "GIT_CONFIG_VALUE_0": f"Authorization: Bearer {token}",
        })
    return env


def process_job(job_data):
    """
    Process a single analysis job end-to-end.

    job_data is a dict straight from the Redis queue, e.g.:
        {"run_id": 42, "repo_full_name": "owner/repo", "pr_number": 7,
         "pr_title": "Fix login", "head_sha": "abc123", "branch": "feature/login"}

    The overall flow is nine numbered steps:
      1. Mark the run as 'running'    2. Clone & checkout the repo
      3. Run tests + semgrep + npm audit
      4. Get the diff and changed files
      5. Gather related-file context for the AI
      6. Read back the tool logs we saved in Step 3
      7. Call the AI service to actually review
      8. Persist the AI findings to Postgres
      9. Mark the run as 'completed'
    If ANYTHING raises, the `except` block marks the run 'failed' and the
    `finally` block always cleans up the temp directory.
    """
    # Pull the job's fields into locally-named variables for readability.
    # `.get("pr_title", "")` returns "" if pr_title is missing rather than
    # crashing — defensive against slightly different job shapes.
    run_id = job_data["run_id"]
    repo_full_name = job_data["repo_full_name"]
    pr_number = job_data["pr_number"]
    pr_title = job_data.get("pr_title", "")
    head_sha = job_data["head_sha"]   # kept for reference; not currently used below
    branch = job_data["branch"]

    print(f"Starting analysis for run #{run_id}: {repo_full_name} PR #{pr_number}")

    # Open a DB connection + cursor for this job. `cursor` is our scratchpad for
    # all SQL — every INSERT/UPDATE in the steps below goes through it.
    db = get_db_connection()
    cursor = db.cursor()
    # `workspace` will point to the temp directory we clone into. We initialize
    # it to None so the `finally` block knows whether there's anything to clean
    # up even if we crash before Step 2 assigns it.
    workspace = None

    try:
        # ---------------------------------------------------------------
        # Step 1: Tell the database (and the dashboard watching it) that
        # this run is now in progress. Anything that was 'queued' before we
        # picked it up becomes 'running' the instant we get here.
        # ---------------------------------------------------------------
        # %s is psycopg2's placeholder for a parameter — we pass (run_id,)
        # as a tuple. NEVER use f-strings or % to build SQL with user data;
        # placeholders are how you avoid SQL injection. (run_id came from our
        # own queue so it's trusted, but the habit matters.)
        cursor.execute(
            "UPDATE analysis_runs SET status = 'running', started_at = now() WHERE id = %s",
            (run_id,)
        )
        # Until we call db.commit(), the UPDATE is staged but not saved.
        # If we crashed now without committing, Postgres would roll it back.
        db.commit()

        # ---------------------------------------------------------------
        # Step 2: Clone the repo into a temp directory and switch to the
        # PR's branch. The temp dir is per-job and is deleted in `finally`.
        # ---------------------------------------------------------------
        # mkdtemp creates a fresh, uniquely-named empty directory. The prefix
        # is just for humans — when you list /tmp you'll see "analysis_42_abc"
        # and immediately know which run it belongs to.
        workspace = tempfile.mkdtemp(prefix=f"analysis_{run_id}_")
        print(f"Cloning repository {repo_full_name} into {workspace}")

        # `subprocess.run([...], capture_output=True, text=True, timeout=60)`
        # means: run `git clone https://github.com/owner/repo.git <workspace>`
        # as if typed in a terminal, capture its stdout/stderr as text, and
        # give up after 60 seconds. `returncode` is 0 on success, non-zero
        # on failure (e.g. repo not found, network down).
        github_token = None
        try:
            github_token = get_github_token(run_id)
        except Exception as token_error:
            # Public repositories can still clone anonymously. A private clone
            # will fail clearly below and be retried by the normal job wrapper.
            print(f"Could not load repository token for run #{run_id}: {token_error}")

        clone_result = subprocess.run(
            ["git", "clone", f"https://github.com/{repo_full_name}.git", workspace],
            capture_output=True, text=True, timeout=60,
            env=git_clone_environment(github_token),
        )
        if clone_result.returncode != 0:
            # Raising here jumps to the `except Exception` block below, which
            # marks the run 'failed' and records the error. Clean failure.
            raise Exception(f"git clone failed: {clone_result.stderr}")

        # We cloned the *default* branch. Now switch to the PR's actual branch
        # so Steps 3-4 operate on the code being reviewed, not on main.
        # cwd=workspace is critical: without it git wouldn't know which repo
        # to act on (it operates on "the repo in the current directory").
        checkout_result = subprocess.run(
            ["git", "checkout", branch],
            cwd=workspace,
            capture_output=True, text=True, timeout=30
        )
        if checkout_result.returncode != 0:
            raise Exception(f"git checkout failed: {checkout_result.stderr}")

        # ---------------------------------------------------------------
        # Step 3: Run the repo's tests (if any), run Semgrep for security,
        # and run `npm audit` for vulnerable dependencies. Each tool's
        # output gets saved as a row in `analysis_jobs` for later display
        # in the dashboard and for the AI to read in Step 6.
        # ---------------------------------------------------------------
        # First, create a 'test' job row so we have an id to update later.
        # detect_test_command looks at the files present (package.json vs
        # requirements.txt/pyproject.toml) and picks npm test or pytest, or
        # returns None if the repo doesn't look like it has tests.
        test_job_id = create_job(cursor, run_id, "test")
        test_command = detect_test_command(workspace)
        if test_command is None:
            # No recognizable test setup — record that as a completed job with
            # a friendly message rather than trying to run something and failing.
            cursor.execute(
                "UPDATE analysis_jobs SET status = 'completed', exit_code = 0, logs = 'no tests configured for this project', completed_at = now() WHERE id = %s",
                (test_job_id,)
            )
            db.commit()
            print(f"No tests configured for run #{run_id}; skipping test step.")
        else:
            # We DO have tests. Run them, then run the two security tools.
            # All three functions insert their own findings into the `findings`
            # table and update their `analysis_jobs` row with stdout/stderr.
            print(f"Detected test command for run #{run_id}: {' '.join(test_command)}")
            run_command(cursor, db, test_job_id, workspace, test_command)
            run_semgrep(cursor, db, run_id, workspace)
            run_npm_audit(cursor, db, run_id, workspace)

        # ---------------------------------------------------------------
        # Step 4: Get the diff (what changed) and the list of changed files.
        # ---------------------------------------------------------------
        # `git diff main...HEAD` compares the PR branch (HEAD, which we
        # checked out in Step 2) against the `main` branch. The three dots
        # `...` mean "everything changed since the two branches diverged",
        # which is exactly the set of changes a PR would show on GitHub.
        # cwd=workspace makes git run *inside* the cloned repo.
        # capture_output=True + text=True grab stdout/stderr as strings
        # instead of printing them to our terminal.
        diff_result = subprocess.run(
            ["git", "diff", "main...HEAD"],
            cwd=workspace, capture_output=True, text=True, timeout=30
        )
        diff = diff_result.stdout  # the actual diff text; we'll send it to the AI

        # `--name-only` lists *just the file paths* that changed, no diff body.
        # We want this list so (a) we can show "Files changed" in the UI, and
        # (b) so we can look up related files for context in Step 5.
        files_result = subprocess.run(
            ["git", "diff", "--name-only", "main...HEAD"],
            cwd=workspace, capture_output=True, text=True, timeout=30
        )
        # .strip().split("\n") turns "a.py\nb.ts\nc.go\n" -> ["a.py", "b.ts", "c.go"].
        # The `if f` guard skips the empty string you'd get if the output was
        # totally blank (no trailing newline with content, or no changes).
        changed_files = [f for f in files_result.stdout.strip().split("\n") if f]

        # ---------------------------------------------------------------
        # Step 5: Build "context" — related files the AI should look at
        # alongside the diff. A diff alone often isn't enough to judge a bug;
        # seeing the file that calls the changed function helps a lot.
        # ---------------------------------------------------------------
        # retrieve_related_files (from retrieval.py) uses ripgrep to find files
        # that import or reference the changed files. Returns a dict like:
        #   {"login.ts": ["auth.ts", "login.test.ts"], ...}
        related = retrieve_related_files(workspace, changed_files)
        context_files = {}
        # Loop over each changed file and its list of related files.
        # `[:3]` caps it at 3 related files per change so the prompt doesn't
        # explode in size (LLMs have a max input they can accept).
        for changed, related_list in related.items():
            for rel_file in related_list[:3]:
                # read_file_contents reads the file off disk; returns None
                # if the file doesn't exist or can't be read (skip in that case).
                content = read_file_contents(workspace, rel_file)
                if content:
                    context_files[rel_file] = content

        # ---------------------------------------------------------------
        # Step 6: Pull together the *results* of the tools we already ran
        # (npm test, semgrep, npm audit). These are already saved as rows in
        # the `analysis_jobs` table from Steps 3 above — we just read them back.
        # ---------------------------------------------------------------
        cursor.execute(
            "SELECT job_type, logs FROM analysis_jobs WHERE run_id = %s AND logs IS NOT NULL",
            (run_id,)
        )
        tool_results = {}
        # fetchall() returns a list of rows; each row is (job_type, logs).
        # We turn it into a dict like {"test": "...", "semgrep": "..."}.
        # logs[:2000] truncates each log to 2000 chars — same reason as the
        # context cap above: keep the prompt small enough for the model.
        for job_type, logs in cursor.fetchall():
            tool_results[job_type] = logs[:2000]

        # ---------------------------------------------------------------
        # Step 7: Ask the AI service to review everything we gathered.
        # ---------------------------------------------------------------
        # call_ai_service (defined below) POSTs to the FastAPI ai-service
        # at http://localhost:8000/review, which then calls the LLM.
        # It returns a list of finding dicts like:
        #   {"title": "SQL injection", "severity": "high", "file_path": "login.ts", ...}
        # If the AI service is down or returns an error, this raises an
        # exception that the outer `except` block will catch and mark the
        # run as 'failed' — no findings get saved in that case.
        #
        # We wrap the call in a time.time() bracket so AI_LATENCY records
        # just the LLM round-trip -- clone/scan/test time is excluded, which
        # makes it obvious from the dashboard whether the model is the
        # bottleneck vs. the repo I/O.
        ai_t0 = time.time()
        # `call_ai_service` returns (findings, tokens_used). tokens_used is
        # 0 when the AI service didn't surface the field -- in that case the
        # counter inc by 0, which is a no-op (Prometheus client libraries
        # don't emit a sample for inc(0), so /metrics stays clean).
        findings, tokens_used = call_ai_service(
            run_id, diff, changed_files, context_files, tool_results,
            pr_title, repo_full_name, pr_number
        )
        AI_LATENCY.observe(time.time() - ai_t0)
        if tokens_used:
            TOKEN_USAGE.inc(tokens_used)

        # ---------------------------------------------------------------
        # Step 8: Save the AI findings to the `findings` table.
        # ---------------------------------------------------------------
        # save_findings (defined below) inserts one row per finding, all with
        # verification_status='unverified' (because an LLM suggested them,
        # they aren't proven yet — unlike semgrep/npm audit findings which are
        # 'verified_by_static_analysis').
        saved = save_findings(cursor, db, run_id, findings)

        # ---------------------------------------------------------------
        # Step 8.5: Patch verification (stretch goal).
        # ---------------------------------------------------------------
        # For each AI finding that includes a `suggested_patch` field, we
        # copy the workspace to a throwaway temp dir, `git apply` the patch,
        # and run the repo's test command. If the tests pass, the finding's
        # verification_status flips from 'unverified' to 'verified_by_test'
        # (with a note in the description). If the patch doesn't apply
        # cleanly OR the tests still fail, we mark it 'failed_verification'.
        #
        # Why bother: an LLM-suggested fix with a passing test is a much
        # stronger signal than an LLM-suggested fix with no test. Surfacing
        # that signal upstream (in the dashboard's verification badge)
        # saves a human reviewer from re-checking what the AI already proved.
        #
        # The verification is best-effort -- if it raises, we DON'T fail
        # the run; we just leave the finding as 'unverified'. The patch
        # verification is a stretch feature, not a critical path.
        if findings:
            test_command = detect_test_command(workspace)
            if test_command is not None:
                try:
                    verify_ai_findings(cursor, db, run_id, workspace, saved, test_command)
                except Exception as ve:
                    # Don't let verification crash the whole job -- log and move on.
                    print(f"Patch verification skipped for run #{run_id}: {ve}")
            else:
                print(f"Patch verification skipped for run #{run_id}: no test command detected (no package.json, requirements.txt, pyproject.toml, setup.py, Pipfile, poetry.lock, or tests/ directory found)")

        # Post the completed review through the configured API service. Comment
        # delivery remains best-effort so a transient GitHub failure does not
        # discard analysis results already stored in Postgres.
        try:
            post_comments(run_id)
            print(f"Posted comment for run #{run_id}")
        except Exception as e:
            print(f"Failed to post comment: {e}")
        # ---------------------------------------------------------------
        # Step 9: Mark the run as finished. (This used to be Step 4 before
        # the AI integration was added — now it's the last thing we do.)
        # ---------------------------------------------------------------
        cursor.execute(
            "UPDATE analysis_runs SET status = 'completed', completed_at = now() WHERE id = %s",
            (run_id,)
        )
        db.commit()
        # Prometheus: this run reached a terminal state so increment the
        # JOBS_TOTAL counter with status="completed". The retry wrapper
        # watches this label to decide whether to retry -- see process_job_with_retry.
        JOBS_TOTAL.labels(status="completed").inc()
        print(f"Analysis for run #{run_id} completed successfully.")

    except Exception as exc:
        # ANY exception from any step lands here. We log it and mark the run
        # 'failed' with the error message in the `error` column, so the user
        # can see in the dashboard why their run didn't finish. We do NOT
        # re-raise here, but we DO re-raise after recording the failure so
        # the OUTER process_job_with_retry can decide whether to retry.
        print(f"Analysis failed for run #{run_id}: {exc}")
        cursor.execute(
            "UPDATE analysis_runs SET status = 'failed', error = %s, completed_at = now() WHERE id = %s",
            (str(exc), run_id)
        )
        db.commit()
        JOBS_TOTAL.labels(status="failed").inc()
        # Re-raise so process_job_with_retry sees the exception and can
        # decide to retry. The outer wrapper catches everything so this never
        # escapes to the BRPOP loop.
        raise

    finally:
        # `finally` runs whether we succeeded or failed. Two resources must
        # always be released: the temp directory (it can be hundreds of MB
        # for big repo clones) and the DB connection (Postgres caps how many
        # can be open at once). We use `if workspace` because if we crashed
        # before Step 2, workspace is still None and there's nothing to delete.
        if workspace and os.path.exists(workspace):
            safe_rmtree(workspace)
        cursor.close()
        db.close()


def safe_rmtree(path):
    """Delete a directory tree, working around a Windows-specific gotcha.

    shutil.rmtree normally can't delete git's "pack" files because they're
    marked read-only on Windows. We pass a custom error handler that chmod's
    the offending file back to writable and retries the delete. On older
    Python the parameter is called `onerror`; on 3.10+ it's `onexc`. We try
    the new name first and fall back to the old one via TypeError.
    (Don't replace this with a bare shutil.rmtree — it WILL fail on Windows.)
    """
    def _on_error(func, p, _exc_info):
        try:
            # S_IWRITE is the "writable" permission bit. Adding it lets the
            # subsequent func(p) call (rmtree's internal delete) succeed.
            os.chmod(p, stat.S_IWRITE)
            func(p)
        except OSError:
            # If even chmod fails, give up silently — better than crashing
            # the worker over one stubborn temp file.
            pass
    try:
        # Newer Python signature: onexc (3.10+).
        shutil.rmtree(path, onexc=_on_error)
    except TypeError:
        # Older Python signature: onerror (pre-3.10).
        shutil.rmtree(path, onerror=_on_error)


def detect_test_command(workspace):
    """Pick the right test command based on the files present in the repo.

    Returns the command as a list (the shape subprocess.run expects) or None
    if the repo doesn't look like it has tests. We keep this simple:
      package.json present    -> ["npm", "test"]
      Python project markers   -> ["pytest", "-q"]
      neither                 -> None (caller treats that as "no tests")
    This is intentionally a heuristic — it doesn't detect every framework,
    but it covers the two most common ecosystems in repos we review.

    Python project markers we check (any one is enough):
      requirements.txt, pyproject.toml, setup.py, setup.cfg, Pipfile, poetry.lock
    We also check for a tests/ or test/ directory as a strong signal that
    the repo has tests even if the dependency file is missing or named
    differently (e.g. a repo that uses a Makefile or conda environment).
    """
    if os.path.exists(os.path.join(workspace, "package.json")):
        return ["npm", "test"]
    # Check for common Python project markers. Any one of these strongly
    # suggests this is a Python project where pytest would work.
    python_markers = [
        "requirements.txt", "pyproject.toml", "setup.py", "setup.cfg",
        "Pipfile", "poetry.lock",
    ]
    has_python_marker = any(
        os.path.exists(os.path.join(workspace, marker))
        for marker in python_markers
    )
    # Also check for a tests/ or test/ directory — a strong signal that
    # the repo has tests even without a standard dependency file.
    has_test_dir = (
        os.path.isdir(os.path.join(workspace, "tests")) or
        os.path.isdir(os.path.join(workspace, "test"))
    )
    if (has_python_marker or has_test_dir) and shutil.which("pytest"):
        return ["pytest", "-q"]
    # Final fallback: if the repo has any .py files, try pytest anyway.
    # pytest auto-discovers test files (test_*.py / *_test.py) anywhere in
    # the tree, so it can find tests even without standard markers.
    # If there are no tests, pytest exits non-zero -- which is fine for
    # patch verification (the finding gets 'failed_verification' instead
    # of staying 'unverified', which is still more informative).
    # BUT: only return pytest if it's actually installed on PATH --
    # otherwise subprocess.run will raise FileNotFoundError (WinError 2)
    # and crash the whole job.
    if shutil.which("pytest"):
        for root_dir, dirs, files in os.walk(workspace):
            # Skip hidden directories (.git, .venv, node_modules, etc.)
            dirs[:] = [d for d in dirs if not d.startswith(".")]
            if any(f.endswith(".py") for f in files):
                return ["pytest", "-q"]
    return None


def create_job(cursor, run_id, job_type):
    """Insert a new row into the `analysis_jobs` table and return its new id.

    Every tool we run (test, semgrep, npm_audit) gets its own job row so the
    dashboard can show each step's status and logs separately. The row starts
    in 'running' state; the caller updates it to 'completed' or 'failed'
    once the tool finishes.

    RETURNING id is Postgres syntax that hands us back the auto-generated id
    of the newly inserted row — we fetchone()[0] to pull it out as a plain int.
    """
    cursor.execute(
        "INSERT INTO analysis_jobs (run_id, job_type, status) VALUES (%s, %s, 'running') RETURNING id",
        (run_id, job_type)
    )
    return cursor.fetchone()[0]


def run_command(cursor, db, job_id, workspace, command):
    """Run a shell command in `workspace`, capture its output, and record the
    result against the `analysis_jobs` row identified by `job_id`.

    This is the generic "run a thing and save what it printed" helper, used for
    the test step. The same pattern (run + UPDATE job row + commit) appears in
    run_semgrep and run_npm_audit, but those also parse the output into findings.
    """
    try:
        # timeout=120: tests should never take more than 2 minutes; if they do,
        # something is hung and we'd rather fail the job than hang forever.
        # JOB_DURATION histogram: measure wall-clock time for this step sliced
        # by job_type so we can see "npm test takes 8s avg, semgrep takes 3s"
        # from the metrics endpoint.
        t0 = time.time()
        result = subprocess.run(
            command, cwd=workspace,
            capture_output=True, text=True, timeout=120
        )
        JOB_DURATION.labels(job_type="test").observe(time.time() - t0)
        # result.returncode is 0 if the command succeeded, non-zero otherwise.
        # We save BOTH stdout and stderr concatenated so the dashboard can show
        # the full output regardless of which stream the error went to.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout + result.stderr, job_id)
        )
        db.commit()
        return result
    except subprocess.TimeoutExpired:
        # Even a timed-out run counts as far as the histogram is concerned --
        # the wall-clock observation is "this run took >120s", which is exactly
        # the noisy signal we want to see in metrics.
        JOB_DURATION.labels(job_type="test").observe(time.time() - t0)
        # Special case: the command took longer than 120s. We mark the job
        # as failed with exit_code 124 (the conventional "timeout" code, the
        # same number the `timeout` coreutils uses) and re-raise so the run
        # is marked failed too — no point continuing if tests are hanging.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 124, logs = 'Command timed out', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        return subprocess.CompletedProcess(args=command, returncode=124, stdout="Command timed out", stderr="")


def run_semgrep(cursor, db, run_id, workspace):
    """Run Semgrep security scan and save findings to the database.

    Semgrep is a static-analysis tool that looks for known vulnerability
    patterns (SQL injection, hard-coded secrets, etc.) using rules. We run it
    with --json so the output is machine-readable, then transform each finding
    into a row in our `findings` table with verification_status =
    'verified_by_static_analysis' (it's not a guess — Semgrep literally matched
    a rule against the code).
    """
    # Create the job row now so we can update it as we go.
    job_id = create_job(cursor, run_id, "semgrep")

    # Guard: if semgrep isn't installed, mark skipped and bail out cleanly.
    # subprocess.run would raise FileNotFoundError (WinError 2) otherwise,
    # which would crash the whole run and produce zero findings.
    semgrep_path = shutil.which("semgrep")
    if not semgrep_path:
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = 'semgrep not found on PATH -- install it to enable static analysis', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        print(f"Semgrep skipped for run #{run_id}: not installed")
        return

    # Prefer our hand-written rules (apps/worker/custom_semgrep_rule.yml) if
    # present; otherwise fall back to "auto" which pulls in Semgrep's bundled
    # rule set. `os.path.dirname(__file__)` is the directory containing this
    # worker.py — handy for locating files placed next to it.
    custom_rules = os.path.join(os.path.dirname(__file__), "custom_semgrep_rule.yml")
    config = custom_rules if os.path.exists(custom_rules) else "auto"

    try:
        # `semgrep scan --json --config=<rules> <workspace>` scans the given
        # directory and prints JSON to stdout describing what it found.
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

        # Parse Semgrep's JSON output. Top-level shape is roughly:
        #   {"results": [{ "path": "...", "start": {...}, "end": {...},
        #                  "check_id": "...", "extra": {"severity": "...", ...} }, ...]}
        semgrep_output = json.loads(result.stdout)

        # Record the raw stdout as the job's logs so a human can debug later.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout, job_id)
        )
        db.commit()

        # Turn each Semgrep result into a `findings` row. .get(...) with a
        # default keeps us alive even if Semgrep's schema changes slightly.
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
        # If Semgrep itself blew up (e.g. not installed, rule parse error),
        # record the failure on the job row and re-raise so the run is marked
        # failed. We DON'T silently swallow — security scans failing is worth
        # surfacing.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 1, logs = %s, completed_at = now() WHERE id = %s",
            (str(e), job_id)
        )
        db.commit()
        raise


def map_semgrep_severity(semgrep_severity):
    """Translate Semgrep's severity names into ours.

    Semgrep uses ERROR/WARNING/INFO; our findings table uses high/medium/low.
    We upper-case the input so "error" or "Error" also match. Anything we
    don't recognize becomes "low" — safer than guessing "high".
    """
    mapping = {"ERROR": "high", "WARNING": "medium", "INFO": "low"}
    return mapping.get(semgrep_severity.upper(), "low")


def run_npm_audit(cursor, db, run_id, workspace):
    """Run `npm audit` and save vulnerable dependencies as findings.

    `npm audit` checks the package.json / package-lock.json against npm's
    vulnerability database and prints JSON describing each known-bad package.
    Each becomes a findings row with category='dependency_risk'. Like Semgrep,
    these are marked 'verified_by_static_analysis' because they come straight
    from a published advisory database, not from an AI guess.
    """
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
        # `npm audit --json` prints its report to stdout. Note: npm audit
        # EXITS NON-ZERO if any vulnerabilities exist — that's expected and
        # NOT an error from our perspective; we look at the JSON, not the
        # exit code, to decide what findings to record.
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

        # Save the raw audit JSON to logs for posterity.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'completed', exit_code = %s, logs = %s, completed_at = now() WHERE id = %s",
            (result.returncode, result.stdout, job_id)
        )
        db.commit()

        # npm audit's JSON shape: {"vulnerabilities": { "<pkg>": { "severity": "...",
        #                                                          "via": [...], ... }, ... }}
        try:
            audit = json.loads(result.stdout)
            vulnerabilities = audit.get("vulnerabilities", {})

            # Insert one findings row per vulnerable package. `via` is a list
            # of advisories/paths; we join them into a single string for the
            # description. If `via` is empty we say "unknown" (still useful).
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
            # Sometimes npm audit prints non-JSON (e.g. if there's no
            # package-lock.json yet). We log and move on without findings —
            # the job row above is already marked 'completed' with the raw
            # stdout, so it's not lost.
            print("npm audit output was not valid JSON")

    except Exception as e:
        # If the `npm audit` subprocess itself failed (timeout, npm not
        # installed, etc.), mark the job row failed and re-raise.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', logs = %s, completed_at = now() WHERE id = %s",
            (str(e), job_id)
        )
        db.commit()
        raise


def call_ai_service(run_id, diff, changed_files, context_files, tool_results, pr_title, repo_full_name, pr_number):
    """POST everything we've gathered to the AI service's /review endpoint
    and return its list of findings.

    The AI service (apps/ai-service/main.py) is a separate FastAPI app on port
    8000. It takes the diff + context + tool results, sends them to an LLM, and
    replies with {"findings": [...]}. This function is the worker's only HTTP
    client call — everything else is git/subprocess/SQL.

    `response.raise_for_status()` raises if the AI service returned a 4xx/5xx,
    which propagates up to process_job's `except` block and marks the run
    failed. We deliberately don't retry here — the outer workflow already
    knows how to handle a raised exception.
    """
    response = httpx.post(
        # AI_SERVICE_URL lets you override the base (e.g. if the AI service
        # moves). The /review path is the one defined in apps/ai-service/main.py.
        os.getenv("AI_SERVICE_URL", "http://localhost:8000") + "/review",
        # httpx's `json=` kwarg serializes the dict to JSON and sets the
        # Content-Type: application/json header automatically.
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
        timeout=120,   # LLM calls can be slow; give it 2 minutes
    )
    # Raise httpx.HTTPStatusError if the AI service returned an error code.
    response.raise_for_status()
    # The response shape is {"findings": [...], "tokens_used": <int>?}.
    # The AI service includes tokens_used when the underlying provider
    # surfaces it; if it doesn't, default to 0 so the TOKEN_USAGE counter's
    # inc(0) is a harmless no-op (Prometheus client doesn't emit a sample
    # for zero increments, keeping /metrics clean).
    response_json = response.json()
    findings = response_json.get("findings", [])
    tokens_used = int(response_json.get("tokens_used") or 0)
    return findings, tokens_used


def save_findings(cursor, db, run_id, findings):
    """Insert every AI-supplied finding into the `findings` table.

    Unlike Semgrep/npm-audit findings, AI findings are guesses — an LLM said
    "this looks like a bug" — so we mark them verification_status='unverified'.
    A later step (the "patch verification" stretch goal, see verify_ai_findings)
    can try to actually prove them by applying the suggested_patch and running
    the repo's tests; rows where that succeeds flip to 'verified_by_test'.

    `finding.get(key, default)` insulates us from an LLM that omitted a field
    in its JSON. We'd rather record "Untitled finding" / "unknown" / 0.5 than
    crash a whole run because the model skipped one field.

    Returns a list of (finding_id, finding_dict) pairs so the caller
    (verify_ai_findings) can UPDATE each row by its primary key without
    having to re-SELECT on (run_id, file_path, title) -- which is fragile
    if the LLM happened to produce two findings with the same title+path.
    """
    saved = []
    for finding in findings:
        # INSERT ... RETURNING id hands us the new row's primary key so
        # the verifier can UPDATE it directly by id later.
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
    # One commit for all the rows in this run -- cheaper than committing per row.
    db.commit()
    return saved


def verify_patch(workspace, patch, test_command):
    """Apply a patch in a COPY of `workspace` and run the test suite there.

    The copy is essential: `git apply` modifies files in place, and we don't
    want to pollute the real workspace that the rest of process_job is still
    using. tempfile.TemporaryDirectory() with shutil.copytree gives us an
    isolated throwaway tree we can trash if the patch breaks tests.

    Returns a (status_string, message) tuple:
      - ("verified_by_test", "...") : patch applied + tests passed.
      - ("failed_verification", "..."): patch failed to apply OR tests failed.

    The status strings match the values the frontend's VERIFICATION_STYLES
    map expects, so the dashboard's verification badge color just lights up
    without any frontend changes.
    """
    import tempfile
    import shutil
    # Time the whole apply+test cycle (one histogram observation per patch) --
    # this is the metric benchmark.ps1's patch-verification test reads.
    with PATCH_VERIFY.time(), tempfile.TemporaryDirectory() as tmpdir:
        # dirs_exist_ok=True is needed on 3.8+; the real workspace has files
        # we want to overwrite, but the tmpdir starts empty.
        shutil.copytree(workspace, tmpdir, dirs_exist_ok=True)
        # `git apply -` reads a unified diff from stdin. We pass the patch in
        # via `input=patch` so we don't have to write it to a temp file first.
        patch_result = subprocess.run(
            ["git", "apply", "-"],
            cwd=tmpdir, input=patch, text=True, capture_output=True
        )
        if patch_result.returncode != 0:
            return "failed_verification", f"Patch did not apply cleanly: {patch_result.stderr.strip()[:500]}"
        # Run the test command in the patched copy. If the patch fixes the
        # bug, tests should pass; if it doesn't, this is exactly the signal
        # we want to surface as "AI suggested but its fix doesn't work."
        try:
            test_result = subprocess.run(
                test_command, cwd=tmpdir, capture_output=True, text=True, timeout=60
            )
        except subprocess.TimeoutExpired:
            return "failed_verification", "Tests timed out"
        if test_result.returncode == 0:
            return "verified_by_test", "Tests passed with patch applied"
        else:
            return "failed_verification", f"Tests failed: {test_result.stderr.strip()[:500]}"


def verify_ai_findings(cursor, db, run_id, workspace, findings, test_command):
    """For each AI finding that has a suggested_patch, apply it in a temp
    copy of the workspace and run the test suite. UPDATE the finding row
    with the new verification_status + the verification message appended
    to the description.

    Findings without a `suggested_patch` field are left as 'unverified'.

    We open a fresh DB connection? No -- the caller's cursor is fine; we're
    on the same transaction. db.commit() at the end flushes all UPDATEs
    in one go.
    """
    verified_count = 0
    failed_count = 0
    skipped_count = 0
    for finding_id, finding in findings:
        patch = finding.get("suggested_patch")
        if not patch:
            # No AI-suggested fix -- leave as 'unverified'.
            skipped_count += 1
            continue
        status, msg = verify_patch(workspace, patch, test_command)
        # Append the verification result to the description so the dashboard
        # shows WHY this finding got a green/red badge (not just the badge
        # alone). The `\\n\\n[Verification]: ...` separator keeps the
        # original AI description intact at the top.
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
    # Prometheus counter: track verified-by-test as a separate label so we
    # can see in metrics what fraction of AI suggestions actually compile+pass.
    # (We don't materialize this as a new JOBS_TOTAL counter -- that's about
    # the entire run; patch verification is a sub-step. If we wanted a real
    # time series here, we'd add a dedicated Counter in PROMETHEUS section.)
    JOBS_TOTAL.labels(status=f"verified_by_test").inc(verified_count)
    JOBS_TOTAL.labels(status="failed_verification").inc(failed_count)


def main():
    """The worker's main event loop: connect to Redis, then forever pull jobs
    off the queue and hand each one to process_job_with_retry() -- which wraps
    process_job() with exponential-backoff retries on failure.

    This is intentionally simple — no threading, no async, no multiprocessing.
    One job at a time, in order. That's enough for a learning project; for real
    throughput you'd run multiple worker processes (each running this same
    loop) all BRPOP-ing the same queue.
    """
    redis_conn = get_redis_connection()
    print(f"[worker-{WORKER_ID}] started. Waiting for jobs on Redis queue 'ai_review_jobs'...")
    while True:
        # BRPOP = "Blocking Right POP". It pulls the rightmost item from the
        # list `ai_review_jobs`. The "B" is the important part: instead of
        # polling Redis in a tight loop ("anything yet? anything yet?"), BRPOP
        # sleeps inside Redis until something is available, then returns it.
        # Much more efficient and lower latency.
        #
        # Why the right and the API LPUSHes to the left? LPUSH adds to the
        # head, BRPOP removes from the tail → FIFO order: oldest jobs go first.
        # The Go API MUST keep using LPUSH to match this — change one side
        # and you silently break ordering (or even starve jobs).
        #
        # timeout=1 means "if nothing arrives within 1 second, return None".
        # We do this so the loop can re-check things (and so Ctrl+C is
        # responsive) instead of truly blocking forever. With a real load
        # you'd just block indefinitely, but 1s is nice for local dev.
        result = redis_conn.brpop("ai_review_jobs", timeout=1)
        if result is None:
            continue  # No job arrived in the last second — loop and wait again.

        # BRPOP returns a tuple (queue_name, raw_message). We don't need the
        # queue name, so we discard it with `_`. The message is a JSON string
        # the Go API serialized — we turn it back into a dict with json.loads.
        _, message = result
        job_data = json.loads(message)

        try:
            # process_job_with_retry handles the retry loop. It catches every
            # exception from process_job and either retries (with sleep) or,
            # after max_retries attempts, leaves the run as 'failed' (which
            # process_job's except block has already written to the DB) and
            # returns normally -- so the BRPOP loop keeps going.
            process_job_with_retry(job_data)
        except Exception as e:
            # The only way to get here is if process_job_with_retry itself
            # raises, which it shouldn't (it swallows all exceptions). This
            # is a true backstop -- "something exploded before we had a
            # try/except set up" -- and we just log + continue.
            print(f"Error processing job: {e}")


def process_job_with_retry(job_data, max_retries=3):
    """Process a job with retry logic and exponential backoff.

    Wraps process_job() in a retry loop. On each failure (signaled by
    process_job raising -- which it now does after recording status='failed'
    + incrementing JOBS_TOTAL[failed]), we sleep `30 * 2^attempt` seconds
    (30s, 60s, 120s) and try again. After the last attempt, we give up and
    let the run stay failed.

    Why exponential backoff vs. fixed delay: transient failures (the AI
    service is restarting, the DB connection hiccupped, a 5xx from GitHub)
    are usually self-resolving within seconds; retrying immediately is rude
    and can pile up load on a struggling upstream. Exponential gives that
    upstream time to recover without skipping the retry entirely.

    Why 3 attempts: spec default. Beyond that you're usually just hammering
    a broken service -- a real production setup would push the failed job
    to a dead-letter queue for inspection instead of retrying ad infinitum.
    """
    for attempt in range(max_retries):
        try:
            process_job(job_data)
            return  # Success -- no retry needed.
        except Exception as e:
            print(f"Job failed (attempt {attempt + 1}/{max_retries}): {e}")
            if attempt < max_retries - 1:
                # 30, 60, 120 seconds. The multiplier is 2 so the backoff
                # roughly doubles each retry -- the classic exponential curve.
                wait_time = 30 * (2 ** attempt)
                print(f"Retrying in {wait_time} seconds...")
                time.sleep(wait_time)
            else:
                print(f"Job permanently failed after {max_retries} attempts -- pushing to dead-letter queue")
                # Park the job on a second Redis list instead of losing it, so
                # it can be inspected/replayed later. We attach the last error
                # so the dashboard can show why it died. A DLQ push failure must
                # never crash the worker -- log it and move on.
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


# Standard Python idiom: "if this file was run directly (python worker.py),
# call main(). If it was imported (e.g. by a test), don't." Lets us import
# helpers like save_findings without auto-starting the worker loop.
if __name__ == "__main__":
    main()
    