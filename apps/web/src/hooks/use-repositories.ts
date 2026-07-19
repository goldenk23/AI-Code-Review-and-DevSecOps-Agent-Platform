"use client";
import { useQuery } from "@tanstack/react-query";
import type { RepositorySummary } from "@/lib/types";
import { getList } from "@/lib/api";

// All connected repositories with per-repo aggregates (grade, last scan,
// finding counts). Backs the /repositories page. Polls every 15s so an
// in-progress scan shows up live without a manual refresh -- long enough
// to be cheap, short enough to feel responsive.
export function useRepositories() {
  return useQuery<RepositorySummary[]>({
    queryKey: ["repositories"],
    queryFn: () => getList<RepositorySummary>("/api/repositories"),
    refetchInterval: 15_000,
  });
}