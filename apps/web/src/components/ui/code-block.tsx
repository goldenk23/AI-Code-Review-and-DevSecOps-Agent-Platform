import { useState } from "react";
import type { ReactNode } from "react";

// "Show evidence" disclosure used inside a finding card. Hidden by default
// to keep the dashboard scrollable; expands inline when clicked.
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
      <pre className="font-code-sm text-code-sm text-text-primary leading-relaxed bg-surface-container-lowest border-t border-border-dim p-4 overflow-x-auto scrollbar-hide">
        <code>{trimmed}</code>
      </pre>
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
        <pre className="font-code-sm text-code-sm text-text-primary leading-relaxed bg-surface-container-lowest px-4 pb-4 overflow-x-auto scrollbar-hide">
          <code>{trimmed}</code>
        </pre>
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