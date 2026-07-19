"use client";
import { useQuery } from "@tanstack/react-query";
import type { CrossRunFinding, Severity } from "@/lib/types";
import { getList } from "@/lib/api";

// Cross-run findings list (newest first) backing the Security page's
// recent findings table. Optional severity / repo_id / limit filters map
// to query params on GET /api/findings. Refetch every 10s -- the security
// page is a live-ish view, and findings show up asynchronously as runs
// finish.
export function useFindings(filters?: { severity?: Severity; repo_id?: number; limit?: number }) {
  const params = new URLSearchParams();
  if (filters?.severity) params.set("severity", filters.severity);
  if (filters?.repo_id) params.set("repo_id", String(filters.repo_id));
  if (filters?.limit) params.set("limit", String(filters.limit));
  const qs = params.toString();
  return useQuery<CrossRunFinding[]>({
    queryKey: ["findings", filters ?? {}],
    queryFn: () => getList<CrossRunFinding>(`/api/findings${qs ? `?${qs}` : ""}`),
    refetchInterval: 10_000,
  });
}