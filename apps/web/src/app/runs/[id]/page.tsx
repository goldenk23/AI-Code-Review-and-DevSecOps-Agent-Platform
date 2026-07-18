// Server Component. Awaits the dynamic route param -- in Next 16 `params` is a
// Promise, so we MUST `await` it (sync access was removed in v15+).
import { notFound } from "next/navigation";
import { RunDetailView } from "@/components/run-detail-view";

export default async function RunPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const runId = Number(id);
  if (Number.isNaN(runId)) {
    // notFound() renders the closest not-found.tsx -- a friendly 404.
    notFound();
  }
  return <RunDetailView runId={runId} />;
}