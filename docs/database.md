# Database

PostgreSQL 16, running in Docker as `ai-review-postgres` (port 5432, db
`ai_review`, user `review`, password `reviewpass`). Migrations live in
`apps/api/migrations/` as plain `.sql` files and are applied by hand —
there's no migration tool and no revert tracking.

## Tables

There are six tables, in the order they were created. They form a chain:
users → repositories → pull_requests → analysis_runs → analysis_jobs and
findings (both children of runs).

```
users
  │
  ▼  (no FK; auth-only)
repositories  ◀── (saved from webhook)
  │
  ▼  FK repo_id
pull_requests  ◀── (saved from webhook)
  │
  ▼  FK pr_id
analysis_runs  ◀── (saved from webhook; one per commit SHA)
  │
  ├─▶ analysis_jobs   (one row per tool run: test, semgrep, npm_audit, ...)
  └─▶ findings        (one row per issue found by any source)
```

### `users` (001)
GitHub users who logged in via OAuth. Only used by the auth flow — not
referenced by the review pipeline.
- `github_id BIGINT UNIQUE` — GitHub's numeric user id.
- `oauth_token_encrypted TEXT` — stored OAuth token.

### `repositories` (002)
Repos we've seen webhooks for.
- `github_repo_id BIGINT UNIQUE` — GitHub's numeric repo id.
- `full_name VARCHAR(255)` — `owner/repo`.
- `webhook_id VARCHAR(255)` — the id GitHub assigned to the webhook (nullable).

### `pull_requests` (003)
PRs that triggered webhooks. Unique per `(repo_id, pr_number)` — re-opening
the same PR re-uses the row.
- `head_sha VARCHAR(40)` — commit the PR was at when we saw it.
- `author VARCHAR(255)`, `title TEXT`.

### `analysis_runs` (004)
**The central unit of work.** One run = one full review of one PR commit.
Unique on `(repo_id, pr_id, commit_sha)` — the webhook handler does
`ON CONFLICT DO NOTHING` so pushing the same webhook twice doesn't create a
duplicate run.
- `status VARCHAR(20)` — one of `queued` / `running` / `completed` / `failed`.
- `trigger VARCHAR(20)` — what started it (e.g. `webhook`).
- `commit_sha VARCHAR(40)` — what was reviewed.
- `started_at`, `completed_at`, `error` — timestamps + failure reason.

### `analysis_jobs` (005)
Steps within a run. Each tool the worker runs gets its own row, so the
dashboard can show each step's status and logs separately. Deleting a run
cascades to delete its jobs (`ON DELETE CASCADE`).
- `run_id BIGINT` (FK to `analysis_runs.id`).
- `job_type VARCHAR(30)` — `test`, `semgrep`, or `npm_audit`.
- `status VARCHAR(20)` — same lifecycle as runs.
- `attempts INTEGER` — how many times we tried (currently always 1 — retries
  are a future feature).
- `exit_code INTEGER` — the tool's return code. `124` is reserved for
  "command timed out".
- `logs TEXT` — raw stdout (and stderr for the test job) of the tool.

### `findings` (006)
The actual review comments. Saved by three sources:
- Semgrep findings → `category='security'`,
  `verification_status='verified_by_static_analysis'`, confidence `0.9`.
- npm audit findings → `category='dependency_risk'`,
  `verification_status='verified_by_static_analysis'`, confidence `0.95`.
- AI findings → `verification_status='unverified'` (an LLM guess),
  `category`/`confidence`/`evidence` come from the model's reply.

Columns:
- `run_id BIGINT` (FK to `analysis_runs.id`, cascade-delete).
- `file_path VARCHAR(500)` — where the issue is (`package.json` for npm-audit
  findings).
- `line_start INTEGER`, `line_end INTEGER` — nullable; AI may not know the line.
- `severity VARCHAR(10)` — `critical` / `high` / `medium` / `low` / `info`.
- `category VARCHAR(30)` — see above.
- `title VARCHAR(255)`, `description TEXT NOT NULL`, `evidence TEXT`.
- `confidence NUMERIC(3,2)` — 0.00 to 1.00; how sure the source is.
- `verification_status VARCHAR(30)` — `unverified` / `verified_by_static_analysis`
  (more statuses will arrive with the patch-verification step).

## Working with the database

Inspect state from a terminal at the repo root:

```powershell
# List tables
docker exec ai-review-postgres psql -U review -d ai_review -c "\dt"

# Latest 10 findings
docker exec ai-review-postgres psql -U review -d ai_review -c `
  "SELECT id, severity, category, title, evidence, confidence FROM findings ORDER BY id DESC LIMIT 10;"

# Latest runs
docker exec ai-review-postgres psql -U review -d ai_review -c `
  "SELECT id, status, commit_sha, created_at FROM analysis_runs ORDER BY id DESC LIMIT 5;"
```

Apply migrations (PowerShell; run 001..006 in order):

```powershell
Get-Content apps/api/migrations/NNN_*.sql | docker exec -i ai-review-postgres psql -U review -d ai_review
```

Wipe all data and start fresh:

```powershell
docker compose down -v
docker compose up -d
# then re-apply migrations 001..006
```