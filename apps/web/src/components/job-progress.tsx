"use client";
import type { AnalysisJob, JobType } from "@/lib/types";
import { ALL_JOB_TYPES, JOB_LABEL } from "@/lib/constants";
import { duration } from "@/lib/format";

// Renders the three expected jobs (test / semgrep / npm_audit) for a run.
// Missing rows render as "skipped" -- see worker semantics: if no test
// command is detected in the cloned repo, only the `test` job exists.
//
// Layout matches the Stitch run-detail "Jobs" card: a status dot, the job
// name in mono, and the exit code + duration on the right.
//
// Note: analysis_jobs.started_at is always null in the current backend, so we
// fall back to the parent run's started_at to compute a job's duration.
const DOT: Record<AnalysisJob["status"], string> = {
  running: "bg-info",
  completed: "bg-success",
  failed: "bg-critical",
};

export function JobProgress({
  jobs,
  runStartedAt,
}: {
  jobs: AnalysisJob[];
  runStartedAt?: string | null;
}) {
  const byType = new Map<JobType, AnalysisJob>();
  for (const j of jobs) byType.set(j.job_type, j);

  return (
    <div className="flex flex-col gap-3">
      {ALL_JOB_TYPES.map((t) => {
        const job = byType.get(t);
        if (!job) {
          return (
            <div key={t} className="flex items-center gap-3 opacity-60">
              <span className="w-2 h-2 rounded-full bg-outline-variant border border-border-dark" />
              <span className="font-code-base text-code-base text-text-muted flex-1 line-through">
                {JOB_LABEL[t]}
              </span>
              <span className="font-caption text-caption text-text-muted">skipped</span>
            </div>
          );
        }
        // started_at is always null today -- fall back to the run's start.
        // Coerce undefined -> null so duration() gets the type it expects.
        const jobStart = job.started_at ?? runStartedAt ?? null;
        const dur = duration(jobStart, job.completed_at);
        return (
          <div key={t} className="flex items-center gap-3">
            <span
              className={`w-2 h-2 rounded-full ${DOT[job.status]} ${job.status === "running" ? "animate-pulse" : ""}`}
              aria-label={job.status}
            />
            <span className="font-code-base text-code-base text-text-primary flex-1">
              {JOB_LABEL[t]}
            </span>
            {/* Right column: duration (if computable) + exit code. */}
            <span className="font-code-sm text-code-sm text-text-muted tabular-nums">
              {dur || (job.status === "running" ? "running…" : "—")}
            </span>
            {job.exit_code !== null ? (
              <span className="font-code-sm text-code-sm text-text-muted tabular-nums">
                code {job.exit_code}
              </span>
            ) : (
              <span className="font-code-sm text-code-sm text-text-muted">—</span>
            )}
          </div>
        );
      })}
    </div>
  );
}