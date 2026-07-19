"use client";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  FolderCopyIcon,
  WebhookIcon,
  StorageIcon,
  CodeIcon,
} from "@/components/icons";

// First-run onboarding: shown only to users who have not yet connected a
// repo (i.e. `useRepositories()` returns 0 rows). Once the GitHub webhook
// fires for the first time, a repositories row is inserted and this state
// disappears on its own -- no flag to set, no localStorage, no DB column.
//
// Why "no repos" rather than "no runs" as the gate: a user could have an
// existing repo but no runs yet (e.g. webhook mis-configured, or all PRs
// closed before being reviewed). "No repos" is the truest definition of
// "brand new to the platform" -- it literally means no webhook has ever
// delivered a PR for them, which is exactly what the onboarding teaches.
//
// The component is presentation-only; the gating logic (the repos-length
// check) lives in each page that uses it, so this stays simple.

const STEPS = [
  {
    icon: <FolderCopyIcon className="size-5" />,
    step: 1,
    title: "Connect a GitHub repository",
    description: "Add a webhook on any public repo pointing at this platform's /webhooks/github endpoint with the shared secret. Repos are auto-registered the moment their first PR webhook arrives.",
  },
  {
    icon: <WebhookIcon className="size-5" />,
    step: 2,
    title: "Open a pull request",
    description: "Push a branch and open a PR with `main` as the base. The `opened`/`reopened`/`synchronize` actions trigger an automated review run.",
  },
  {
    icon: <CodeIcon className="size-5" />,
    step: 3,
    title: "See your AI review here",
    description: "The worker clones the branch, runs tests + Semgrep + npm audit, gathers context, asks the AI service to review, and posts a Markdown summary back to your PR.",
  },
];

export function OnboardingState({ variant = "default" }: { variant?: "default" | "compact" }) {
  const isCompact = variant === "compact";
  return (
    <Card className="p-inset-card relative overflow-hidden">
      {/* Soft indigo glow background -- matches the auth screen's aesthetic
          so a brand-new user has a consistent visual language. */}
      <div className="absolute -top-20 -right-20 w-72 h-72 rounded-full bg-primary/10 blur-3xl pointer-events-none" />
      <div className="absolute -bottom-32 -left-20 w-80 h-80 rounded-full bg-accent/5 blur-3xl pointer-events-none" />

      <div className="relative z-10 flex flex-col items-start gap-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 rounded-lg bg-surface-container-high border border-border-dark flex items-center justify-center shrink-0">
            <StorageIcon className="size-6 text-primary" />
          </div>
          <div>
            <h2 className="font-headline-md text-headline-md text-text-primary mb-1">
              Welcome to AI Code Review &amp; DevSecOps
            </h2>
            <p className="font-body-muted text-body-muted text-text-muted max-w-xl">
              No repositories connected yet. Once you wire up a GitHub webhook, your PRs
              will appear here automatically with AI-generated reviews, security findings,
              and DevSecOps metrics.
            </p>
          </div>
        </div>

        <div className={`grid gap-4 w-full ${isCompact ? "grid-cols-1" : "grid-cols-1 md:grid-cols-3"}`}>
          {STEPS.map((s) => (
            <div
              key={s.step}
              className="bg-[#0e0e0e] border border-border-dark rounded-lg p-4 flex flex-col gap-2 hover:border-primary/30 transition-colors"
            >
              <div className="flex items-center justify-between">
                <span className="w-8 h-8 rounded-full bg-primary/10 border border-primary/30 text-primary flex items-center justify-center font-headline-md text-headline-md font-bold">
                  {s.step}
                </span>
                <span className="text-primary">{s.icon}</span>
              </div>
              <h3 className="font-subheading text-subheading text-text-primary mt-2">{s.title}</h3>
              <p className="font-body-muted text-body-muted text-text-muted text-sm">{s.description}</p>
            </div>
          ))}
        </div>

        <div className="flex flex-wrap items-center gap-3 pt-2">
          <Button variant="primary" onClick={() => (window.location.href = "/repositories")}>
            <FolderCopyIcon className="size-4" />
            Go to Repositories
          </Button>
          <span className="font-code-sm text-code-sm text-text-muted">
            or open a PR on a repo with a webhook configured to land here automatically
          </span>
        </div>
      </div>
    </Card>
  );
}

// Tiny convenience hook: returns true once at least one repository row exists.
// Pages gate their normal content on this; new users see <OnboardingState>.
import { useRepositories } from "@/hooks/use-repositories";
export function useHasRepos() {
  const { data } = useRepositories();
  return (data?.length ?? 0) > 0;
}