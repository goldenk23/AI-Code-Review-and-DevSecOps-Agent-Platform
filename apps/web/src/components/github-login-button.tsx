"use client";
import { useSyncExternalStore } from "react";
import { GithubIcon, LogoutIcon } from "./icons";

// Top-nav auth control. Behaviour depends on whether the `cp-authed` cookie
// (set by the OAuth callback page) is present:
//
//   - Signed OUT  -> <a href="/auth/github">  "Sign in with GitHub"
//     Plain anchor to /auth/github (proxied to Go's OAuth kickoff by
//     next.config.ts rewrites). The browser follows the 302 to GitHub.
//
//   - Signed IN   -> <button>                 "Sign out"
//     Client-side handler deletes the cookie + bounces to /login, at which
//     point proxy.ts blocks further dashboard access. We DO NOT call a
//     backend /logout endpoint -- none exists on the Go API.
//
// useSyncExternalStore lets us read document.cookie (browser-only, no value
// during SSR) without a hydration mismatch: the server snapshot is always
// `false` (we render the signed-out variant during SSR), and the client
// snapshot re-evaluates whenever the cookie store changes.
function subscribeCookie(callback: () => void) {
  // document.cookie doesn't fire events, but window.focus catches the case
  // where the user signs back in from another tab. Cheap and good enough.
  window.addEventListener("focus", callback);
  return () => window.removeEventListener("focus", callback);
}
function getCookieClient(): boolean {
  return document.cookie.split("; ").includes("cp-authed=1");
}
function getCookieServer(): boolean {
  // SSR can't see document -- render the signed-out variant; the client
  // will reconcile on hydration.
  return false;
}

export function GithubLoginButton({ className = "" }: { className?: string }) {
  const authed = useSyncExternalStore(subscribeCookie, getCookieClient, getCookieServer);

  if (authed) {
    return (
      <button
        type="button"
        onClick={() => {
          document.cookie = "cp-authed=; path=/; max-age=0; SameSite=Lax";
          // Hard navigation so proxy.ts re-evaluates without the cookie.
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