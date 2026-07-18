"use client";
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
import { Button } from "@/components/ui/button";
import { CommitIcon, RefreshIcon, TerminalIcon, PlayIcon } from "@/components/icons";
import { useMemo } from "react";
import { useRouter } from "next/navigation";

// Reusable row component the worker loop re-renders as the list polls.
// Whole-row clickable via onClick navigation. We use this instead of wrapping
// the row in <Link> (which renders <a>) because <tbody> may only contain <tr>
// under the HTML spec -- the old <Link className="contents"><tr> pattern
// produced <tbody><a><tr/></tbody>, which is invalid and tripped React 19
// hydration (the actual root cause of the "unstyled page" symptom: the client
// tree got discarded, leaving raw server HTML with no client JS attached).
function RunRow({ run }: { run: AnalysisSummary }) {
  const router = useRouter();
  const style = STATUS_STYLES[run.status as RunStatus] ?? STATUS_STYLES.completed;
  const href = `/runs/${run.id}`;
  return (
    <tr
      onClick={() => router.push(href)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(href);
        }
      }}
      tabIndex={0}
      role="link"
      aria-label={`Open run #${run.id}`}
      className="hover:bg-[#1a1a1a] focus-visible:outline-none focus-visible:bg-[#1a1a1a] transition-colors group cursor-pointer"
    >
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
          dotShape={style.dotShape}
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
    <thead className="bg-surface-container-high border-b border-border-dark sticky top-0 backdrop-blur-sm bg-opacity-90">
      <tr>
        {heads.map((h) => (
          <th
            key={h.label}
            scope="col"
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
    <tbody className="divide-y divide-border-dark" aria-busy="true" role="status">
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
        {/* Header -- title + subtitle on the left, Trigger Analysis on the right.
            The Trigger Analysis button is a visual placeholder: the backend has
            no "create run" endpoint today (runs come from PR webhooks), so we
            keep it disabled to match the design without inventing an action. */}
        <div className="flex justify-between items-end mb-6">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-text-primary">Overview</h1>
            <p className="font-body-muted text-body-muted text-text-muted mt-1">
              Monitor recent analysis runs across all repositories.
            </p>
          </div>
          <Button variant="primary" disabled title="Runs are triggered by PR webhooks">
            <PlayIcon className="size-[18px]" />
            Trigger Analysis
          </Button>
        </div>

        {/* Recent runs card */}
        <Card className="overflow-hidden">
          {/* Card header -- dark #111111 band, matches the Stitch design. */}
          <div className="p-inset-card border-b border-border-dark flex justify-between items-center bg-[#111111]">
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

          {/* Error state -- red-tinted card with a Retry button (SPEC). */}
          {error && (
            <div className="px-inset-card py-8">
              <div className="flex flex-col items-center justify-center text-center gap-3 border border-critical/30 bg-critical/5 rounded-lg p-6">
                <p className="font-subheading text-subheading text-critical">{"Couldn't load runs"}</p>
                <p className="font-code-sm text-code-sm text-text-muted">{error.message}</p>
                <Button variant="ghost" onClick={() => refetch()}>
                  <RefreshIcon className="size-4" />
                  Retry
                </Button>
              </div>
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
                <tbody className="divide-y divide-border-dark font-body-muted text-body-muted text-text-primary">
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