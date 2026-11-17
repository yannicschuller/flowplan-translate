// Placeholders in a text, per the component's styles. Client-safe.
import type { PlaceholderStyle } from "./types";

// ${…} must come before {…}: otherwise "{applicationName}" inside
// "${applicationName}" would count as a brace placeholder.
const PATTERNS: Record<PlaceholderStyle, string> = {
  dollar: String.raw`\$\{[A-Za-z_][\w.]*\}`,
  brace: String.raw`\{[A-Za-z0-9_]+\}`,
  index: String.raw`\{\d+\}`,
  // %% is a literal percent sign and no placeholder (matched, then dropped).
  printf: String.raw`%%|%(?:\d+\$)?(?:ll|l|h|q|z)?[@dDiuUxXoOfFeEgGcCsSp]`,
};
const ORDER: PlaceholderStyle[] = ["dollar", "brace", "index", "printf"];

export function placeholderRegex(styles: PlaceholderStyle[]) {
  const parts = ORDER.filter((s) => styles.includes(s)).map((s) => PATTERNS[s]);
  return parts.length ? new RegExp(parts.join("|"), "g") : null;
}

export function placeholders(text: string, styles: PlaceholderStyle[]): string[] {
  const re = placeholderRegex(styles);
  if (!re) return [];
  return [...text.matchAll(re)].map((m) => m[0]).filter((p) => p !== "%%");
}

// Compares as multisets: which of the source's placeholders the
// translation lacks, and which it has too many of.
export function comparePlaceholders(source: string, translation: string, styles: PlaceholderStyle[]) {
  const count = (list: string[]) => list.reduce((m, p) => m.set(p, (m.get(p) || 0) + 1), new Map<string, number>());
  const want = count(placeholders(source, styles));
  const have = count(placeholders(translation, styles));
  const missing: string[] = [];
  const extra: string[] = [];
  for (const [p, n] of want) for (let i = have.get(p) || 0; i < n; i++) missing.push(p);
  for (const [p, n] of have) for (let i = want.get(p) || 0; i < n; i++) extra.push(p);
  return { missing, extra };
}
