"use client";
import { useState } from "react";
import { GithubIcon, TerminalIcon } from "@/components/icons";

// Full-viewport login screen -- visual design transcribed from
// design-reference/authentication_github_login/SPEC.md. NO AppShell / nav bar
// (per the spec). The card is a 545px wide centered tile with three regions
// (header / form / footer) sitting on a grid-pattern + indigo-orb background.
//
// Functional paths:
//   - "Sign in with GitHub" -> <a href="/auth/github"> (proxied to Go's OAuth
//     kickoff by next.config.ts rewrites). The browser follows the 302 to
//     GitHub. After authorizing, GitHub redirects to /auth/github/callback,
//     which sets the `cp-authed` cookie and bounces back to ?next= or /.
//   - "ACCESS TOKEN" + "Authenticate via CLI" -> visual only. The backend has
//     no token-based auth endpoint, so these controls render but don't fire.
//     (They're not even buttons in the failed sense -- they're disabled, with
//     a tooltip, to honor the design without inventing endpoints.)
export function LoginScreen() {
  const [status, setStatus] = useState<"awaiting" | "redirecting">("awaiting");

  function onGithubClick() {
    setStatus("redirecting");
    // Don't preventDefault -- the <a href="/auth/github"> does the real work
    // (302 to GitHub, handled browser-side). State just drives the footer
    // "Connecting…" label while the navigation is in flight.
  }

  return (
    <main className="relative min-h-screen flex items-center justify-center bg-[#0e0e0e] text-text-primary font-body-base overflow-hidden">
      {/* Atmospheric background: faint 40px grid + two soft indigo orbs. */}
      <div className="absolute inset-0 bg-grid-pattern z-0" />
      <div
        className="blur-orb"
        style={{
          top: "-100px",
          left: "-100px",
          background: "radial-gradient(circle, rgba(192,193,255,0.15) 0%, rgba(14,14,14,0) 70%)",
        }}
      />
      <div
        className="blur-orb"
        style={{
          bottom: "-150px",
          right: "-50px",
          background: "radial-gradient(circle, rgba(135,137,245,0.10) 0%, rgba(14,14,14,0) 70%)",
        }}
      />

      {/* Centered auth card */}
      <div className="relative z-10 w-full max-w-[545px] mx-4 bg-[#161616] border border-border-dark rounded-xl flex flex-col overflow-hidden">
        {/* 1. Header region */}
        <div className="px-10 pt-10 pb-8 flex flex-col items-center text-center">
          <div className="w-14 h-14 rounded border border-border-dark bg-[#232323] flex items-center justify-center mb-5">
            <TerminalIcon className="text-[28px] text-primary" />
          </div>
          <h1 className="font-headline-lg text-headline-lg text-text-primary">
            Sign in to CodePulse AI
          </h1>
          <p className="font-body-muted text-body-muted text-text-muted mt-2 max-w-[400px]">
            Secure your repositories with AI-powered DevSecOps analysis.
          </p>
        </div>

        {/* 2. Form region (separated by 1px divider) */}
        <div className="border-t border-border-dark px-8 py-8 flex flex-col gap-5">
          {/* Primary: white bg, black text -> the real OAuth kickoff link */}
          <a
            href="/auth/github"
            onClick={onGithubClick}
            className="w-full inline-flex items-center justify-center gap-3 bg-white text-black font-body-base text-body-base font-semibold rounded-md py-3.5 px-4 hover:bg-white/90 transition-all active:scale-[0.99]"
          >
            <GithubIcon className="size-5" />
            Sign in with GitHub
          </a>

          {/* Divider row: lines either side of "OR ENTER SECRETS" */}
          <div className="flex items-center gap-3 my-1">
            <div className="flex-1 h-px bg-border-dark" />
            <span className="font-code-sm text-code-sm text-text-muted uppercase tracking-wider">
              OR ENTER SECRETS
            </span>
            <div className="flex-1 h-px bg-border-dark" />
          </div>

          {/* Field label */}
          <label
            htmlFor="access-token"
            className="font-code-sm text-code-sm text-text-muted uppercase tracking-wider"
          >
            ACCESS TOKEN
          </label>

          {/* Input -- visual only; no endpoint to authenticate with */}
          <div className="relative">
            <span
              className="absolute left-3 top-1/2 -translate-y-1/2 text-primary font-code-base text-code-base pointer-events-none"
              aria-hidden
            >
              &gt;
            </span>
            <input
              id="access-token"
              type="password"
              placeholder="ghp_***********************"
              disabled
              title="Token-based auth is not wired up yet -- use GitHub OAuth above"
              className="w-full bg-[#0a0a0a] border border-border-dark rounded font-code-base text-code-base text-text-primary pl-8 pr-4 py-2.5 placeholder-text-muted focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
            />
          </div>

          {/* Secondary button -- visual only */}
          <button
            type="button"
            disabled
            title="CLI authentication is not wired up yet -- use GitHub OAuth above"
            className="w-full inline-flex items-center justify-center gap-2 bg-[#232323] border border-border-dark text-white font-body-base text-body-base font-bold rounded-md py-3.5 px-4 hover:bg-[#2a2a2a] transition-colors disabled:opacity-70 disabled:cursor-not-allowed"
          >
            Authenticate via CLI
          </button>
        </div>

        {/* 3. Footer strip */}
        <div className="bg-[#0e0e0e] border-t border-border-dark px-6 py-4 flex items-center justify-between">
          <span className="font-code-sm text-code-sm text-text-muted">
            Status:{" "}
            {status === "redirecting" ? (
              <span className="text-info">Connecting…</span>
            ) : (
              <span className="text-medium">Awaiting Credentials</span>
            )}
          </span>
          <span className="font-code-sm text-code-sm text-text-muted">v2.4.1</span>
        </div>
      </div>
    </main>
  );
}