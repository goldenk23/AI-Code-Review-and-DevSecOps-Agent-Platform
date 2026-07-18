"use client";
import { GithubIcon } from "./icons";

// Plain anchor to /auth/github. The Go API endpoint returns a 302 redirect to
// GitHub -- letting the browser follow it is the simplest, most reliable flow
// (server-side fetch would not let the browser land at GitHub's login page).
// After the user authorizes, GitHub returns to /auth/github/callback -- see the
// `auth/github/callback/page.tsx` route.
export function GithubLoginButton({ className = "" }: { className?: string }) {
  return (
    <a
      href="/auth/github"
      className={`inline-flex items-center justify-center gap-2 bg-text-primary text-background hover:brightness-90 transition-all rounded py-2.5 px-4 font-subheading text-subheading ${className}`}
    >
      <GithubIcon className="size-5" />
      <span>Sign in with GitHub</span>
    </a>
  );
}