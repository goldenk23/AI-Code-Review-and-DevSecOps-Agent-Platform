"use client";
import { useQuery } from "@tanstack/react-query";
import type { AnalysisSummary } from "@/lib/types";
import { getList } from "@/lib/api";

// Live list of recent runs. The Go endpoint returns the last 50, newest first.
// Poll every 5s so a developer watching the dashboard sees new runs land.
// The query is keyed only by ["analyses"] so refetch invalidates the list everywhere.
// getList normalises the API's `null`-instead-of-`[]` quirk.
export function useAnalyses() {
  return useQuery<AnalysisSummary[]>({
    queryKey: ["analyses"],
    queryFn: () => getList<AnalysisSummary>("/api/analyses"),
    refetchInterval: 5_000,
  });
}
