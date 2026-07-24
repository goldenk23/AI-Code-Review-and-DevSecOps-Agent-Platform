"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { useConnectRepo } from "@/hooks/use-connect-repo";

interface Props {
  onClose: () => void;
}

// Modal that lets a user type owner/repo, then automatically installs the
// GitHub webhook and registers the repo in one click.
export function ConnectRepoModal({ onClose }: Props) {
  const [value, setValue] = useState("");
  const { mutate, isPending, error, isSuccess } = useConnectRepo();

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (!trimmed) return;
    mutate(trimmed, { onSuccess: () => setTimeout(onClose, 1200) });
  }

  return (
    // Backdrop
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      {/* Panel — stop click propagation so clicking inside doesn't close */}
      <div
        className="w-full max-w-md bg-[#111] border border-border-dark rounded-xl p-6 shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="font-headline-md text-headline-md text-text-primary mb-1">
          Connect a Repository
        </h2>
        <p className="font-body-muted text-body-muted text-text-muted mb-5">
          Enter a GitHub repository you have admin access to. We&apos;ll install
          the webhook automatically.
        </p>

        <form onSubmit={handleSubmit} className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <label
              htmlFor="repo-input"
              className="font-code-sm text-code-sm text-text-muted"
            >
              Repository (owner/repo)
            </label>
            <input
              id="repo-input"
              type="text"
              autoFocus
              placeholder="e.g. goldenk23/my-app"
              value={value}
              onChange={(e) => setValue(e.target.value)}
              className="bg-[#0e0e0e] border border-border-dark rounded-lg px-3 py-2 text-text-primary font-code-sm text-code-sm focus:outline-none focus:ring-2 focus:ring-primary/50 placeholder:text-text-muted/40"
            />
          </div>

          {/* Error from GitHub or our API */}
          {error && (
            <p className="font-code-sm text-code-sm text-critical bg-critical/10 border border-critical/30 rounded-lg px-3 py-2">
              {(error as Error).message}
            </p>
          )}

          {/* Success confirmation */}
          {isSuccess && (
            <p className="font-code-sm text-code-sm text-success bg-success/10 border border-success/30 rounded-lg px-3 py-2">
              ✅ Webhook installed! Repo connected.
            </p>
          )}

          <div className="flex justify-end gap-3 pt-1">
            <Button type="button" variant="ghost" onClick={onClose} disabled={isPending}>
              Cancel
            </Button>
            <Button
              type="submit"
              variant="primary"
              disabled={isPending || !value.trim()}
            >
              {isPending ? "Connecting…" : "Connect"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
