"use client";
import { useMemo, useState } from "react";
import type { Finding, Severity, Category } from "@/lib/types";
import { ALL_CATEGORIES, ALL_SEVERITIES } from "@/lib/constants";
import { FindingCard } from "./finding-card";
import { Select } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/empty-state";
import { DescriptionIcon } from "@/components/icons";

// Filters are local UI state -- they don't reach the API. The findings
// endpoint returns everything for a run; the count is small enough that
// client-side filtering is the simplest, fastest design.
type SeverityFilter = Severity | "all";
type CategoryFilter = Category | "all";
type VerifiedFilter = "all" | "verified_by_static_analysis" | "unverified";

const SEVERITY_OPTIONS: { value: SeverityFilter; label: string }[] = [
  { value: "all", label: "All Severities" },
  ...ALL_SEVERITIES.map((s) => ({ value: s, label: s[0].toUpperCase() + s.slice(1) })),
];

const CATEGORY_OPTIONS: { value: CategoryFilter; label: string }[] = [
  { value: "all", label: "All Categories" },
  ...ALL_CATEGORIES.map((c) => ({ value: c, label: c.replaceAll("_", " ") })),
];

const VERIFIED_OPTIONS: { value: VerifiedFilter; label: string }[] = [
  { value: "all", label: "All Sources" },
  { value: "verified_by_static_analysis", label: "Verified only" },
  { value: "unverified", label: "AI-suggested only" },
];

export function FindingsList({ findings, isLoading }: { findings: Finding[]; isLoading: boolean }) {
  const [severity, setSeverity] = useState<SeverityFilter>("all");
  const [category, setCategory] = useState<CategoryFilter>("all");
  const [verified, setVerified] = useState<VerifiedFilter>("all");

  const filtered = useMemo(() => {
    return findings.filter((f) => {
      if (severity !== "all" && f.severity !== severity) return false;
      if (category !== "all" && f.category !== category) return false;
      if (verified !== "all" && f.verification_status !== verified) return false;
      return true;
    });
  }, [findings, severity, category, verified]);

  return (
    <section className="flex flex-col gap-4 mt-4">
      <div className="flex justify-between items-end border-b border-border-dark pb-2 flex-wrap gap-2">
        <h2 className="font-subheading text-subheading text-text-primary">
          Findings ({findings.length})
        </h2>
        <div className="flex gap-2">
          <Select<SeverityFilter>
            aria-label="Filter by severity"
            value={severity}
            onChange={setSeverity}
            options={SEVERITY_OPTIONS}
          />
          <Select<CategoryFilter>
            aria-label="Filter by category"
            value={category}
            onChange={setCategory}
            options={CATEGORY_OPTIONS}
          />
          <Select<VerifiedFilter>
            aria-label="Filter by source"
            value={verified}
            onChange={setVerified}
            options={VERIFIED_OPTIONS}
          />
        </div>
      </div>

      {isLoading && (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 3 }).map((_, i) => (
            <Skeleton key={i} className="h-40 rounded" />
          ))}
        </div>
      )}

      {!isLoading && filtered.length === 0 && (
        <EmptyState
          icon={<DescriptionIcon className="size-10" />}
          title={findings.length === 0 ? "No findings" : "No findings match these filters"}
          description={
            findings.length === 0
              ? "This run completed without producing any findings."
              : "Try clearing the filters above."
          }
        />
      )}

      {!isLoading && filtered.length > 0 && (
        <div className="flex flex-col gap-4">
          {filtered.map((f) => (
            <FindingCard key={f.id} finding={f} />
          ))}
        </div>
      )}
    </section>
  );
}