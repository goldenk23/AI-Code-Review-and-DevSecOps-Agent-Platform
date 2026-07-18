// Stitch designed a Repositories overview screen, but the Go API has no
// `/api/repositories` endpoint yet. We render a clean "coming soon" empty
// state instead of inventing fake data, so the nav link doesn't 404.
import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import { TerminalIcon } from "@/components/icons";

export default function Page() {
  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-8">
        <h1 className="font-headline-lg text-headline-lg text-text-primary mb-6">Repositories</h1>
        <EmptyState
          icon={<TerminalIcon className="size-10" />}
          title="Repository overview coming soon"
          description="This view is part of the design. It will list your connected repositories and their security health once a /api/repositories endpoint exists on the backend."
        />
      </main>
    </AppShell>
  );
}