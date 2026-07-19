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