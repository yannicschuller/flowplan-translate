// Done and outdated as an SVG bar: widths are SVG attributes, so no style
// attribute is needed under the strict CSP.
export function ProgressBar({ total, done, outdated, label }: { total: number; done: number; outdated: number; label: string }) {
  const pct = (n: number) => (total ? Math.round((n / total) * 1000) / 10 : 0);
  const d = pct(done);
  const o = Math.min(pct(outdated), 100 - d);
  return (
    <svg className="progress" viewBox="0 0 100 8" preserveAspectRatio="none" role="img" aria-label={label}>
      <rect className="track" x="0" y="0" width="100" height="8" />
      <rect className="done" x="0" y="0" width={d} height="8" />
      <rect className="outdated" x={d} y="0" width={o} height="8" />
    </svg>
  );
}
