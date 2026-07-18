import type { ReactNode } from "react";

// Tiny Card: 1px border, no shadow, slightly raised bg -- matches the
// "tonal layers, no shadows" rule from DESIGN.md.
export function Card({ className = "", children }: { className?: string; children: ReactNode }) {
  return (
    <div className={`bg-[#111111] border border-border-dark rounded-lg shadow-none ${className}`}>
      {children}
    </div>
  );
}

// Card with a labelled header bar -- the dominant layout in the dashboard
// (Recent runs / Run summary / Jobs / Actions).
export function CardWithHeader({ title, action, children }: { title: ReactNode; action?: ReactNode; children: ReactNode }) {
  return (
    <Card>
      <div className="px-inset-card py-3 border-b border-border-dark flex justify-between items-center">
        <h3 className="font-subheading text-subheading text-text-primary">{title}</h3>
        {action}
      </div>
      {children}
    </Card>
  );
}