// Server Component. Renders the Stitch Security overview design
// (KPI cards + findings-over-time chart + most vulnerable repos list)
// using the mock dataset transcribed from
// `design-reference/security_overview_org_insights_2/SPEC.md`. The Go API
// has no aggregated-insights endpoint yet, so the numbers are visual mocks
// of the design only.
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  DiamondIcon,
  WarningIcon,
  ScheduleIcon,
  FolderOpenIcon,
  TrendingUpIcon,
  TrendingDownIcon,
  FolderIcon,
  FilterListIcon,
} from "@/components/icons";

type Stat = {
  label: string;
  icon: React.ReactNode;
  value: React.ReactNode;
  delta?: React.ReactNode;
  barColor: string;   // bg for the progress bar fill
  trackColor: string; // bg for the unfilled track
  fillClass: string;  // width utility (e.g. "w-1/4")
  valueColor?: string;
};

const STATS: Stat[] = [
  {
    label: "Critical Findings",
    icon: <DiamondIcon className="text-[16px] text-critical icon-fill" />,
    value: <span className="text-critical">14</span>,
    delta: (
      <span className="text-error flex items-center gap-0.5">
        <TrendingUpIcon className="text-[12px]" /> +3
      </span>
    ),
    barColor: "bg-critical",
    trackColor: "bg-critical/20",
    fillClass: "w-1/4",
  },
  {
    label: "High Findings",
    icon: <WarningIcon className="text-[16px] text-high icon-fill" />,
    value: <span className="text-high">42</span>,
    delta: (
      <span className="text-success flex items-center gap-0.5">
        <TrendingDownIcon className="text-[12px]" /> -12
      </span>
    ),
    barColor: "bg-high",
    trackColor: "bg-high/20",
    fillClass: "w-2/5",
  },
  {
    label: "Avg. Time to Fix",
    icon: <ScheduleIcon className="text-[16px] text-info" />,
    value: (
      <span className="text-text-primary">
        4.2
        <span className="font-headline-md text-headline-md text-text-muted ml-1">days</span>
      </span>
    ),
    delta: (
      <span className="text-success flex items-center gap-0.5">
        <TrendingDownIcon className="text-[12px]" /> -0.8 days
      </span>
    ),
    barColor: "bg-info",
    trackColor: "bg-info/20",
    fillClass: "w-3/5",
  },
  {
    label: "Vulnerable Repos",
    icon: <FolderOpenIcon className="text-[16px] text-medium icon-fill" />,
    value: (
      <span className="text-text-primary">
        18
        <span className="font-headline-md text-headline-md text-text-muted ml-1">/ 142</span>
      </span>
    ),
    delta: <span className="text-text-muted flex items-center gap-0.5">12% of total</span>,
    barColor: "bg-medium",
    trackColor: "bg-border-dark",
    fillClass: "w-[12%]",
  },
];

type VulnRepo = { name: string; lang: string; branch: string; crit: number; high: number };
const VULN_REPOS: VulnRepo[] = [
  { name: "auth-service-api",   lang: "nodejs", branch: "production",   crit: 6, high: 12 },
  { name: "payment-gateway",    lang: "golang", branch: "production",   crit: 4, high: 8  },
  { name: "frontend-dashboard", lang: "react",  branch: "develop",      crit: 2, high: 15 },
  { name: "legacy-batch-jobs",   lang: "java",   branch: "master",       crit: 2, high: 5  },
];

export default function Page() {
  return (
    <AppShell>
      <main className="flex-1 w-full max-w-container-max mx-auto px-margin-page py-8 flex flex-col gap-8">
        {/* Header */}
        <header className="flex flex-col md:flex-row md:items-end justify-between gap-4">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-text-primary">Security Overview</h1>
            <p className="font-body-muted text-body-muted text-text-muted mt-2">
              Aggregated DevSecOps metrics across all organization repositories.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-code-sm text-code-sm text-text-muted">
              LAST SCANNED: <span className="text-text-primary">2 MINS AGO</span>
            </span>
            <Button variant="ghost"><FilterListIcon className="text-[14px]" />Filter</Button>
          </div>
        </header>

        {/* KPI stat cards */}
        <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {STATS.map((s) => (
            <div
              key={s.label}
              className="bg-[#111111] border border-border-dark rounded-lg p-inset-card flex flex-col gap-2 relative overflow-hidden"
            >
              <div className="flex items-center justify-between text-text-muted font-body-muted text-body-muted">
                <span>{s.label}</span>
                {s.icon}
              </div>
              <div className="font-headline-lg text-headline-lg">{s.value}</div>
              <div className="flex items-center gap-1 font-caption text-caption text-text-muted">
                {s.delta} <span>vs last week</span>
              </div>
              {/* Progress bar flush along the bottom edge */}
              <div className={`absolute bottom-0 left-0 w-full h-1 ${s.trackColor}`}>
                <div className={`h-full ${s.barColor} ${s.fillClass}`} />
              </div>
            </div>
          ))}
        </section>

        {/* Trend chart + vulnerable repos */}
        <section className="grid grid-cols-1 lg:grid-cols-12 gap-8">
          {/* Findings Over Time */}
          <div className="lg:col-span-8 flex flex-col gap-4">
            <div className="bg-[#111111] border border-border-dark rounded-lg flex flex-col h-[400px]">
              <div className="border-b border-border-dark p-4 flex justify-between items-center">
                <h2 className="font-subheading text-subheading text-text-primary">Findings Over Time</h2>
                <div className="flex gap-2">
                  <span className="flex items-center gap-1 font-caption text-caption text-text-muted">
                    <span className="w-2 h-2 rounded-full bg-critical block" /> Critical
                  </span>
                  <span className="flex items-center gap-1 font-caption text-caption text-text-muted ml-2">
                    <span className="w-2 h-2 rounded-full bg-high block" /> High
                  </span>
                </div>
              </div>
              {/* Chart body: faint grid background + dual-line SVG, Jan-Jun x-axis */}
              <div className="flex-1 p-4 flex items-center justify-center relative bg-grid-pattern">
                <svg
                  className="absolute inset-0 w-full h-full p-4"
                  preserveAspectRatio="none"
                  viewBox="0 0 100 100"
                >
                  <path
                    d="M0,80 L20,75 L40,85 L60,50 L80,55 L100,20"
                    fill="none"
                    stroke="var(--color-critical)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <path
                    d="M0,90 L20,88 L40,70 L60,75 L80,40 L100,30"
                    fill="none"
                    stroke="var(--color-high)"
                    strokeWidth="2"
                    vectorEffect="non-scaling-stroke"
                  />
                  <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="3" x="0" y="98">Jan</text>
                  <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="3" x="20" y="98">Feb</text>
                  <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="3" x="40" y="98">Mar</text>
                  <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="3" x="60" y="98">Apr</text>
                  <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="3" x="80" y="98">May</text>
                  <text fill="var(--color-text-muted)" fontFamily="Geist Mono, monospace" fontSize="3" textAnchor="end" x="100" y="98">Jun</text>
                </svg>
              </div>
            </div>
          </div>

          {/* Most Vulnerable Repos */}
          <div className="lg:col-span-4 flex flex-col gap-4">
            <div className="bg-[#111111] border border-border-dark rounded-lg flex flex-col h-full max-h-[400px]">
              <div className="border-b border-border-dark p-4 flex justify-between items-center bg-surface-container-high/50 backdrop-blur-md">
                <h2 className="font-subheading text-subheading text-text-primary">Most Vulnerable Repos</h2>
                <a className="font-caption text-caption text-primary hover:underline cursor-pointer" href="#">View All</a>
              </div>
              <div className="flex-1 overflow-y-auto p-2">
                {VULN_REPOS.map((r) => (
                  <div
                    key={r.name}
                    className="flex items-center justify-between p-3 rounded-lg hover:bg-[#1a1a1a] transition-colors cursor-pointer group border border-transparent hover:border-border-dark mb-1"
                  >
                    <div className="flex items-center gap-3">
                      <FolderIcon className="text-text-muted group-hover:text-primary transition-colors" />
                      <div>
                        <div className="font-body-base text-body-base text-text-primary">{r.name}</div>
                        <div className="font-code-sm text-code-sm text-text-muted mt-0.5">{r.lang} • {r.branch}</div>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <div className="bg-critical/10 border border-critical/30 text-critical font-code-sm text-code-sm px-1.5 py-0.5 rounded flex items-center gap-1">
                        <DiamondIcon className="text-[10px] icon-fill" /> {r.crit}
                      </div>
                      <div className="bg-high/10 border border-high/30 text-high font-code-sm text-code-sm px-1.5 py-0.5 rounded flex items-center gap-1">
                        <WarningIcon className="text-[10px] icon-fill" /> {r.high}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>
      </main>
    </AppShell>
  );
}