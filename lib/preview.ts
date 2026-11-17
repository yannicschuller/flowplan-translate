// Placeholders for the editor: the text split into plain parts and
// placeholder chips, the placeholders of a source with how often the
// translation uses them, sample values and the preview with them filled in.
// Pure and client-safe; everything stays plain text (never HTML).
import { placeholderRegex } from "./placeholders";
import type { Locale } from "./i18n";
import type { PlaceholderStyle } from "./types";

export type Segment = { kind: "text" | "placeholder"; text: string };

// The text as segments; "%%" stays text (a literal percent sign).
export function tokenize(text: string, styles: PlaceholderStyle[]): Segment[] {
  const re = placeholderRegex(styles);
  if (!re) return text ? [{ kind: "text", text }] : [];
  const out: Segment[] = [];
  let last = 0;
  const push = (kind: Segment["kind"], part: string) => {
    if (!part) return;
    const prev = out[out.length - 1];
    if (kind === "text" && prev?.kind === "text") prev.text += part;
    else out.push({ kind, text: part });
  };
  for (const m of text.matchAll(re)) {
    push("text", text.slice(last, m.index));
    push(m[0] === "%%" ? "text" : "placeholder", m[0]);
    last = m.index! + m[0].length;
  }
  push("text", text.slice(last));
  return out;
}

export type Usage = { token: string; want: number; have: number };

// Each placeholder of the source once, in order of first appearance, with
// how often the source and the translation use it.
export function placeholderUsage(source: string, translation: string, styles: PlaceholderStyle[]): Usage[] {
  const count = (text: string) => {
    const m = new Map<string, number>();
    for (const s of tokenize(text, styles)) if (s.kind === "placeholder") m.set(s.text, (m.get(s.text) || 0) + 1);
    return m;
  };
  const want = count(source);
  const have = count(translation);
  return [...want].map(([token, n]) => ({ token, want: n, have: have.get(token) || 0 }));
}

const NUMBER_NAMES = /^(count|n|num|number|total|days|hours|minutes|seconds|size|amount|index|percent)$/i;
const HOST_NAMES = /^(server|host|url|instance|domain|address)$/i;
const PERSON_NAMES = /^(name|user|author|person|login)$/i;

// A sensible sample value for a placeholder: numbers for the first numbered
// one and for %d, names for named ones, a word otherwise.
export function sampleValue(token: string, locale: Locale, numberedIndex = 0): string {
  const de = locale === "de";
  const word = de ? "Beispiel" : "Example";
  if (token.startsWith("${")) {
    const name = token.slice(2, -1);
    return name === "applicationName" ? "Flowplan" : name;
  }
  if (token.startsWith("{")) {
    const name = token.slice(1, -1);
    if (/^\d+$/.test(name)) return numberedIndex === 0 ? "3" : `${de ? "Seite" : "Page"} ${String.fromCharCode(64 + Math.min(numberedIndex, 26))}`;
    if (NUMBER_NAMES.test(name)) return "3";
    if (HOST_NAMES.test(name)) return "app.flowplan.org";
    if (PERSON_NAMES.test(name)) return "Anna";
    return name;
  }
  // printf: the conversion is the last character.
  const conversion = token.slice(-1);
  if (/[dDiuUxXoO]/.test(conversion)) return "3";
  if (/[fFeEgG]/.test(conversion)) return "2.5";
  return word;
}

// Sample values for every placeholder of the source.
export function sampleValues(source: string, styles: PlaceholderStyle[], locale: Locale): Record<string, string> {
  const values: Record<string, string> = {};
  let numbered = 0;
  for (const { token } of placeholderUsage(source, "", styles)) values[token] = sampleValue(token, locale, /^\{\d+\}$/.test(token) ? numbered++ : 0);
  return values;
}

// The text with the sample values filled in; placeholders without a value stay as they are.
export function fillPreview(text: string, styles: PlaceholderStyle[], values: Record<string, string>): string {
  return tokenize(text, styles)
    .map((s) => (s.kind === "placeholder" && values[s.text] !== undefined ? values[s.text] : s.text))
    .join("");
}
