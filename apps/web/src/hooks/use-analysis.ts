"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisDetail } from "@/lib/types";
import { get } from "@/lib/api";

// Single run. Polls while the run is in-flight (queued/running), stops once
// it reaches a terminal state (completed/failed). runId comes from the URL.
export function useAnalysis(runId: number, enabled = true) {
  return useQuery<AnalysisDetail>({
    queryKey: ["analysis", runId],
    queryFn: () => get<AnalysisDetail>(`/api/analyses/${runId}`),
    enabled,
    refetchInterval: (query) => {
      const status = query.state.data?.status;
      return status === "running" || status === "queued" ? 10_000 : false;
    },
  });
}