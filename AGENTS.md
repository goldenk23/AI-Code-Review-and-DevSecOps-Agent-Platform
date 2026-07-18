# AGENTS.md

Repo-specific guidance for AI Code Review & DevSecOps Agent Platform. Multi-app monorepo; each app is independent (no shared build, no workspace tooling at the root).

## Layout

- `apps/api` — Go API server (chi router). Module path `github.com/goldenk23/ai-devsecops-reviewer/api` (does NOT match the repo dir name — keep imports as-is). Entry `main.go`, packages under `internal/{auth,api,database,github,queue,webhook}`.
- `apps/worker` — Python worker. Consumes Redis queue `ai_review_jobs` (BRPOP), clones the target repo, runs tests/semgrep/npm audit, writes findings to Postgres. Shells out to `git`, `npm`, `semgrep`, `pytest` — they must be on PATH.
- `apps/ai-service` — Python FastAPI `/review` endpoint, port 8000.
- `apps/web` — Next.js 16 dashboard. **Read `apps/web/AGENTS.md` and `node_modules/next/dist/docs/` before editing web code** — this Next.js version has breaking changes vs. prior versions. App Router, TS strict, `@/*` -> `src/*`.
- `infra/`, `docker-compose.yml` — infra only (Postgres + Redis). `infra/{compose,docker}` are empty placeholders.
- `apps/api/migrations/` — plain `.sql` files applied by hand (no migration tool, no revert tracking).

## Commands

**One-command dev loop (recommended):**
```
.\start.ps1
```
Brings up Postgres + Redis via `docker compose up -d`, applies migrations 001..006 if missing, ensures `apps/api/.env` has `GITHUB_CALLBACK_URL=http://localhost:3000/auth/github/callback`, installs web/Python deps on first run, then launches Go API + worker + AI service + Next.js web in the background and tails all four logs in one terminal. **Ctrl+C stops everything cleanly.** Old logs saved to `./logs/`.

Manual per-service commands (fallback when you need to debug one piece):

Infra (run from repo root):
```
docker compose up -d
docker compose down        # keep data
docker compose down -v     # wipe postgres_data + redis_data
```

Apply migrations (Windows PowerShell; run 001..006 in order):
```
Get-Content apps/api/migrations/NNN_*.sql | docker exec -i ai-review-postgres psql -U review -d ai_review
```

Run services (each in its own terminal):
```
cd apps/api        ; go run main.go                      # API on :8080
cd apps/ai-service ; uvicorn main:app --port 8000        # AI service on :8000
cd apps/worker     ; python worker.py
cd apps/web        ; npm run dev                          # dashboard on :3000
cd apps/web        ; npm run lint                          # eslint (flat config)
```

End-to-end webhook test from repo root: `python send_webhook.py` (posts to `localhost:8080/webhooks/github` with `GITHUB_WEBHOOK_SECRET=testsecret123`).

## Verification

- **No test suite exists in this repo.** Don't assume `npm test`, `go test`, or `pytest` here — they will fail/no-op. The worker's `detect_test_command` runs tests against repos it *clones*, not against this repo.
- For API/worker changes: bring up infra, apply migrations, then `go run main.go` / `python worker.py` and exercise via `send_webhook.py` or `curl localhost:8080/health`.
- For web: `npm run lint`; typecheck happens via `next build` (no separate typecheck script).
- Inspect DB state with `docker exec ai-review-postgres psql -U review -d ai_review -c "<query>"`.

## Gotchas

- Queue contract: API does `LPUSH ai_review_jobs`, worker does `BRPOP ai_review_jobs` (FIFO). Changing one side without the other breaks jobs silently.
- Dev creds live in committed `apps/api/.env` and `apps/worker/.env` (review:reviewpass, redis on :6379). Root `.gitignore` ignores `.env`; these app-level `.env` files are tracked on purpose for dev. Real secrets must not be added there.
- `go.mod` declares `go 1.26.4` and the API defaults to port 8000 when `PORT` is unset — the `.env` overrides it to 8080. Don't "fix" either without checking the worker/ai-service ports.
- Worker runs on Windows by default; `safe_rmtree` handles read-only git pack files — don't replace it with a bare `shutil.rmtree`.
- Default branch for cloned target repos is checked out literally by name (`branch` field from the job). Public repos only — no auth token is passed to `git clone`.

## Sources & references

- `apps/web/AGENTS.md` — Next.js 16-specific rules (authoritative for web edits).
- `implementation_guide.md`, `plan_tuned.md`, `script.md` — gitignored local doc/notes; useful background but not committed, so don't rely on them for the source of truth.
- `.github/workflows/` is empty — there is **no CI**. Verification is manual.