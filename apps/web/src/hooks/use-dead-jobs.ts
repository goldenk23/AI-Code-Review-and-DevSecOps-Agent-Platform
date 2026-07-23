"use client";
import { useQuery } from "@tanstack/react-query";
import type { DeadJob } from "@/lib/types";
import { getList } from "@/lib/api";

// Permanently-failed jobs parked in the Redis dead-letter queue. These appear
// rarely (only after a job exhausts all worker retries), so a 30s poll is
// plenty -- no need to hammer the endpoint like the live runs list.
export function useDeadJobs() {
  return useQuery<DeadJob[]>({
    queryKey: ["dead-jobs"],
    queryFn: () => getList<DeadJob>("/api/dead-jobs"),
    refetchInterval: 30_000,
  });
}
