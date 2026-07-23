"use client";
import { useDeadJobs } from "@/hooks/use-dead-jobs";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";

// Dead-letter queue view: lists jobs that permanently failed (all worker
// retries exhausted) and were parked in Redis for inspection/replay.
export function DeadJobsView() {
  const { data, isLoading } = useDeadJobs();
  const jobs = data ?? [];
  return (
    <AppShell>
      <main className="flex-1 w-full max-w-container-max mx-auto px-margin-page py-8 flex flex-col gap-6">
        <header>
          <h1 className="font-headline-lg text-headline-lg text-text-primary">Dead-Letter Queue</h1>
          <p className="font-body-muted text-body-muted text-text-muted mt-2">
            Jobs that permanently failed after all retries and were set aside for inspection.
          </p>
        </header>
        <Card className="overflow-hidden">
          {isLoading ? (
            <div className="p-4 flex flex-col gap-2">
              {Array.from({ length: 3 }).map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : jobs.length === 0 ? (
            <p className="p-8 text-center font-code-sm text-code-sm text-text-muted">
              No dead jobs. Everything either succeeded or is still retrying.
            </p>
          ) : (
            <table className="w-full text-left border-collapse">
              <thead className="bg-surface-container-high border-b border-border-dark">
                <tr>
                  {["Run #", "Repo", "PR", "Error"].map((h) => (
                    <th key={h} className="py-3 px-4 font-caption text-caption text-text-muted">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border-dark">
                {jobs.map((j, i) => (
                  <tr key={`${j.run_id}-${i}`}>
                    <td className="py-3 px-4 font-code-sm text-code-sm">#{j.run_id}</td>
                    <td className="py-3 px-4 font-code-sm text-code-sm">{j.repo_full_name}</td>
                    <td className="py-3 px-4 font-code-sm text-code-sm">#{j.pr_number}</td>
                    <td className="py-3 px-4 font-code-sm text-code-sm text-critical">{j.error}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </Card>
      </main>
    </AppShell>
  );
}
