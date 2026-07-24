"use client";
import { useState } from "react";
import { useRepositories } from "@/hooks/use-repositories";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import {
  FolderCopyIcon,
  MergeTypeIcon,
  CheckCircleIcon,
  WarningIcon,
  ErrorIcon,
  RefreshIcon,
  GridViewIcon,
} from "@/components/icons";
import { relativeTime } from "@/lib/format";
import type { RepositorySummary, RepoGrade } from "@/lib/types";
import { useRouter } from "next/navigation";
import { OnboardingState } from "@/components/onboarding-state";
import { ConnectRepoModal } from "@/components/connect-repo-modal";

const GRADE_STYLE: Record<RepoGrade, { chip: string; glow: string }> = {
  A: { chip: "bg-success/10 border-success/30 text-success", glow: "bg-success/5" },
  B: { chip: "bg-medium/10  border-medium/30  text-medium",  glow: "bg-medium/5" },
  C: { chip: "bg-critical/10 border-critical/30 text-critical", glow: "bg-critical/5" },
};

export function RepositoriesPage() {
  const { data, isLoading, error, refetch } = useRepositories();
  const repos = data ?? [];
  const [showConnect, setShowConnect] = useState(false);

  const total = repos.length;
  const healthy = repos.filter((r) => r.grade === "A" && !r.scanning).length;
  const warning = repos.filter((r) => r.grade === "B").length;
  const critical = repos.filter((r) => r.grade === "C").length;
  const scanning = repos.filter((r) => r.scanning).length;

  return (
    <AppShell>
      {showConnect && <ConnectRepoModal onClose={() => setShowConnect(false)} />}
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Repositories</h1>
            <p className="font-body-muted text-body-muted text-text-muted">
              Manage and monitor security posture across all connected codebases.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => refetch()}>
              <RefreshIcon className="text-[18px]" />Refresh
            </Button>
            <Button variant="primary" onClick={() => setShowConnect(true)}>
              <FolderCopyIcon className="text-[18px]" />Connect Repo
            </Button>
          </div>
        </div>

        {/* Summary strip -- live from the API */}
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-dark">
          <div className="flex gap-4 items-center font-code-sm text-code-sm flex-wrap">
            <span className="text-text-primary">{total} Repositories Found</span>
            <span className="text-success flex items-center gap-1"><CheckCircleIcon className="text-[14px]" /> {healthy} Healthy</span>
            <span className="text-medium flex items-center gap-1"><WarningIcon className="text-[14px]" /> {warning} Warning</span>
            <span className="text-critical flex items-center gap-1"><ErrorIcon className="text-[14px]" /> {critical} Critical</span>
            {scanning > 0 && (
              <span className="text-info flex items-center gap-1">
                <RefreshIcon className="text-[14px] animate-spin" /> {scanning} Scanning
              </span>
            )}
          </div>
          <div className="flex items-center gap-2 text-text-muted">
            <GridViewIcon className="text-[18px]" />
          </div>
        </div>

        {error ? (
          <div className="flex flex-col items-center justify-center text-center gap-3 border border-critical/30 bg-critical/5 rounded-lg p-6 max-w-md mx-auto">
            <p className="font-subheading text-subheading text-critical">Couldn&apos;t load repositories</p>
            <p className="font-code-sm text-code-sm text-text-muted">{error.message}</p>
            <Button variant="ghost" onClick={() => refetch()}>
              <RefreshIcon className="size-4" />Retry
            </Button>
          </div>
        ) : isLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {Array.from({ length: 6 }).map((_, i) => (
              <Card key={i} className="h-[200px] p-inset-card">
                <Skeleton className="h-4 w-32 mb-3" />
                <Skeleton className="h-3 w-24 mb-6" />
                <Skeleton className="h-10 w-full" />
              </Card>
            ))}
          </div>
        ) : repos.length === 0 ? (
          /* New-user onboarding: the platform has never seen a webhook
             from this user, so they have zero repos. Show the welcome
             hero instead of an empty box. See onboarding-state.tsx. */
          <OnboardingState variant="compact" />
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {repos.map((repo) => <RepoCard key={repo.id} repo={repo} />)}
          </div>
        )}
      </main>
    </AppShell>
  );
}

function RepoCard({ repo }: { repo: RepositorySummary }) {
  const router = useRouter();
  const g = GRADE_STYLE[repo.grade];
  const cardBorder = repo.scanning ? "border-primary/30" : repo.grade === "C" ? "border-critical/30" : "border-border-dark";
  const [owner, name] = repo.full_name.split("/");

  return (
    <div
      role="link"
      tabIndex={0}
      onClick={() => router.push(`/?repo_id=${repo.id}`)}
      onKeyDown={(e) => {
        if (e.key === "Enter" || e.key === " ") {
          e.preventDefault();
          router.push(`/?repo_id=${repo.id}`);
        }
      }}
      aria-label={`Open runs for ${repo.full_name}`}
      className={`bg-[#111111] border ${cardBorder} rounded-lg p-inset-card hover:bg-[#151515] transition-colors group relative overflow-hidden flex flex-col justify-between h-[200px] cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent`}
    >
      <div className={`absolute top-0 right-0 w-24 h-24 ${g.glow} ${repo.scanning ? "bg-primary/5" : ""} rounded-bl-full blur-xl -z-10`} />
      {repo.scanning && (
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent h-[200%] w-full animate-scan -z-10 pointer-events-none opacity-50" />
      )}

      <div className="flex justify-between items-start mb-4 z-10">
        <div className="flex items-center gap-3">
          <div className={`w-8 h-8 rounded bg-[#1a1a1a] border ${repo.scanning ? "border-primary/50" : "border-border-dark"} flex items-center justify-center shrink-0`}>
            {repo.scanning ? (
              <RefreshIcon className="text-[18px] text-primary animate-spin" />
            ) : (
              <FolderCopyIcon className="text-[18px] text-text-muted" />
            )}
          </div>
          <div>
            <h3 className="font-subheading text-subheading text-text-primary group-hover:text-primary transition-colors truncate max-w-[200px]">
              {name}
            </h3>
            <p className="font-code-sm text-code-sm text-text-muted mt-0.5">
              {repo.scanning ? (
                <span className="text-primary">Scanning in progress...</span>
              ) : repo.last_scan_at ? (
                `Last scan: ${relativeTime(repo.last_scan_at)}`
              ) : (
                "Never scanned"
              )}
            </p>
          </div>
        </div>
        <div className={`w-8 h-8 rounded border flex items-center justify-center font-headline-md text-headline-md font-bold ${g.chip}`}>
          {repo.grade}
        </div>
      </div>

      <div className={`grid grid-cols-2 gap-4 mt-auto z-10 pt-4 border-t border-border-dark ${repo.scanning ? "opacity-50" : ""}`}>
        <div>
          <span className="block font-code-sm text-code-sm text-text-muted mb-1">Total Runs</span>
          <div className="flex items-center gap-1 text-text-primary font-subheading text-subheading">
            <MergeTypeIcon className="text-[16px] text-text-muted" /> {repo.total_runs}
          </div>
        </div>
        <div>
          <span className="block font-code-sm text-code-sm text-text-muted mb-1">Open Findings</span>
          {repo.scanning ? (
            <span className="font-code-sm text-code-sm text-text-muted">Analyzing</span>
          ) : repo.critical + repo.high + repo.medium + repo.low === 0 ? (
            <span className="font-code-sm text-code-sm text-success flex items-center gap-1">
              <CheckCircleIcon className="text-[14px]" /> Clean
            </span>
          ) : (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="flex items-center gap-1 font-code-sm text-code-sm text-critical">
                <span className="w-2 h-2 bg-critical rounded-sm" /> {repo.critical}
              </span>
              <span className="flex items-center gap-1 font-code-sm text-code-sm text-high">
                <span className="w-2 h-2 bg-high rounded-sm" /> {repo.high}
              </span>
              <span className="flex items-center gap-1 font-code-sm text-code-sm text-medium">
                <span className="w-2 h-2 bg-medium rounded-sm" /> {repo.medium}
              </span>
              <span className="flex items-center gap-1 font-code-sm text-code-sm text-low">
                <span className="w-2 h-2 bg-low rounded-sm" /> {repo.low}
              </span>
            </div>
          )}
        </div>
      </div>

      <p className="absolute bottom-2 right-3 font-code-sm text-code-sm text-text-muted/60">
        {owner}
      </p>
    </div>
  );
}