import type { ReactNode } from "react";

// Reusable empty-state block: icon + title + secondary line. Used by every
// screen so "no data yet" looks intentional rather than broken.
export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center text-center px-6 py-12 bg-surface-container border border-border-dark border-dashed rounded-lg">
      {icon && <div className="text-text-muted opacity-50 mb-4">{icon}</div>}
      <p className="font-body-muted text-body-muted text-text-primary mb-2">{title}</p>
      {description && (
        <p className="font-caption text-caption text-text-muted max-w-md">{description}</p>
      )}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}