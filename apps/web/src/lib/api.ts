// Tiny typed wrapper around fetch. All components go through here so we never
// hardcode URLs in two places, and so we can normalise the "null instead of []"
// quirk the Go API has (see AGENTS.md / API contract).

// Every list endpoint in the API can return `null` instead of `[]`. This
// helper makes sure our hooks always receive an array.
export async function get<T>(path: string): Promise<T> {
  const res = await fetch(path);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} on ${path}`);
  }
  const body = await res.json();
  return body as T;
};

// `post` is fire-and-forget for endpoints that take no body (the
// "post-comments" endpoint reads only the route param).
export async function post(path: string): Promise<void> {
  const res = await fetch(path, { method: "POST" });
  if (!res.ok) {
    // Try to extract the message body the API sent (plain text via http.Error).
    const text = await res.text();
    throw new Error(text || `HTTP ${res.status} on ${path}`);
  }
};