import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

// Top-level loading state (kicks in during route transitions to "/").
// Mirrors the dashboard layout so the shell stays stable instead of jumping.
export default function Loading() {
  return (
    <AppShell>
      <main className="max-w-container-max mx-auto px-margin-page py-8">
        <Skeleton className="h-9 w-48 mb-2" />
        <Skeleton className="h-4 w-72 mb-6" />
        <Skeleton className="h-96 rounded-lg" />
      </main>
    </AppShell>
  );
}