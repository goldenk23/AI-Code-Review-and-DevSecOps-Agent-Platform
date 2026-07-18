"use client";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ErrorIcon } from "@/components/icons";

// Route-level error boundary for /runs/[id]. Catches render errors in the
// detail view (e.g. a bad run id that slipped past notFound()). We offer a
// "Try again" button (reset) and a link back to the dashboard.
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-16">
        <div className="flex flex-col items-center justify-center text-center gap-3 border border-critical/30 bg-critical/5 rounded-lg p-8 max-w-md mx-auto">
          <ErrorIcon className="size-10 text-critical" />
          <p className="font-subheading text-subheading text-critical">{"Couldn't load this run"}</p>
          <p className="font-code-sm text-code-sm text-text-muted max-w-sm">
            {error.message || "An unexpected error occurred while loading this run."}
          </p>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={reset}>
              Try again
            </Button>
            <Link href="/">
              <Button variant="primary">Back to dashboard</Button>
            </Link>
          </div>
        </div>
      </main>
    </AppShell>
  );
}