// Loading skeleton block. Use as <Skeleton className="h-4 w-24" />.
export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`bg-surface-container-high rounded animate-pulse ${className}`} aria-hidden />;
}