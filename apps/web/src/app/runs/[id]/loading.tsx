import { AppShell } from "@/components/app-shell";
import { Skeleton } from "@/components/ui/skeleton";

// Route-level loading state for /runs/[id]. Same idea as app/loading.tsx.
export default function Loading() {
  return (
    <AppShell>
      <div className="max-w-container-max mx-auto px-margin-page py-8 w-full flex flex-col md:flex-row gap-gutter">
        <main className="w-full md:w-[70%] flex flex-col gap-6">
          <Skeleton className="h-5 w-32 mb-2" />
          <Skeleton className="h-8 w-64 mb-3" />
          <Skeleton className="h-4 w-48 mb-6" />
          <Skeleton className="h-96" />
        </main>
        <aside className="w-full md:w-[30%] flex flex-col gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-60" />
          <Skeleton className="h-32" />
        </aside>
      </div>
    </AppShell>
  );
}