"use client";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type { ReviewSettings } from "@/lib/types";
import { get, put } from "@/lib/api";

// Singleton review-pipeline settings. Backs the Automation page.
// 30s refetch -- settings rarely change but we want a teammate's save to
// show up without a refresh.
export function useSettings() {
  return useQuery<ReviewSettings>({
    queryKey: ["settings"],
    queryFn: () => get<ReviewSettings>("/api/settings"),
    refetchInterval: 30_000,
  });
}

// Partial update -- only fields present in `patch` are sent. The server
// upserts the singleton row and returns the full new state, which we
// optimistically write into the cache so toggles feel instant.
export function useUpdateSettings() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (patch: Partial<ReviewSettings>) => put<ReviewSettings>("/api/settings", patch),
    onSuccess: (data) => {
      qc.setQueryData<ReviewSettings>(["settings"], data);
    },
  });
}