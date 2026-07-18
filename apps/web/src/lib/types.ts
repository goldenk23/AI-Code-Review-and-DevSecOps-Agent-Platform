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

export type VerificationStatus = "verified_by_static_analysis" | "unverified";

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
};