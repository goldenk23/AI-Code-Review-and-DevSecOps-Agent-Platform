"use client";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { postJson, del } from "@/lib/api";

interface ConnectResult {
  id: number;
  full_name: string;
  hook_id: number;
  message: string;
}

// Installs a GitHub webhook on the given repo and registers it in the platform.
// On success, invalidates the repositories list so the new repo appears immediately.
export function useConnectRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (fullName: string) =>
      postJson<ConnectResult>("/api/repositories/connect", { full_name: fullName }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repositories"] });
    },
  });
}

// Removes the GitHub webhook and unlinks the repo from the current user.
// The repo row + historical runs are preserved.
export function useDisconnectRepo() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (repoId: number) => del(`/api/repositories/${repoId}`),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["repositories"] });
    },
  });
}
