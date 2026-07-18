import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading skeleton for /runs/[id]. Mirrors the detail layout
// (breadcrumb + header + 70/30 split) so the transition from the list page
// doesn't jump. This fires during the Server Component's async params await
// and before the client RunDetailView mounts.
export default function Loading() {
  return (
    <AppShell>
      <main className="max-w-container-max mx-auto px-margin-page py-8">
        <Skeleton className="h-5 w-32 mb-2" />
        <Skeleton className="h-8 w-64 mb-3" />
        <Skeleton className="h-4 w-48 mb-6" />
        <div className="grid grid-cols-1 md:grid-cols-[70%_30%] gap-gutter">
          <div className="flex flex-col gap-4">
            <Skeleton className="h-6 w-40" />
            <Skeleton className="h-40 rounded" />
            <Skeleton className="h-40 rounded" />
          </div>
          <div className="flex flex-col gap-4">
            <Skeleton className="h-20 rounded" />
            <Skeleton className="h-60 rounded" />
            <Skeleton className="h-40 rounded" />
          </div>
        </div>
      </main>
    </AppShell>
  );
}