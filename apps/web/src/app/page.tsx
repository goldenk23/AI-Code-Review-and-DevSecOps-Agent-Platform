// Server Component (no "use client" -- it just renders).
// We keep the page itself as a thin shell that hands off to a client
// component for the live-polling list (TanStack Query needs client hooks).
import { DashboardPage } from "@/components/run-list-table";

export default function Page() {
  return <DashboardPage />;
}