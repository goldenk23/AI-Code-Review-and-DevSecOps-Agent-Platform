# Project Plan (Tuned for You): AI Code Review & DevSecOps Agent Platform

> **Personalized for:** 3rd-year B.Tech, IIT Kanpur | Target: FAANG SDE-1 | Resume deadline: ~Sept 5 | Build window: **July 2 → July 27 (24 days)**

---

## 0. Read This First — The Honest Constraint

You have **24 days**, you're still grinding DSA ~2-4 hrs/day (per your `guide.md` July plan), and this is your **third** project. The original `plan.md` is an 8-week polyglot system. **You cannot build all of it in 24 days.** If you try, you'll ship nothing and hurt your DSA.

This tuned plan does three things:
1. **Cuts scope ruthlessly** to a demo-able, resume-impressive MVP in 24 days.
2. **Uses only languages you already know** (Go, Python, TypeScript) — zero new-framework learning overhead.
3. **Gives you an interview-ready answer for every tech choice** — because "why this stack?" is guaranteed to be asked.

> ⚠️ **The deal you make with yourself:** Project gets ~4-5 hrs/day in July. DSA drops to a **non-negotiable floor of 2 hrs/day** (1 contest on Saturday + 2 problems/day). If by **July 15** the core webhook→queue→worker→AI flow isn't working end-to-end, execute the **Fallback** in §9 instead. Do not let this project eat August — August is your CS-fundamentals blitz.

---

## 1. What You're Actually Building in 24 Days (Scope Decision)

### ✅ IN — The 24-Day MVP
- GitHub OAuth + webhook receiver (Go API)
- Webhook signature verification + idempotent job creation
- Redis queue + Python worker that clones the repo, runs `npm test` + Semgrep, captures logs/exit codes
- Python AI service: custom agent loop → reads diff + retrieved context + tool outputs → generates findings with **evidence + confidence**
- Code context retrieval via **ripgrep keyword + path heuristics** (NOT pgvector — deferred)
- PostgreSQL stores runs, jobs, findings
- Next.js dashboard: list analyses, view findings + job status
- Post one summary comment to GitHub PR (with dedup)
- Docker Compose for everything; Docker sandbox for untrusted jobs
- README + architecture diagram + demo repo with planted bugs + 90-sec demo

### ⏸️ DEFERRED (Do NOT build in July — mention as "future work" in README/interviews)
- pgvector / embedding retrieval (use ripgrep first)
- LangGraph / multi-agent roles
- Patch suggestions + verification (stretch goal only if ahead by July 20)
- Kafka/Redpanda, GitHub Checks API, SARIF, multi-language (Node-only first)
- Analytics dashboard, self-hosted runners, policy engine, eval dataset

> **Interview framing for deferred items:** "I scoped the MVP to prove the end-to-end loop — webhook to verified comment. pgvector, LangGraph, and patch verification are on the roadmap; I prioritized a working system over a feature-complete one." This answer shows maturity, not incompleteness.

---

## 2. Tuned Tech Stack (with Interview-Ready Justifications)

```
Frontend:    Next.js + TypeScript + Tailwind + shadcn/ui + TanStack Query
Backend API: Go + Chi
AI Service:  Python + FastAPI + custom agent loop
Workers:     Python + Celery (Redis broker)
Queue:       Redis
Data:        PostgreSQL (pgvector added only if time — see §8)
Sandbox:     Docker (--network=none, read-only, cgroup limits, timeout)
Analysis:    Semgrep + npm audit (Node target repos)
Observability: OpenTelemetry + Prometheus + Grafana (light — traces + 4 metrics)
Deploy:      Docker Compose (local) → Render/Cloud Run (prod-like) + GitHub Actions
```

### Why this stack — interview Q&A (memorize the ones marked ⭐)

#### ⭐ Backend: Why Go + Chi, not Java/Spring or Node.js?
> "Three reasons. **Concurrency:** the API receives GitHub webhooks and fans them out to a queue — Go's goroutines handle thousands of concurrent I/O ops cheaply, which maps naturally to an event-driven workload. **Deployment:** Go compiles to a single static binary, so my Docker image is scratch-based, ~15MB, with sub-second cold start — versus a JVM image that's hundreds of MB and takes seconds to warm up. That matters when scaling workers. **Leverage:** I already had Go from my betting-exchange project, so I moved fast without learning a new framework. I'd reach for Java/Spring in a large enterprise codebase with heavy DI and domain modeling, but for a stateless API gateway in front of a queue, Go's simplicity and performance win."

#### ⭐ AI Service + Workers: Why Python, not Go end-to-end?
> "The AI ecosystem is Python-first — OpenAI/Anthropic SDKs, tree-sitter bindings, tiktoken, LangChain all have first-class Python support and immature or absent Go ports. Reusing one language across the AI service and workers lets me share code-parsing utilities instead of serializing across a language boundary. The tradeoff is Python's slower execution, but the worker is I/O-bound — cloning, running shell commands, calling LLMs — not CPU-bound, so Python's performance is fine here. I deliberately did **not** force one language everywhere; I picked the right tool per layer."

#### ⭐ Agent: Why a custom loop, not LangGraph/LangChain?
> "My MVP workflow is linear: ingest diff → retrieve context → run tools → generate findings → publish. A custom loop gives explicit control over tool dispatch, retry, and token budgeting, and it's trivial to debug. LangGraph's value is stateful, branching, multi-agent graphs — that complexity isn't justified until I have Planner/Security/Patch agents sharing state. Starting simple also means I deeply understand the agent mechanics instead of treating a framework as a black box — which matters in interviews. I'd migrate to LangGraph if the workflow grows non-linear."

#### ⭐ Queue: Why Redis, not Kafka/RabbitMQ?
> "Redis is already in my stack for caching and rate limiting, so using its Celery broker avoids operating a second distributed system. My throughput is PRs per minute, not millions of events per second — Kafka's partitioning, durability, and replay would be over-engineering. The tradeoff is Redis is less durable (mostly in-memory), but for a review job that can be re-triggered idempotently from the webhook, at-least-once delivery with retries is sufficient. I'd move to Kafka if I needed multi-consumer fan-out, event replay for debugging, or 10x higher throughput."

#### Data: Why PostgreSQL (+ pgvector later), not a dedicated vector DB?
> "Co-location. My retrieval query is 'find code chunks similar to this changed function, filtered to this repo and file type.' With pgvector that's one SQL query joining embeddings with metadata. With Qdrant I'd maintain two stores and sync IDs, adding a failure mode. At my corpus size — thousands of chunks per repo — pgvector's HNSW index returns in single-digit ms. Qdrant makes sense at millions of vectors with high QPS; that's not my scale. For the MVP I'm starting with ripgrep keyword + path heuristics, which is simpler and often more relevant for code than embeddings."

#### ⭐ Sandbox: Why Docker, and what's your isolation model?
> "Untrusted-code isolation is the core security requirement. Docker gives me filesystem, process, and network namespace isolation plus cgroup CPU/memory limits in one tool. I run jobs with `--network=none`, a read-only root filesystem, a tmpfs workspace, no Docker socket access, and a hard timeout — so even a malicious PR can't reach my network, persist files, or escape to the host. gVisor or a microVM would be stronger isolation but adds operational complexity I don't need yet."

#### Frontend: Why Next.js + TypeScript?
> "Next.js gives file-based routing and server components for the dashboard's initial data load, shrinking the client bundle and improving first paint. TypeScript catches contract violations between the Go API and the React client at compile time — with a polyglot backend, shared types are my integration safety net. I considered Vite + React for simplicity, but Next.js is the production standard and its API routes let me prototype quickly."

#### Observability: Why OpenTelemetry?
> "My system is polyglot — Go API, Python workers, Python AI service. To debug a slow review I need to trace one request across all three. OpenTelemetry is vendor-neutral with first-class Go and Python libraries, so I instrument once and can ship traces to any backend. Hardcoding a vendor SDK would lock me in and force re-instrumentation if I switch."

#### Why Chi over Gin or stdlib for Go routing?
> "Chi is `net/http`-compatible, so handlers are portable and there's no framework lock-in. It gives me middleware composition (auth, logging, recovery, rate limiting) and clean routing without Gin's custom context type. I prefer Chi for long-term maintainability; Gin is fine but couples you to its abstractions."

---

## 3. Architecture (24-Day Version) — Explained for Beginners

> If you're new to distributed systems, read this section twice. It's the heart of the project and the thing interviewers will ask you to draw and explain.

### 3.1 The One-Sentence Summary

> **A developer opens a pull request → GitHub tells our server → our server puts a "review job" in a queue → a worker downloads the code and runs tests/scans → an AI reads everything and writes findings → those findings go to the dashboard and back to GitHub as a comment.**

That's it. Everything below is just *how* each step happens and *why* we split it into separate pieces.

---

### 3.2 The Real-World Analogy (Read This First)

Imagine a **hospital**:

| Hospital | This Project |
|----------|--------------|
| Patient walks in with a complaint | Developer opens a pull request |
| Receptionist checks them in, creates a file | Go API receives the webhook, creates an `analysis_run` |
| The file goes into a queue of patients waiting for tests | The job goes into the Redis queue |
| A lab technician picks up the file, runs blood tests, X-rays | The Python worker picks up the job, runs `npm test` + Semgrep |
| A doctor reads the test results + patient history, writes a diagnosis | The AI service reads the diff + test results + context, writes findings |
| The diagnosis is saved to the patient's file | Findings are saved to PostgreSQL |
| The patient gets a report + the doctor posts notes on their chart | The dashboard shows findings + GitHub gets a comment |

**Why the hospital has separate roles** (receptionist ≠ lab tech ≠ doctor) is the *same reason* we have separate services (API ≠ worker ≠ AI). Each does one job well, they work in parallel, and if one is busy the others keep going.

---

### 3.3 The Components — What Each One Does, in Plain English

#### 🟦 1. GitHub (the trigger)
- **What it is:** The website where developers' code lives. A "pull request" is a developer saying "please merge my new code into the main project."
- **What it does here:** When a PR is opened or updated, GitHub sends an automatic notification (a **webhook**) to our server. Think of it as GitHub calling our phone: "Hey, new code is ready to review."
- **Why it matters:** This is the *start* of our whole flow. No webhook = nothing happens.

#### 🟩 2. Go API (the receptionist)
- **What it is:** A small server program written in Go (using the Chi library for routing). It's the *only* part of our system that talks directly to GitHub.
- **What it does:**
  1. Receives the webhook from GitHub.
  2. **Verifies the signature** — checks that the call really came from GitHub (using a secret password), not a hacker pretending to be GitHub. *Like checking a patient's ID.*
  3. Saves basic info about the PR (which repo, which branch, who wrote it) into the database.
  4. Creates a "review job" record and puts it in the queue.
  5. Immediately tells GitHub "got it, I'll work on it" (returns HTTP 200 fast).
- **Why it's separate & fast:** GitHub will give up and consider the webhook "failed" if we don't respond within ~10 seconds. But actually *reviewing* code takes minutes. So the API's only job is to *accept the request quickly* and hand the slow work to someone else (the queue + workers).
- **Interview line:** "The API is a thin, stateless gateway — it validates, persists, and enqueues, then returns. It never does the actual analysis."

#### 🟨 3. PostgreSQL (the filing cabinet)
- **What it is:** A relational database — think of it as a set of spreadsheets (tables) that store everything permanently.
- **What it stores:** Users, repositories, pull requests, analysis runs, jobs, and findings (see §4 for the exact tables).
- **Why it's central:** Every other component reads from and writes to it. It's the *shared memory* of the system. The API writes "new run started," the worker updates "job finished," the AI writes "found 3 bugs," the dashboard reads "show me the latest findings."
- **Why a database and not just files:** Multiple services need to see the same data, we need to survive restarts, and we need to query history ("show me all findings for this repo").

#### 🟥 4. Redis Queue (the waiting room)
- **What it is:** A fast, in-memory data store used here as a **queue** — a line of jobs waiting to be processed.
- **What it does:** The Go API pushes a job onto the queue ("review PR #42"). Workers pull jobs off the queue one at a time. We use **Celery** (a Python library) to manage this.
- **Why we need a queue (critical concept):**
  - **Decoupling:** The API doesn't wait for the worker. It drops the job and moves on.
  - **Buffering:** If 10 PRs arrive at once, they line up instead of crashing the system.
  - **Retries:** If a worker crashes mid-job, the job goes back in the queue for another worker.
  - **Scaling:** We can add more workers later without changing the API.
- **Analogy:** A restaurant ticket system. The cashier (API) takes your order and puts a ticket on the rail (queue). The cooks (workers) pick tickets off the rail. The cashier doesn't wait for your food to cook.

#### 🟧 5. Python Worker — the Sandbox (the lab technician)
- **What it is:** A Python program (running via Celery) that does the *actual hands-on work* with the developer's code.
- **What it does, step by step:**
  1. Picks a job from the queue.
  2. **Clones the repository** (downloads a copy of the code) and checks out the PR's branch.
  3. Runs the project's tests (e.g., `npm test`).
  4. Runs a security scanner (**Semgrep**) that looks for dangerous patterns.
  5. Runs a dependency audit (`npm audit`) that checks for known-vulnerable libraries.
  6. Captures all the output (logs, pass/fail, exit codes) and saves it to the database.
- **The security twist — why it runs inside Docker:** The code we're running is *untrusted*. A malicious PR could try to delete files, steal secrets, or attack our network. So we run it inside a **Docker container** that's locked down:
  - `--network=none` → no internet access
  - read-only filesystem → can't modify our files
  - CPU/memory limits → can't crash our machine
  - hard timeout → can't run forever
  - *Analogy: the lab technician works inside a sealed glove box. The samples can't contaminate the lab.*
- **Interview line:** "The worker is the only component that touches untrusted code, and it does so inside an isolated, resource-limited, network-less container."

#### 🟪 6. Python AI Service (the doctor)
- **What it is:** A Python FastAPI service that talks to an LLM (OpenAI/Anthropic) and produces the actual *review*.
- **What it does, step by step:**
  1. Reads the PR diff (what lines changed).
  2. **Retrieves context** — uses `ripgrep` (a fast search tool) to find related files. *If `auth/login.ts` changed, it pulls `auth/*`, middleware, and tests so the AI understands the surroundings, not just the changed lines.*
  3. Reads the worker's test/scan results from the database.
  4. Sends all of this (diff + context + tool results) to the LLM with a carefully designed prompt.
  5. The LLM returns **findings** — each one has: a title, severity, the file/line, **evidence** (a quote from the diff or a test failure), and a **confidence** score.
  6. Saves findings to the database.
- **Why it's a separate service from the worker:** The worker does *deterministic* things (run a test → it passes or fails). The AI does *judgment* things (is this change risky?). Splitting them means we can retry the AI call without re-running all the tests, and we can scale them independently.
- **What "custom agent loop" means (don't be scared):** It's just a loop in our code: "call the LLM → if it asks to use a tool (like 'read this file'), run that tool → feed the result back → repeat until it says 'done'." We write this loop ourselves instead of using a framework, so we fully control and understand it. *It's maybe 100-200 lines of Python.*

#### 🟦 7. Next.js Dashboard (the report screen)
- **What it is:** A website (React/Next.js) where the user logs in with GitHub and sees their review results.
- **What it shows:** List of repos → list of PRs → a detail page for each analysis showing job status (running/done/failed), test results, security findings, and AI findings with severity, evidence, and confidence.
- **Why it exists:** GitHub comments are great for the developer, but a team lead wants a *dashboard* to see trends, history, and all findings in one place. It also makes the project demo-able — a recruiter can see it working visually.

#### 🟩 8. GitHub PR Comment (the feedback to the developer)
- **What it is:** After the analysis finishes, we post a summary comment back on the GitHub pull request — the same place the developer is already looking.
- **The dedup trick:** We tag our comment with the commit SHA (a unique ID for that version of the code). Before posting, we check if a comment with that tag already exists. This prevents spamming the PR if GitHub re-sends the webhook (which it does sometimes).
- **Why it matters:** This closes the loop. The developer gets the review *where they already are*, without opening our dashboard.

---

### 3.4 The Full Data Flow — One PR's Journey, Step by Step

Read this as a story. This is what you'll explain in interviews.

```text
STEP 1: A developer named Priya opens PR #42 on GitHub.

STEP 2: GitHub sends a webhook (an HTTP POST) to our Go API.
        └─ The API checks the HMAC signature (secret password) to confirm
           it's really GitHub calling.

STEP 3: The Go API looks at the webhook payload:
        └─ "This is repo 'acme/web', PR #42, commit SHA 'abc123', author 'priya'."
        └─ It saves this to PostgreSQL in the 'pull_requests' and
           'analysis_runs' tables.
        └─ It checks: "Do I already have a run for (repo, PR, commit SHA)?"
           If yes → skip (idempotent). If no → create a new run, status='queued'.

STEP 4: The API pushes a job onto the Redis queue.
        └─ The job says: "Analyze run #17 — clone acme/web, branch 'feature-x'."
        └─ The API returns HTTP 200 to GitHub immediately. Total time: <1 second.

STEP 5: A Python worker (idle, waiting on the queue) picks up the job.
        └─ It updates the run status in PostgreSQL to 'running'.

STEP 6: The worker spins up a locked-down Docker container:
        └─ Clones the repo inside it.
        └─ Checks out Priya's branch.
        └─ Runs: npm test        → 2 tests failed (captures logs)
        └─ Runs: semgrep scan    → 1 security finding (captures JSON)
        └─ Runs: npm audit       → 1 vulnerable dependency
        └─ Saves all results to the 'analysis_jobs' and 'tool_results' tables.
        └─ Destroys the container. (No trace left.)

STEP 7: The worker (or the AI service — your design choice) calls the AI service:
        └─ "Here's the diff, the related files I found with ripgrep,
           and the test/scan results. What do you think?"

STEP 8: The AI service runs its agent loop:
        └─ Sends the prompt to the LLM.
        └─ LLM responds with structured findings (JSON):
           • "High: SQL injection in login.ts line 42 — evidence: user input
              concatenated directly into query. Confidence: 0.92."
           • "Medium: missing test for new validateEmail function. Confidence: 0.8."
        └─ Saves findings to the 'findings' table.

STEP 9: The system posts a summary comment on GitHub PR #42:
        └─ "🤖 AI Review: 2 findings (1 high, 1 medium). [details...]"
        └─ Checks for existing comment with tag 'ai-review-abc123' first
           (dedup). If exists → update it. If not → post new.

STEP 10: The run status in PostgreSQL is set to 'completed'.
         └─ Priya sees the comment on GitHub.
         └─ A team lead opens the Next.js dashboard and sees the same
            findings with severity, evidence, and confidence.
```

**Total elapsed time:** ~1-3 minutes from webhook to comment, depending on test suite size and LLM latency. The API was involved for <1 second; everything else happened asynchronously in the background.

---

### 3.5 The Diagram (Annotated)

```text
                        ┌──────────┐
                        │  GitHub  │  ← where developers' code lives
                        └────┬─────┘
                             │ webhook (GitHub calls our server)
                             ▼
                ┌────────────────────────┐
                │   Go API (Chi)         │  ← "receptionist": verifies
                │   • verify signature   │     signature, saves PR info,
                │   • save PR metadata   │     creates a job, responds fast
                │   • create job         │
                └───────────┬────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │   PostgreSQL           │  ← "filing cabinet": stores
                │   (users, repos, PRs,  │     everything permanently;
                │    runs, jobs, findings)│     all services read/write here
                └───────────┬────────────┘
                            │
                            ▼
                ┌────────────────────────┐
                │   Redis Queue          │  ← "waiting room": jobs line up
                │   (via Celery)         │     here until a worker is free
                └───────────┬────────────┘
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
   ┌──────────────────────┐    ┌──────────────────────┐
   │ Python Worker        │    │ Python AI Service    │
   │ (the "lab tech")     │    │ (the "doctor")       │
   │                      │    │                      │
   │ • clone repo         │    │ • read diff          │
   │ • run npm test       │    │ • retrieve context   │
   │ • run semgrep        │    │   (ripgrep)          │
   │ • run npm audit      │    │ • call LLM           │
   │ • capture logs       │    │ • generate findings  │
   │                      │    │   with evidence +    │
   │ 🔒 runs inside a     │    │   confidence         │
   │    locked Docker     │    │                      │
   │    container         │    │                      │
   └──────────┬───────────┘    └──────────┬───────────┘
              │                           │
              └─────────────┬─────────────┘
                            ▼
                ┌────────────────────────┐
                │   PostgreSQL           │  ← findings & results saved here
                └───────────┬────────────┘
                            │
              ┌─────────────┴──────────────┐
              ▼                            ▼
   ┌──────────────────────┐    ┌──────────────────────┐
   │ Next.js Dashboard    │    │ GitHub PR Comment    │
   │ (the "report screen")│    │ (feedback to dev)    │
   │                      │    │                      │
   │ • login with GitHub  │    │ • summary of findings│
   │ • see repos & PRs    │    │ • dedup by commit SHA│
   │ • view findings,     │    │   (no duplicate spam)│
   │   evidence, status   │    │                      │
   └──────────────────────┘    └──────────────────────┘
```

---

### 3.6 Why It's Split Into Separate Services (the Key Interview Concept)

A beginner's instinct is "why not just one big program that does everything?" Here's why we split it — and this is *the* answer interviewers want:

| Problem if it were one program | How splitting solves it |
|--------------------------------|------------------------|
| GitHub webhook times out (~10s) while we run tests (minutes) | API responds instantly; worker runs tests in the background |
| If the AI service crashes, we lose the test results too | Worker and AI are separate — test results are saved before AI runs |
| Can't handle 10 PRs at once — one program does them one-by-one | Multiple workers can pull from the queue in parallel |
| Can't scale the AI part (slow, expensive) without scaling the test part (fast, cheap) | Scale workers and AI service independently |
| A bug in the test runner crashes the whole system | A worker crash only loses one job; it goes back in the queue |

**The one-sentence interview answer:** "I split the system into an API, a queue, workers, and an AI service so each can fail, scale, and be developed independently — the API stays fast, the queue buffers bursts, workers run untrusted code in isolation, and the AI service can be retried without re-running tests."

---

### 3.7 What Talks to What (the Communication Map)

| From → To | How | Why |
|-----------|-----|-----|
| GitHub → Go API | HTTP POST (webhook) | GitHub notifies us of PR events |
| Go API → PostgreSQL | SQL (via Go pgx/driver) | Save PR metadata, create run/job |
| Go API → Redis | Celery task enqueue | Put job in the queue |
| Worker → Redis | Celery task dequeue | Pick up next job |
| Worker → Docker | Docker API (run container) | Run tests/scans in isolation |
| Worker → PostgreSQL | SQL | Save test/scan results |
| Worker/AI → AI Service | HTTP (FastAPI endpoint) | Request AI review |
| AI Service → LLM (OpenAI/Anthropic) | HTTPS API call | Get the actual AI analysis |
| AI Service → PostgreSQL | SQL | Save findings |
| Go API → GitHub | HTTPS (GitHub API) | Post comment on PR |
| Next.js → Go API | HTTP (REST) | Fetch data for dashboard |

> **Note:** The worker and AI service both talk to PostgreSQL directly — they don't talk to each other through the API. This is intentional: the database is the shared source of truth. The worker writes results; the AI reads them. They're decoupled.

---

### 3.8 Quick Glossary (Terms That Sound Scary but Aren't)

| Term | Plain Meaning |
|------|---------------|
| **Webhook** | One website automatically calling another when something happens. Like an automatic phone call from GitHub. |
| **HMAC signature** | A cryptographic "stamp" that proves a message came from who it claims to be. Like a wax seal on a letter. |
| **Idempotent** | "Doing the same thing twice has the same result as doing it once." So if GitHub re-sends the webhook, we don't create a duplicate review. |
| **Queue** | A line of tasks waiting to be processed, one at a time, in order. |
| **Worker** | A program that picks tasks off a queue and does them. |
| **Celery** | A Python library that manages the queue + workers for us. |
| **Diff** | The "before vs after" of changed code — which lines were added/removed. |
| **LLM** | Large Language Model — the AI (like GPT-4) that reads code and writes reviews. |
| **Agent loop** | A loop where the AI can ask to use tools (read a file, run a test) before giving its final answer. |
| **Docker container** | A lightweight, isolated "mini-computer" that runs a program without touching the host. |
| **cgroup limits** | Linux feature that caps how much CPU/memory a process can use. |
| **Exit code** | A number a program returns when it finishes (0 = success, non-zero = failure). |
| **Commit SHA** | A unique fingerprint for a specific version of code. Used for dedup. |
| **ripgrep** | A very fast text search tool (like `grep` but faster). |
| **OpenTelemetry** | A standard way to trace a request across multiple services for debugging. |

---

## 4. Database Schema (Minimal — 6 tables)

```text
users           (id, github_id, username, oauth_token_encrypted, created_at)
repositories    (id, github_repo_id, full_name, owner, webhook_id, created_at)
pull_requests   (id, repo_id, pr_number, head_sha, author, title, created_at)
analysis_runs   (id, repo_id, pr_id, status, trigger, commit_sha, started_at, completed_at, error)
analysis_jobs   (id, run_id, job_type, status, attempts, exit_code, logs, started_at, completed_at)
findings        (id, run_id, file_path, line_start, line_end, severity, category, title, description, evidence, confidence, verification_status, created_at)
```

> **Interview note:** "I designed tables around domain entities (Run, Job, Finding), not UI screens. `analysis_runs` is idempotent on `(repo_id, pr_id, commit_sha)` so re-delivered webhooks don't create duplicate runs."

---

## 5. The 24-Day Day-by-Day Plan

> **Daily rhythm:** DSA 2 hrs (floor) → Project 4-5 hrs → 30 min review/log. Saturday = LC contest (don't skip). Sunday = light.

### Week 1 (July 2-8): Foundation + GitHub Flow
| Day | Date | Goal | Deliverable |
|-----|------|------|-------------|
| 1 | Jul 2 | Monorepo + infra | `apps/{web,api,ai,worker}`, `docker-compose.yml` (postgres, redis), Go API skeleton (Chi), DB migrations |
| 2 | Jul 3 | Auth + schema | GitHub OAuth, `users`/`repos` tables, `/api/repos` list |
| 3 | Jul 4 | Webhook | `POST /webhooks/github`, HMAC signature verification, store PR metadata |
| 4 | Jul 5 | Diff + queue | Fetch PR diff via GitHub API, create `analysis_run`, push job to Redis |
| 5 | Jul 6 | Worker skeleton | Python Celery worker: clone repo, checkout PR branch, run `npm test`, capture logs/exit |
| 6 | Jul 7 | Job status APIs | `GET /api/analyses/{id}`, `/jobs`; minimal Next.js dashboard showing run + job status |
| 7 | Jul 8 | **Checkpoint 1** | End-to-end: PR webhook → job queued → worker runs `npm test` → status in UI. **If not working → see §9 Fallback.** |

### Week 2 (July 9-15): Static Analysis + AI Review
| Day | Date | Goal | Deliverable |
|-----|------|------|-------------|
| 8 | Jul 9 | Semgrep | Run Semgrep in worker, parse JSON, store as findings |
| 9 | Jul 10 | npm audit + severity mapping | Dependency scan, map severities/categories, store tool results |
| 10 | Jul 11 | Retrieval (ripgrep) | Given changed files, pull related files via path heuristics + ripgrep keyword search |
| 11 | Jul 12 | AI service skeleton | FastAPI app, LLM client (OpenAI/Anthropic), `/review` endpoint, token counting |
| 12 | Jul 13 | Agent loop v1 | Ingest diff + context + tool outputs → LLM → structured findings (JSON schema) |
| 13 | Jul 14 | Evidence + confidence | Force LLM to cite diff lines + tool output as evidence; confidence field; store findings |
| 14 | Jul 15 | **Checkpoint 2** | AI generates findings referencing real diff + Semgrep results. **If not working → §9 Fallback.** |

### Week 3 (July 16-22): GitHub Comments + Dashboard + Hardening
| Day | Date | Goal | Deliverable |
|-----|------|------|-------------|
| 15 | Jul 16 | Post comment | Post summary comment to GitHub PR; dedup by commit SHA + comment tag |
| 16 | Jul 17 | Dashboard findings | Findings view (severity, evidence, confidence), job timeline |
| 17 | Jul 18 | Dashboard polish | Repo/PR lists, run detail page, loading/error states (TanStack Query) |
| 19 | Jul 20 | Observability (light) | OTel traces across Go+Python, 4 Prometheus metrics (job duration, queue depth, AI latency, token usage) |
| 20 | Jul 21 | Retries + error handling | Celery retry w/ exponential backoff, dead-letter, webhook idempotency test |
| 21 | Jul 22 | **Stretch: patch verification** | If ahead: AI suggests patch → apply in tmpfs → run targeted test → mark status. If behind: skip, list as future work. |

### Week 4 (July 23-27): Polish + Resume
| Day | Date | Goal | Deliverable |
|-----|------|------|-------------|
| 22 | Jul 23 | Demo repo | Create public repo with planted bugs (missing validation, failing test, fake secret, bad dep) |
| 23 | Jul 24 | README + diagram | README (per §7), Mermaid architecture diagram, demo script |
| 24 | Jul 25 | Deploy | Deploy API+worker+AI to Render/Cloud Run; frontend to Vercel; test live webhook |
| 25 | Jul 26 | Demo video | 90-sec demo GIF/video; final end-to-end test on demo repo |
| 26-27 | Jul 26-27 | Buffer + resume | Fix bugs, write resume bullets (§6), prep interview talking points (§7) |

---

## 6. Resume Bullets (Ready to Paste)

```
AI Code Review & DevSecOps Agent | Go, Python, Next.js, PostgreSQL, Redis, Docker
• Built an agentic AI platform that reviews GitHub PRs by orchestrating
  sandboxed test execution, Semgrep security scans, and LLM-driven
  analysis, posting evidence-backed findings directly to pull requests
• Designed an event-driven architecture: Go API receives webhooks,
  enqueues idempotent jobs to Redis, Python Celery workers run checks
  in isolated Docker containers (--network=none, read-only fs, cgroup limits)
• Implemented a custom tool-using agent loop in Python that retrieves
  code context via ripgrep, interprets test/static-analysis output, and
  generates findings with cited evidence and confidence scores
• Enforced untrusted-code isolation with Docker namespace + cgroup
  sandboxing, webhook HMAC verification, and OAuth token encryption
• Added OpenTelemetry tracing across Go + Python services and
  Prometheus metrics for job duration, queue depth, and LLM token cost
```

> **Quantify before submitting:** fill in real numbers — PRs analyzed in demo, p95 job duration, findings generated, token cost per review. Even small real numbers beat adjectives.

---

## 7. Interview Talking Points (Beyond the Stack)

**System design (they will ask these):**
- **Why a queue instead of synchronous API?** Webhook handlers must return 200 fast (GitHub times out at ~10s). Analysis takes minutes. Decoupling lets the API ack immediately, workers retry independently, and the system absorb bursts (e.g., a PR push + a reopen in quick succession).
- **How did you prevent duplicate processing?** Idempotency key = `(repo_id, pr_number, head_sha)`. Store GitHub delivery ID. Re-deliveries upsert, don't duplicate. Comment dedup by tagging comments with commit SHA.
- **How do you handle worker failures?** Celery exponential backoff (e.g., 3 retries at 30s/2m/10m), then dead-letter queue for manual inspection. Jobs are idempotent so retry is safe.
- **How does code retrieval improve review quality?** A diff alone lacks context. If `auth/login.ts` changes, retrieving `auth/*`, middleware, and tests lets the AI judge whether a change breaks callers — not just whether the diff looks plausible.
- **How did you handle LLM hallucinations?** Three ways: (1) force evidence citation — every finding must quote a diff line or tool output; (2) confidence field calibrated against tool results; (3) verification status — unverified vs verified-by-test. The dashboard surfaces this so humans know what to trust.
- **What would you change for scale?** Worker pools split by job type (CPU-heavy sandbox vs AI-heavy LLM), cache repo clones, move logs to S3, Kafka for durable streaming, per-tenant rate limits, horizontal worker autoscaling on queue depth.

**Be ready to draw** the architecture diagram from §3 on a whiteboard and explain each arrow.

---

## 8. Stretch Goals (Only If Ahead by July 20)

1. **pgvector retrieval** — add embeddings, HNSW index, hybrid (keyword + vector) search. ~1 day.
2. **Patch verification** — AI suggests patch → apply in tmpfs → run targeted tests → mark `verified_by_test` / `failed_verification`. ~2 days. **Highest resume value** — directly addresses the "AI hallucination" interview question with a working demo.
3. **GitHub Checks API** — post pending/success/failure status to the PR check suite. ~0.5 day.

> If you complete the MVP by July 20, **prioritize patch verification** — it's the single most impressive demo feature and the best interview story.

---

## 9. Fallback Plan (If Checkpoint 1 or 2 Fails)

If by **July 15** the end-to-end flow (webhook → worker → AI findings) isn't working, **stop**. Do not spend July 16-27 salvaging. Instead pivot to the guide's original recommendation:

> **2-week RAG project:** "RAG-based Q&A over IIT Kanpur course materials" — LangChain/LlamaIndex + FastAPI + ChromaDB. You already know this stack from your search engine. Ship it by July 27, spend Aug on CS fundamentals.

**A finished simple project beats an unfinished ambitious one.** Your betting exchange + search engine already carry the resume. This third project is a bonus, not a gamble.

---

## 10. Rules to Protect Your Placements

1. **DSA floor is non-negotiable:** 2 hrs/day + Saturday contest. This project does not exist at the cost of DSA.
2. **No new language/framework in July.** Go, Python, TS only. If you're tempted to "just learn Spring," re-read §0.
3. **Commit every day.** Green squares = momentum + resume proof of sustained work.
4. **Demo-able > feature-complete.** A 90-sec video of a real PR getting reviewed beats 10 half-built features.
5. **August is CS-fundamentals + DSA month.** This project must be done July 27. After that: README polish only, then back to OS/DBMS/Networks per your `guide.md`.

---

## 11. Final Verdict on the Original `plan.md` Stack

The original architecture is sound. The original **stack recommendation (Java Spring Boot primary) was wrong for you** — it ignored your existing Go/Python skills and your 24-day timeline. This tuned version:
- **Backend → Go** (leverages your skills, faster to ship, better interview story for your target companies)
- **Workers → Python/Celery** (aligned with AI service, shares tooling)
- **Agent → custom loop first** (LangGraph deferred)
- **Retrieval → ripgrep first** (pgvector deferred)
- **Scope → 24-day MVP** (patch verification as stretch, rest as roadmap)

Build the end-to-end loop first. Make it work on a real PR. Then add one impressive feature (patch verification). Then write the README and record the demo. That's your July.