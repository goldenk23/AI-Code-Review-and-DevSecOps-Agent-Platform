"use client";
import { useEffect, useState } from "react";
import { GithubIcon, LogoutIcon } from "./icons";

// The browser cannot read the HttpOnly session cookie. Query the API's session
// endpoint to choose the control, and use its logout endpoint to clear it.
export function GithubLoginButton({ className = "" }: { className?: string }) {
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    fetch("/api/auth/session", { headers: { Accept: "application/json" } })
      .then((response) => setAuthed(response.ok))
      .catch(() => setAuthed(false));
  }, []);

  if (authed) {
    return (
      <button
        type="button"
        onClick={async () => {
          await fetch("/api/auth/logout", { method: "POST" });
          window.location.href = "/login";
        }}
        className={`inline-flex items-center justify-center gap-2 bg-surface-container-low text-text-primary border border-border-dark hover:bg-surface-container-highest transition-colors duration-200 ease-in-out rounded px-4 py-2 font-body-muted text-body-muted ${className}`}
      >
        <LogoutIcon className="size-[18px]" />
        Sign out
      </button>
    );
  }

  return (
    <a
      href="/auth/github"
      className={`inline-flex items-center justify-center gap-2 bg-surface-container-low text-text-primary border border-border-dark hover:bg-surface-container-highest transition-colors duration-200 ease-in-out rounded px-4 py-2 font-body-muted text-body-muted ${className}`}
    >
      <GithubIcon className="size-[18px]" />
      Sign in with GitHub
    </a>
  );
}