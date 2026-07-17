"use client";

import { useQuery } from "@tanstack/react-query";

type Analysis = {
  id: number;
  status: string;
  trigger: string;
  commit_sha: string;
  created_at: string;
};

async function fetchAnalyses(): Promise<Analysis[]> {
  const res = await fetch("http://localhost:8080/api/analyses");
  if (!res.ok) throw new Error("Failed to fetch");
  return res.json();
}

export default function Home() {
  const { data, isLoading, error } = useQuery({
    queryKey: ["analyses"],
    queryFn: fetchAnalyses,
    refetchInterval: 5000,
  });

  return (
    <main className="max-w-4xl mx-auto p-8">
      <h1 className="text-2xl font-bold mb-6">AI Code Review Dashboard</h1>
      {isLoading && <p>Loading...</p>}
      {error && <p className="text-red-500">Error: {error.message}</p>}
      {data && data.length === 0 && (
        <p className="text-gray-500">No analyses yet. Open a PR to trigger one!</p>
      )}
      {data && data.length > 0 && (
        <table className="w-full border-collapse">
          <thead>
            <tr className="border-b">
              <th className="text-left p-2">Run #</th>
              <th className="text-left p-2">Status</th>
              <th className="text-left p-2">Trigger</th>
              <th className="text-left p-2">Commit</th>
              <th className="text-left p-2">Created</th>
            </tr>
          </thead>
          <tbody>
            {data.map((run) => (
              <tr key={run.id} className="border-b hover:bg-gray-50">
                <td className="p-2">#{run.id}</td>
                <td className="p-2">
                  <span className={`px-2 py-1 rounded text-sm ${
                    run.status === "completed" ? "bg-green-100 text-green-800" :
                    run.status === "running" ? "bg-blue-100 text-blue-800" :
                    run.status === "failed" ? "bg-red-100 text-red-800" :
                    "bg-gray-100 text-gray-800"
                  }`}>{run.status}</span>
                </td>
                <td className="p-2">{run.trigger}</td>
                <td className="p-2 font-mono text-sm">{run.commit_sha.slice(0, 7)}</td>
                <td className="p-2 text-sm text-gray-500">{run.created_at}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}