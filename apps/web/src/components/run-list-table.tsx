"use client";
import Link from "next/link";
import { useAnalyses } from "@/hooks/use-analyses";
import type { AnalysisSummary, RunStatus } from "@/lib/types";
import { STATUS_STYLES } from "@/lib/constants";
import { relativeTime, shortSha } from "@/lib/format";
import { AppShell } from "@/components/app-shell";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { Skeleton } from "@/components/ui/skeleton";
import { Tag } from "@/components/ui/tag";
import { CommitIcon, RefreshIcon, TerminalIcon } from "@/components/icons";
import { useMemo } from "react";

// Reusable row component the worker loop re-renders as the list polls.
function RunRow({ run }: { run: AnalysisSummary }) {
  const style = STATUS_STYLES[run.status as RunStatus] ?? STATUS_STYLES.completed;
  return (
    <Link
      href={`/runs/${run.id}`}
      className="contents" // makes the <tr> wrapper clickable without breaking table semantics
    >
      <tr className="hover:bg-surface-container-highest transition-colors group cursor-pointer">
        <td className="py-3 px-4 font-code-base text-code-base text-text-muted group-hover:text-text-primary transition-colors">
          #{run.id}
        </td>
        <td className="py-3 px-4">
          <Badge
            text={run.status}
            textCls={style.text}
            bgCls={style.bg}
            borderCls={style.border}
            dot={style.dot}
            pulse={run.status === "running"}
          />
        </td>
        <td className="py-3 px-4">
          <Tag text={run.trigger} />
        </td>
        <td className="py-3 px-4">
          <div className="flex items-center gap-2">
            <CommitIcon className="size-4 text-text-muted" />
            <span className="font-code-base text-code-base">{shortSha(run.commit_sha)}</span>
          </div>
        </td>
        <td className="py-3 px-4 text-right text-text-muted font-code-base text-code-base">
          {relativeTime(run.created_at)}
        </td>
      </tr>
    </Link>
  );
}

function TableHeaders() {
  const heads = [
    { label: "Run #", className: "w-24" },
    { label: "Status", className: "w-40" },
    { label: "Trigger", className: "w-32" },
    { label: "Commit", className: "" },
    { label: "Created", className: "text-right w-48" },
  ];
  return (
    <thead className="bg-surface-container-high border-b border-border-dark sticky top-0 backdrop-blur-sm">
      <tr>
        {heads.map((h) => (
          <th
            key={h.label}
            className={`py-3 px-4 font-caption text-caption text-text-muted font-medium ${h.className}`}
          >
            {h.label}
          </th>
        ))}
      </tr>
    </thead>
  );
}

function SkeletonRows() {
  return (
    <tbody className="divide-y divide-border-dark">
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          <td className="py-3 px-4"><Skeleton className="h-4 w-8" /></td>
          <td className="py-3 px-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
          <td className="py-3 px-4"><Skeleton className="h-5 w-20 rounded" /></td>
          <td className="py-3 px-4"><Skeleton className="h-4 w-24" /></td>
          <td className="py-3 px-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
        </tr>
      ))}
    </tbody>
  );
}

export function DashboardPage() {
  const { data, isLoading, error, refetch } = useAnalyses();
  const runs = useMemo(() => data ?? [], [data]);
  const activeCount = runs.filter((r) => r.status === "running" || r.status === "queued").length;

  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        {/* Header -- title + subtitle on the left, refresh button on the right */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-text-primary">Overview</h1>
            <p className="font-body-muted text-body-muted text-text-muted mt-1">
              Monitor recent analysis runs across all repositories.
            </p>
          </div>
        </div>

        {/* Recent runs card */}
        <Card className="overflow-hidden">
          {/* Card header */}
          <div className="px-inset-card py-3 border-b border-border-dark flex justify-between items-center bg-surface">
            <div>
              <h2 className="font-subheading text-subheading text-text-primary">Recent runs</h2>
              <p className="font-caption text-caption text-text-muted mt-1 flex items-center gap-2">
                Last 50 runs, auto-refresh every 5s
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
                </span>
              </p>
            </div>
            <button
              type="button"
              onClick={() => refetch()}
              title="Refresh"
              className="text-text-muted hover:text-text-primary transition-colors p-1 rounded hover:bg-surface-container-high"
            >
              <RefreshIcon className="size-5" />
            </button>
          </div>

          {/* Error state -- wrapped in a <div> so we don't render a <table> */}
          {error && (
            <div className="px-inset-card py-8">
              <EmptyState
                title="Couldn't load runs"
                description={error.message}
              />
            </div>
          )}

          {/* Loading state */}
          {!error && isLoading && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <TableHeaders />
                <SkeletonRows />
              </table>
            </div>
          )}

          {/* Empty state */}
          {!error && !isLoading && runs.length === 0 && (
            <div className="p-inset-card">
              <EmptyState
                icon={<TerminalIcon className="size-10" />}
                title="No analyses yet"
                description="Open a PR on a connected repo to trigger one."
              />
            </div>
          )}

          {/* Loaded table */}
          {!error && !isLoading && runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <TableHeaders />
                <tbody className="divide-y divide-border-dark text-text-primary">
                  {runs.map((run) => (
                    <RunRow key={run.id} run={run} />
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Footer status strip */}
          {!error && !isLoading && runs.length > 0 && (
            <div className="bg-surface-container-high border-t border-border-dark px-4 py-2 flex justify-between items-center">
              <div className="flex items-center gap-2 font-caption text-caption text-text-muted">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-info opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-info" />
                </span>
                {activeCount} {activeCount === 1 ? "run" : "runs"} active
              </div>
              <div className="font-code-sm text-code-sm text-text-muted opacity-50">
                system status: operational
              </div>
            </div>
          )}
        </Card>
      </main>
    </AppShell>
  );
}