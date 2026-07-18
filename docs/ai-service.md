# The AI service (`apps/ai-service`)

A small FastAPI app on port 8000 whose only real job is: **take a bunch of
code-review context, send it to an LLM, and return a list of findings.**

It does not talk to Postgres, Redis, or the worker directly — it only answers
HTTP requests. The worker is its sole caller.

See `apps/ai-service/agent.py` for the implementation with comments; this doc
explains what it does and how to drive it.

## Files

```
apps/ai-service/
├── main.py          FastAPI app; /health and /review endpoints
├── agent.py         AgentLoop: builds the prompt, calls the LLM, parses JSON
├── requirements.txt pinned Python deps (fastapi, httpx, pydantic, ...)
├── .env             NOT committed — holds OPENCODE_GO_API_KEY
└── test_review.json ready-made curl payload for manual testing
```

## Endpoints

### `GET /health`
Returns `{"status": "ok"}`. Used as a smoke test:
```powershell
curl http://localhost:8000/health
```

### `POST /review`
Accepts a JSON body matching the `ReviewRequest` model in `main.py`:

| Field | Type | What it is |
|-------|------|------------|
| `run_id` | int | The analysis run this review belongs to (echoed back) |
| `repo_full_name` | str | `"owner/repo"` (for context in the prompt) |
| `pr_number` | int | PR number (for context in the prompt) |
| `pr_title` | str | The PR title |
| `diff` | str | The full `git diff` output |
| `changed_files` | list[str] | Paths of changed files |
| `context_files` | dict[str, str] | Map of related file → its first ~100 lines |
| `tool_results` | dict[str, str] | Map of tool name → its output logs |

Returns:
```json
{ "run_id": 1, "findings": [ { "title": "...", "severity": "high", ... }, ... ] }
```

If the API key is missing or the LLM call fails after retries, the endpoint
returns `500` (missing config) or `502` (LLM unavailable) instead of crashing.

### Manual test
```powershell
curl.exe -X POST http://localhost:8000/review `
  -H "Content-Type: application/json" `
  --data-binary "@apps/ai-service/test_review.json"
```

The `test_review.json` payload contains a planted SQL-injection so you can
confirm the LLM finds it.

## How `POST /review` works

1. `main.py` flattens `context_files` and `tool_results` (dicts) into a
   single string per chunk, separated by `--- path ---` headers.
2. Opens an `AgentLoop` (`with AgentLoop() as agent:` so the HTTP client is
   closed automatically).
3. Calls `agent.review_pr(diff, context, tool_results, pr_title)`.
4. Returns `{"run_id": ..., "findings": findings}`.

## AgentLoop — the actual LLM call

`AgentLoop.__init__` reads config from env vars (with explicit-arg overrides):
`OPENCODE_GO_API_KEY`, `OPENCODE_GO_MODEL` (default `glm-5.2`),
`OPENCODE_GO_BASE_URL` (default `https://opencode.ai/zen/go/v1`),
`OPENCODE_GO_MAX_TOKENS` (2000), `OPENCODE_GO_TIMEOUT` (60s).

The endpoint it calls is `<base_url>/chat/completions`, the OpenAI-compatible
endpoint exposed by **OpenCode Go** (`https://opencode.ai/docs/go/`). Auth is
`Authorization: Bearer <key>`. Models include `glm-5.2`, `kimi-k2.7-code`,
`deepseek-v4-flash` (cheapest, most requests), and others — change with
`OPENCODE_GO_MODEL`.

### The prompt

A **system prompt** (hard-coded; tells the model it's an expert code reviewer
that must return JSON with title/severity/category/file_path/line_start/
description/evidence/confidence, and must include evidence) plus a **user
prompt** built from the PR title, diff, related context, and tool results.

Each chunk is size-capped (`diff[:8000]`, `context[:4000]`,
`tool_results[:4000]`) so the total fits within the model's input window.

### Reliability

- **Retries:** up to 3 attempts total (1 + 2 retries). Only retries
  `429` / `500` / `502` / `503` / `504` and network errors, with exponential
  backoff (`1s`, `2s`, `4s`). Non-transient errors (malformed body, missing
  key) surface immediately — retrying those would waste time.
- **JSON parsing:** the model is told to return a JSON array, but LLMs love to
  wrap output in markdown. `_parse_findings` tries three strategies in order:
  1. parse the whole response as JSON;
  2. find a ```` ```json ... ``` ```` (or ```` ``` ... ``` ````) fence and
     parse what's inside;
  3. take everything from the first `[` to the last `]` and try that.
  If all three fail, it logs a snippet and returns `[]` (the caller proceeds
  as if no issues were found — better than crashing a whole run).
- **Missing key:** `__init__` raises a clear `ValueError` naming the env var
  and the file to put it in. `main.py` catches this and returns HTTP 500
  with that message.
- **Connection lifecycle:** `with AgentLoop() as agent:` closes the `httpx`
  client on the way out, even if the call raised.

## Findings layout

The LLM is instructed to return each finding as a dict shaped like:

```json
{
  "title": "SQL injection in login query",
  "severity": "high",
  "category": "security",
  "file_path": "src/auth/login.ts",
  "line_start": 12,
  "description": "User input is concatenated directly into the SQL query...",
  "evidence": "const query = \"SELECT * FROM users WHERE email='\" + email + \"'\"",
  "confidence": 0.9
}
```

The worker's `save_findings(...)` inserts these into Postgres with
`verification_status = 'unverified'` — an LLM suggestion is a *guess*, not a
proven fact, so the dashboard shows it as such. Semgrep and npm-audit
findings, in contrast, come from rule matches and advisory databases, so the
worker marks those `verified_by_static_analysis`.

See [architecture.md](architecture.md) for where the AI service sits in the
overall picture and [flows.md](flows.md) for the full webhook → finding flow.