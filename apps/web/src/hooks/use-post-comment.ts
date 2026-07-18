"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { post } from "@/lib/api";

// Asks the Go API to post (or update) the review-summary comment on the PR.
// The endpoint takes no body -- the server pulls the run id from the URL and
// the GitHub token from the DB. On success, invalidate the run query so the
// UI reflects the new state (although for now the API doesn't return a flag
// saying "comment posted" -- we just rely on the 200).
export function usePostComment(runId: number) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: () => post(`/api/analyses/${runId}/post-comments`),
    onSuccess: () => {
      // Mark this run as stale so anywhere it's used refetches.
      qc.invalidateQueries({ queryKey: ["analysis", runId] });
    },
  });
}