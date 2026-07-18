"use client";
import { useQuery } from "@tanstack/react-query";
import type { Finding } from "@/lib/types";
import { getList } from "@/lib/api";

// All findings for one run. The API already orders them critical -> info.
// We poll at 10s while the run is active (the caller passes a flag) so the
// list grows live as semgrep/npm audit/AI findings land.
// getList normalises the API's `null`-instead-of-`[]` quirk.
export function useAnalysisFindings(runId: number, isActive: boolean, enabled = true) {
  return useQuery<Finding[]>({
    queryKey: ["analysis", runId, "findings"],
    queryFn: () => getList<Finding>(`/api/analyses/${runId}/findings`),
    enabled,
    refetchInterval: isActive ? 10_000 : false,
  });
}
