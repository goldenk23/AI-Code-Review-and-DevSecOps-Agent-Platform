// Stitch designed an Automation workflow-settings screen: scan triggers,
// threshold gates, AI review personality (sliders), and a GitHub integration
// status sidebar. The Go API has no settings endpoints yet, so we render the
// page chrome (header + section cards with disabled controls) and a clean
// "coming soon" note -- we don't POST anywhere or invent saved state.
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import {
  BoltIcon,
  GavelIcon,
  PsychologyIcon,
  IntegrationIcon,
  CodeIcon,
  CheckIcon,
} from "@/components/icons";

// A small toggle rendered as a pure-visual disabled control (no state, no
// onChange) -- it's a placeholder for the real settings form to come.
function VisualToggle({ on = false }: { on?: boolean }) {
  return (
    <span
      className={`relative inline-block w-12 h-6 rounded-full transition-colors ${
        on ? "bg-primary-container" : "bg-surface-container-high"
      }`}
      aria-hidden
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white border-2 transition-all ${
          on ? "left-6 border-primary-container" : "left-0.5 border-border-dark"
        }`}
      />
    </span>
  );
}

export default function Page() {
  return (
    <AppShell>
      <div className="flex-1 flex max-w-container-max mx-auto w-full">
        <main className="flex-1 px-margin-page pt-8 md:pt-12 pb-8">
          {/* Header */}
          <div className="mb-8">
            <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Automation Settings</h1>
            <p className="font-body-muted text-body-muted text-text-muted">
              Configure AI agent behavior, scanning triggers, and review style for automated PR analysis.
            </p>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
            {/* 70% column -- settings sections (disabled placeholders) */}
            <div className="lg:col-span-8 flex flex-col gap-8">
              {/* Scan Triggers */}
              <Card className="p-inset-card">
                <div className="flex items-center gap-3 border-b border-border-dark pb-4 mb-6">
                  <BoltIcon className="size-5 text-primary" />
                  <h2 className="font-subheading text-subheading text-text-primary">Scan Triggers</h2>
                </div>
                <div className="flex flex-col gap-6">
                  <div className="flex items-center justify-between">
                    <div>
                      <h3 className="font-body-base text-body-base text-text-primary font-semibold">PR Webhooks</h3>
                      <p className="font-body-muted text-body-muted text-text-muted mt-1">
                        Automatically scan new pull requests and commits.
                      </p>
                    </div>
                    <VisualToggle on />
                  </div>
                  <div className="flex items-center justify-between pt-6 border-t border-border-dark/50">
                    <div>
                      <h3 className="font-body-base text-body-base text-text-primary font-semibold">Scheduled Scans</h3>
                      <p className="font-body-muted text-body-muted text-text-muted mt-1">
                        Run full repository analysis daily at 00:00 UTC.
                      </p>
                    </div>
                    <VisualToggle />
                  </div>
                </div>
              </Card>

              {/* Threshold Gates */}
              <Card className="p-inset-card">
                <div className="flex items-center gap-3 border-b border-border-dark pb-4 mb-6">
                  <GavelIcon className="size-5 text-primary" />
                  <h2 className="font-subheading text-subheading text-text-primary">Threshold Gates</h2>
                </div>
                <div className="flex flex-col gap-6">
                  <label className="flex items-start gap-3 cursor-not-allowed opacity-80">
                    <input type="checkbox" checked disabled className="mt-1 h-4 w-4 rounded border-border-dark bg-background accent-primary-container" />
                    <div>
                      <span className="font-body-base text-body-base text-text-primary block">Block PR if High findings are found</span>
                      <span className="font-body-muted text-body-muted text-text-muted mt-1 block">
                        Fails the CI/CD pipeline if high severity issues are detected.
                      </span>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-not-allowed opacity-80 pt-4">
                    <input type="checkbox" checked disabled className="mt-1 h-4 w-4 rounded border-border-dark bg-background accent-primary-container" />
                    <div>
                      <span className="font-body-base text-body-base text-text-primary block">Require verification for Critical findings</span>
                      <span className="font-body-muted text-body-muted text-text-muted mt-1 block">
                        Mandates human approval for any finding classified as Critical before merging.
                      </span>
                    </div>
                  </label>
                </div>
              </Card>

              {/* AI Review Personality */}
              <Card className="p-inset-card">
                <div className="flex items-center gap-3 border-b border-border-dark pb-4 mb-6">
                  <PsychologyIcon className="size-5 text-primary" />
                  <h2 className="font-subheading text-subheading text-text-primary">AI Review Personality</h2>
                </div>
                <div className="flex flex-col gap-8">
                  <div>
                    <div className="flex justify-between mb-2">
                      <label className="font-body-base text-body-base text-text-primary font-semibold">Verbosity</label>
                      <span className="font-code-sm text-code-sm text-text-muted">Balanced</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={3}
                      defaultValue={2}
                      disabled
                      className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-not-allowed accent-primary-container"
                    />
                    <div className="flex justify-between mt-2 font-caption text-caption text-text-muted">
                      <span>Concise</span>
                      <span>Detailed</span>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-border-dark/50">
                    <div className="flex justify-between mb-2">
                      <label className="font-body-base text-body-base text-text-primary font-semibold">Strictness</label>
                      <span className="font-code-sm text-code-sm text-text-muted">Strict (Style + Sec)</span>
                    </div>
                    <input
                      type="range"
                      min={1}
                      max={4}
                      defaultValue={3}
                      disabled
                      className="w-full h-1 bg-surface-container-high rounded-lg appearance-none cursor-not-allowed accent-primary-container"
                    />
                    <div className="flex justify-between mt-2 font-caption text-caption text-text-muted">
                      <span>Permissive</span>
                      <span>Pedantic</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Save action (disabled until a /api/settings endpoint exists) */}
              <div className="flex justify-end pt-4">
                <button
                  type="button"
                  disabled
                  className="bg-inverse-primary text-white font-body-base text-body-base py-2 px-6 rounded-lg transition-all border border-transparent opacity-50 cursor-not-allowed"
                >
                  Save Configuration
                </button>
              </div>
            </div>

            {/* 30% column -- integration status sidebar */}
            <div className="lg:col-span-4 flex flex-col gap-6">
              <Card className="p-inset-card sticky top-24">
                <div className="flex items-center gap-3 border-b border-border-dark pb-4 mb-4">
                  <IntegrationIcon className="size-5 text-text-muted" />
                  <h3 className="font-subheading text-subheading text-text-primary">Integration Status</h3>
                </div>
                <div className="flex items-start gap-4">
                  <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center border border-border-dark shrink-0">
                    <CodeIcon className="size-5 text-primary" />
                  </div>
                  <div>
                    <h4 className="font-body-base text-body-base text-text-primary font-semibold">GitHub App</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="w-2 h-2 rounded-full bg-success" />
                      <span className="font-code-sm text-code-sm text-text-muted">Connected & Active</span>
                    </div>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-border-dark">
                  <div className="font-code-sm text-code-sm text-text-muted flex flex-col gap-2">
                    <div className="flex justify-between">
                      <span>Last Sync:</span>
                      <span className="text-text-primary">2m ago</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Permissions:</span>
                      <span className="text-primary inline-flex items-center gap-1">
                        <CheckIcon className="size-3" /> Read & Write
                      </span>
                    </div>
                  </div>
                </div>
                <button
                  type="button"
                  disabled
                  className="w-full mt-6 bg-surface-container-high hover:bg-surface-container-highest text-text-primary font-body-base text-body-base py-2 px-4 rounded border border-border-dark transition-colors opacity-50 cursor-not-allowed"
                >
                  Manage Connection
                </button>
              </Card>
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  );
}