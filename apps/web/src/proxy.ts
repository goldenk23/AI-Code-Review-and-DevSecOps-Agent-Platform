import { createHmac, timingSafeEqual } from "node:crypto";
import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Server-side gate. Verifies the API-issued `cp-session` HMAC and expiry before
// protected routes render. Invalid sessions go to /login; valid sessions skip it.
//
// Why proxy.ts and not a client `useEffect` redirect: proxy runs on the edge
// before any HTML is sent, so there's NO flash of unstyled dashboard content
// before the login redirect fires. In Next 16, `middleware.ts` was renamed
// to `proxy.ts` (same API, new name).
//
// Note: we don't carry a `?next=` through the GitHub OAuth flow because the
// backend's GITHUB_CALLBACK_URL is a fixed env value and can't be augmented
// from here. After login the user always lands on "/" -- simpler and good
// enough for a single-dashboard app.

// Routes that should ALWAYS be reachable regardless of auth state.
//
// `/api/auth/exchange` must stay public: it trades the one-time GitHub code and
// state cookie for the signed HttpOnly session. Session status/logout validate
// or clear that cookie themselves.
const PUBLIC_PATHS = [
  "/login",
  "/auth/github",
  "/auth/github/callback",
  "/api/auth/exchange",
  "/api/auth/session",
  "/api/auth/logout",
];

type SessionClaims = { uid: number; username: string; exp: number };

function isAllowedUsername(username: string): boolean {
  const configured = process.env.ALLOWED_GITHUB_USERS?.trim();
  if (!configured) {
    const environment = process.env.ENVIRONMENT?.toLowerCase() ?? "development";
    return environment === "development" || environment === "test";
  }
  return configured.split(",").some((allowed) => allowed.trim().toLowerCase() === username.toLowerCase());
}

function hasValidSession(token: string | undefined): boolean {
  const secret = process.env.SESSION_SECRET;
  if (!token || !secret || secret.length < 32) return false;
  try {
    const [payload, signature, extra] = token.split(".");
    if (!payload || !signature || extra) return false;
    const actual = Buffer.from(signature, "base64url");
    const expected = createHmac("sha256", secret).update(payload).digest();
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) return false;
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as SessionClaims;
    return Number.isInteger(claims.uid) && claims.uid > 0 && Boolean(claims.username) && claims.exp > Date.now() / 1000 && isAllowedUsername(claims.username);
  } catch {
    return false;
  }
}

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = hasValidSession(request.cookies.get("cp-session")?.value);

  // Authenticated user trying to visit /login -> bounce them to the dashboard.
  if (authed && pathname === "/login") {
    const url = request.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  // Unauthenticated user hitting a protected route -> send to /login.
  if (!authed && !isPublic(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  // Rewrite server-side at request time so one image can use a different
  // API_INTERNAL_URL in every deployment. Strip caller-supplied service
  // headers before injecting the real key.
  let upstreamPath: string | null = null;
  if (pathname === "/auth/github") upstreamPath = "/auth/github";
  else if (pathname === "/api/auth/exchange") upstreamPath = "/auth/github/callback";
  else if (pathname === "/api/auth/session") upstreamPath = "/auth/session";
  else if (pathname === "/api/auth/logout") upstreamPath = "/auth/logout";
  else if (pathname.startsWith("/api/")) upstreamPath = pathname;

  if (upstreamPath) {
    const target = new URL(upstreamPath, process.env.API_INTERNAL_URL ?? "http://localhost:8080");
    target.search = request.nextUrl.search;
    const headers = new Headers(request.headers);
    headers.delete("x-api-key");
    headers.delete("x-internal-request");
    const apiKey = process.env.API_KEY;
    if (apiKey) headers.set("x-api-key", apiKey);
    return NextResponse.rewrite(target, { request: { headers } });
  }

  return NextResponse.next();
}

export const config = {
  // Run on every request except Next's internal asset pipelines + favicon.
  // (Matchers are positive: matched paths run the proxy, excluded paths skip it.)
  matcher: [
    "/((?!_next/static|_next/image|_next/dev|favicon.ico|icon-light-32x32.png|icon-dark-32x32.png|icon.svg|apple-icon.png).*)",
  ],
};