// Inline SVG icons -- no external font dependency, no new npm package.
// Each icon is a small React component that inherits color via `currentColor`
// and size via the `className` prop. Use like: <RefreshIcon className="size-4" />

type IconProps = { className?: string; "aria-label"?: string };

// 24x24 viewBox, stroke = currentColor, width/height controlled through className.
function Svg({ className, "aria-label": label, children }: IconProps & { children: React.ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className ?? "size-4"}
      aria-hidden={label ? undefined : true}
      role={label ? "img" : undefined}
      aria-label={label}
    >
      {children}
    </svg>
  );
}

export const RefreshIcon = (p: IconProps) => (
  <Svg {...p}><path d="M3 12a9 9 0 0 1 15-6.7L21 8" /><path d="M21 3v5h-5" /><path d="M21 12a9 9 0 0 1-15 6.7L3 16" /><path d="M3 21v-5h5" /></Svg>
);
export const CommitIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="4" /><path d="M12 4v4M12 16v4M4 12h4M16 12h4" /></Svg>
);
export const ChevronRightIcon = (p: IconProps) => (
  <Svg {...p}><path d="M9 6l6 6-6 6" /></Svg>
);
export const CommentIcon = (p: IconProps) => (
  <Svg {...p}><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></Svg>
);
export const DescriptionIcon = (p: IconProps) => (
  <Svg {...p}><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /><path d="M8 13h8M8 17h8M8 9h2" /></Svg>
);
export const TerminalIcon = (p: IconProps) => (
  <Svg {...p}><path d="M4 4h16v16H4z" /><path d="M8 9l3 3-3 3M13 15h4" /></Svg>
);
export const CheckCircleIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /><path d="M8 12l3 3 5-6" /></Svg>
);
export const PlayIcon = (p: IconProps) => (
  <Svg {...p}><path d="M6 4l14 8-14 8z" fill="currentColor" /></Svg>
);
export const GithubIcon = (p: IconProps) => (
  <svg viewBox="0 0 24 24" fill="currentColor" className={p.className ?? "size-5"} aria-label={p["aria-label"]} role={p["aria-label"] ? "img" : undefined}>
    <path clipRule="evenodd" fillRule="evenodd" d="M12 2C6.477 2 2 6.477 2 12c0 4.42 2.865 8.166 6.839 9.489.5.092.682-.217.682-.482 0-.237-.008-.866-.013-1.7-2.782.603-3.369-1.34-3.369-1.34-.454-1.156-1.11-1.463-1.11-1.463-.908-.62.069-.608.069-.608 1.003.07 1.531 1.03 1.531 1.03.892 1.529 2.341 1.087 2.91.831.092-.646.35-1.086.636-1.336-2.22-.253-4.555-1.11-4.555-4.943 0-1.091.39-1.984 1.029-2.683-.103-.253-.446-1.27.098-2.647 0 0 .84-.269 2.75 1.025A9.578 9.578 0 0112 6.836c.85.004 1.705.114 2.504.336 1.909-1.294 2.747-1.025 2.747-1.025.546 1.379.203 2.394.1 2.647.64.699 1.028 1.592 1.028 2.683 0 3.842-2.339 4.687-4.566 4.935.359.309.678.919.678 1.852 0 1.336-.012 2.415-.012 2.743 0 .267.18.578.688.48C19.138 20.161 22 16.418 22 12c0-5.523-4.477-10-10-10z" />
  </svg>
);
export const AccountCircleIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c0-4 4-6 8-6s8 2 8 6" /></Svg>
);
export const WarningIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 2l10 18H2L12 2z" /><path d="M12 9v5M12 17h.01" /></Svg>
);
export const TriangleIcon = (p: IconProps) => (
  <WarningIcon {...p} />
);
export const SquareIcon = (p: IconProps) => (
  <Svg {...p}><rect x="4" y="4" width="16" height="16" rx="2" /></Svg>
);
export const DiamondIcon = (p: IconProps) => (
  <Svg {...p}><path d="M12 2l10 10-10 10L2 12z" /></Svg>
);
export const CircleIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="9" /></Svg>
);
export const DotIcon = (p: IconProps) => (
  <Svg {...p}><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none" /></Svg>
);
export const ArrowForwardIcon = (p: IconProps) => (
  <Svg {...p}><path d="M5 12h14M13 6l6 6-6 6" /></Svg>
);