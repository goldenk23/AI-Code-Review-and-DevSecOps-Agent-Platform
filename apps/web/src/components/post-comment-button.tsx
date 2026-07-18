"use client";
import { useState } from "react";
import type { RunStatus } from "@/lib/types";
import { usePostComment } from "@/hooks/use-post-comment";
import { Button } from "@/components/ui/button";
import { CommentIcon, CheckIcon } from "@/components/icons";

// Disabled while the run is queued/running (no findings yet to post about).
// On success: brief inline confirmation with a checkmark icon that auto-clears.
// On error: red text under the button with the API's error message.
export function PostCommentButton({ runId, runStatus }: { runId: number; runStatus: RunStatus }) {
  const mutation = usePostComment(runId);
  const [showSuccess, setShowSuccess] = useState(false);

  const isRunning = runStatus === "running" || runStatus === "queued";

  async function handleClick() {
    try {
      await mutation.mutateAsync();
      setShowSuccess(true);
      setTimeout(() => setShowSuccess(false), 3_000);
    } catch {
      // mutation.isError will be set; the UI below renders the message.
    }
  }

  return (
    <div className="flex flex-col gap-2">
      <Button
        variant="primary"
        className="w-full"
        onClick={handleClick}
        disabled={isRunning || mutation.isPending}
        title={isRunning ? "Run still in progress" : undefined}
      >
        <CommentIcon className="size-4" />
        {mutation.isPending ? "Posting..." : "Post comment to PR"}
      </Button>
      {showSuccess && (
        <p className="font-caption text-caption text-success flex items-center gap-1">
          <CheckIcon className="size-3" />
          Comment posted
        </p>
      )}
      {mutation.isError && (
        <p className="font-caption text-caption text-critical">
          {mutation.error instanceof Error ? mutation.error.message : "Failed to post comment"}
        </p>
      )}
    </div>
  );
}