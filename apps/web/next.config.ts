import type { NextConfig } from "next";

// Why rewrites? The browser only ever talks to Next (localhost:3000).
// Next silently forwards /api/* to the Go API (localhost:8080), so we never
// hit CORS, never hardcode the API URL in components, and never expose the
// backend port to the client.
//
// NOTE on /auth: we proxy ONLY /auth/github (the login kickoff, which 302s
// to GitHub). We do NOT proxy /auth/github/callback -- that has its own
// Next page so we can render a friendly "Login successful" screen instead of
// raw JSON. The Next callback page exchanges the code by hitting the rewrite
// /api/auth/exchange -> Go's /auth/github/callback server-side.
const nextConfig: NextConfig = {
  async rewrites() {
    return [
      // OAuth code exchange -- called from the Next callback page's useEffect.
      // Different path from /auth/github/callback so it doesn't conflict with
      // the Next page. MUST come before the /api/:path* catch-all below --
      // Next evaluates rewrites top-down and the first matching source wins,
      // so a more specific rule placed after the catch-all is silently shadowed
      // (the request gets forwarded to /api/auth/exchange on Go, which 404s).
      { source: "/api/auth/exchange", destination: "http://localhost:8080/auth/github/callback" },
      { source: "/api/:path*", destination: "http://localhost:8080/api/:path*" },
      // Login kickoff -- Go 302s the browser to GitHub.
      { source: "/auth/github", destination: "http://localhost:8080/auth/github" },
    ];
  },
};

export default nextConfig;