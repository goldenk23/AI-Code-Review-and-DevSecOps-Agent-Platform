import type { ReactNode } from "react";

// Soft-tinted pill: 10% bg / 30% border / 100% text of the chosen color.
// Caller supplies the exact Tailwind classes (from constants.ts) so we
// don't accidentally use a token that doesn't exist.
export function Badge({
  text,
  textCls,
  bgCls,
  borderCls,
  dot,
  pulse = false,
  icon,
}: {
  text: ReactNode;
  textCls: string;       // e.g. "text-info"
  bgCls: string;         // e.g. "bg-info/10"
  borderCls: string;     // e.g. "border-info/30"
  dot?: string;          // e.g. "bg-info" -- omit to suppress
  pulse?: boolean;       // animate the dot (used for "running" status)
  icon?: ReactNode;      // optional small icon left of the label
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${bgCls} ${borderCls} ${textCls} font-caption text-caption uppercase tracking-wider`}
    >
      {dot && (
        <span className="relative flex h-1.5 w-1.5">
          {pulse && (
            <span className={`animate-ping absolute inline-flex h-full w-full rounded-full ${dot} opacity-75`} />
          )}
          <span className={`relative inline-flex rounded-full h-1.5 w-1.5 ${dot}`} />
        </span>
      )}
      {icon}
      {text}
    </span>
  );
}