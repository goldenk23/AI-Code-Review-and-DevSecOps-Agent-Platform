"use client";
import { useState } from "react";
import { useSettings, useUpdateSettings } from "@/hooks/use-settings";
import { useWorkerStatus } from "@/hooks/use-insights";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  BoltIcon, GavelIcon, PsychologyIcon, IntegrationIcon, CodeIcon, CheckIcon,
  RefreshIcon, TerminalIcon, ErrorIcon, ArrowForwardIcon,
} from "@/components/icons";
import type { ReviewSettings } from "@/lib/types";

// Interactive Toggle -- a real switch that calls back on click. Used both
// for the settings form and for any other on/off control in the app.
function Toggle({ on, disabled, onClick }: { on: boolean; disabled?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      disabled={disabled}
      onClick={onClick}
      className={`relative inline-block w-12 h-6 rounded-full transition-colors ${
        on ? "bg-primary-container" : "bg-surface-container-high"
      } ${disabled ? "opacity-50 cursor-not-allowed" : "cursor-pointer"}`}
    >
      <span
        className={`absolute top-0.5 h-5 w-5 rounded-full bg-white border-2 transition-all ${
          on ? "left-6 border-primary-container" : "left-0.5 border-border-dark"
        }`}
      />
    </button>
  );
}

const VERBOSITY_LABELS: Record<number, string> = { 1: "Concise", 2: "Balanced", 3: "Detailed" };
const STRICTNESS_LABELS: Record<number, string> = { 1: "Permissive", 2: "Standard", 3: "Strict", 4: "Pedantic" };

export default function Page() {
  const { data, isLoading, error, refetch } = useSettings();
  const update = useUpdateSettings();

  // Local draft state lets the user adjust controls without auto-saving.
  // Commit happens on the Save button; "Reset" discards back to the
  // server's last-known-good (the query cache).
  const [draft, setDraft] = useState<ReviewSettings | null>(null);
  const source = draft ?? data ?? null;
  if (data && !draft) setDraft(data); // first load

  // While the user is dragging a slider, we keep the value as a FREE
  // float in `drag` so the thumb tracks the cursor smoothly (the native
  // step=1/default would snap it to only 3 or 4 positions, which feels
  // janky). On release we round to the nearest integer and commit it
  // to `draft` -- the backend's CHECK constraint requires integers.
  const [drag, setDrag] = useState<{ key: "ai_verbosity" | "ai_strictness"; value: number } | null>(null);
  const sliderValue = (key: "ai_verbosity" | "ai_strictness") =>
    drag?.key === key ? drag.value : (source?.[key] ?? 0);
  const onSliderChange = (key: "ai_verbosity" | "ai_strictness", v: number) =>
    setDrag({ key, value: v });
  const onSliderCommit = (key: "ai_verbosity" | "ai_strictness") => {
    if (!drag) return;
    set(key, Math.round(drag.value));
    setDrag(null);
  };

  if (isLoading || !source) {
    return (
      <AppShell>
        <div className="flex-1 flex max-w-container-max mx-auto w-full">
          <main className="flex-1 px-margin-page py-8">
            <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Automation Settings</h1>
            <p className="font-body-muted text-body-muted text-text-muted">Loading settings...</p>
          </main>
        </div>
      </AppShell>
    );
  }

  const set = <K extends keyof ReviewSettings>(k: K, v: ReviewSettings[K]) =>
    setDraft((d) => (d ? { ...d, [k]: v } : d));

  const dirty = JSON.stringify(draft) !== JSON.stringify(data);
  const save = async () => {
    if (!draft) return;
    try {
      await update.mutateAsync(draft);
      setDraft(null); // force re-sync from cache
    } catch {
      // mutation.isError surfaces it below
    }
  };
  const reset = () => setDraft(data ? { ...data } : null);

  return (
    <AppShell>
      <div className="flex-1 flex max-w-container-max mx-auto w-full">
        <main className="flex-1 px-margin-page pt-8 md:pt-12 pb-8">
          <div className="mb-8 flex justify-between items-end">
            <div>
              <h1 className="font-headline-lg text-headline-lg text-text-primary mb-2">Automation Settings</h1>
              <p className="font-body-muted text-body-muted text-text-muted">
                Configure AI agent behavior, scanning triggers, and review style.
              </p>
            </div>
            <Button variant="ghost" onClick={() => refetch()}><RefreshIcon className="size-4" />Refresh</Button>
          </div>

          {error && (
            <Card className="p-inset-card mb-6 border-critical/30 text-critical font-code-sm text-code-sm">
              {error.message}
            </Card>
          )}
          {update.isError && (
            <Card className="p-inset-card mb-6 border-critical/30 text-critical font-code-sm text-code-sm">
              Failed to save: {(update.error as Error).message}
            </Card>
          )}
          {update.isSuccess && !dirty && (
            <Card className="p-inset-card mb-6 border-success/30 text-success font-code-sm text-code-sm flex items-center gap-2">
              <CheckIcon className="size-4" /> Settings saved
            </Card>
          )}

          <div className="grid grid-cols-1 lg:grid-cols-12 gap-8">
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
                    <Toggle on={source.pr_webhooks_enabled} onClick={() => set("pr_webhooks_enabled", !source.pr_webhooks_enabled)} />
                  </div>
                  <div className="flex items-center justify-between pt-6 border-t border-border-dark/50">
                    <div>
                      <h3 className="font-body-base text-body-base text-text-primary font-semibold">Scheduled Scans</h3>
                      <p className="font-body-muted text-body-muted text-text-muted mt-1">
                        Run full repository analysis daily at 00:00 UTC.
                      </p>
                    </div>
                    <Toggle on={source.scheduled_scans_enabled} onClick={() => set("scheduled_scans_enabled", !source.scheduled_scans_enabled)} />
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
                  <label className="flex items-start gap-3 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={source.block_on_high}
                      onChange={(e) => set("block_on_high", e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-border-dark bg-background accent-primary-container"
                    />
                    <div>
                      <span className="font-body-base text-body-base text-text-primary block">Block PR if High findings are found</span>
                      <span className="font-body-muted text-body-muted text-text-muted mt-1 block">
                        Fails the CI/CD pipeline if high severity issues are detected.
                      </span>
                    </div>
                  </label>
                  <label className="flex items-start gap-3 cursor-pointer pt-4">
                    <input
                      type="checkbox"
                      checked={source.require_critical_verified}
                      onChange={(e) => set("require_critical_verified", e.target.checked)}
                      className="mt-1 h-4 w-4 rounded border-border-dark bg-background accent-primary-container"
                    />
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
                      <span className="font-code-sm text-code-sm text-text-muted">{VERBOSITY_LABELS[Math.round(sliderValue("ai_verbosity"))]}</span>
                    </div>
                    <input
                      type="range" min={1} max={3} step={0.01}
                      value={sliderValue("ai_verbosity")}
                      onChange={(e) => onSliderChange("ai_verbosity", Number(e.target.value))}
                      onPointerUp={() => onSliderCommit("ai_verbosity")}
                      onBlur={() => onSliderCommit("ai_verbosity")}
                      className="range-slider"
                      style={{ ["--range-fill" as string]: `${((sliderValue("ai_verbosity") - 1) / 2) * 100}%` }}
                    />
                    <div className="flex justify-between mt-2 font-caption text-caption text-text-muted">
                      <span>Concise</span><span>Detailed</span>
                    </div>
                  </div>
                  <div className="pt-4 border-t border-border-dark/50">
                    <div className="flex justify-between mb-2">
                      <label className="font-body-base text-body-base text-text-primary font-semibold">Strictness</label>
                      <span className="font-code-sm text-code-sm text-text-muted">{STRICTNESS_LABELS[Math.round(sliderValue("ai_strictness"))]}</span>
                    </div>
                    <input
                      type="range" min={1} max={4} step={0.01}
                      value={sliderValue("ai_strictness")}
                      onChange={(e) => onSliderChange("ai_strictness", Number(e.target.value))}
                      onPointerUp={() => onSliderCommit("ai_strictness")}
                      onBlur={() => onSliderCommit("ai_strictness")}
                      className="range-slider"
                      style={{ ["--range-fill" as string]: `${((sliderValue("ai_strictness") - 1) / 3) * 100}%` }}
                    />
                    <div className="flex justify-between mt-2 font-caption text-caption text-text-muted">
                      <span>Permissive</span><span>Pedantic</span>
                    </div>
                  </div>
                </div>
              </Card>

              {/* Save / Reset actions */}
              <div className="flex justify-end gap-3 pt-4">
                <Button variant="ghost" disabled={!dirty || update.isPending} onClick={reset}>Reset</Button>
                <Button
                  variant="primary"
                  disabled={!dirty || update.isPending}
                  onClick={save}
                >
                  {update.isPending ? "Saving..." : "Save Configuration"}
                </Button>
              </div>
            </div>

            {/* Sidebar -- integration status */}
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
                    <h4 className="font-body-base text-body-base text-text-primary font-semibold">GitHub Webhooks</h4>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="w-2 h-2 rounded-full bg-success" />
                      <span className="font-code-sm text-code-sm text-text-muted">Connected & Active</span>
                    </div>
                  </div>
                </div>
                <div className="mt-6 pt-4 border-t border-border-dark">
                  <div className="font-code-sm text-code-sm text-text-muted flex flex-col gap-2">
                    <div className="flex justify-between">
                      <span>Mode:</span>
                      <span className="text-text-primary">Per-repo webhooks</span>
                    </div>
                    <div className="flex justify-between items-center">
                      <span>Permissions:</span>
                      <span className="text-primary inline-flex items-center gap-1">
                        <CheckIcon className="size-3" /> Read & Write
                      </span>
                    </div>
                  </div>
                </div>
                <p className="mt-6 font-caption text-caption text-text-muted">
                  Repositories are auto-registered when a GitHub PR webhook is received on
                  <span className="font-code-sm text-code-sm text-text-primary"> /webhooks/github</span>.
                </p>
              </Card>

              {/* Worker + Prometheus metrics status. Pings /api/insights/worker-status
                  (which the Go API proxies to the worker's :9090/metrics endpoint) so the
                  user can see at a glance whether the worker is alive and where to scrape. */}
              <WorkerStatusCard />
            </div>
          </div>
        </main>
      </div>
    </AppShell>
  );
}

// Worker + Prometheus metrics status card. Pings the Go API's
// /api/insights/worker-status endpoint, which proxies to the worker's
// :9090/metrics Prometheus endpoint. Shows a green/red dot + a link the
// user can click to open the raw metrics page in a new tab.
//
// Three states:
//   - loading: grey dot, "Checking..." (first fetch, before any data)
//   - up:      green dot, "Running" + clickable metrics link
//   - down:    red dot, "Not responding" (worker process is down OR
//              the metrics server failed to bind on :9090)
//
// The hook's `retry: false` means a down worker stays down in the UI
// instead of silently recovering in the background -- the user needs to
// see the problem, not have it papered over.
function WorkerStatusCard() {
  const { data, isLoading, isError } = useWorkerStatus();

  const isUp = data?.status === "up";
  const dotColor = isLoading
    ? "bg-text-muted"
    : isUp
      ? "bg-success"
      : "bg-critical";
  const statusLabel = isLoading
    ? "Checking..."
    : isUp
      ? "Running"
      : "Not responding";

  return (
    <Card className="p-inset-card">
      <div className="flex items-center gap-3 border-b border-border-dark pb-4 mb-4">
        <TerminalIcon className="size-5 text-text-muted" />
        <h3 className="font-subheading text-subheading text-text-primary">Worker & Metrics</h3>
      </div>
      <div className="flex items-start gap-4">
        <div className="w-10 h-10 rounded-full bg-surface-container-high flex items-center justify-center border border-border-dark shrink-0">
          <TerminalIcon className="size-5 text-primary" />
        </div>
        <div>
          <h4 className="font-body-base text-body-base text-text-primary font-semibold">Analysis Worker</h4>
          <div className="flex items-center gap-2 mt-1">
            <span className={`w-2 h-2 rounded-full ${dotColor}`} />
            <span className="font-code-sm text-code-sm text-text-muted">{statusLabel}</span>
          </div>
        </div>
      </div>
      <div className="mt-6 pt-4 border-t border-border-dark">
        <div className="font-code-sm text-code-sm text-text-muted flex flex-col gap-2">
          <div className="flex justify-between">
            <span>Metrics:</span>
            {isUp && data?.metrics_url ? (
              <a
                href={data.metrics_url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary inline-flex items-center gap-1 hover:underline"
              >
                :9090/metrics <ArrowForwardIcon className="size-3" />
              </a>
            ) : (
              <span className="text-text-muted">Prometheus :9090</span>
            )}
          </div>
          <div className="flex justify-between items-center">
            <span>Queue:</span>
            <span className="text-text-primary inline-flex items-center gap-1">
              Redis BRPOP
            </span>
          </div>
        </div>
      </div>
      {isError && (
        <p className="mt-4 font-caption text-caption text-critical flex items-center gap-1">
          <ErrorIcon className="size-3" /> Worker is not responding on port 9090.
        </p>
      )}
      <p className="mt-4 font-caption text-caption text-text-muted">
        The worker exposes 4 Prometheus metrics: job duration, jobs total, AI latency, and token usage.
      </p>
    </Card>
  );
}