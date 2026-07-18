// A grey tag-pill: small label used for "trigger" / "category" chips.
export function Tag({ text }: { text: string }) {
  return (
    <span className="inline-block px-2 py-0.5 rounded bg-surface-container text-text-muted border border-border-dark font-caption text-caption">
      {text}
    </span>
  );
}