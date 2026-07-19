# Stitch Prompt — AI Code Review & DevSecOps Dashboard

> Paste everything below this line into Google Stitch.

---

You are building the frontend for an existing product called **AI Code Review & DevSecOps Agent Platform**. The backend already exists and is frozen — you are designing and generating the Next.js 16 dashboard that consumes it. The generated code must drop into an existing repo with zero manual adaptation: same paths, same imports, same conventions, same dependencies, same data shapes.

This brief is exhaustive on purpose. Treat every "DO", "DON'T", and "API contract" line as a hard constraint. Do not invent endpoints, do not rename fields, do not assume framework features that don't exist in this version.

================================================================
1. ROLE & GOAL
================================================================

Build a polished, production-looking developer dashboard for an AI code review / DevSecOps platform. Runs are triggered by GitHub PR webhooks; the worker runs tests, Semgrep, `npm audit`, and an LLM review; findings land in Postgres and are surfaced back as a comment on the PR. The dashboard's job is to let a developer:

- See a live list of analysis runs (newest first, auto-refreshing).
- Drill into a single run and see: run metadata, per-tool job status (test / semgrep / npm_audit), and a severity-ordered list of findings with file/line/category/confidence/evidence.
- Filter findings by severity, category, and verification status.
- See the run's status lifecycle (queued → running → completed | failed), the error message if it failed, and timing (started_at, completed_at, duration).
- Trigger a "Post comment to PR" action for a run (calls a backend endpoint that posts/updates a review summary comment on the GitHub PR).
- Log in with GitHub (OAuth) so the bot has a token to use.
- See a clean empty state, loading skeleton, and error state for every screen.

Visual tone: a serious, modern developer tool — think Vercel/GitHub/Linear/PostHog aesthetic. Dark-mode-native, with a light variant. Dense but readable. Monospaced for SHAs, file paths, and evidence. Tailwind utility classes throughout. Subtle borders, soft cards, small badges with strong color coding for severity. No emoji icons unless they convey meaning; prefer simple inline SVG icons in a dedicated `components/icons.tsx`. A persistent left sidebar OR a top nav is fine — pick what produces the cleanest layout for a 2-screen dashboard (list + detail) plus a login button and a settings placeholder.

================================================================
2. TECH STACK — LOCKED, DO NOT SUBSTITUTE
================================================================

- Next.js 16.2.10 (App Router, React Server Components by default). Turbopack is the default bundler — do not add webpack config.
- React 19.2.4
- @tanstack/react-query 5.101.2 (already a dependency — use it for all client-side fetching; do not introduce SWR, axios, or custom fetch wrappers)
- Tailwind CSS v4 (via `@tailwindcss/postcss`). Configure theme tokens in `globals.css` via `@theme`, NOT via `tailwind.config.js`. Do not create `tailwind.config.js`.
- TypeScript strict mode. Path alias `@/*` maps to `./src/*`.

Other installed packages you may use without adding deps: `next`, `react`, `react-dom`, `react-query`. **Do not add new npm dependencies.** If you think you need one, simulate the same UX with Tailwind + native HTML/SVG. In particular, do not add a UI kit (shadcn, radix, daisy, mantine). Build small primitives by hand in `src/components/ui/`.

================================================================
3. HARD CONSTRAINTS — NEXT.JS 16 GOTCHAS (DO NOT VIOLATE)
================================================================

These are real breaking changes vs. older Next.js versions. Code that ignores them will not compile or silently break.

1. **App Router only.** No `pages/` directory. No `getServerSideProps`/`getStaticProps`/`getInitialProps`. Use Server Components + `fetch`/Route Handlers or Client Components + TanStack Query.

2. **`useRouter` MUST be imported from `next/navigation`**, never `next/router`. Do not read `router.query` or `router.pathname` — they were removed. Use `useSearchParams()` and `usePathname()` instead. Do not use `router.events` — it's gone.

3. **Dynamic route `params` is a Promise in v16.** In a Server Component page:
   ```tsx
   export default async function Page({ params }: { params: Promise<{ id: string }> }) {
     const { id } = await params;
     ...
   }
   ```
   In a Client Component, use the `use(params)` hook (from `react`) or the `useParams()` hook from `next/navigation` (returns a plain object, no await).

4. **`searchParams` page prop is also a Promise.** `await searchParams` in Server Components; `use(searchParams)` or `useSearchParams()` in Client Components.

5. **`viewport` is a SEPARATE export from `metadata`.** Do not put `viewport`, `themeColor`, or `colorScheme` inside `metadata`. Use:
   ```tsx
   export const viewport: Viewport = { themeColor: "black", width: "device-width" };
   export const metadata: Metadata = { title: "...", description: "..." };
   ```
   Both only work in Server Components (never inside a `"use client"` file).

6. **Root `layout.tsx` is a Server Component and owns `<html>`/`<body>`.** Never add `"use client"` to it. Providers that need client (e.g. `QueryClientProvider`) live in a separate `"use client"` file (the project already has `src/app/providers.tsx` — keep using it).

7. **`"use client"` should go on the smallest interactive component, not the whole page.** Prefer Server Component pages that render a Client child for interactive parts. List/detail pages CAN be Client Components if they use TanStack Query's polling — that's acceptable — but don't mark layouts or the root as client.

8. **`fetch` is NOT cached by default in v16.** Don't write code that assumes Next will cache. If you want caching, use TanStack Query's `staleTime`/`gcTime` config (preferred — it's already in the stack).

9. **Do NOT create `middleware.ts`.** In v16 it's renamed to `proxy.ts` with a `proxy` named export. We don't need it for this dashboard — skip entirely.

10. **Do NOT add `<Image>` from `next/image` for external hosts (e.g. GitHub avatars) without configuring `images.remotePatterns` in `next.config.ts`.** For now, prefer plain `<img>` for GitHub avatars to avoid config churn, OR configure `remotePatterns` for `avatars.githubusercontent.com`. Either is fine — pick one and be explicit in the code.

11. **Geist fonts are referenced via CSS variables in `globals.css` (`--font-geist-sans`, `--font-geist-mono`) but `layout.tsx` does NOT import them yet.** Wire them up in `layout.tsx`:
    ```tsx
    import { Geist, Geist_Mono } from "next/font/google";
    const geistSans = Geist({ subsets: ["latin"], variable: "--font-geist-sans" });
    const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });
    // Then: <html className={`${geistSans.variable} ${geistMono.variable}`} lang="en">
    ```
    This is required for `font-sans` and `font-mono` Tailwind utilities to actually render Geist instead of falling back to Arial.

12. **`refetchInterval` polling is fine** — the existing list page uses 5s polling. Keep that pattern for list and run detail page (use longer interval, e.g. 10s, on detail).

13. **Do NOT use `next/link`'s legacy props** — `passHref`, `<a>` child etc. are unnecessary in App Router. Just `<Link href="/runs/42">text</Link>`.

14. **Do NOT use `next/legacy/image`.** Use `next/image` if you use Image at all.

15. **Parallel routes / `default.tsx`** — we don't use them; don't add.

16. **Don't introduce `cacheComponents`, `use cache`, `cacheLife`, `cacheTag`.** That feature is off (empty `next.config.ts`).

================================================================
4. PROJECT STRUCTURE — USE EXACTLY THESE PATHS
================================================================

The repo uses the alias `@/* -> ./src/*`. Put files at exactly these locations:

```
src/
  app/
    layout.tsx               # Server Component — owns <html>/<body>, imports Providers, sets metadata + viewport, wires Geist fonts
    providers.tsx            # ALREADY EXISTS — "use client" QueryClientProvider. Reuse it; do not duplicate.
    globals.css              # ALREADY EXISTS — Tailwind v4 import + @theme tokens. EXTEND it with new tokens; don't drop existing ones.
    page.tsx                 # Dashboard index: list of runs. (REWRITE — currently minimal.)
    loading.tsx              # Optional skeleton for index route
    error.tsx                 # Optional error boundary for index route
    runs/
      [id]/
        page.tsx             # Run detail page — Server Component, awaits params, renders <RunDetailView runId={id} />
        loading.tsx          # Skeleton for the run detail
    api/                     # NOTHING — do not add Route Handler proxies; we use next.config.ts rewrites (see below)
  components/
    ui/
      badge.tsx              # StatusBadge, SeverityBadge, VerificationBadge
      card.tsx
      button.tsx
      table.tsx
      skeleton.tsx
      empty-state.tsx
      code-block.tsx         # monospace, scrollable, line numbers optional
      tag.tsx
    icons.tsx                 # inline SVG icon set (status, severity, chevrons, github-mark, refresh, external-link)
    app-shell.tsx            # top nav / sidebar + login button + brand
    run-list-table.tsx       # client — uses useAnalyses()
    run-row.tsx
    run-detail-view.tsx      # client — uses useAnalysis + useAnalysisJobs + useAnalysisFindings
    findings-list.tsx        # client — filtering UI + list
    finding-card.tsx
    job-progress.tsx         # shows the 1 or 3 jobs for a run with status + exit_code
    post-comment-button.tsx  # client — uses usePostComment mutation
    github-login-button.tsx  # client — link to /auth/github
  hooks/
    use-analyses.ts          # useQuery on /api/analyses, 5s refetchInterval
    use-analysis.ts          # useQuery on /api/analyses/{id}, 10s refetchInterval
    use-analysis-jobs.ts     # useQuery on /api/analyses/{id}/jobs, 10s
    use-analysis-findings.ts # useQuery on /api/analyses/{id}/findings, 10s
    use-post-comment.ts      # useMutation on POST /api/analyses/{id}/post-comments
  lib/
    types.ts                 # exact TypeScript types from the API contract below
    api.ts                   # small typed fetch helpers — get<T>(path), post(path) — wraps Web fetch
    format.ts                # formatTimestamp, formatDuration, formatSha (first 7), formatConfidence
    constants.ts             # severity rank, color maps, status color maps, category icons
  config/
    query-client.ts          # default QueryClient options (staleTime, retry, refetchOnFocus)
next.config.ts               # EXTEND with rewrites() to proxy /api/* to http://localhost:8080/api/*
```

**CORS strategy (use this exact approach):**
Add `rewrites()` to `next.config.ts` so browser calls go to same-origin `/api/...` and Next proxies them server-side to the Go API on `localhost:8080`:
```ts
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: "http://localhost:8080/api/:path*" },
      { source: "/auth/:path*", destination: "http://localhost:8080/auth/:path*" },
    ];
  },
};
export default nextConfig;
```
This eliminates all CORS problems — the browser only ever talks to `localhost:3000`.

================================================================
5. DESIGN SYSTEM
================================================================

Aesthetic: serious developer tool, dense, modern. Inspired by Vercel's dashboard, GitHub's PR UI, Linear's issue list.

Color tokens — add to `globals.css` `@theme inline` block (extend what's there, don't remove `--color-background`/`--color-foreground`):

- Background surfaces: `--color-bg`, `--color-bg-subtle`, `--color-bg-muted`, `--color-border`, `--color-border-subtle`
- Text: `--color-text`, `--color-text-muted`, `--color-text-subtle`
- Severity (use these exact names so Tailwind generates classes like `bg-severity-high/10`, `text-severity-high`, `border-severity-high/30`):
  - `--color-severity-critical: #9b1c1c` (deep red)
  - `--color-severity-high:     #d92d20` (red)
  - `--color-severity-medium:   #f79009` (amber)
  - `--color-severity-low:      #667085` (slate)
  - `--color-severity-info:     #1570ef` (blue)
- Status:
  - `--color-status-queued:   #667085`
  - `--color-status-running:  #1570ef`
  - `--color-status-completed:#12b76a`
  - `--color-status-failed:   #d92d20`
- Accent / brand: `--color-accent: #6366f1` (indigo), `--color-accent-hover: #4f46e5`

Dark mode: the project's `globals.css` already has a `@media (prefers-color-scheme: dark)` override block — extend it with dark values for every new token you add (bg #0a0a0a, subtle #111, muted #1a1a1a, border #232323, text #ededed, muted-text #a0a0a0).

Typography: Geist Sans for body, Geist Mono for SHAs/file paths/evidence/code blocks. Use Tailwind utilities `font-sans`/`font-mono`.

Layout: full-height app shell. Top bar (header): brand on the left, GitHub "Sign in" / avatar button on the right, optional runtime status dot. Below: a max-width content container (~1080–1200px) with generous vertical padding. List page: a single big table with sticky header. Detail page: left main column (~70% width with findings list), right column (~30%) with run summary card + job progress card + Post Comment button.

Severity badge visual: small pill, lowercase uppercase first letter, soft tinted bg + colored text + 1px colored border. Example: `bg-severity-high/10 text-severity-high border-severity-high/30`.

Status badge: similar pill but with a small dot before the label. Running state includes an animated pulse on the dot.

Empty state: centered icon + one-line message + secondary line. Loading state: skeleton blocks mimicking the final layout (use `animate-pulse`). Error state: red-tinted card with the error text and a Retry button that calls `refetch()` from the relevant query.

================================================================
6. PAGES & ROUTES TO BUILD
================================================================

### Route 1 — `/` (Dashboard index)

A clean dashboard landing page. Two regions:

**Header bar** (in `app-shell.tsx`, shared): brand "AI Code Review & DevSecOps", subtitle "DevSecOps Agent Platform", GitHub sign-in button.

**Main**: a "Recent runs" card containing:

- Subtitle: "Last 50 runs, auto-refresh every 5s".
- Sortable-looking table (default: by `created_at` desc — already server-ordered; don't actually implement client sort unless trivial).
- Columns: **Run #** (`#42`), **Status** (badge), **Trigger** (`webhook` — text), **Commit** (mono 7-char SHA), **Created** (relative time, absolute on hover title).
- Each row is a Next `<Link href={`/runs/${id}`}>` — hover changes row background.
- Empty state when `data` is `null` or `[]`: "No analyses yet — open a PR on a connected repo to trigger one."
- Loading state: 8 skeleton rows.
- Error state: a red-tinted card with the message and a Retry button.
- A small "x runs active" counter if any have `status === "running"` or `"queued"`.

### Route 2 — `/runs/[id]` (Run detail)

Server Component page that awaits `params` and renders `<RunDetailView runId={id} />`. The client component composes three queries (analysis + jobs + findings) and lays out:

**Left main column:**
- Breadcrumb: `Runs / #42`
- Run header: Status badge + Run # + PR title (we don't have PR title from the API — use `commit_sha` truncated as the secondary line). If `status === "failed"` show `error` in a red card.
- Tabs or sections (use sections, not client-side tabs — keep it simple):
  1. **Findings** — heading "Findings (N)" with filter bar (severity multi-select, category multi-select, verification status toggle). Filtered list of `<FindingCard>`.
  2. **Jobs** — heading "Jobs" with three (or one) `<JobRow>` items: `test`, `semgrep`, `npm_audit`. Show status badge, exit_code (mono), timestamps.

**Right column (sticky):**
- **Run summary card**: status badge, commit SHA (full, mono, copyable), trigger, created_at, started_at, completed_at, duration (computed as `completed_at - started_at` when both present, suffix "in progress…" when not). If `error` is non-null, a red-bordered sub-card with the error text in mono.
- **Job progress card**: a vertical list of the three jobs (test/semgrep/npm_audit) with status dot, name, exit code, "completed at" time. Missing jobs (e.g. semgrep/npm_audit skipped because no test command was detected) are rendered as a greyed-out "skipped" row.
- **Actions card**: a `Post comment to PR` button. Uses `usePostComment`. On click, calls `POST /api/analyses/{id}/post-comments`. Shows loading spinner during mutation, success toast/text on 200, red error on failure. Disables the button while the run is still `running`/`queued` (no findings yet).

#### Finding card (`finding-card.tsx`)

Each finding is shown as a card with:
- Top row: severity badge (color-coded) + category tag (e.g. `security`, `dependency_risk`, `maintainability`) + verification badge (`Verified by static analysis` vs `AI — unverified`).
- Title — bold.
- File path — mono, with line range suffix when present (`:` or `-`). Format: `src/auth/login.js:42-58` if both `line_start` and `line_end` present; `src/auth/login.js:42` if only `line_start`; `src/auth/login.js` if neither. Skip the line suffix when both are null (npm audit findings, AI findings without `line_start`).
- Description — full text, mono for any inline code you detect (basic regex on backticks).
- Evidence — in a `<code-block>` (mono, soft bordered, scrollable horizontally) when `evidence` is non-null. Hidden behind a "Show evidence" disclosure button if it's long (>200 chars).
- Footer: confidence as a small label "confidence 0.95" — color the value by thresholds: ≥0.9 strong, 0.5–0.9 medium, <0.5 weak.

#### Job row (`job-progress.tsx`)

For each job:
- Status dot + name (`test`/`semgrep`/`npm_audit` rendered nicely: "Tests", "Semgrep", "npm audit").
- exit_code as mono `code 0` / `code 124` / `—` for null.
- Timestamps: `completed_at` relative ("3m ago"), absolute on hover.

For missing jobs (semgrep/npm_audit absent because no test command was detected), show a greyed "skipped" row.

================================================================
7. API CONTRACT — EXACT REQUESTS & RESPONSES
================================================================

All responses are JSON. Always go through same-origin `/api/...` (the `rewrites` config proxies to `http://localhost:8080`). Empty list endpoints may return **`null`** (not `[]`) — handle both: `data ?? []`.

### GET `/api/analyses` — list runs (max 50, newest first)
Response 200:
```ts
type AnalysisSummary = {
  id: number;
  status: "queued" | "running" | "completed" | "failed";
  trigger: string;            // always "webhook" in current data
  commit_sha: string;
  created_at: string;         // ISO timestamp string
};
// Response body: AnalysisSummary[] | null
```
Non-200: 500 (text "failed to query runs").

### GET `/api/analyses/{id}` — single run
Response 200:
```ts
type AnalysisDetail = {
  id: number;
  status: "queued" | "running" | "completed" | "failed";
  trigger: string;
  commit_sha: string;
  started_at: string | null;
  completed_at: string | null;
  error: string | null;       // only populated on failed runs
};
```
Non-200: 400 ("invalid id"), 404 ("analysis not found"). Note: any DB error also returns 404 — be tolerant.

### GET `/api/analyses/{id}/jobs` — list of jobs for a run
Response 200:
```ts
type AnalysisJob = {
  id: number;
  job_type: "test" | "semgrep" | "npm_audit";  // these are the only values ever written
  status: "running" | "completed" | "failed";   // "queued" never actually appears
  attempts: number;                             // always 0 — don't surface as "retries"
  exit_code: number | null;
  started_at: string | null;                    // ALWAYS null in practice — use created_at for start time
  completed_at: string | null;
};
// Response body: AnalysisJob[] | null
```
Non-200: 400 ("invalid id"), 500 ("failed to query jobs").

Note: this endpoint does NOT expose `logs`. Do not attempt to display raw tool logs — there is no endpoint for it.

Note: A run has either just 1 job (`test` only, when no test command was detected) OR 3 jobs (`test` + `semgrep` + `npm_audit`). semgrep/npm_audit never appear without test.

### GET `/api/analyses/{id}/findings` — all findings for a run, severity-ordered
Response 200:
```ts
type Severity = "critical" | "high" | "medium" | "low" | "info";
type Category = "security" | "dependency_risk" | "correctness" | "performance" | "testing" | "maintainability";
type VerificationStatus = "verified_by_static_analysis" | "unverified";

type Finding = {
  id: number;
  file_path: string;                  // never null; for npm_audit always "package.json"
  line_start: number | null;          // null for npm_audit findings; reliably null for AI findings too (line_end specifically)
  line_end: number | null;             // reliably null unless populated by semgrep
  severity: Severity;                  // critical > high > medium > low > info sort order from server
  category: Category;
  title: string;
  description: string;
  evidence: string | null;             // populated by semgrep and sometimes AI; null for npm_audit
  confidence: number | null;           // 0.95 npm_audit; 0.9 semgrep; 0.0–1.0 AI (default 0.5 if missing)
  verification_status: VerificationStatus;
};
// Response body: Finding[] | null
```
Non-200: 400 ("invalid id"), 500 ("failed to query findings").

### POST `/api/analyses/{id}/post-comments` — post/update the PR comment
Request: empty body. Just `POST /api/analyses/{id}/post-comments` (no JSON, no form data, no Authorization header from browser — the backend pulls its own token from the DB).
Response 200: `{ "message": "comment posted" }`
Non-200: 400 ("invalid id"), 404 ("analysis run not found"), 500 (various messages — surface verbatim to the user).

### GET `/auth/github` — start GitHub OAuth
Returns 302 redirect to GitHub. Render this as a plain `<a href="/auth/github">` (let the browser follow the redirect itself). Do NOT `fetch()` it client-side.

### GET `/auth/github/callback?code=...&state=...` — OAuth callback
Github redirects here after the user authorizes. The backend stores the token, returns 200 `{ "message": "Login successful", "username": "octocat" }`. **The current backend does NOT set a session cookie and does NOT redirect to the frontend** — the browser will land on this URL with raw JSON. Treat this as a known limitation: render the login button as a link to `/auth/github` and accept that after the callback the user sees raw JSON (or, if you want, design a tiny `<p>"If you see JSON here, your login was successful — return to the dashboard."</p>` text on a client page mounted at `/auth/github/callback` that reads the JSON body and offers a "Back to dashboard" link to `/`). Do NOT invent a `/me` endpoint — there isn't one.

### GET `/health` — API health
Returns 200 body "OK". Don't surface on the dashboard.

================================================================
8. DATA SEMANTICS & EDGE CASES — DO NOT GET THESE WRONG
================================================================

1. **Empty lists come back as `null`, not `[]`.** Always `data ?? []` before `.map`.
2. **`analysis_jobs.started_at` is always null** in the current backend. Use `created_at` for "started" — but note that `AnalysisJob` response doesn't even include `created_at` (only `started_at`/`completed_at`). So for a job's start time, fall back to the parent run's `started_at`.
3. **`analysis_jobs.attempts` is always `0`.** Don't render it as retry count.
4. **`analysis_jobs.status` is never `"queued"`** (the worker inserts `"running"` directly).
5. **A run has either 1 or 3 jobs.** If semgrep/npm_audit rows are absent, render them as "skipped" rows (not "missing"). They were skipped because no test command was detected in the cloned repo.
6. **AI findings have `line_end === null` (reliably)** because the AI is only prompted for `line_start`. Render `line_end` only when non-null.
7. **npm audit findings have `file_path === "package.json"` and both `line_start`/`line_end` null.** Render them with no line suffix, and a small "dependency" tag.
8. **`confidence` is always present in practice** but typed as nullable. Treat null as "unknown" not "0".
9. **`error` (on AnalysisDetail) is only populated when `status === "failed"`.** For completed/running runs it's null.
10. **`completed_at` is populated for BOTH `completed` AND `failed` runs.** Use `completed_at` (not status) to compute duration.
11. **Severity sort order from server**: `critical` → `high` → `medium` → `low` → `info` (and unknown). Preserve the server order; don't re-sort on the client.
12. **`trigger` is always `"webhook"` today.** Display it as a small tag, but the value space is open.
13. **`analysis_runs.created_at` is ISO-8601 text with timezone**, e.g. `"2026-07-18T14:22:03.123456+00:00"`. Use `new Date(...)` to parse, then format with `toLocaleString` or `Intl.RelativeTimeFormat` for relative.
14. **Don't render `attempts`, `logs`, `started_at` (for jobs) as "missing" with red styling** — they're expected to be null/zero. Render them as muted "—" or hide entirely.

================================================================
9. SPECIFIC CODE PATTERNS TO USE
================================================================

### QueryClient setup (already in `providers.tsx`):
Keep the existing `Providers` component, but optionally pass default options via a new `config/query-client.ts`:
```ts
import { QueryClient } from "@tanstack/react-query";
export function makeQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true },
    },
  });
}
```

### A typed hook pattern (use these exact files):
```ts
// hooks/use-analyses.ts
"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisSummary } from "@/lib/types";
import { get } from "@/lib/api";

export function useAnalyses() {
  return useQuery<AnalysisSummary[]>({
    queryKey: ["analyses"],
    queryFn: () => get<AnalysisSummary[]>("/api/analyses"),
    refetchInterval: 5_000,
  });
}
```
And `lib/api.ts`:
```ts
async function parseBody<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = await res.json();
  return (body ?? []) as T;
}
export async function get<T>(path: string): Promise<T> { return parseBody<T>(await fetch(path)); }
export async function post(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
}
```

### Server Component detail page:
```tsx
// src/app/runs/[id]/page.tsx
import { RunDetailView } from "@/components/run-detail-view";
type Props = { params: Promise<{ id: string }> };
export default async function RunPage({ params }: Props) {
  const { id } = await params;
  const runId = Number(id);
  if (Number.isNaN(runId)) notFound();
  return <RunDetailView runId={runId} />;
}
```
(`notFound` from `next/navigation`.)

### Mutation hook for Post Comment:
```ts
// hooks/use-post-comment.ts
"use client";
import { useMutation } from "@tanstack/react-query";
import { post } from "@/lib/api";

export function usePostComment(runId: number) {
  return useMutation({
    mutationFn: () => post(`/api/analyses/${runId}/post-comments`),
  });
}
```
Disable the button while `status === "running" || status === "queued"`. On `isPending` show spinner; on `isError` show red error text with `error.message`; on `isSuccess` show "Comment posted ✓" toast for 3 seconds.

### Relative time formatting (`lib/format.ts`):
Use `Intl.RelativeTimeFormat` and `Date.parse`. Don't introduce `date-fns` or `dayjs`. Keep the helper tiny.

================================================================
10. ACCESSIBILITY & INTERACTION
================================================================

- All interactive controls are real `<button>`/`<a>` elements; tables use semantic `<th scope="col">`.
- Severity/status badges include both color AND text (don't rely on color alone).
- Filter controls have visible labels and keyboard focus rings (Tailwind `focus-visible:ring-2`).
- The Post Comment button confirms its disabled state with a tooltip "Run still in progress…".
- Loading skeletons use `role="status"` and `aria-busy="true"` on the container.
- Use `prefers-reduced-motion` to disable the running-status pulse.

================================================================
11. DELIVERABLES
================================================================

Produce a complete, copy-pasteable file tree implementing the structure in section 4. For every file:

- Full path as a header comment.
- Clean, formatted TypeScript/TSX.
- No `console.log` / no debug statements.
- No comments explaining "what this does" — instead, only short intent comments where the why is non-obvious.
- Every page reads from a hook, every hook reads via `lib/api.ts`. No direct `fetch` calls in components.
- Severity/status/category color maps centralized in `lib/constants.ts` — components reference the map, never hardcode a color.
- All "use client" boundaries at the smallest interactive component.
- All Server Components default (layout, root page if possible, runs/[id] page).

Specifically generate AT LEAST these files:

1. `next.config.ts` (extended with `rewrites`)
2. `src/app/layout.tsx` (Server; Geist fonts; metadata + viewport)
3. `src/app/globals.css` (extended tokens + dark mode)
4. `src/app/page.tsx` (Server; renders `<RunListPage />` client child)
5. `src/components/run-list-table.tsx` + `src/components/run-row.tsx` (client, uses `useAnalyses`)
6. `src/app/runs/[id]/page.tsx` (Server; awaits params)
7. `src/components/run-detail-view.tsx` (client; composes 3 hooks)
8. `src/components/findings-list.tsx` + `src/components/finding-card.tsx` (client, with filters)
9. `src/components/job-progress.tsx` (shows 1 or 3 jobs with skipped rows)
10. `src/components/post-comment-button.tsx` (client, uses `usePostComment`)
11. `src/components/github-login-button.tsx`
12. `src/components/app-shell.tsx` (header bar + brand + login)
13. `src/components/ui/badge.tsx`, `button.tsx`, `card.tsx`, `skeleton.tsx`, `code-block.tsx`, `tag.tsx`, `empty-state.tsx`
14. `src/components/icons.tsx` (inline SVG icons)
15. `src/hooks/use-analyses.ts`, `use-analysis.ts`, `use-analysis-jobs.ts`, `use-analysis-findings.ts`, `use-post-comment.ts`
16. `src/lib/types.ts`, `api.ts`, `format.ts`, `constants.ts`
17. `src/config/query-client.ts`

The output should be ready to drop into the existing repo at the listed paths and `npm run lint && npm run dev` cleanly.

================================================================
12. WHAT NOT TO DO
================================================================

- Do NOT add npm dependencies.
- Do NOT introduce a UI kit (shadcn/radix/daisy/mantine). Hand-roll tiny primitives.
- Do NOT create `tailwind.config.js`.
- Do NOT create `middleware.ts` (v16 renames it to `proxy.ts`; we don't need either).
- Do NOT use `getServerSideProps`, `getStaticProps`, `getInitialProps`, `next/router`, `next/legacy/image`.
- Do NOT invent endpoints not listed in section 7 (no `/api/me`, no `/api/repos`, no `/api/analyses/{id}/logs` — those don't exist).
- Do NOT display raw tool logs — the API doesn't expose them.
- Do NOT use `attempts` as retry count, do NOT show `started_at` for jobs as a "real" start time.
- Do NOT trust empty arrays — `null` is a valid response for every list endpoint.
- Do NOT use emoji as the only status indicator. Use a dot (SVG) plus text.
- Do NOT add comments restating the code; only annotate intent.
- Do NOT use Pages Router (`src/pages/`).
- Do NOT call cross-origin URLs from the client (no `http://localhost:8080` in components — always `/api/...`).
- Do NOT export `viewport`, `themeColor`, or `colorScheme` inside `metadata` — they must be in a separate `viewport` export.

================================================================
END OF PROMPT
================================================================