import { AppShell } from "@/components/app-shell";
import { EmptyState } from "@/components/ui/empty-state";
import Link from "next/link";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <AppShell>
      <main className="flex-grow w-full max-w-container-max mx-auto px-margin-page py-16">
        <EmptyState
          title="Not found"
          description="This page or run doesn't exist."
          action={
            <Link href="/">
              <Button variant="primary">Back to dashboard</Button>
            </Link>
          }
        />
      </main>
    </AppShell>
  );
}