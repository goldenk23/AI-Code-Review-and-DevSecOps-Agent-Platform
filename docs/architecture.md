# Architecture

The platform is a **multi-app monorepo**: four independent programs plus two
infrastructure services, all talking to each other over the network. There is
no shared code between apps — each one builds and runs on its own.

## The pieces

```
                 GitHub
                   │  (webhook on PR open)
                   ▼
        ┌─────────────────────┐         ┌──────────────┐
        │   apps/api (Go)     │────────▶│  PostgreSQL  │
        │   - OAuth login     │         │  (state)     │
        │   - Webhook receiver│         └──────────────┘
        │   - Status APIs     │                ▲
        └──────────┬──────────┘                │
                   │ LPUSH job                │ INSERT findings
                   ▼                          │
        ┌─────────────────────┐         ┌─────┴────────────┐
        │      Redis          │────────▶│  apps/worker     │
        │  (queue: ai_review_ │  BRPOP  │  (Python)       │
        │         jobs)        │         │  - git clone     │
        └─────────────────────┘         │  - run tests     │
                                        │  - semgrep       │
                                        │  - npm audit     │
                                        │  - call AI svc   │
                                        └─────┬────────────┘
                                              │ HTTP POST /review
                                              ▼
                                   ┌──────────────────────┐
                                   │  apps/ai-service     │
                                   │  (FastAPI, Python)   │
                                   │  - calls the LLM     │
                                   │  - returns findings  │
                                   └──────────────────────┘

                 apps/web (Next.js) ── reads JSON from apps/api only
                 apps/api reads/writes Postgres, pushes Redis
                 apps/worker reads Redis, writes Postgres, calls ai-service
```

## Each app's job

### `apps/api` — Go API server (port 8080)
The "front door". It speaks to the outside world and the database.
- **GitHub OAuth login** (`/auth/github`, `/auth/github/callback`) — saves the
  user to Postgres.
- **Webhook receiver** (`POST /webhooks/github`) — verifies the HMAC signature
  with `GITHUB_WEBHOOK_SECRET`, ignores non-PR events, dedupes by
  `(repo, pr, commit_sha)`, saves the run row as `queued`, and pushes a small
  JSON payload to the Redis list `ai_review_jobs`.
- **Status APIs** (`/api/analyses`, `/api/analyses/{id}`,
  `/api/analyses/{id}/jobs`, `/api/analyses/{id}/findings`) — read-only JSON
  used by the dashboard.
- **Health** (`/health`) — docker readiness probe.

Router: `chi`. Module path is `github.com/goldenk23/ai-devsecops-reviewer/api`
— note that doesn't match the repo directory name; don't "fix" it.

### `apps/worker` — Python worker
The "muscle". Pulls one job at a time off the `ai_review_jobs` Redis list
(`BRPOP`, blocking) and does the slow work the API refuses to block on:
1. marks the run `running`,
2. clones the repo into a temp dir and checks out the PR branch,
3. runs the repo's tests + Semgrep + `npm audit`, saving each as rows in
   `analysis_jobs` and any findings to `findings`,
4. gets the diff (`git diff main...HEAD`) and the list of changed files,
5. gathers related-file context via ripgrep (`retrieval.py`),
6. reads the tool logs back from Postgres,
7. POSTs diff + context + tool logs to `apps/ai-service` at `/review`,
8. saves the AI's findings to Postgres (marked `unverified`),
9. marks the run `completed` (or `failed` if anything raised).

Shells out to `git`, `npm`, `semgrep`, and `pytest` — all must be on `PATH`.

### `apps/ai-service` — FastAPI /review (port 8000)
The "brain". Accepts a JSON request with the diff, changed files, context,
and tool results, builds a prompt, calls the LLM, and returns
`{"run_id": ..., "findings": [...]}`. Currently wired to call the
OpenCode Go chat-completions endpoint (`https://opencode.ai/zen/go/v1`).
See [ai-service.md](ai-service.md) for details.

### `apps/web` — Next.js dashboard (port 3000)
Read-only UI. Calls the Go API's status endpoints to list runs and show a
run's jobs/findings. Next.js 16, App Router, TypeScript strict,
`@/*` → `src/*`. Read `apps/web/AGENTS.md` and the bundled
`node_modules/next/dist/docs/` before editing — this Next.js version has
breaking changes vs prior versions.

### Infrastructure (root `docker-compose.yml`)
- **PostgreSQL 16** (`ai-review-postgres`, port 5432, db `ai_review`,
  user `review` / pass `reviewpass`) — durable state.
- **Redis 7** (`ai-review-redis`, port 6379) — used purely as a job queue.

Both have named volumes that survive `docker compose down`; wipe with
`docker compose down -v`.

## Why split it like this?

Three reasons, in order of importance:
1. **Don't block the webhook on slow work.** GitHub expects a webhook to
   reply in a few seconds. Cloning + tests + LLM call can take minutes. The
   API accepts the webhook, puts a job on Redis, returns immediately.
2. **Isolation.** If the worker crashes mid-analysis, the API and dashboard
   keep working. If the AI service is down, the static-analysis findings
   (Semgrep, npm audit) are still saved before the AI call fails.
3. **Independent scaling.** You can run multiple worker processes against
   the same queue without code changes.

## Queue contract (important)

The API and worker have a hard dependency on matching Redis usage:

| Side | Command | Effect |
|------|---------|--------|
| API | `LPUSH ai_review_jobs <json>` | adds to the LEFT/head |
| Worker | `BRPOP ai_review_jobs <json>` | removes from the RIGHT/tail |

Combined, `LPUSH` head + `BRPOP` tail = **FIFO** — oldest jobs go first.
**Changing one side without the other breaks jobs silently.** This is
called out as a gotcha in `AGENTS.md`.