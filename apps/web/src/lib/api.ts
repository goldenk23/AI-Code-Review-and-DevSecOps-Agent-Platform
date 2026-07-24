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

// `put` sends a JSON body and returns the server's response JSON. Used by
// the Automation page's settings save (partial update where the server
// echoes back the full updated row so the caller can cache-put it).
export async function put<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

// `postJson` sends a JSON body and returns the server's response JSON.
export async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status} on ${path}`);
  }
  return res.json() as Promise<T>;
}

// `del` sends a DELETE request. Returns nothing (204 expected).
export async function del(path: string): Promise<void> {
  const res = await fetch(path, { method: "DELETE" });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status} on ${path}`);
  }
}
