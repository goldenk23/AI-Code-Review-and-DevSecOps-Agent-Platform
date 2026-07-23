# AGENTS.md

Repo-specific guidance for AI Code Review & DevSecOps Agent Platform. Multi-app monorepo; each app is independent (no shared build, no workspace tooling at the root).

## Layout

- `apps/api` — Go API server (chi router). Module path `github.com/goldenk23/ai-devsecops-reviewer/api` (does NOT match the repo dir name — keep imports as-is). Entry `main.go`, packages under `internal/{auth,api,database,github,queue,webhook}`.
- `apps/worker` — Python worker. Consumes Redis queue `ai_review_jobs` (BRPOP), clones the target repo, runs tests/semgrep/npm audit, writes findings to Postgres. Shells out to `git`, `npm`, `semgrep`, `pytest` — they must be on PATH. Serves Prometheus metrics on `:9090` (override with `METRICS_PORT`); metrics include `ai_review_latency_seconds` and `patch_verify_seconds`.
- `apps/ai-service` — Python FastAPI `/review` endpoint, port 8000.
- `apps/web` — Next.js 16 dashboard. **Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before editing web code** — this Next.js version has breaking changes vs. prior versions. App Router, TS strict, `@/*` -> `src/*`.
- `infra/`, `docker-compose.yml` — compose runs the full stack (Postgres + Redis + all four apps via per-app `Dockerfile`s); `docker compose up -d postgres redis` still brings up infra only for local dev. `infra/{compose,docker}` are empty placeholders. Inside containers, services reach each other by name (`postgres`, `redis`, `api`, `ai-service`); the web container's rewrites use `API_INTERNAL_URL=http://api:8080` (defaults to localhost outside Docker). The web image needs `output: "standalone"` in `next.config.ts` — don't remove it.
- `apps/api/migrations/` — idempotent forward-only `.sql` files. Compose runs them through the one-shot `migrate` service; `start.ps1` applies them in filename order.

## Commands

**One-command dev loop (recommended):**
```
.\start.ps1
```
Brings up Postgres + Redis via `docker compose up -d`, applies all migrations in filename order, ensures `apps/api/.env` has `GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback`, installs web/Python deps on first run, then launches Go API + worker + AI service + Next.js web in the background and tails all four logs in one terminal. **Ctrl+C stops everything cleanly.** Old logs saved to `./logs/`.

Manual per-service commands (fallback when you need to debug one piece):

Infra (run from repo root):
```
docker compose up -d
docker compose down        # keep data
docker compose down -v     # wipe postgres_data + redis_data
```

Apply migrations (Windows PowerShell; run all files in order):
```
Get-Content apps/api/migrations/NNN_*.sql | docker exec -i ai-review-postgres psql -U review -d ai_review
```

Run services (each in its own terminal):
```
cd apps/api        ; go run .                            # API on :8080
cd apps/ai-service ; uvicorn main:app --port 8000        # AI service on :8000
cd apps/worker     ; python worker.py
cd apps/web        ; npm run dev                          # dashboard on :3000
cd apps/web        ; npm run lint                          # eslint (flat config)
```

End-to-end webhook test from repo root: `python send_webhook.py` (posts to `localhost:8080/webhooks/github` with `GITHUB_WEBHOOK_SECRET=testsecret123`).

Benchmark suite from repo root (platform must be running): `.\benchmark.ps1` (all tests) or `.\benchmark.ps1 -Only api|e2e|ai|scale|patch`. The `scale` test spawns extra workers itself (venv python, `METRICS_PORT` 9091/9092); `patch` reads the worker's `patch_verify_seconds` metric, so it needs a worker running the current worker.py.

## Verification

- Unit tests now cover core API helpers, webhook signatures, AI response parsing, and worker test-command detection. Run `go test ./...` from `apps/api`, and `python -m pytest -v` from `apps/ai-service` and `apps/worker`.
- For API/worker integration changes: bring up infra, apply migrations, then `go run .` / `python worker.py` and exercise via `send_webhook.py` or `curl localhost:8080/health`.
- For web: `npm run lint`; typecheck happens via `next build` (no separate typecheck script).
- Inspect DB state with `docker exec ai-review-postgres psql -U review -d ai_review -c "<query>"`.

## Gotchas

- Queue contract: API does `LPUSH ai_review_jobs`, worker does `BRPOP ai_review_jobs` (FIFO). Changing one side without the other breaks jobs silently.
- Dev creds live in committed `apps/api/.env` and `apps/worker/.env` (review:reviewpass, redis on :6379). Root `.gitignore` ignores `.env`; these app-level `.env` files are tracked on purpose for dev. Real secrets must not be added there.
- `go.mod` declares `go 1.26.4` and the API defaults to port 8000 when `PORT` is unset — the `.env` overrides it to 8080. Don't "fix" either without checking the worker/ai-service ports.
- Worker runs on Windows by default; `safe_rmtree` handles read-only git pack files — don't replace it with a bare `shutil.rmtree`.
- The venv python re-execs the base interpreter as a child that escapes `Stop-Tree`, so Ctrl+C leaves orphan `worker.py` processes consuming jobs — `start.ps1` reaps them at startup (and on exit) by command-line match. Multiple workers may run on one machine only with distinct `METRICS_PORT` values, or all but one lose their `/metrics`.
- The worker's Prometheus HTTP server runs in a daemon thread that starves under the GIL mid-job — `/metrics` can take several seconds to answer while the worker is busy. Don't scrape it with a short timeout.
- Default branch for cloned target repos is checked out literally by name (`branch` field from the job). Private repositories use the OAuth token mapped to that repository; public repositories can fall back to anonymous clone.

## Sources & references

- `apps/web/AGENTS.md` — Next.js 16-specific rules (authoritative for web edits).
- `implementation_guide.md`, `plan_tuned.md`, `script.md` — gitignored local doc/notes; useful background but not committed, so don't rely on them for the source of truth.
- `.github/workflows/ci.yml` — CI runs on every push/PR: web (npm ci, lint, build), api (go vet, go test), ai-service (pytest), worker (pytest). Keep the working-directory and requirements-file names (`requirement.txt` singular for worker) in sync with the repo if you move things.