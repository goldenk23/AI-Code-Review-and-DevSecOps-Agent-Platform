# Local development

How to run, configure, and verify the project on your own machine.

## Prerequisites

Install these and put them on `PATH` — the worker shells out to them:

| Tool | Why | Check |
|------|-----|-------|
| Go 1.26+ | API server | `go version` |
| Python 3.11+ | worker + ai-service | `python --version` |
| Node.js 18+ | dashboard | `node --version` |
| Docker Desktop | Postgres + Redis | `docker version` |
| Git | worker clones repos | `git version` |
| Semgrep | security scan | `semgrep --version` |
| npm | tests + audit | `npm --version` |
| pytest | tests (Python repos only) | `pytest --version` |
| ripgrep (`rg`) | context retrieval | `rg --version` |

Skip ones you don't need for the slice you're working on (e.g. you don't need
semgrep to edit the Go API). But the worker needs all of them for the
end-to-end flow.

## One-time setup

```powershell
# From the repo root.

# 1. Start Postgres + Redis.
docker compose up -d

# 2. Wait until both are healthy.
docker compose ps

# 3. Create the database tables (run 001..006 in order).
Get-Content apps/api/migrations/001_create_users.sql           | docker exec -i ai-review-postgres psql -U review -d ai_review
Get-Content apps/api/migrations/002_create_repositories.sql   | docker exec -i ai-review-postgres psql -U review -d ai_review
Get-Content apps/api/migrations/003_create_pull_requests.sql  | docker exec -i ai-review-postgres psql -U review -d ai_review
Get-Content apps/api/migrations/004_create_analysis_runs.sql  | docker exec -i ai-review-postgres psql -U review -d ai_review
Get-Content apps/api/migrations/005_create_analysis_jobs.sql  | docker exec -i ai-review-postgres psql -U review -d ai_review
Get-Content apps/api/migrations/006_create_findings.sql       | docker exec -i ai-review-postgres psql -U review -d ai_review

# 4. Verify tables exist.
docker exec ai-review-postgres psql -U review -d ai_review -c "\dt"
```

## Running all four services

Each in its own terminal. The order doesn't strictly matter, but Postgres +
Redis must be up first.

```powershell
# Terminal 1 — infra (already running from setup; restart with:)
docker compose up -d

# Terminal 2 — Go API on :8080
cd apps/api
go run .

# Terminal 3 — Python AI service on :8000
cd apps/ai-service
uvicorn main:app --port 8000

# Terminal 4 — Python worker (no port; just runs the loop)
cd apps/worker
python worker.py

# Terminal 5 — Next.js dashboard on :3000
cd apps/web
npm run dev
```

Quick smoke tests:
```powershell
curl http://localhost:8080/health       # → OK
curl http://localhost:8000/health       # → {"status":"ok"}
```

## End-to-end test

With all services running, send a fake webhook from the repo root:

```powershell
python send_webhook.py
# Posts a validly-signed payload to localhost:8080/webhooks/github
# using GITHUB_WEBHOOK_SECRET=testsecret123 (matches apps/api/.env).
```

Then watch the worker terminal print `Starting analysis for run #N...`, and
once it finishes:

```powershell
docker exec ai-review-postgres psql -U review -d ai_review -c `
  "SELECT id, severity, category, title, evidence, confidence FROM findings ORDER BY id DESC LIMIT 10;"
```

You should see findings from Semgrep (`verified_by_static_analysis`), npm
audit (`verified_by_static_analysis`), and the AI (`unverified`).

## Environment variables

The committed `.env` files at `apps/api/.env` and `apps/worker/.env` hold dev
credentials (review:reviewpass, redis on :6379). They are tracked on purpose —
**don't put real secrets there**. Root `.gitignore` ignores `.env` in
general, but those two specific files are committed (so the project Just
Works out of the box).

| File | Key vars |
|------|----------|
| `apps/api/.env` | `DATABASE_URL`, `REDIS_URL`, `GITHUB_CLIENT_ID`, `GITHUB_CLIENT_SECRET`, `GITHUB_WEBHOOK_SECRET`, `PORT=8080` |
| `apps/worker/.env` | `REDIS_URL`, `DATABASE_URL`, `AI_SERVICE_URL=http://localhost:8000` |
| `apps/ai-service/.env` | `OPENCODE_GO_API_KEY` (you paste this; see [ai-service.md](ai-service.md)), `OPENCODE_GO_MODEL=glm-5.2`, etc. This file is NOT committed — it's gitignored at the root, so losing it just means re-pasting your key. |

Note the port oddity: `go.mod` defaults the API to `:8000` when `PORT` is
unset, but `apps/api/.env` overrides it to `8080`. Don't "fix" one without
checking the other services — the ai-service already owns `:8000`.

## Verification approach

There is **no test suite** anywhere in this repo. Don't run `npm test`, `go
test`, or `pytest` at the repo level — they will fail or no-op. (Note:
`apps/worker` has a `detect_test_command` that runs tests, but it runs them
against the cloned *target* repo, not against this repo.)

Per app:
- **api**: start it; hit `localhost:8080/health` and the `/api/analyses*`
  endpoints with `curl`; run `send_webhook.py`.
- **worker**: start it; trigger via webhook or manually push a job to Redis;
  check Postgres for the resulting rows.
- **ai-service**: `curl localhost:8000/health`; then POST a review with the
  test JSON file: `curl.exe -X POST http://localhost:8000/review -H
  "Content-Type: application/json" --data-binary "@apps/ai-service/test_review.json"`.
- **web**: `npm run lint`; typecheck via `next build` (no separate typecheck
  script). Dev server renders at `localhost:3000`.

## Gotchas

The big ones are also called out in `AGENTS.md`. The ones a beginner most
often trips on:

- **Queue contract:** API `LPUSH`es to `ai_review_jobs`, worker `BRPOP`s from
  it (FIFO). Changing one side without the other breaks jobs silently.
- **`safe_rmtree` on Windows:** git pack files are read-only, so a bare
  `shutil.rmtree` will fail. Don't replace `safe_rmtree` with one.
- **Circular port default:** Unset `PORT` makes the Go API bind `:8000`,
  conflicting with the ai-service. Keep `PORT=8080` in `apps/api/.env`.
- **Go module path:** `github.com/goldenk23/ai-devsecops-reviewer/api` does
  NOT match the repo directory name. Leave the imports alone.
- **No CI:** `.github/workflows/` is empty. Everything is verified manually.
- **AI service key:** `apps/ai-service/.env` is gitignored — your OpenCode Go
  key lives there and never gets committed. The dedicated test payload is at
  `apps/ai-service/test_review.json` for quick curl testing.

## Stopping / wiping

```powershell
docker compose down        # stop containers, KEEP data volumes
docker compose down -v     # also wipe postgres_data + redis_data
```
After `-v`, re-apply all migrations before running again.