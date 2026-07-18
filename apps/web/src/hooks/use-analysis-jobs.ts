"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisJob } from "@/lib/types";
import { get } from "@/lib/api";

// Jobs (test / semgrep / npm_audit) for one run. Polls while the parent run
// is still in-flight, stops once it's completed or failed.
export function useAnalysisJobs(runId: number, enabled = true) {
  return useQuery<AnalysisJob[]>({
    queryKey: ["analysis", runId, "jobs"],
    queryFn: () => get<AnalysisJob[]>(`/api/analyses/${runId}/jobs`),
    enabled,
    refetchInterval: (query) => {
      // We don't have the run status here, so just keep polling at 10s while
      // any job is still "running". Once everything is terminal, stop.
      const jobs = query.state.data;
      if (!jobs) return 10_000;
      return jobs.some((j) => j.status === "running") ? 10_000 : false;
    },
  });
}