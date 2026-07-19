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
import { CommitIcon, RefreshIcon, TerminalIcon, PlayIcon, FolderCopyIcon, CloseIcon } from "@/components/icons";
import { OnboardingState } from "@/components/onboarding-state";
import { useRepositories } from "@/hooks/use-repositories";
import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

// Reusable row component the worker loop re-renders as the list polls.
// Whole-row clickable via onClick navigation. We use this instead of wrapping
// the row in <Link> (which renders <a>) because <tbody> may only contain <tr>
// under the HTML spec -- the old <Link className="contents"><tr> pattern
// produced <tbody><a><tr/></tbody>, which is invalid and tripped React 19
// hydration (the actual root cause of the "unstyled page" symptom: the client
// tree got discarded, leaving raw server HTML with no client JS attached).
function RunRow({ run, showRepo }: { run: AnalysisSummary; showRepo: boolean }) {
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
      {showRepo && (
        <td className="py-3 px-4 font-code-base text-code-base text-text-muted">
          {run.repo_full_name}
        </td>
      )}
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

function TableHeaders({ showRepo }: { showRepo: boolean }) {
  const heads = [
    { label: "Run #", className: "w-24" },
    { label: "Status", className: "w-40" },
    ...(showRepo ? [{ label: "Repository", className: "w-64" }] : []),
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

function SkeletonRows({ showRepo }: { showRepo: boolean }) {
  return (
    <tbody className="divide-y divide-border-dark" aria-busy="true" role="status">
      {Array.from({ length: 8 }).map((_, i) => (
        <tr key={i}>
          <td className="py-3 px-4"><Skeleton className="h-4 w-8" /></td>
          <td className="py-3 px-4"><Skeleton className="h-5 w-20 rounded-full" /></td>
          {showRepo && <td className="py-3 px-4"><Skeleton className="h-4 w-32" /></td>}
          <td className="py-3 px-4"><Skeleton className="h-5 w-20 rounded" /></td>
          <td className="py-3 px-4"><Skeleton className="h-4 w-24" /></td>
          <td className="py-3 px-4"><Skeleton className="h-4 w-16 ml-auto" /></td>
        </tr>
      ))}
    </tbody>
  );
}

export function DashboardPage() {
  // Read `?repo_id=N` from the URL so the /repositories page can deep-link
  // here filtered to one repo. useSearchParams is wrapped in <Suspense>
  // via Next's docs so this stays a dynamic-but-client render.
  const search = useSearchParams();
  const repoIdParam = search.get("repo_id");
  const repoId = repoIdParam ? Number(repoIdParam) || undefined : undefined;

  const { data, isLoading, error, refetch } = useAnalyses(repoId);
  const runs = useMemo(() => data ?? [], [data]);
  const activeCount = runs.filter((r) => r.status === "running" || r.status === "queued").length;
  // The filtered repo's full name (for the "Showing runs for X" chip).
  // All rows share the same repo when filtered, so pull it from the first.
  const filteredRepoName = repoId && runs.length > 0 ? runs[0].repo_full_name : null;
  const router = useRouter();

  // First-run gate: a brand-new user (no webhook has ever delivered, so
  // no `repositories` rows exist) sees the onboarding hero instead of
  // the empty "No analyses yet" card. The repos query is shared across
  // every page that gates on it, so this adds no extra network calls.
  const reposQ = useRepositories();
  const hasRepos = (reposQ.data?.length ?? 0) > 0;
  // While we don't KNOW whether they have repos (initial load), don't
  // flash onboarding -- show the normal empty state briefly. We only
  // show onboarding when repositories have been fetched and we definitively
  // know there are zero.
  const showOnboarding = !repoId && !hasRepos && !reposQ.isLoading && !reposQ.error;

  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        {showOnboarding ? (
          <div className="flex flex-col gap-6">
            <div className="flex justify-between items-end">
              <div>
                <h1 className="font-headline-lg text-headline-lg text-text-primary">Overview</h1>
                <p className="font-body-muted text-body-muted text-text-muted mt-1">
                  Monitor recent analysis runs across all repositories.
                </p>
              </div>
            </div>
            <OnboardingState />
          </div>
        ) : (
          <>
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

        {/* Filter banner -- only when arrived from /repositories via ?repo_id=.
            A "Clear filter" pill restores the unfiltered view by dropping the
            query string and navigating back to /. */}
        {repoId && (
          <div className="mb-4 flex items-center gap-3 px-inset-card py-2 border border-border-dark rounded-md bg-[#111111]">
            <FolderCopyIcon className="size-4 text-primary" />
            <span className="font-code-sm text-code-sm text-text-muted">Showing runs for</span>
            <span className="font-subheading text-subheading text-text-primary">
              {filteredRepoName ?? `repo #${repoId}`}
            </span>
            <button
              type="button"
              onClick={() => router.push("/")}
              className="ml-auto flex items-center gap-1 font-code-sm text-code-sm text-text-muted hover:text-text-primary border border-border-dark rounded px-2 py-0.5 transition-colors"
              title="Clear filter"
            >
              <CloseIcon className="size-3" /> Clear
            </button>
          </div>
        )}

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
                <TableHeaders showRepo={!repoId} />
                <SkeletonRows showRepo={!repoId} />
              </table>
            </div>
          )}

          {/* Empty state */}
          {!error && !isLoading && runs.length === 0 && (
            <div className="p-inset-card">
              <EmptyState
                icon={<TerminalIcon className="size-10" />}
                title={repoId ? "No runs for this repository yet" : "No analyses yet"}
                description={repoId ? "Open a PR on this repo to trigger a review." : "Open a PR on a connected repo to trigger one."}
              />
            </div>
          )}

          {/* Loaded table */}
          {!error && !isLoading && runs.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <TableHeaders showRepo={!repoId} />
                <tbody className="divide-y divide-border-dark font-body-muted text-body-muted text-text-primary">
                  {runs.map((run) => (
                    <RunRow key={run.id} run={run} showRepo={!repoId} />
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
        </>
      )}
      </main>
    </AppShell>
  );
}