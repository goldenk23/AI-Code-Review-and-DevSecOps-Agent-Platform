"use client";
import { useMemo } from "react";
import Link from "next/link";
import { useAnalysis } from "@/hooks/use-analysis";
import { useAnalysisJobs } from "@/hooks/use-analysis-jobs";
import { useAnalysisFindings } from "@/hooks/use-analysis-findings";
import { AppShell } from "@/components/app-shell";
import { FindingsList } from "@/components/findings-list";
import { JobProgress } from "@/components/job-progress";
import { PostCommentButton } from "@/components/post-comment-button";
import { Card, CardWithHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { ChevronRightIcon, CommitIcon, RefreshIcon } from "@/components/icons";
import { STATUS_STYLES } from "@/lib/constants";
import { shortSha, clockTime, duration } from "@/lib/format";

export function RunDetailView({ runId }: { runId: number }) {
  // The full run -- gives us status, started_at, completed_at, error.
  const { data: run, isLoading, error, refetch } = useAnalysis(runId);
  // isActive drives polling on the two dependent queries below.
  const isActive = !!run && (run.status === "running" || run.status === "queued");

  // Jobs + findings only fetch once we have a run (so we know it exists).
  // Findings poll only while the run is active; jobs poll while any job runs.
  const jobsEnabled = !!run && !error;
  const { data: jobs } = useAnalysisJobs(runId, jobsEnabled);
  const { data: findings, isLoading: findingsLoading } = useAnalysisFindings(runId, isActive, jobsEnabled);

  const jobList = useMemo(() => jobs ?? [], [jobs]);

  if (isLoading) {
    return (
      <AppShell>
        <main className="max-w-container-max mx-auto px-margin-page py-8">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-8 w-64 mb-3" />
          <Skeleton className="h-4 w-48 mb-6" />
          <div className="grid grid-cols-1 md:grid-cols-[70%_30%] gap-gutter">
            <Skeleton className="h-96" />
            <Skeleton className="h-60" />
          </div>
        </main>
      </AppShell>
    );
  }

  if (error || !run) {
    return (
      <AppShell>
        <main className="max-w-container-max mx-auto px-margin-page py-8">
          <div className="flex flex-col items-center justify-center text-center gap-3 border border-critical/30 bg-critical/5 rounded-lg p-6 max-w-md mx-auto">
            <p className="font-subheading text-subheading text-critical">Run not found</p>
            <p className="font-code-sm text-code-sm text-text-muted">
              {error?.message ?? "This run doesn't exist or hasn't been recorded yet."}
            </p>
            <Button variant="ghost" onClick={() => refetch()}>
              <RefreshIcon className="size-4" />
              Retry
            </Button>
          </div>
        </main>
      </AppShell>
    );
  }

  const style = STATUS_STYLES[run.status] ?? STATUS_STYLES.completed;
  const dur = duration(run.started_at, run.completed_at);

  return (
    <AppShell>
      <div className="max-w-container-max mx-auto px-margin-page py-8 w-full flex flex-col md:flex-row gap-gutter">
        {/* LEFT 70%: findings */}
        <main className="w-full md:w-[70%] flex flex-col gap-6">
          {/* Breadcrumb + header -- PR-title style: status badge inline with
              the run title, full commit SHA on its own mono line below. */}
          <header className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-text-muted font-body-muted text-body-muted">
              <Link href="/" className="hover:text-text-primary transition-colors">Runs</Link>
              <ChevronRightIcon className="size-4" />
              <span className="text-text-primary">#{run.id}</span>
            </div>
            <div className="flex items-center gap-4 flex-wrap">
              <h1 className="font-headline-lg text-headline-lg text-text-primary">
                Run #{run.id}
              </h1>
              <Badge
                text={run.status}
                textCls={style.text}
                bgCls={style.bg}
                borderCls={style.border}
                dot={style.dot}
                dotShape={style.dotShape}
                pulse={run.status === "running"}
              />
            </div>
            <div className="font-code-base text-code-base text-text-muted flex items-center gap-2">
              <CommitIcon className="size-4" />
              {run.commit_sha}
            </div>
            {run.status === "failed" && run.error && (
              <div className="mt-2 border border-critical/30 bg-critical/10 rounded p-4">
                <p className="font-subheading text-subheading text-critical mb-2">Run failed</p>
                <pre className="font-code-sm text-code-sm text-text-primary whitespace-pre-wrap break-words">
                  {run.error}
                </pre>
              </div>
            )}
          </header>

          {/* Findings -- show skeleton while the query is loading (covers the
              initial load on a completed run, not just active runs). */}
          <FindingsList findings={findings ?? []} isLoading={findingsLoading} />
        </main>

        {/* RIGHT 30%: sticky metadata -- Actions, Run Summary, Jobs.
            Order matches the Stitch run-detail design. */}
        <aside className="w-full md:w-[30%] flex flex-col gap-4 md:sticky md:top-24 self-start">
          {/* Actions */}
          <Card className="p-4">
            <PostCommentButton runId={run.id} runStatus={run.status} />
          </Card>

          {/* Run summary -- the detail API exposes started_at/completed_at but
              NOT created_at, so we show Started (not "Created") to avoid
              duplicating the same value on two rows. */}
          <CardWithHeader title="Run Summary">
            <div className="p-4 flex flex-col gap-3">
              <SummaryRow label="Commit" value={shortSha(run.commit_sha)} mono />
              <SummaryRow label="Trigger" value={run.trigger} mono />
              <SummaryRow
                label="Started"
                value={run.started_at ? clockTime(run.started_at) : "—"}
                mono
              />
              <SummaryRow
                label="Completed"
                value={run.completed_at ? clockTime(run.completed_at) : isActive ? "in progress..." : "—"}
                mono
              />
              <SummaryRow
                label="Duration"
                value={dur || (isActive ? "in progress..." : "—")}
                mono
              />
            </div>
          </CardWithHeader>

          {/* Jobs */}
          <CardWithHeader title="Jobs">
            <div className="p-4">
              <JobProgress jobs={jobList} runStartedAt={run.started_at} />
            </div>
          </CardWithHeader>
        </aside>
      </div>
    </AppShell>
  );
}

function SummaryRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex justify-between items-center gap-2">
      <span className="font-body-muted text-body-muted text-text-muted">{label}</span>
      <span
        className={`text-text-primary ${mono ? "font-code-sm text-code-sm" : "font-body-muted text-body-muted"}`}
      >
        {value}
      </span>
    </div>
  );
}