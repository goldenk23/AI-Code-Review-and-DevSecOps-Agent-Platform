import type { ReactNode } from "react";

// Shape options for the status dot. circle/square are simple rounded
// variants; triangle/diamond/hexagon use CSS clip-path for colorblind-safe
// geometric severity indicators (per DESIGN.md).
export type DotShape = "circle" | "square" | "diamond" | "triangle" | "hexagon";

// clip-path polygons for the non-circle/square shapes.
const CLIP_PATH: Partial<Record<DotShape, string>> = {
  triangle: "polygon(50% 0%, 0% 100%, 100% 100%)",
  diamond: "polygon(50% 0%, 100% 50%, 50% 100%, 0% 50%)",
  hexagon: "polygon(50% 0%, 100% 25%, 100% 75%, 50% 100%, 0% 75%, 0% 25%)",
};

function DotGeometry({ shape, colorCls, pulse }: { shape: DotShape; colorCls: string; pulse?: boolean }) {
  const isRounded = shape === "circle" ? "rounded-full" : shape === "square" ? "rounded-sm" : "";
  const clipPath = CLIP_PATH[shape] ?? "none";

  return (
    <span className="relative flex items-center justify-center w-2 h-2">
      {pulse && (
        <span
          className={`animate-ping absolute top-0 left-0 h-full w-full opacity-75 ${colorCls} ${isRounded}`}
          style={{ clipPath: clipPath === "none" ? undefined : clipPath }}
        />
      )}
      <span
        className={`relative inline-flex h-full w-full ${colorCls} ${isRounded}`}
        style={{ clipPath: clipPath === "none" ? undefined : clipPath }}
      />
    </span>
  );
}

// Soft-tinted pill: 10% bg / 30% border / 100% text of the chosen color.
// Caller supplies the exact Tailwind classes (from constants.ts) so we
// don't accidentally use a token that doesn't exist.
export function Badge({
  text,
  textCls,
  bgCls,
  borderCls,
  dot,
  dotShape = "circle",
  pulse = false,
  icon,
}: {
  text: ReactNode;
  textCls: string;       // e.g. "text-info"
  bgCls: string;         // e.g. "bg-info/10"
  borderCls: string;     // e.g. "border-info/30"
  dot?: string;          // e.g. "bg-info" -- omit to suppress
  dotShape?: DotShape;
  pulse?: boolean;       // animate the dot (used for "running" status)
  icon?: ReactNode;      // optional small icon left of the label
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded border ${bgCls} ${borderCls} ${textCls} font-caption text-caption uppercase tracking-wider`}
    >
      {dot && <DotGeometry shape={dotShape} colorCls={dot} pulse={pulse} />}
      {icon}
      {text}
    </span>
  );
}