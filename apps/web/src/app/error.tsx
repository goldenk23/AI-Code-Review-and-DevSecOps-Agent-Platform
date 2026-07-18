"use client";
import { AppShell } from "@/components/app-shell";
import { Button } from "@/components/ui/button";
import { ErrorIcon } from "@/components/icons";

// Route-level error boundary for the dashboard index. Catches render errors
// AND server component failures for "/" and its children. Next passes the
// error + a reset() callback; we show a red-tinted card with a Retry button.
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
          <p className="font-subheading text-subheading text-critical">Something went wrong</p>
          <p className="font-code-sm text-code-sm text-text-muted max-w-sm">
            {error.message || "An unexpected error occurred while loading this page."}
          </p>
          <Button variant="ghost" onClick={reset}>
            Try again
          </Button>
        </div>
      </main>
    </AppShell>
  );
}