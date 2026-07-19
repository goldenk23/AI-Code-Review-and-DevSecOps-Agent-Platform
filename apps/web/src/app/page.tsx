// Server Component (no "use client" -- it just renders).
// We keep the page itself as a thin shell that hands off to a client
// component for the live-polling list (TanStack Query needs client hooks).
//
// `useSearchParams` inside DashboardPage requires a Suspense boundary in
// Next 16 -- without it the route opts into static rendering and the
// hook throws. The Suspense fallback here is intentionally minimal
// because the inner component shows its own skeleton immediately.
import { Suspense } from "react";
import { DashboardPage } from "@/components/run-list-table";

export default function Page() {
  return (
    <Suspense fallback={null}>
      <DashboardPage />
    </Suspense>
  );
}