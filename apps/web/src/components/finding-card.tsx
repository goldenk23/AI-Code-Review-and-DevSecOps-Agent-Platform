"use client";
import type { Finding } from "@/lib/types";
import { SEVERITY_STYLES, VERIFICATION_STYLES } from "@/lib/constants";
import { Badge } from "@/components/ui/badge";
import { Tag } from "@/components/ui/tag";
import { CodeBlock, MonoPath } from "@/components/ui/code-block";
import { DescriptionIcon, WarningIcon, TriangleIcon, SquareIcon, DiamondIcon, CircleIcon } from "@/components/icons";
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

export function FindingCard({ finding }: { finding: Finding }) {
  const s = SEVERITY_STYLES[finding.severity] ?? SEVERITY_STYLES.low;
  const v = VERIFICATION_STYLES[finding.verification_status];
  const Icon = SEVERITY_ICON[finding.severity] ?? SquareIcon;

  return (
    <div className="bg-surface-container-lowest border border-border-dark rounded flex flex-col">
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
            confidence {confidence(finding.confidence)}
          </span>
        </div>

        {/* title + file:line */}
        <div>
          <h3 className="font-subheading text-subheading text-text-primary">{finding.title}</h3>
          <MonoPath icon={<DescriptionIcon className="size-3.5" />}>
            {filePathWithLines(finding.file_path, finding.line_start, finding.line_end)}
          </MonoPath>
        </div>

        {/* description */}
        <p className="font-body-muted text-body-muted text-text-muted">
          {finding.description}
        </p>
      </div>

      {/* evidence (optional) */}
      {finding.evidence && (
        <CodeBlock code={finding.evidence} />
      )}
    </div>
  );
}