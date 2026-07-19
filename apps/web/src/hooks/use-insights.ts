"use client";
import { useQuery } from "@tanstack/react-query";
import type { InsightsSummary, FindingsOverTimePoint, VulnerableRepo, WorkerStatus } from "@/lib/types";
import { get, getList } from "@/lib/api";

// Org-wide KPIs (critical/high counts, vulnerable repos, avg fix time,
// week-over-week critical delta). Single JSON object, 30s refetch.
export function useInsightsSummary() {
  return useQuery<InsightsSummary>({
    queryKey: ["insights", "summary"],
    queryFn: () => get<InsightsSummary>("/api/insights/summary"),
    refetchInterval: 30_000,
  });
}

// Daily findings counts by severity for the last N days (default 30).
// 60s refetch -- day-grain data doesn't change fast.
export function useFindingsOverTime(days = 30) {
  return useQuery<FindingsOverTimePoint[]>({
    queryKey: ["insights", "findings-over-time", days],
    queryFn: () => getList<FindingsOverTimePoint>(`/api/insights/findings-over-time?days=${days}`),
    refetchInterval: 60_000,
  });
}

// Top-N repos by critical+high finding count, for the Security page sidebar.
export function useMostVulnerableRepos(limit = 5) {
  return useQuery<VulnerableRepo[]>({
    queryKey: ["insights", "most-vulnerable-repos", limit],
    queryFn: () => getList<VulnerableRepo>(`/api/insights/most-vulnerable-repos?limit=${limit}`),
    refetchInterval: 30_000,
  });
}

// Worker liveness + Prometheus metrics URL. The Go API proxies to the
// worker's :9090/metrics endpoint so the browser never hits a second
// host (avoids CORS). 15s refetch -- a stuck worker is visible quickly,
// but we don't hammer the endpoint. `retry: false` keeps the error
// state sticky instead of silently retrying in the background (a down
// worker is a real condition the user should see, not a transient blip).
export function useWorkerStatus() {
  return useQuery<WorkerStatus>({
    queryKey: ["insights", "worker-status"],
    queryFn: () => get<WorkerStatus>("/api/insights/worker-status"),
    refetchInterval: 15_000,
    retry: false,
  });
}
