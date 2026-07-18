// A tiny <select> styled to match the Proton Syntax inputs. We don't pull
// in a library -- native selects read fine to screen readers and are keyboard
// accessible. Caller passes options + current value + onChange.
export function Select<T extends string>({
  value,
  onChange,
  options,
  "aria-label": ariaLabel,
}: {
  value: T;
  onChange: (next: T) => void;
  options: readonly { value: T; label: string }[] | { value: T; label: string }[];
  "aria-label"?: string;
}) {
  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(e) => onChange(e.target.value as T)}
      className="bg-surface-container-low border border-border-dark text-text-primary rounded px-2 py-1 font-body-muted text-body-muted focus:ring-1 focus:ring-primary focus:border-primary focus:outline-none"
    >
      {options.map((opt) => (
        <option key={opt.value} value={opt.value}>
          {opt.label}
        </option>
      ))}
    </select>
  );
}