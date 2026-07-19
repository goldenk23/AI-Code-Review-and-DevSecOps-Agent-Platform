"use client";
import { useInsightsSummary, useFindingsOverTime, useMostVulnerableRepos } from "@/hooks/use-insights";
import { useFindings as useAllFindings } from "@/hooks/use-findings";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import {
  DiamondIcon, WarningIcon, ScheduleIcon, FolderOpenIcon,
  TrendingUpIcon, TrendingDownIcon, FolderIcon, RefreshIcon,
} from "@/components/icons";
import { SEVERITY_STYLES, VERIFICATION_STYLES } from "@/lib/constants";
import { relativeTime, shortSha, filePathWithLines } from "@/lib/format";
import type { Severity, FindingsOverTimePoint } from "@/lib/types";
import { OnboardingState } from "@/components/onboarding-state";
import { useRepositories } from "@/hooks/use-repositories";

export function SecurityPage() {
  const summaryQ = useInsightsSummary();
  const trendQ = useFindingsOverTime(30);
  const vulnQ = useMostVulnerableRepos(5);
  const findingsQ = useAllFindings({ limit: 50 });
  // New-user gate: same hook the rest of the app uses -- the react-query
  // cache is shared, so this adds no extra network calls.
  const reposQ = useRepositories();
  const hasRepos = (reposQ.data?.length ?? 0) > 0;
  const showOnboarding = !hasRepos && !reposQ.isLoading && !reposQ.error;

  if (showOnboarding) {
    return (
      <AppShell>
        <main className="flex-1 w-full max-w-container-max mx-auto px-margin-page py-8 flex flex-col gap-6">
          <header>
            <h1 className="font-headline-lg text-headline-lg text-text-primary">Security Overview</h1>
            <p className="font-body-muted text-body-muted text-text-muted mt-2">
              Aggregated DevSecOps metrics across all organization repositories.
            </p>
          </header>
          <OnboardingState variant="compact" />
        </main>
      </AppShell>
    );
  }

  return (
    <AppShell>
      <main className="flex-1 w-full max-w-container-max mx-auto px-margin-page py-8 flex flex-col gap-8">
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-text-primary">Security Overview</h1>
            <p className="font-body-muted text-body-muted text-text-muted mt-2">
              Aggregated DevSecOps metrics across all organization repositories.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost" onClick={() => { summaryQ.refetch(); trendQ.refetch(); vulnQ.refetch(); findingsQ.refetch(); }}>
              <RefreshIcon className="text-[14px]" />Refresh
            </Button>
          </div>
        </header>

        {/* KPI cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {summaryQ.isLoading ? (
            Array.from({ length: 4 }).map((_, i) => (
              <Card key={i} className="h-[130px] p-inset-card"><Skeleton className="h-4 w-24 mb-2" /><Skeleton className="h-8 w-16 mb-3" /><Skeleton className="h-2 w-full" /></Card>
            ))
          ) : summaryQ.error ? (
            <Card className="p-inset-card col-span-full text-critical">{summaryQ.error.message}</Card>
          ) : summaryQ.data ? (
            <>
              <KpiCard
                label="Critical Findings"
                icon={<DiamondIcon className="text-[16px] text-critical icon-fill" />}
                value={<span className="text-critical">{summaryQ.data.findings.critical}</span>}
                delta={summaryQ.data.critical_delta_last_week}
                deltaLabel="vs last week"
                barColor="bg-critical"
                trackColor="bg-critical/20"
                fillPct={pct(summaryQ.data.findings.critical, totalFindings(summaryQ.data))}
              />
              <KpiCard
                label="High Findings"
                icon={<WarningIcon className="text-[16px] text-high icon-fill" />}
                value={<span className="text-high">{summaryQ.data.findings.high}</span>}
                deltaLabel="total"
                barColor="bg-high"
                trackColor="bg-high/20"
                fillPct={pct(summaryQ.data.findings.high, totalFindings(summaryQ.data))}
              />
              <KpiCard
                label="Avg. Time to Fix"
                icon={<ScheduleIcon className="text-[16px] text-info" />}
                value={
                  <span className="text-text-primary">
                    {summaryQ.data.avg_fix_time_hours != null ? summaryQ.data.avg_fix_time_hours.toFixed(1) : "—"}
                    {summaryQ.data.avg_fix_time_hours != null && (
                      <span className="font-headline-md text-headline-md text-text-muted ml-1">hours</span>
                    )}
                  </span>
                }
                deltaLabel="across finished runs"
                barColor="bg-info"
                trackColor="bg-info/20"
                fillPct={summaryQ.data.avg_fix_time_hours != null ? Math.min(100, (summaryQ.data.avg_fix_time_hours / 168) * 100) : 0}
              />
              <KpiCard
                label="Vulnerable Repos"
                icon={<FolderOpenIcon className="text-[16px] text-medium icon-fill" />}
                value={
                  <span className="text-text-primary">
                    {summaryQ.data.vulnerable_repos}
                    <span className="font-headline-md text-headline-md text-text-muted ml-1">/ {summaryQ.data.total_repos}</span>
                  </span>
                }
                deltaLabel={`${pct(summaryQ.data.vulnerable_repos, summaryQ.data.total_repos)}% of total`}
                barColor="bg-medium"
                trackColor="bg-border-dark"
                fillPct={pct(summaryQ.data.vulnerable_repos, summaryQ.data.total_repos)}
              />
            </>
          ) : null}
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Trend chart */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            <TrendChart points={trendQ.data ?? []} isLoading={trendQ.isLoading} />
          </div>
          {/* Vulnerable repos sidebar */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <VulnerableReposCard isLoading={vulnQ.isLoading} repos={vulnQ.data ?? []} />
          </div>
        </section>

        {/* Recent findings */}
        <section>
          <RecentFindings isLoading={findingsQ.isLoading} findings={findingsQ.data ?? []} />
        </section>
      </main>
    </AppShell>
  );
}

function pct(n: number, total: number): number {
  if (total <= 0) return 0;
  return Math.round((n / total) * 100);
}
function totalFindings(s: { findings: { critical: number; high: number; medium: number; low: number; info: number } }): number {
  return s.findings.critical + s.findings.high + s.findings.medium + s.findings.low + s.findings.info;
}

function KpiCard({
  label, icon, value, delta, deltaLabel, barColor, trackColor, fillPct,
}: {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  delta?: number;
  deltaLabel: string;
  barColor: string;
  trackColor: string;
  fillPct: number;
}) {
  return (
    <Card className="p-inset-card flex flex-col gap-2 relative overflow-hidden h-[130px]">
      <div className="flex items-center justify-between text-text-muted font-body-muted text-body-muted">
        <span>{label}</span>
        {icon}
      </div>
      <div className="font-headline-lg text-headline-lg">{value}</div>
      <div className="flex items-center gap-1 font-caption text-caption text-text-muted">
        {typeof delta === "number" ? (
          <span className={`flex items-center gap-0.5 ${delta > 0 ? "text-error" : delta < 0 ? "text-success" : "text-text-muted"}`}>
            {delta > 0 ? <TrendingUpIcon className="text-[12px]" /> : delta < 0 ? <TrendingDownIcon className="text-[12px]" /> : null}
            {delta > 0 ? "+" : ""}{delta}
          </span>
        ) : null}
        <span>{deltaLabel}</span>
      </div>
      <div className={`absolute bottom-0 left-0 w-full h-1 ${trackColor}`}>
        <div className={`h-full ${barColor}`} style={{ width: `${fillPct}%` }} />
      </div>
    </Card>
  );
}

// Builds the `points="x1,y1 x2,y2 ..." attribute for an SVG <polyline>.
// IMPORTANT: <polyline> uses plain space-separated coordinates, NOT
// path-syntax "L" commands (the old code joined with " L", which made
// the points attribute invalid and the lines silently failed to render).
function buildPath(points: FindingsOverTimePoint[], key: keyof FindingsOverTimePoint, max: number): string {
  if (points.length === 0) return "";
  return points
    .map((p, i) => {
      const x = points.length === 1 ? 0 : (i / (points.length - 1)) * 100;
      // Map 0..max onto y = 95..5 (5px top/bottom padding inside the viewbox).
      const y = 95 - (Number(p[key]) / max) * 90;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(" ");
}

// One chart series descriptor: severity label, the JSON key to read, and
// the CSS variable that stroke uses (so the colors stay in sync with the
// rest of the dashboard).
const SERIES: { key: keyof FindingsOverTimePoint; label: string; stroke: string }[] = [
  { key: "critical", label: "Critical", stroke: "var(--color-critical)" },
  { key: "high",     label: "High",     stroke: "var(--color-high)" },
  { key: "medium",   label: "Medium",   stroke: "var(--color-medium)" },
  { key: "low",      label: "Low",      stroke: "var(--color-low)" },
];

function TrendChart({ points, isLoading }: { points: FindingsOverTimePoint[]; isLoading: boolean }) {
  // Scale all series against a single max so a 1-finding day doesn't look
  // the same as a 100-finding day across lines.
  const max = Math.max(1, ...points.flatMap((p) => [p.critical, p.high, p.medium, p.low, p.info]));
  const hasAny = points.some((p) => p.critical + p.high + p.medium + p.low + p.info > 0);

  // Tick marks: ~5 horizontal gridlines + labels so the user can read
  // approximate counts, not just compare relative bumps.
  const ticks = Array.from({ length: 5 }, (_, i) => i * (max / 4));

  return (
    <Card className="flex flex-col h-[400px]">
      <div className="border-b border-border-dark p-4 flex justify-between items-center">
        <h2 className="font-subheading text-subheading text-text-primary">Findings Over Time (30 days)</h2>
        <div className="flex gap-3 flex-wrap">
          {SERIES.map((s) => (
            <span key={s.key} className="flex items-center gap-1 font-caption text-caption text-text-muted">
              <span className="w-2 h-2 rounded-full block" style={{ background: s.stroke }} />
              {s.label}
            </span>
          ))}
        </div>
      </div>
      <div className="flex-1 relative bg-grid-pattern">
        {isLoading ? (
          <Skeleton className="h-full w-full" />
        ) : !hasAny ? (
          <div className="absolute inset-0 flex items-center justify-center p-4 text-center">
            <p className="font-code-sm text-code-sm text-text-muted">No findings in the last 30 days. Open a PR to see trend data.</p>
          </div>
        ) : (
          <svg className="absolute inset-0 w-full h-full" preserveAspectRatio="none" viewBox="0 0 100 100">
            {/* Horizontal gridlines -- non-scaling stroke so they stay 1px
                even though the viewBox is stretched across the card body. */}
            {ticks.map((t, i) => {
              const y = 95 - (t / max) * 90;
              return (
                <line key={i} x1="0" y1={y} x2="100" y2={y} stroke="var(--color-border-dark)" strokeWidth="1" vectorEffect="non-scaling-stroke" strokeDasharray="2 4" />
              );
            })}
            {/* Y-axis tick labels: count at each gridline. fontSize is in
                viewBox units (3 = 3% of height), so the labels stay readable. */}
            {ticks.map((t, i) => {
              const y = 95 - (t / max) * 90;
              return (
                <text key={`l${i}`} x="0.5" y={y} fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="2.5" dominantBaseline="middle">
                  {Math.round(t)}
                </text>
              );
            })}
            {/* Series lines */}
            {SERIES.map((s) => (
              <polyline
                key={s.key}
                points={buildPath(points, s.key, max)}
                fill="none"
                stroke={s.stroke}
                strokeWidth="2"
                strokeLinejoin="round"
                strokeLinecap="round"
                vectorEffect="non-scaling-stroke"
              />
            ))}
            {/* X-axis endpoint labels */}
            <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="2.5" x="0.5" y="99">{points[0]?.date.slice(5)}</text>
            <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="2.5" textAnchor="end" x="99.5" y="99">{points[points.length - 1]?.date.slice(5)}</text>
          </svg>
        )}
      </div>
    </Card>
  );
}

function VulnerableReposCard({ isLoading, repos }: { isLoading: boolean; repos: { id: number; full_name: string; critical: number; high: number; findings_total: number; last_scan_at: string }[] }) {
  return (
    <Card className="flex flex-col h-full max-h-[400px]">
      <div className="border-b border-border-dark p-4 flex justify-between items-center bg-surface-container-high/50 backdrop-blur-md">
        <h2 className="font-subheading text-subheading text-text-primary">Most Vulnerable Repos</h2>
      </div>
      <div className="flex-1 overflow-y-auto p-2">
        {isLoading ? (
          Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full mb-1" />)
        ) : repos.length === 0 ? (
          <p className="font-code-sm text-code-sm text-text-muted p-4 text-center">No vulnerable repos yet</p>
        ) : (
          repos.map((r) => (
            <div
              key={r.id}
              className="flex items-center justify-between p-3 rounded-lg hover:bg-[#1a1a1a] transition-colors cursor-pointer group border border-transparent hover:border-border-dark mb-1"
            >
              <div className="flex items-center gap-3">
                <FolderIcon className="text-text-muted group-hover:text-primary transition-colors" />
                <div>
                  <div className="font-body-base text-body-base text-text-primary">{r.full_name}</div>
                  <div className="font-code-sm text-code-sm text-text-muted mt-0.5">{r.findings_total} total findings • {relativeTime(r.last_scan_at)}</div>
                </div>
              </div>
              <div className="flex gap-2">
                {r.critical > 0 && (
                  <div className="bg-critical/10 border border-critical/30 text-critical font-code-sm text-code-sm px-1.5 py-0.5 rounded flex items-center gap-1">
                    <DiamondIcon className="text-[10px] icon-fill" /> {r.critical}
                  </div>
                )}
                {r.high > 0 && (
                  <div className="bg-high/10 border border-high/30 text-high font-code-sm text-code-sm px-1.5 py-0.5 rounded flex items-center gap-1">
                    <WarningIcon className="text-[10px] icon-fill" /> {r.high}
                  </div>
                )}
              </div>
            </div>
          ))
        )}
      </div>
    </Card>
  );
}

function RecentFindings({ isLoading, findings }: { isLoading: boolean; findings: import("@/lib/types").CrossRunFinding[] }) {
  return (
    <Card className="overflow-hidden">
      <div className="p-inset-card border-b border-border-dark flex justify-between items-center bg-[#111111]">
        <div>
          <h2 className="font-subheading text-subheading text-text-primary">Recent Findings</h2>
          <p className="font-caption text-caption text-text-muted mt-1">Across all repositories, newest first.</p>
        </div>
      </div>
      {isLoading ? (
        <div className="p-4 flex flex-col gap-2">
          {Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-12 w-full" />)}
        </div>
      ) : findings.length === 0 ? (
        <div className="p-8">
          <EmptyState title="No findings yet" description="Findings will appear here once the worker analyzes a PR." />
        </div>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead className="bg-surface-container-high border-b border-border-dark sticky top-0">
              <tr>
                {["Severity", "Repo", "File", "Title", "Confidence", "When"].map((h) => (
                  <th key={h} scope="col" className="py-3 px-4 font-caption text-caption text-text-muted font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border-dark font-body-muted text-body-muted">
              {findings.map((f) => {
                const sev = SEVERITY_STYLES[f.severity as Severity] ?? SEVERITY_STYLES.low;
                const vr = VERIFICATION_STYLES[f.verification_status] ?? VERIFICATION_STYLES.unverified;
                return (
                  <tr key={f.id} className="hover:bg-surface-container-highest/30">
                    <td className="py-3 px-4">
                      <Badge text={f.severity} textCls={sev.text} bgCls={sev.bg} borderCls={sev.border} dot={sev.dot} dotShape={sev.dotShape} />
                    </td>
                    <td className="py-3 px-4 font-code-sm text-code-sm text-text-primary">{f.repo_full_name}</td>
                    <td className="py-3 px-4 font-code-sm text-code-sm text-text-muted">{filePathWithLines(f.file_path, f.line_start, f.line_end)}</td>
                    <td className="py-3 px-4 font-body-base text-body-base text-text-primary max-w-md truncate">{f.title}</td>
                    <td className="py-3 px-4 font-code-sm text-code-sm">
                      <span className={vr.text}>{vr.label}</span>
                    </td>
                    <td className="py-3 px-4 font-code-sm text-code-sm text-text-muted">{relativeTime(f.created_at)} · {shortSha(f.commit_sha)}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}