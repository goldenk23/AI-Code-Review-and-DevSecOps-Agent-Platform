// Exact TypeScript types for every response the Go API can return.
// Field names match the JSON keys the API sends -- do not rename.

export type RunStatus = "queued" | "running" | "completed" | "failed";

// GET /api/analyses  (one row per run, list view)
export type AnalysisSummary = {
  id: number;
  status: RunStatus;
  trigger: string; // always "webhook" in current data, but left open
  commit_sha: string;
  created_at: string; // ISO-8601 with timezone
  repo_full_name: string; // "owner/repo" -- joined from repositories
};

// GET /api/analyses/{id}  (single run, detail view)
export type AnalysisDetail = {
  id: number;
  status: RunStatus;
  trigger: string;
  commit_sha: string;
  started_at: string | null; // null until the worker picks the run up
  completed_at: string | null; // null while running; populated on completed AND failed
  error: string | null; // only populated on failed runs
};

export type JobType = "test" | "semgrep" | "npm_audit";
export type JobStatus = "running" | "completed" | "failed"; // "queued" never appears

// GET /api/analyses/{id}/jobs
export type AnalysisJob = {
  id: number;
  job_type: JobType;
  status: JobStatus;
  attempts: number; // always 0 today -- don't display as "retries"
  exit_code: number | null;
  started_at: string | null; // always null today -- worker never sets it
  completed_at: string | null;
};

export type Severity = "critical" | "high" | "medium" | "low" | "info";

export type Category =
  | "security"
  | "dependency_risk"
  | "correctness"
  | "performance"
  | "testing"
  | "maintainability";

export type VerificationStatus =
  | "verified_by_static_analysis" // semgrep / npm audit -- matched a rule
  | "verified_by_test"           // AI finding where the suggested_patch passed tests
  | "unverified"                 // AI suggestion as-is, not yet tried
  | "failed_verification";       // AI suggested a patch but tests still failed

// GET /api/analyses/{id}/findings
export type Finding = {
  id: number;
  file_path: string; // "package.json" for npm audit findings
  line_start: number | null; // null for npm audit; reliably null `line_end` for AI findings
  line_end: number | null;
  severity: Severity;
  category: Category;
  title: string;
  description: string;
  evidence: string | null; // populated by semgrep; sometimes AI; null for npm audit
  confidence: number | null; // 0.95 npm / 0.9 semgrep / 0.0--1.0 AI
  verification_status: VerificationStatus;
  suggested_patch: string | null; // AI-generated unified diff, null for non-AI findings
};

// GET /api/repositories  (per-repo aggregates for the Repositories page)
export type RepoGrade = "A" | "B" | "C";
export type RepositorySummary = {
  id: number;
  full_name: string;
  owner: string;
  last_scan_at: string | null;
  total_runs: number;
  total_prs: number;
  active_runs: number;
  scanning: boolean; // active_runs > 0 -- the worker is currently scanning
  grade: RepoGrade; // computed server-side from severity counts
  critical: number;
  high: number;
  medium: number;
  low: number;
};

// GET /api/findings  (cross-run list for the Security page)
export type CrossRunFinding = Finding & {
  run_id: number;
  created_at: string;
  repo_full_name: string;
  commit_sha: string;
};

// GET /api/insights/summary  (KPI strip on the Security page)
export type InsightsSummary = {
  total_repos: number;
  total_runs: number;
  findings: {
    critical: number;
    high: number;
    medium: number;
    low: number;
    info: number;
  };
  verified: number;
  unverified: number;
  vulnerable_repos: number;
  avg_fix_time_hours: number | null;
  critical_delta_last_week: number;
};

// GET /api/insights/findings-over-time  (Security page trend chart)
export type FindingsOverTimePoint = {
  date: string; // YYYY-MM-DD
  critical: number;
  high: number;
  medium: number;
  low: number;
  info: number;
};

// GET /api/insights/most-vulnerable-repos  (Security page sidebar)
export type VulnerableRepo = {
  id: number;
  full_name: string;
  owner: string;
  critical: number;
  high: number;
  findings_total: number;
  last_scan_at: string;
};

// GET /api/insights/worker-status  (Automation page sidebar)
// The Go API proxies this to the worker's :9090/metrics endpoint.
export type WorkerStatus = {
  status: "up" | "down";
  metrics_url: string;
};

// GET /api/settings | PUT /api/settings  (Automation page)
export type ReviewSettings = {
  pr_webhooks_enabled: boolean;
  scheduled_scans_enabled: boolean;
  block_on_high: boolean;
  require_critical_verified: boolean;
  ai_verbosity: number; // 1..3
  ai_strictness: number; // 1..4
};