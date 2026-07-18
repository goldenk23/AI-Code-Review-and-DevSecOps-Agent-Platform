import { useState } from "react";
import type { ReactNode } from "react";

// Evidence block shown at the bottom of a finding card. Matches the Stitch
// run-detail design: a bordered footer area with a soft lowest-tier bg,
// mono text, horizontal scroll. Long evidence (>200 chars) is hidden behind
// a "Show evidence" disclosure so the findings list stays scannable.
export function CodeBlock({
  code,
  defaultOpen = false,
}: {
  code: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const trimmed = code.trim();
  const isLong = trimmed.length > 200;

  if (!isLong) {
    return (
      <div className="bg-surface-container-lowest border-t border-border-dark p-4 rounded-b overflow-x-auto scrollbar-hide">
        <pre className="font-code-sm text-code-sm text-text-primary leading-relaxed">
          <code>{trimmed}</code>
        </pre>
      </div>
    );
  }

  return (
    <div className="border-t border-border-dark">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 text-text-muted hover:text-text-primary font-code-sm text-code-sm transition-colors"
      >
        {open ? "Hide evidence" : "Show evidence"}
      </button>
      {open && (
        <div className="bg-surface-container-lowest px-4 pb-4 overflow-x-auto scrollbar-hide">
          <pre className="font-code-sm text-code-sm text-text-primary leading-relaxed">
            <code>{trimmed}</code>
          </pre>
        </div>
      )}
    </div>
  );
}

// A mono inline label like `src/auth.ts:12` with an optional icon.
export function MonoPath({ icon, children }: { icon?: ReactNode; children: ReactNode }) {
  return (
    <span className="font-code-sm text-code-sm text-text-muted mt-1 flex items-center gap-1">
      {icon}
      {children}
    </span>
  );
}