// Fragments: many source texts are parts of a sentence that the code joins
// to other text (" · container in total: {0}", "and {0} more…"). Their
// casing and the marks and spaces at the start and end are intentional and
// stay as in the English source – German capitalises nouns by grammar and
// is no guide for that. Client-safe: the editor page shows a notice, the
// checks (lib/checks.ts) give hints.
import type { T } from "./i18n";
import { placeholderRegex } from "./placeholders";
import type { PlaceholderStyle } from "./types";

// Placeholders are neither letters nor marks: replaced by a private-use
// character before looking at the edges ("{0} items" starts with "i").
const SLOT = "";
const withoutPlaceholders = (text: string, styles: PlaceholderStyle[]) => {
  const re = placeholderRegex(styles);
  return re ? text.replace(re, (m) => (m === "%%" ? "%" : SLOT)) : text;
};

// The case of the first letter: "lower", "upper" or "" (no letter, or a
// script without case like Chinese). A first word with a capital inside it
// is a name ("iCloud", "macOS") and counts as no case.
export function initialCase(text: string, styles: PlaceholderStyle[] = []): "lower" | "upper" | "" {
  const word = /[\p{L}][\p{L}\p{M}\p{N}]*/u.exec(withoutPlaceholders(text, styles))?.[0];
  if (!word) return "";
  const first = String.fromCodePoint(word.codePointAt(0)!);
  if (first.toLowerCase() === first.toUpperCase()) return "";
  if (/\p{Lu}/u.test(word.slice(first.length))) return "";
  return /\p{Lu}/u.test(first) ? "upper" : /\p{Ll}/u.test(first) ? "lower" : "";
}

// Marks that a fragment starts or ends with (·, …, :, –, →, …). Opening
// brackets and quotes at the start, closing ones at the end, and the
// sentence ends . ! ? are ordinary text, no sign of a fragment.
const MARK = /[\p{P}\p{S}]/u;
const QUOTE = /["'«»“”„‘’‚‹›「」『』]/u;
const SENTENCE_END = /[.!?。！？．]/u;

export function leadingMark(text: string, styles: PlaceholderStyle[] = []) {
  const first = [...withoutPlaceholders(text, styles).trimStart()][0] ?? "";
  if (!MARK.test(first) || QUOTE.test(first) || /\p{Ps}|\p{Pi}/u.test(first)) return "";
  return first;
}

export function trailingMark(text: string, styles: PlaceholderStyle[] = []) {
  const trimmed = withoutPlaceholders(text, styles).trimEnd();
  if (trimmed.endsWith("...")) return "…";
  const last = [...trimmed].at(-1) ?? "";
  if (!MARK.test(last) || QUOTE.test(last) || SENTENCE_END.test(last) || /\p{Pe}|\p{Pf}/u.test(last)) return "";
  return last;
}

// Full-width and compatibility forms count as the same mark ("：" = ":",
// "…" = "..."), so a Chinese translation may use its own punctuation.
export const sameMark = (a: string, b: string) => a.normalize("NFKC").charAt(0) === b.normalize("NFKC").charAt(0);

export type Fragment = {
  lowercaseStart: boolean;
  leadingMark: string;
  trailingMark: string;
  leadingSpace: boolean;
  trailingSpace: boolean;
};

// What makes the source a fragment, or null when it looks like a whole
// text (capital letter at the start, no marks or spaces at the edges).
export function fragmentOf(source: string, styles: PlaceholderStyle[] = []): Fragment | null {
  const f: Fragment = {
    lowercaseStart: initialCase(source, styles) === "lower",
    leadingMark: leadingMark(source, styles),
    trailingMark: trailingMark(source, styles),
    leadingSpace: /^[ \t ]/.test(source),
    trailingSpace: /[ \t ]$/.test(source),
  };
  return f.lowercaseStart || f.leadingMark || f.trailingMark || f.leadingSpace || f.trailingSpace ? f : null;
}

// The notice on the editor page: "Fragment: keep the lowercase start and
// the leading ‘·’ like the source."
export function fragmentNotice(f: Fragment, t: T) {
  const parts = [
    f.leadingSpace && t("das Leerzeichen am Anfang", "the leading space"),
    f.leadingMark && t(`das „${f.leadingMark}“ am Anfang`, `the leading ‘${f.leadingMark}’`),
    f.lowercaseStart && t("den kleinen Anfangsbuchstaben", "the lowercase start"),
    f.trailingMark && t(`das „${f.trailingMark}“ am Ende`, `the trailing ‘${f.trailingMark}’`),
    f.trailingSpace && t("das Leerzeichen am Ende", "the trailing space"),
  ].filter((p): p is string => !!p);
  const and = t(" und ", " and ");
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(", ")}${and}${parts.at(-1)}` : parts[0];
  return t(`Satzteil: Behalte ${list} wie im Ausgangstext bei.`, `Fragment: keep ${list} like the source.`);
}
