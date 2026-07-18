# How things flow

Three request flows cover everything implemented so far. Walking through each
one is the fastest way to understand the system.

## Flow 1 — A pull request gets reviewed

This is the main event. Triggered when GitHub sends a `pull_request` webhook
to `/webhooks/github`.

```
GitHub  PR opened
   │
   │ POST /webhooks/github  (with X-Hub-Signature-256 header)
   ▼
apps/api  (handler.go: Handler.HandleGitHubWebhook)
   │
   ├─ 1. Verify the HMAC signature using GITHUB_WEBHOOK_SECRET.
   │     If it doesn't match → 401. This proves the request is from GitHub.
   │
   ├─ 2. Ignore anything that isn't action="opened" or "synchronize" on a PR.
   │
   ├─ 3. Upsert the repository row (by github_repo_id).
   │
   ├─ 4. Upsert the pull_request row (by repo_id + pr_number).
   │
   ├─ 5. INSERT ... INTO analysis_runs ... ON CONFLICT (repo_id, pr_id, commit_sha)
   │     DO NOTHING — so re-delivering the same webhook doesn't dup the run.
   │     New run starts in status='queued'.
   │
   ├─ 6. queue.EnqueueAnalysis(ctx, payload)
   │     → LPUSH ai_review_jobs  (left/head of the Redis list)
   │
   └─ 7. Return 202 to GitHub immediately. The slow work hasn't happened yet.

   (sometime later, in another process)

apps/worker  (worker.py: main loop)
   │
   ├─ BRPOP ai_review_jobs   (right/tail — blocks until a job arrives)
   │
   └─ process_job(job_data):
        ├─ Step 1: UPDATE analysis_runs SET status='running'
        │
        ├─ Step 2: tempfile.mkdtemp(); git clone <repo>; git checkout <branch>
        │
        ├─ Step 3: create_job('test') → run tests (npm or pytest, by detect_test_command)
        │          create_job('semgrep') → run_semgrep  → INSERT findings (verified)
        │          create_job('npm_audit') → run_npm_audit → INSERT findings (verified)
        │
        ├─ Step 4: git diff main...HEAD         → diff text
        │          git diff --name-only main...HEAD → changed file list
        │
        ├─ Step 5: retrieve_related_files(...)  (ripgrep-based; from retrieval.py)
        │          → read 3 related files each
        │
        ├─ Step 6: SELECT job_type, logs FROM analysis_jobs WHERE run_id = ...
        │          (read back what we saved in Step 3)
        │
        ├─ Step 7: call_ai_service(...)  →  POST http://localhost:8000/review
        │          (see ai-service.md for what happens inside)
        │
        ├─ Step 8: save_findings(...)  →  INSERT INTO findings ... ('unverified')
        │          (one row per AI finding)
        │
        └─ Step 9: UPDATE analysis_runs SET status='completed'
                   (or status='failed' + error=... if anything raised)

      finally: delete the temp workspace (safe_rmtree, Windows-aware),
               close cursor + db connection.
```

**Failure behavior:** If any step raises, control jumps to the outer `except`
in `process_job`, which sets the run `failed` and stores the exception
message in `analysis_runs.error`. The worker loop itself catches exceptions
too, so one bad job doesn't kill the worker. Findings written before the
crash are NOT rolled back — you may see a run that's `failed` but already has
Semgrep findings, which is fine.

**End-to-end test from the repo root:**
```powershell
python send_webhook.py
# posts a validly-signed payload to localhost:8080/webhooks/github
# using GITHUB_WEBHOOK_SECRET=testsecret123
```

## Flow 2 — A user logs in via GitHub OAuth

Two endpoints in `apps/api/internal/auth/handler.go`. Standard OAuth 2 auth-code
flow with a CSRF `state` token:

```
1. User clicks "Login" on the dashboard → browser hits /auth/github
       │
       ▼
   LoginHandler:
     - generate a random `state` string (CSRF protection)
     - redirect to https://github.com/login/oauth/authorize?client_id=...&state=...

2. User authorizes on GitHub → GitHub redirects to /auth/github/callback?code=...&state=...
       │
       ▼
   CallbackHandler:
     - exchange the temporary `code` for an access token (POST to GitHub)
     - call GitHub /user with the token → get username + github_id
     - INSERT ... ON CONFLICT (github_id) DO UPDATE into `users`
     - reply with JSON containing the username
```

No session/cookie is maintained after this — the auth flow just proves the
GitHub-identity-to-Postgres linkage works. The webhook flow does NOT require
a logged-in user; it's authenticated by the webhook secret instead.

## Flow 3 — Dashboard reads analysis state

Pure read-only. The dashboard (`apps/web`) calls the Go API; the Go API runs
plain SELECTs against Postgres and returns JSON. No mutations, no Redis.

```
apps/web  (Next.js, React + react-query)
   │
   ├─ GET /api/analyses           → list of 50 most recent runs
   ├─ GET /api/analyses/{id}      → one run (for the detail header)
   ├─ GET /api/analyses/{id}/jobs → the tool steps for that run
   └─ GET /api/analyses/{id}/findings → findings, sorted by severity
       │
       ▼
apps/api  (internal/api/handler.go: Handlers)
   │
   └─ Plain SELECT against analysis_runs / analysis_jobs / findings
      using pgxpool. Findings are sorted server-side by a CASE expression
      (critical → 1, high → 2, medium → 3, low → 4, else 5) so the dashboard
      always shows the worst findings first regardless of sort stability.
```

The dashboard polls these endpoints on a refetch interval (currently 5s for
the list view) so a user watching a run can see status change from `queued`
→ `running` → `completed` without refreshing.

## What is NOT a flow yet

These are planned but not implemented:
- **Posting a summary comment back to the GitHub PR.** The findings live in
  Postgres and are visible in the dashboard, but the PR on GitHub itself gets
  no comment. Planned for section 20 of the guide.
- **Per-analysis findings view in the dashboard.** The API endpoint exists,
  but the `apps/web/src/app/analyses/[id]/page.tsx` route isn't built yet.
- **Retries / patch verification.** A failed run stays failed; nobody tries
  to apply the suggested fix and re-run tests.