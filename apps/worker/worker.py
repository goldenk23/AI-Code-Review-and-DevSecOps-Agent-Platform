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
import time        # currently unused here but kept for future retry/sleep logic
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

# retrieval.py sits next to this file in apps/worker/. It uses ripgrep to find
# files related to the ones that changed (e.g. callers of a changed function),
# which gives the AI reviewer helpful context beyond the raw diff.
from retrieval import retrieve_related_files, read_file_contents

# Read apps/worker/.env so os.getenv(...) calls below pick up our config.
# If .env is missing, the getenv calls will return their fallback defaults
# (or None), which usually means "can't connect" later — so keep .env present.
load_dotenv()


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
        clone_result = subprocess.run(
            ["git", "clone", f"https://github.com/{repo_full_name}.git", workspace],
            capture_output=True, text=True, timeout=60
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
        findings = call_ai_service(
            run_id, diff, changed_files, context_files, tool_results,
            pr_title, repo_full_name, pr_number
        )

        # ---------------------------------------------------------------
        # Step 8: Save the AI findings to the `findings` table.
        # ---------------------------------------------------------------
        # save_findings (defined below) inserts one row per finding, all with
        # verification_status='unverified' (because an LLM suggested them,
        # they aren't proven yet — unlike semgrep/npm audit findings which are
        # 'verified_by_static_analysis').
        save_findings(cursor, db, run_id, findings)
        # post comment
        try:
            httpx.post(
                f"http://localhost:8080/api/analyses/{run_id}/post-comments",
                timeout=30
            )
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
        print(f"Analysis for run #{run_id} completed successfully.")

    except Exception as exc:
        # ANY exception from any step lands here. We log it and mark the run
        # 'failed' with the error message in the `error` column, so the user
        # can see in the dashboard why their run didn't finish. We do NOT
        # re-raise — the worker loop in main() should keep going for the next
        # job, not die because one job broke.
        print(f"Analysis failed for run #{run_id}: {exc}")
        cursor.execute(
            "UPDATE analysis_runs SET status = 'failed', error = %s, completed_at = now() WHERE id = %s",
            (str(exc), run_id)
        )
        db.commit()

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
      requirements.txt OR pyproject.toml present -> ["pytest", "-q"]
      neither                 -> None (caller treats that as "no tests")
    This is intentionally a heuristic — it doesn't detect every framework,
    but it covers the two most common ecosystems in repos we review.
    """
    if os.path.exists(os.path.join(workspace, "package.json")):
        return ["npm", "test"]
    if os.path.exists(os.path.join(workspace, "requirements.txt")) or os.path.exists(os.path.join(workspace, "pyproject.toml")):
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
    the test step. The same pattern (run → UPDATE job row → commit) appears in
    run_semgrep and run_npm_audit, but those also parse the output into findings.
    """
    try:
        # timeout=120: tests should never take more than 2 minutes; if they do,
        # something is hung and we'd rather fail the job than hang forever.
        result = subprocess.run(
            command, cwd=workspace,
            capture_output=True, text=True, timeout=120
        )
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
        # Special case: the command took longer than 120s. We mark the job
        # as failed with exit_code 124 (the conventional "timeout" code, the
        # same number the `timeout` coreutils uses) and re-raise so the run
        # is marked failed too — no point continuing if tests are hanging.
        cursor.execute(
            "UPDATE analysis_jobs SET status = 'failed', exit_code = 124, logs = 'Command timed out', completed_at = now() WHERE id = %s",
            (job_id,)
        )
        db.commit()
        raise Exception(f"Command {command} timed out")


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

    # Prefer our hand-written rules (apps/worker/custom_semgrep_rule.yml) if
    # present; otherwise fall back to "auto" which pulls in Semgrep's bundled
    # rule set. `os.path.dirname(__file__)` is the directory containing this
    # worker.py — handy for locating files placed next to it.
    custom_rules = os.path.join(os.path.dirname(__file__), "custom_semgrep_rule.yml")
    config = custom_rules if os.path.exists(custom_rules) else "auto"

    try:
        # `semgrep scan --json --config=<rules> <workspace>` scans the given
        # directory and prints JSON to stdout describing what it found.
        result = subprocess.run(
            ["semgrep", "scan", "--json", f"--config={config}", workspace],
            capture_output=True, text=True, timeout=120
        )

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

    try:
        # `npm audit --json` prints its report to stdout. Note: npm audit
        # EXITS NON-ZERO if any vulnerabilities exist — that's expected and
        # NOT an error from our perspective; we look at the JSON, not the
        # exit code, to decide what findings to record.
        result = subprocess.run(
            ["npm", "audit", "--json"],
            cwd=workspace, capture_output=True, text=True, timeout=60
        )

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
    # .get("findings", []) returns [] if the key is missing, so a slightly
    # malformed reply still yields a usable (empty) result instead of a KeyError.
    return response.json().get("findings", [])


def save_findings(cursor, db, run_id, findings):
    """Insert every AI-supplied finding into the `findings` table.

    Unlike Semgrep/npm-audit findings, AI findings are guesses — an LLM said
    "this looks like a bug" — so we mark them verification_status='unverified'.
    A later step (the "patch verification" stretch goal) could try to actually
    prove them, but for now they're surfaced as unverified.

    `finding.get(key, default)` insulates us from an LLM that omitted a field
    in its JSON. We'd rather record "Untitled finding" / "unknown" / 0.5 than
    crash a whole run because the model skipped one field.
    """
    for finding in findings:
        cursor.execute(
            """INSERT INTO findings (run_id, file_path, line_start, line_end, severity, category,
               title, description, evidence, confidence, verification_status)
               VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, 'unverified')""",
            (run_id,
             finding.get("file_path", "unknown"),
             finding.get("line_start"),
             finding.get("line_end"),
             finding.get("severity", "low"),
             finding.get("category", "maintainability"),
             finding.get("title", "Untitled finding"),
             finding.get("description", ""),
             finding.get("evidence"),
             finding.get("confidence", 0.5))
        )
    # One commit for all the rows in this run — cheaper than committing per row.
    db.commit()


def main():
    """The worker's main event loop: connect to Redis, then forever pull jobs
    off the queue and hand each one to process_job().

    This is intentionally simple — no threading, no async, no multiprocessing.
    One job at a time, in order. That's enough for a learning project; for real
    throughput you'd run multiple worker processes (each running this same
    loop) all BRPOP-ing the same queue.
    """
    redis_conn = get_redis_connection()
    print("Worker started. Waiting for jobs on Redis queue 'ai_review_jobs'...")
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
            # Hand the parsed job to process_job(). If it raises, we print the
            # error and loop again — one bad job must NOT kill the worker.
            # (process_job itself has a try/except that marks the run failed,
            # so most errors won't even reach this outer try. This is the
            # "everything exploded before we could record it" backstop.)
            process_job(job_data)
        except Exception as e:
            print(f"Error processing job: {e}")
            # Optionally you could push the job back to Redis for a retry, or
            # write it to a dead-letter queue. We don't, intentionally: a job
            # that raised twice would loop forever, and we'd rather drop it
            # and see the error in logs.

# Standard Python idiom: "if this file was run directly (python worker.py),
# call main(). If it was imported (e.g. by a test), don't." Lets us import
# helpers like save_findings without auto-starting the worker loop.
if __name__ == "__main__":
    main()
    