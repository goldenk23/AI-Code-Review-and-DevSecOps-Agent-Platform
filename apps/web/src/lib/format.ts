// Small formatting helpers used across the dashboard.
// We don't pull in date-fns/dayjs -- Intl + Date is enough, no new deps.

// "abc123def456..." -> "abc123d"   (7 chars is the GitHub short SHA length)
export function shortSha(sha: string): string {
  return sha.slice(0, 7);
}

// "2026-07-18T14:22:03.123456+00:00" -> "just now" / "3m ago" / "2h ago" / etc.
export function relativeTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  const diffMs = ms - Date.now();
  const diffSec = Math.round(diffMs / 1000);
  const abs = Math.abs(diffSec);

  if (abs < 5) return "just now";
  if (abs < 60) return `${Math.abs(diffSec)}s ago`;

  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  if (abs < 3600) return rtf.format(Math.round(diffSec / 60), "minute");
  if (abs < 86400) return rtf.format(Math.round(diffSec / 3600), "hour");
  if (abs < 86400 * 7) return rtf.format(Math.round(diffSec / 86400), "day");
  return rtf.format(Math.round(diffSec / (86400 * 7)), "week");
};

// "2026-07-18T14:22:03+00:00" -> "10:42 AM"  (user's local time)
export function clockTime(iso: string): string {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return iso;
  return new Date(ms).toLocaleTimeString("en-US", {
    hour: "numeric",
    minute: "2-digit",
  });
}

// Both ISO strings present? Compute "2m 14s" style duration.
// If either is missing, return "" so the caller can fall back to "in progress...".
export function duration(startedAt: string | null, completedAt: string | null): string {
  if (!startedAt || !completedAt) return "";
  const start = Date.parse(startedAt);
  const end = Date.parse(completedAt);
  if (Number.isNaN(start) || Number.isNaN(end)) return "";
  const sec = Math.max(0, Math.round((end - start) / 1000));
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  if (m < 60) return `${m}m ${s}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// 0.95 -> "0.95". null -> "—".
export function confidence(c: number | null): string {
  if (c === null || c === undefined) return "—";
  return c.toFixed(2);
}

// Render a file path with optional line suffix.
//   ("src/auth.ts", 12, null)    -> "src/auth.ts:12"
//   ("src/auth.ts", 12, 58)      -> "src/auth.ts:12-58"
//   ("package.json", null, null) -> "package.json"
export function filePathWithLines(filePath: string, lineStart: number | null, lineEnd: number | null): string {
  if (lineStart === null) return filePath;
  if (lineEnd === null || lineEnd === lineStart) return `${filePath}:${lineStart}`;
  return `${filePath}:${lineStart}-${lineEnd}`;
}