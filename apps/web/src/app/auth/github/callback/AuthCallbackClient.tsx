"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/app-shell";
import { Card } from "@/components/ui/card";
import { CheckCircleIcon, ArrowForwardIcon } from "@/components/icons";

// After GitHub authorizes the user, GitHub redirects the browser to whatever
// `GITHUB_CALLBACK_URL` was set to on the Go API. For this Next page to render,
// that env var must be set to `http://localhost:3000/auth/github/callback`.
//
// GitHub adds `?code=...` to that URL. We then call /api/auth/exchange, which
// next.config.ts rewrites to Go's /auth/github/callback -- Go exchanges the
// code with GitHub, upserts the user into the `users` table (so PostComments
// has a token to use), and returns {"message": "Login successful", "username": ...}.
export function AuthCallbackClient({ code }: { code: string }) {
  // Compute the "no code" error up front so the effect below doesn't need to
  // call setState synchronously -- it only runs to perform the fetch.
  const initialError = code ? null : "Missing 'code' parameter -- did you reach this page directly?";
  const [username, setUsername] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(initialError);
  const [pending, setPending] = useState(code !== "");

  useEffect(() => {
    if (!code) return;
    let cancelled = false;
    fetch(`/api/auth/exchange?code=${encodeURIComponent(code)}`, {
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
  }, [code]);

  return (
    <AppShell>
      <main className="flex-grow flex items-center justify-center px-margin-page py-16">
        <Card className="max-w-md w-full">
          <div className="p-inset-card flex flex-col items-center text-center border-b border-border-dark">
            <div
              className={`h-16 w-16 rounded-full flex items-center justify-center mb-stack-normal border ${
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
            <h2 className="font-headline-md text-headline-md text-text-primary mb-stack-dense">
              {pending ? "Authenticating..." : error ? "Authentication issue" : "Login successful"}
            </h2>
            <p className="font-code-base text-code-base text-text-muted">
              {pending
                ? "Exchanging code with GitHub..."
                : error
                ? error
                : username
                ? `Welcome, ${username}.`
                : "Session established via GitHub OAuth."}
            </p>
          </div>
          <div className="p-inset-card">
            <Link
              href="/"
              className="w-full inline-flex items-center justify-center gap-2 bg-primary text-on-primary hover:brightness-110 transition-all rounded py-2.5 px-4 font-subheading text-subheading"
            >
              Go to Dashboard
              <ArrowForwardIcon className="size-4" />
            </Link>
          </div>
        </Card>
      </main>
    </AppShell>
  );
}