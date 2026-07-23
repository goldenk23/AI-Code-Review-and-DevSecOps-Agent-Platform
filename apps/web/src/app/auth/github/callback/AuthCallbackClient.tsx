"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { CheckCircleIcon, ArrowForwardIcon, TerminalIcon } from "@/components/icons";

// Go validates the OAuth state, exchanges the code, syncs repository access,
// sets the signed HttpOnly session, and returns the username. On success this
// page redirects to the dashboard after a short confirmation.

// After GitHub authorizes the user, GitHub redirects the browser to whatever
// `GITHUB_CALLBACK_URL` was set to on the Go API. For this Next page to render,
// that env var must be set to `http://localhost:3000/auth/github/callback`.
//
// GitHub adds `?code=...` to that URL. We then call /api/auth/exchange, which
// next.config.ts rewrites to Go's /auth/github/callback -- Go exchanges the
// code with GitHub, upserts the user into the `users` table (so PostComments
// has a token to use), and returns {"message": "Login successful", "username": ...}.
//
// The visual treatment matches the Stitch auth design: a terminal-feel card on
// a subtle grid background with soft indigo orbs, a status header, and a mock
// terminal output block that ticks through the OAuth exchange steps.
export function AuthCallbackClient({ code, state, nextPath }: { code: string; state: string; nextPath: string }) {
  const initialError = code && state ? null : "Missing OAuth code or state -- restart sign-in from the login page.";
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(code !== "" && state !== "");
  const router = useRouter();

  // GitHub OAuth codes are SINGLE-USE. In React StrictMode (Next dev), effects
  // fire twice; without this guard the second fetch re-submits the same code
  // and GitHub returns "bad_verification_code", surfacing as
  // "Retrieving user context... FAILED". The ref ensures we only exchange once.
  const exchangedRef = useRef(false);

  useEffect(() => {
    if (!code || !state || exchangedRef.current) return;
    exchangedRef.current = true;
    let cancelled = false;
    fetch(`/api/auth/exchange?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`, {
      headers: { Accept: "application/json" },
    })
      .then(async (res) => {
        const text = await res.text();
        if (cancelled) return;
        try {
          const data = JSON.parse(text);
          if (!res.ok) {
            setError(data.message || data.error || `Login failed (HTTP ${res.status})`);
            return;
          }
          setUsername(data.username ?? "unknown");
        } catch {
          setError(text || `Login failed (HTTP ${res.status})`);
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => {
        if (!cancelled) setPending(false);
      });
    return () => {
      cancelled = true;
    };
  }, [code, state]);

  // Auto-redirect to the dashboard ~1.5s after we've confirmed success.
  // The visible terminal card stays in place as a fallback for slow/no-JS.
  useEffect(() => {
    if (!username || error) return;
    const t = setTimeout(() => router.replace(nextPath), 1500);
    return () => clearTimeout(t);
  }, [username, error, router, nextPath]);

  const status = pending
    ? "Exchanging code with GitHub..."
    : error
    ? error
    : username
    ? `Welcome, ${username}.`
    : "Session established via GitHub OAuth.";
  const statusColor = error ? "text-medium" : "text-success";

  return (
    <div className="min-h-screen flex flex-col relative overflow-hidden">
      {/* Atmospheric background -- grid + indigo orbs (matches the Stitch auth screen). */}
      <div className="absolute inset-0 bg-grid-pattern z-0" />
      <div className="blur-orb top-[-100px] left-[-100px]" />
      <div
        className="blur-orb bottom-[-150px] right-[-50px]"
        style={{ background: "radial-gradient(circle, rgba(135, 137, 245, 0.1) 0%, rgba(19, 19, 19, 0) 70%)" }}
      />

      <AppShell>
        <main className="flex-1 flex items-center justify-center px-margin-page py-16 z-10 relative">
          <Card className="max-w-md w-full shadow-2xl">
            {/* Header */}
            <div className="p-inset-card flex flex-col items-center text-center border-b border-border-dark relative overflow-hidden">
              {error ? null : <div className="absolute inset-0 bg-success/5 z-0" />}
              <div
                className={`h-16 w-16 rounded-full flex items-center justify-center mb-stack-normal border z-10 relative ${
                  error
                    ? "bg-critical/10 border-critical/30 text-critical"
                    : "bg-success/10 border-success/30 text-success"
                }`}
              >
                {pending ? (
                  <span className="animate-pulse font-headline-md text-headline-md">…</span>
                ) : error ? (
                  <span className="font-headline-lg text-headline-lg">!</span>
                ) : (
                  <CheckCircleIcon className="size-9" />
                )}
              </div>
              <h2 className="font-headline-md text-headline-md text-text-primary mb-stack-dense z-10 relative">
                {pending ? "Authenticating..." : error ? "Authentication issue" : "Authentication Successful"}
              </h2>
              <p className="font-code-base text-code-base text-text-muted z-10 relative">{status}</p>
            </div>

            {/* Body -- terminal output + CTA */}
            <div className="p-inset-card flex flex-col gap-stack-normal">
              <div className="bg-background border border-border-dark rounded p-3 font-code-sm text-code-sm text-text-muted flex flex-col gap-1">
                <div className="flex items-center gap-2">
                  <span className="text-success">✔</span>
                  <span>Validating token payload... {pending ? "..." : "OK"}</span>
                </div>
                <div className="flex items-center gap-2">
                  <span className={error ? "text-critical" : "text-success"}>{error ? "✘" : "✔"}</span>
                  <span>Retrieving user context... {error ? "FAILED" : "OK"}</span>
                </div>
                <div className={`flex items-center gap-2 ${error ? "opacity-40" : ""}`}>
                  <span className={error ? "text-critical" : "text-success"}>{error ? "✘" : "✔"}</span>
                  <span>Syncing repository manifest... {error ? "SKIPPED" : "OK"}</span>
                </div>
                <div className="flex items-center gap-2 mt-2">
                  <span className="text-primary">{">"}</span>
                  <span className={`text-text-primary ${pending ? "animate-pulse" : ""}`}>
                    {error ? "Returning to login_" : "Routing to Dashboard_"}
                  </span>
                </div>
              </div>

              <Link
                href={nextPath}
                className="w-full inline-flex items-center justify-center gap-2 bg-primary text-on-primary hover:brightness-110 transition-all rounded py-2.5 px-4 font-subheading text-subheading mt-2"
              >
                Go to Dashboard
                <ArrowForwardIcon className="size-4" />
              </Link>
            </div>

            {/* Footer status bar */}
            <div className="p-4 bg-background border-t border-border-dark rounded-b-lg font-code-sm text-code-sm text-text-muted flex items-center justify-between">
              <span>
                Status: <span className={statusColor}>{error ? "Error" : pending ? "Connecting" : "Connected"}</span>
              </span>
              <span className="inline-flex items-center gap-1">
                <TerminalIcon className="size-3" /> v2.4.1
              </span>
            </div>
          </Card>
        </main>
      </AppShell>
    </div>
  );
}