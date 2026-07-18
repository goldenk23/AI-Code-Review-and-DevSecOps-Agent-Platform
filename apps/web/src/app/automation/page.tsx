// Stitch designed an Automation workflow-settings screen, but the Go API has
// no settings endpoints yet. Render a clean "coming soon" state so the nav
// link doesn't 404 -- we don't invent fake data.
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { TerminalIcon } from "@/components/icons";

export default function Page() {
  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        <h1 className="font-headline-lg text-headline-lg text-text-primary mb-6">Automation</h1>
        <EmptyState
          icon={<TerminalIcon className="size-10" />}
          title="Workflow automation coming soon"
          description="Configure when and how the AI reviewer runs (per-PR, on schedule, on label) once the backend exposes settings endpoints."
        />
      </main>
    </AppShell>
  );
}