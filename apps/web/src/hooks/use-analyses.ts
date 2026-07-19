"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisSummary } from "@/lib/types";
import { getList } from "@/lib/api";

// Live list of recent runs. The Go endpoint returns the last 50, newest first.
// Poll every 5s so a developer watching the dashboard sees new runs land.
// getList normalises the API's `null`-instead-of-`[]` quirk.
//
// Optional `repoId` filter -- when set, hits /api/analyses?repo_id=N and
// the query key includes the id so a filtered view and the unfiltered
// view don't share a cache (switching filters wouldn't otherwise refetch).
export function useAnalyses(repoId?: number) {
  const qs = repoId ? `?repo_id=${repoId}` : "";
  return useQuery<AnalysisSummary[]>({
    queryKey: ["analyses", repoId ?? null],
    queryFn: () => getList<AnalysisSummary>(`/api/analyses${qs}`),
    refetchInterval: 5_000,
  });
}