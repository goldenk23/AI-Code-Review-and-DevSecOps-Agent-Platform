# Project Documentation

Beginner-friendly docs for the **AI Code Review & DevSecOps Agent Platform** —
a system that automatically reviews GitHub pull requests using static analysis
and a large language model.

> New here? Start with **[Architecture](architecture.md)**, then read
> **[How things flow](flows.md)** to see a real request travel through the
> system. The other pages are references you can come back to.

## Contents

| Doc | What it covers |
|-----|----------------|
| [architecture.md](architecture.md) | The four apps + two infrastructure pieces, and how they fit together |
| [database.md](database.md) | What each table is for and how the tables relate |
| [flows.md](flows.md) | Step-by-step walkthroughs of the three main request flows |
| [development.md](development.md) | How to run the project locally, with commands and gotchas |
| [ai-service.md](ai-service.md) | How the AI review endpoint works (LLM call, parsing, retries) |
| [testing-pr-review.md](testing-pr-review.md) | Step-by-step guide to trigger a real PR review end-to-end via GitHub webhook (ngrok + form config + troubleshooting) |

## What's implemented so far

The project is being built following `implementation_guide.md` (a local,
gitignored learning guide). As of this writing, the system can:

- Authenticate a user via GitHub OAuth and remember them in Postgres.
- Receive a signed GitHub webhook for a PR, verify its signature, save the
  repo/PR/run records, and push a job onto Redis for the worker.
- In the worker: clone the repo, run the repo's tests (npm test or pytest),
  run Semgrep for security issues, and run `npm audit` for vulnerable
  dependencies. All finding rows are written to Postgres.
- Gather the diff + related-file context + tool logs, POST them to the
  AI service, get back an LLM-generated list of findings, and save those
  to Postgres as **unverified** (vs static-analysis findings, which are
  marked **verified**).
- Serve JSON status endpoints on the Go API and render them in a Next.js
  dashboard.

**Not yet implemented:** posting a summary comment back to the GitHub PR,
the per-analysis findings view in the dashboard, observability/metrics,
retries, patch verification, and deployment.

See `AGENTS.md` (repo root) for the authoritative short summary of
commands, gotchas, and layout.

## Scaling the worker

The job queue is a Redis list (`LPUSH` from the API, `BRPOP` from the workers),
so N worker processes consume the same queue safely — no code changes needed.
Each job is popped by exactly one worker, so nothing is processed twice.

Run 3 workers locally (each in its own terminal). Give each a distinct
`WORKER_ID` (log prefix) and `METRICS_PORT` — two workers on the same metrics
port means all but the first lose their `/metrics` endpoint:

    cd apps/worker
    python worker.py                                            # worker-1 (:9090)
    $env:WORKER_ID=2; $env:METRICS_PORT=9091; python worker.py  # worker-2
    $env:WORKER_ID=3; $env:METRICS_PORT=9092; python worker.py  # worker-3

Logs are prefixed `[worker-N]` so you can see each process pull jobs.

In Docker, scale with Compose instead: `docker compose up -d --scale worker=3`
(remove the worker's `container_name` first — fixed names prevent replicas).

Measure the speedup with `.\benchmark.ps1 -Only e2e` (1 worker) vs the same
run with 3 workers.
