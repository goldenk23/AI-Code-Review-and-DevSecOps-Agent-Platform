import type { RunStatus, Severity, JobType, Category, VerificationStatus } from "./types";

// Centralized color / label maps so components never hardcode colors.
// Tailwind v4 picks up tokens we declared in @theme (e.g. --color-high),
// so classes like `text-high`, `bg-high/10`, `border-high/30` all work.

export const STATUS_STYLES: Record<RunStatus, { text: string; bg: string; border: string; dot: string; dotShape?: "circle" | "square" }> = {
  queued:   { text: "text-low",       bg: "bg-low/10",       border: "border-low/30",       dot: "bg-low" },
  running:  { text: "text-info",      bg: "bg-info/10",      border: "border-info/30",      dot: "bg-info" },
  completed:{ text: "text-success",   bg: "bg-success/10",   border: "border-success/30",   dot: "bg-success" },
  failed:   { text: "text-critical",  bg: "bg-critical/10",  border: "border-critical/30",  dot: "bg-critical", dotShape: "square" },
};

export const SEVERITY_STYLES: Record<Severity, { text: string; bg: string; border: string; dot: string; dotShape?: "circle" | "square" | "diamond" | "triangle" | "hexagon" }> = {
  critical: { text: "text-critical", bg: "bg-critical/10", border: "border-critical/30", dot: "bg-critical", dotShape: "diamond" },
  high:      { text: "text-high",     bg: "bg-high/10",     border: "border-high/30", dot: "bg-high", dotShape: "triangle" },
  medium:    { text: "text-medium",   bg: "bg-medium/10",   border: "border-medium/30", dot: "bg-medium", dotShape: "square" },
  low:       { text: "text-low",      bg: "bg-low/10",      border: "border-low/30", dot: "bg-low", dotShape: "circle" },
  info:      { text: "text-info",     bg: "bg-info/10",     border: "border-info/30", dot: "bg-info", dotShape: "circle" },
};

export const VERIFICATION_STYLES: Record<VerificationStatus, { text: string; bg: string; border: string; label: string }> = {
  verified_by_static_analysis: {
    label: "Verified by static analysis",
    text: "text-success",
    bg: "bg-success/10",
    border: "border-success/30",
  },
  unverified: {
    label: "AI -- unverified",
    text: "text-medium",
    bg: "bg-medium/10",
    border: "border-medium/30",
  },
};

// Friendly display names for job types.
export const JOB_LABEL: Record<JobType, string> = {
  test: "Tests",
  semgrep: "Semgrep",
  npm_audit: "npm audit",
};

// All possible job types we expect for a run, in display order. The API may
// return only a subset (e.g. just `test` when no test command was detected);
// the missing rows render as "skipped".
export const ALL_JOB_TYPES: JobType[] = ["test", "semgrep", "npm_audit"];

// All severity + category options, used to populate filter dropdowns.
export const ALL_SEVERITIES: Severity[] = ["critical", "high", "medium", "low", "info"];
export const ALL_CATEGORIES: Category[] = [
  "security", "dependency_risk", "correctness", "performance", "testing", "maintainability",
];