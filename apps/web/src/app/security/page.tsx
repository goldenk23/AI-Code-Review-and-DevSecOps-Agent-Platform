// Stitch designed a Security overview screen (org insights), but the Go API
// has no aggregated-insights endpoint yet. Render a clean "coming soon" state
// so the nav link doesn't 404 -- we don't invent fake data.
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { TerminalIcon } from "@/components/icons";

export default function Page() {
  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        <h1 className="font-headline-lg text-headline-lg text-text-primary mb-6">Security</h1>
        <EmptyState
          icon={<TerminalIcon className="size-10" />}
          title="Security insights coming soon"
          description="Aggregated severity / category breakdowns across all runs will appear here once the backend exposes an aggregation endpoint."
        />
      </main>
    </AppShell>
  );
}