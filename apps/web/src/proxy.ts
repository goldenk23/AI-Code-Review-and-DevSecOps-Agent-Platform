import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

// Server-side gate. Reads the `cp-authed` cookie (set by the OAuth callback
// page after a successful GitHub login) and redirects:
//   - unauthenticated users hitting a protected route -> /login
//   - authenticated users hitting /login                -> /
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
// `/api/auth/exchange` MUST be here: the OAuth callback page (which has no
// `cp-authed` cookie yet, since the cookie is set only AFTER a successful
// exchange) fetches this endpoint to trade the one-time GitHub code for our
// session cookie. If it isn't public, proxy.ts 307s the fetch to /login, the
// fetch follows the redirect, gets back the login page HTML, JSON.parse throws,
// and the user sees "Retrieving user context... FAILED" instead of logging in.
const PUBLIC_PATHS = ["/login", "/auth/github", "/auth/github/callback", "/api/auth/exchange"];

function isPublic(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p + "/"));
}

export function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const authed = request.cookies.get("cp-authed")?.value === "1";

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

  // For dashboard->API calls that Next rewrites to the Go API, inject the
  // shared API key server-side. The browser never sees it (this runs on the
  // server), and the Go API rejects any /api request without it -- so hitting
  // the API host directly, bypassing this proxy, fails. Setting it via
  // `request.headers` propagates the header upstream to the rewrite target.
  if (pathname.startsWith("/api/")) {
    const apiKey = process.env.API_KEY;
    if (apiKey) {
      const headers = new Headers(request.headers);
      headers.set("x-api-key", apiKey);
      return NextResponse.next({ request: { headers } });
    }
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