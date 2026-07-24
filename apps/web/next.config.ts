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
// Server-side rewrite target for the Go API. Defaults to localhost for
// `npm run dev`; docker-compose sets API_INTERNAL_URL=http://api:8080 so the
// Next container reaches the API container by service name. Rewrites run
// server-side, so the BROWSER still only ever talks to Next (same origin).
const nextConfig: NextConfig = {
  output: "standalone", // slim self-contained server.js for the Docker image
};

export default nextConfig;