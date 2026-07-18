// Tiny typed wrapper around fetch. All components go through here so we never
// hardcode URLs in two places, and so we can normalise the "null instead of []"
// quirk the Go API has (see AGENTS.md / API contract).

// Single-object fetch. Used for endpoints like /api/analyses/{id} that return
// one JSON object (or 404). We do NOT coerce null here -- a null single object
// is a real error and should surface to the caller.
export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}`);
  }
  const body = await res.json();
  return body as T;
}

// List fetch. Every list endpoint in the Go API can return `null` instead of
// `[]` (see API contract). This helper guarantees the caller always receives
// an array, so hooks/components can safely `.map()` without a `?? []` guard.
export async function getList<T>(path: string): Promise<T[]> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}`);
  }
  const body = await res.json();
  return (body ?? []) as T[];
}

// `post` is fire-and-forget for endpoints that take no body (the
// "post-comments" endpoint reads only the route param).
export async function post(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) {
    // Try to extract the message body the API sent (plain text via http.Error).
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status} on ${path}`);
  }
}
