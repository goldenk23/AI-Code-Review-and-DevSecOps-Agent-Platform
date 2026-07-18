// Server Component. The Stitch design references a Repositories overview
// screen, but the Go API has no /api/repositories endpoint yet. We render the
// full visual design (bento grid with grade tiles, summary strip, scanning
// animation, "Action Req" overlay) using the mock dataset transcribed from
// `design-reference/repositories_security_health_overview/SPEC.md`, so the
// route looks exactly like the design. The cards are intentionally inert
// (no <Link>/no fetch) until a backend endpoint exists.
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import {
  FolderCopyIcon,
  MergeTypeIcon,
  CheckCircleIcon,
  WarningIcon,
  ErrorIcon,
  RefreshIcon,
  GridViewIcon,
  ViewListIcon,
  FilterListIcon,
  AddIcon,
} from "@/components/icons";

type Grade = "A" | "B" | "C" | "?";
type RepoCardData = {
  name: string;
  language: string;
  lastScan: string;
  grade: Grade;
  activePRs: number;
  critical: number;
  medium: number;
  scanning?: boolean;
  actionReq?: boolean;
};

// Mock data taken directly from the Stitch SPEC table.
const REPOS: RepoCardData[] = [
  { name: "acme-corp/api-gateway",   language: "Node.js", lastScan: "2m ago", grade: "A", activePRs: 4,  critical: 0, medium: 2  },
  { name: "acme-corp/auth-service",  language: "Go",      lastScan: "15m ago", grade: "B", activePRs: 12, critical: 0, medium: 8  },
  { name: "acme-corp/payment-worker", language: "Python", lastScan: "1h ago",  grade: "C", activePRs: 2,  critical: 3, medium: 15, actionReq: true },
  { name: "acme-corp/web-client",    language: "React",   lastScan: "5m ago",  grade: "A", activePRs: 7,  critical: 0, medium: 0  },
  { name: "acme-corp/data-pipeline", language: "—",       lastScan: "",       grade: "?", activePRs: 1,  critical: 0, medium: 0,  scanning: true },
];

const GRADE_STYLE: Record<Grade, { chip: string; glow: string }> = {
  A: { chip: "bg-success/10 border-success/30 text-success",   glow: "bg-success/5"  },
  B: { chip: "bg-medium/10  border-medium/30  text-medium",    glow: "bg-medium/5"  },
  C: { chip: "bg-critical/10 border-critical/30 text-critical", glow: "bg-critical/5" },
  "?": { chip: "bg-[#1a1a1a] border-border-dark text-text-muted", glow: "bg-primary/5" },
};

export default function Page() {
  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-end justify-between gap-4 mb-8">
          <div>
            <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Repositories</h1>
            <p className="font-body-muted text-body-muted text-text-muted">
              Manage and monitor security posture across all connected codebases.
            </p>
          </div>
          <div className="flex items-center gap-3">
            <Button variant="ghost"><FilterListIcon className="text-[18px]" />Filter</Button>
            <Button variant="primary"><AddIcon className="text-[18px]" />Connect Repo</Button>
          </div>
        </div>

        {/* Summary strip */}
        <div className="flex items-center justify-between mb-4 pb-2 border-b border-border-dark">
          <div className="flex gap-4 items-center font-code-sm text-code-sm">
            <span className="text-text-primary">12 Repositories Found</span>
            <span className="text-success flex items-center gap-1"><CheckCircleIcon className="text-[14px]" /> 8 Healthy</span>
            <span className="text-medium flex items-center gap-1"><WarningIcon className="text-[14px]" /> 3 Warning</span>
            <span className="text-critical flex items-center gap-1"><ErrorIcon className="text-[14px]" /> 1 Critical</span>
          </div>
          <div className="flex items-center gap-2 text-text-muted">
            <button className="p-1 hover:text-text-primary bg-surface-container-high rounded transition-colors" title="Grid view">
              <GridViewIcon className="text-[18px]" />
            </button>
            <button className="p-1 hover:text-text-primary rounded transition-colors" title="List view">
              <ViewListIcon className="text-[18px]" />
            </button>
          </div>
        </div>

        {/* Bento grid (3 cols desktop, 2 cols tablet, 1 col mobile) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {REPOS.map((repo) => <RepoCard key={repo.name} repo={repo} />)}
        </div>
      </main>
    </AppShell>
  );
}

function RepoCard({ repo }: { repo: RepoCardData }) {
  const g = GRADE_STYLE[repo.grade];
  const cardBorder = repo.scanning
    ? "border-primary/30"
    : repo.actionReq
    ? "border-critical/30"
    : "border-border-dark";

  return (
    <div
      className={`bg-[#111111] border ${cardBorder} rounded-lg p-inset-card hover:bg-[#151515] transition-colors group cursor-pointer relative overflow-hidden flex flex-col justify-between h-[200px]`}
    >
      {/* Glow + scanning overlay (decorative only) */}
      <div className={`absolute top-0 right-0 w-24 h-24 ${g.glow} ${repo.actionReq ? "bg-critical/10" : repo.scanning ? "bg-primary/5" : ""} rounded-bl-full blur-xl -z-10`} />
      {repo.scanning && (
        <div className="absolute inset-0 bg-gradient-to-b from-transparent via-primary/5 to-transparent h-[200%] w-full animate-scan -z-10 pointer-events-none opacity-50" />
      )}

      {/* Header row: folder icon tile + name + grade tile */}
      <div className="flex justify-between items-start mb-4 z-10">
        <div className="flex items-center gap-3">
          <div
            className={`w-8 h-8 rounded bg-[#1a1a1a] border ${repo.scanning ? "border-primary/50" : "border-border-dark"} flex items-center justify-center shrink-0`}
          >
            {repo.scanning ? (
              <RefreshIcon className="text-[18px] text-primary animate-spin" />
            ) : (
              <FolderCopyIcon className="text-[18px] text-text-muted" />
            )}
          </div>
          <div>
            <h3 className="font-subheading text-subheading text-text-primary group-hover:text-primary transition-colors">
              {repo.name}
            </h3>
            <p className="font-code-sm text-code-sm text-text-muted mt-0.5">
              {repo.scanning ? (
                <span className="text-primary">Scanning in progress...</span>
              ) : (
                `${repo.language} • Last scan: ${repo.lastScan}`
              )}
            </p>
          </div>
        </div>
        <div
          className={`w-8 h-8 rounded border flex items-center justify-center font-headline-md text-headline-md font-bold ${g.chip}`}
        >
          {repo.grade}
        </div>
      </div>

      {/* Stats row */}
      <div className={`grid grid-cols-2 gap-4 mt-auto z-10 pt-4 border-t border-border-dark ${repo.scanning ? "opacity-50" : ""}`}>
        <div>
          <span className="block font-code-sm text-code-sm text-text-muted mb-1">Active PRs</span>
          <div className="flex items-center gap-1 text-text-primary font-subheading text-subheading">
            <MergeTypeIcon className="text-[16px] text-text-muted" /> {repo.activePRs}
          </div>
        </div>
        <div>
          <span className="block font-code-sm text-code-sm text-text-muted mb-1">Open Findings</span>
          {repo.scanning ? (
            <span className="font-code-sm text-code-sm text-text-muted">Analyzing</span>
          ) : (
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 bg-critical rounded-sm shrink-0" />
              <span className="font-code-sm text-code-sm text-text-primary">{repo.critical}</span>
              <span className="w-2 h-2 bg-medium rounded-sm shrink-0" />
              <span className="font-code-sm text-code-sm text-text-primary">{repo.medium}</span>
            </div>
          )}
        </div>
      </div>

      {/* Critical badge overlay */}
      {repo.actionReq && (
        <div className="absolute bottom-4 right-4 flex items-center gap-1 text-critical font-code-sm text-code-sm animate-pulse">
          <WarningIcon className="text-[14px]" /> Action Req
        </div>
      )}
    </div>
  );
}