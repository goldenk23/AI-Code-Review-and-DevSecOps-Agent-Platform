"use client";
import { useState } from "react";
import type { ReactNode } from "react";
import type { Finding } from "@/lib/types";
import { SEVERITY_STYLES, VERIFICATION_STYLES } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { CodeBlock, MonoPath } from "@/components/ui/code-block";
import {
  DescriptionIcon,
  WarningIcon,
  TriangleIcon,
  SquareIcon,
  DiamondIcon,
  CircleIcon,
} from "@/components/icons";
import { confidence, filePathWithLines } from "@/lib/format";

// Each severity gets its own little icon so the badging still works for
// colorblind users (the DESIGN.md "geometric icon per severity" rule).
const SEVERITY_ICON: Record<string, React.ComponentType<{ className?: string }>> = {
  critical: DiamondIcon,
  high: WarningIcon,
  medium: TriangleIcon,
  low: SquareIcon,
  info: CircleIcon,
};

// Color the confidence value by the thresholds in the design system:
// >=0.9 strong (success), 0.5-0.9 medium (amber), <0.5 weak (muted).
function confidenceColor(c: number | null): string {
  if (c === null) return "text-text-muted";
  if (c >= 0.9) return "text-success";
  if (c >= 0.5) return "text-medium";
  return "text-text-muted";
}

// Render a description string with inline `code` spans rendered in mono.
function renderDescription(text: string): ReactNode {
  const parts = text.split(/`([^`]+)`/g);
  return parts.map((part, i) =>
    i % 2 === 1 ? (
      <code key={i} className="font-code-sm text-code-sm text-primary bg-surface-container-high/50 px-1 py-0.5 rounded">
        {part}
      </code>
    ) : (
      <span key={i}>{part}</span>
    )
  );
}

// GitHub-Copilot-style unified diff renderer.
// Lines starting with '+' are green (added), '-' are red (removed),
// '@@' are blue hunk headers, everything else is neutral context.
function PatchDiff({ patch }: { patch: string }) {
  const [open, setOpen] = useState(false);
  const lines = patch.split("\n");

  return (
    <div className="border-t border-border-dark">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="w-full text-left px-4 py-2 flex items-center gap-2 text-text-muted hover:text-text-primary font-code-sm text-code-sm transition-colors"
      >
        <svg className="size-3.5 shrink-0" viewBox="0 0 16 16" fill="currentColor">
          <path d="M11.013 1.427a1.75 1.75 0 0 1 2.474 0l1.086 1.086a1.75 1.75 0 0 1 0 2.474l-8.61 8.61c-.21.21-.47.364-.756.445l-3.251.93a.75.75 0 0 1-.927-.928l.929-3.25c.081-.286.235-.547.445-.758l8.61-8.61zm1.414 1.06a.25.25 0 0 0-.354 0L10.811 3.75l1.439 1.44 1.263-1.263a.25.25 0 0 0 0-.354l-1.086-1.086zM11.189 6.25 9.75 4.81l-6.286 6.287a.25.25 0 0 0-.064.108l-.558 1.953 1.953-.558a.25.25 0 0 0 .108-.064l6.286-6.286z"/>
        </svg>
        {open ? "Hide suggested fix" : "Show suggested fix"}
      </button>
      {open && (
        <div className="overflow-x-auto scrollbar-hide">
          <table className="w-full border-collapse font-code-sm text-code-sm">
            <tbody>
              {lines.map((line, i) => {
                let bg = "bg-transparent";
                let text = "text-text-muted";

                if (line.startsWith("@@")) {
                  bg = "bg-blue-950/40";
                  text = "text-blue-400";
                } else if (line.startsWith("+")) {
                  bg = "bg-green-950/50";
                  text = "text-green-300";
                } else if (line.startsWith("-")) {
                  bg = "bg-red-950/50";
                  text = "text-red-300";
                }

                return (
                  <tr key={i} className={bg}>
                    {/* gutter: show +/- prefix for changed lines */}
                    <td className={`pl-3 pr-1 py-px select-none w-4 ${text} opacity-70 text-right`}>
                      {line.startsWith("@@") ? "…" : line.startsWith("+") ? "+" : line.startsWith("-") ? "-" : " "}
                    </td>
                    {/* content: strip the first char for +/- lines */}
                    <td className={`pl-2 pr-4 py-px whitespace-pre ${text}`}>
                      {line.startsWith("@@") ? line : line.slice(1)}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

export function FindingCard({ finding }: { finding: Finding }) {
  const s = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.low;
  const v = VERIFICATION_STYLES[finding.verification_status];
  const Icon = SEVERITY_ICON[finding.severity] ?? SquareIcon;

  return (
    <div className="bg-[#111111] border border-border-dark rounded flex flex-col">
      <div className="p-inset-card flex flex-col gap-3">
        {/* severity + category + verification badges */}
        <div className="flex justify-between items-start gap-2 flex-wrap">
          <div className="flex gap-2 items-center flex-wrap">
            <Badge
              text={finding.severity}
              textCls={s.text}
              bgCls={s.bg}
              borderCls={s.border}
              icon={<Icon className="size-3" />}
            />
            <Tag text={finding.category.replaceAll("_", " ")} />
            <Badge
              text={v.label}
              textCls={v.text}
              bgCls={v.bg}
              borderCls={v.border}
            />
          </div>
          <span className="font-caption text-caption text-text-muted">
            confidence <span className={confidenceColor(finding.confidence)}>{confidence(finding.confidence)}</span>
          </span>
        </div>

        {/* title + file:line */}
        <div>
          <h3 className="font-subheading text-subheading text-text-primary">{finding.title}</h3>
          <MonoPath icon={<DescriptionIcon className="size-3.5" />}>
            {filePathWithLines(finding.file_path, finding.line_start, finding.line_end)}
          </MonoPath>
        </div>

        {/* description -- inline `code` rendered in mono */}
        <p className="font-body-muted text-body-muted text-text-muted leading-relaxed">
          {renderDescription(finding.description)}
        </p>
      </div>

      {/* evidence (optional) */}
      {finding.evidence && (
        <CodeBlock code={finding.evidence} />
      )}

      {/* suggested patch diff (optional — AI findings with a suggested fix) */}
      {finding.suggested_patch && (
        <PatchDiff patch={finding.suggested_patch} />
      )}
    </div>
  );
}