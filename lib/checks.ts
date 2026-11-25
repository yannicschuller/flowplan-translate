// The checks on save. Errors block saving, hints are shown but saving is
// allowed. Client-safe: the editor runs them while typing, the server runs
// them again on every save and accept.
import { comparePlaceholders } from "./placeholders";
import { initialCase, leadingMark, sameMark } from "./fragment";
import type { CheckResult, Format, GlossaryEntry, Issue, Limit, PlaceholderStyle } from "./types";

export const MAX_INPUT = 10_000;

// Characters and bytes as flowplan-app's store test counts them: on the
// trimmed text, characters as code points, bytes in UTF-8.
export const countChars = (text: string) => [...text.trim()].length;
export const countBytes = (text: string) => new TextEncoder().encode(text.trim()).length;

// C0 controls except tab and line feed, DEL, and the C1 range. Line ends
// are normalised to \n before the check, so a \r is an error here too.
const CONTROL = /[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/;

// Final punctuation, with the full-width and French forms counted as the same.
const FINAL: Record<string, string> = {
  ".": ".", "。": ".", "．": ".",
  "!": "!", "！": "!",
  "?": "?", "？": "?",
  ":": ":", "：": ":",
  ";": ";", "；": ";",
  ",": ",", "，": ",", "、": ",",
  "…": "…",
};
function finalPunctuation(text: string) {
  const trimmed = text.trimEnd();
  if (trimmed.endsWith("...")) return "…";
  return FINAL[trimmed.slice(-1)] ?? "";
}

const escapeRegex = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
// The term as a word of its own, also in the plural ("Workspace", "Workspaces").
export function termRegex(term: string) {
  return new RegExp(`(?<![\\p{L}\\p{N}])${escapeRegex(term.trim())}(?:s|es)?(?![\\p{L}\\p{N}])`, "iu");
}
export function glossaryHits(source: string, glossary: GlossaryEntry[]) {
  return glossary.filter((g) => g.term.trim() && termRegex(g.term).test(source));
}
// A glossary word as a pattern. Latin words may take a plural s or x
// ("Espace de travail" → "Espaces de travail"). Russian words change their
// ending by case and number ("База данных" → "Базу данных", "Записи",
// "Рабочем пространстве"): a final vowel, й or ь is dropped and any ending
// of up to four letters allowed. Polish words (a Polish glossary entry) do
// too ("Baza danych" → "Bazę danych", "Rekord" → "Rekordów", "Zadanie" →
// "Zadań", "Skrzynka odbiorcza" → "Skrzynce odbiorczej", "Członek" →
// "Członka"): a final vowel is dropped, the last consonant may soften
// (k/c, t/c, n/ń, s/ś, c/ć, ł/l), an e before a final k may drop, and any
// ending of up to four letters is allowed.
const PL_SOFT: Record<string, string> = { k: "[kc]", t: "[tc]", n: "[nń]", ń: "[nń]", s: "[sś]", ś: "[sś]", c: "[cć]", ć: "[cć]", ł: "[łl]" };
function polishWordPattern(word: string) {
  const stem = word.replace(/[aeiouyąęó]{1,2}$/iu, "");
  if (stem.length < 3) return escapeRegex(word) + "\\p{L}{0,4}";
  const last = stem.slice(-1).toLowerCase();
  let core = stem.slice(0, -1);
  let fleeting = false;
  if (last === "k" && /e$/iu.test(core) && core.length >= 3) {
    core = core.slice(0, -1);
    fleeting = true;
  } else if (last === "k" && /[^aeiouyąęó]$/iu.test(core)) fleeting = true;
  return escapeRegex(core) + (fleeting ? "e?" : "") + (PL_SOFT[last] ?? escapeRegex(stem.slice(-1))) + "\\p{L}{0,4}";
}
function wordPattern(word: string, lang: string) {
  if (lang === "pl" && /^\p{L}{3,}$/u.test(word)) return polishWordPattern(word);
  if (/^\p{Script=Cyrillic}{3,}$/u.test(word)) {
    const stem = word.replace(/[аеёиоуыэюяйь]{1,2}$/iu, "");
    return escapeRegex(stem.length >= 3 ? stem : word) + "\\p{Script=Cyrillic}{0,4}";
  }
  return escapeRegex(word) + (/^\p{L}{3,}$/u.test(word) ? "[sx]?" : "");
}
// Is the glossary translation (or one of its " / " alternatives) used?
function usesTranslation(text: string, translation: string, lang: string) {
  return translation
    .split(/\s+\/\s+/)
    .map((alt) => alt.trim())
    .filter(Boolean)
    .some((alt) => new RegExp(alt.split(/\s+/).map((word) => wordPattern(word, lang)).join("\\s+"), "iu").test(text));
}

export type CheckInput = {
  source: string;
  text: string;
  format: Format;
  limit?: Limit;
  placeholders: PlaceholderStyle[];
  glossary?: GlossaryEntry[];
};

export function checkTranslation(input: CheckInput): CheckResult {
  const { source, text, format } = input;
  const errors: Issue[] = [];
  const hints: Issue[] = [];
  if (text.length > MAX_INPUT) return { errors: [{ code: "too_long_input", limit: MAX_INPUT, actual: text.length }], hints };
  if (!text.trim()) return { errors: [{ code: "empty" }], hints };

  const { missing, extra } = comparePlaceholders(source, text, input.placeholders);
  if (missing.length) errors.push({ code: "placeholders_missing", values: missing });
  if (extra.length) errors.push({ code: "placeholders_extra", values: extra });

  if (CONTROL.test(text)) errors.push({ code: "control_chars" });
  const multiline = input.limit?.multiline ?? format !== "txt-files";
  if (!multiline && text.includes("\n")) errors.push({ code: "line_breaks" });
  // A txt file holds the text plus the file's own trailing newline: no
  // leading or trailing blanks or extra lines.
  if (format === "txt-files" && text !== text.trim()) errors.push({ code: "edge_whitespace_txt" });

  const limit = input.limit;
  if (limit?.chars !== undefined && countChars(text) > limit.chars) errors.push({ code: "too_many_chars", limit: limit.chars, actual: countChars(text) });
  if (limit?.bytes !== undefined && countBytes(text) > limit.bytes) errors.push({ code: "too_many_bytes", limit: limit.bytes, actual: countBytes(text) });
  if (limit?.keywords) {
    const words = text.trim().split(",");
    if (!words.every((w) => w && w === w.trim())) errors.push({ code: "keywords_format" });
    const seen = new Set<string>();
    const repeated = words.filter((w) => (seen.has(w) ? true : (seen.add(w), false)));
    if (repeated.length) errors.push({ code: "keywords_repeat", values: [...new Set(repeated)] });
  }

  if (format !== "txt-files") {
    const lead = (s: string) => /^\s*/.exec(s)![0];
    const trail = (s: string) => /\s*$/.exec(s)![0];
    if (lead(source) !== lead(text) || trail(source) !== trail(text)) hints.push({ code: "whitespace_differs" });
  }
  // Fragments keep the source's case and leading mark (lib/fragment.ts);
  // a script without case (Chinese) is never compared; Cyrillic has case and is.
  const wantCase = initialCase(source, input.placeholders);
  const haveCase = initialCase(text, input.placeholders);
  if (wantCase && haveCase && wantCase !== haveCase) hints.push({ code: "case_differs", values: [wantCase, haveCase] });
  const wantMark = leadingMark(source, input.placeholders);
  const haveMark = leadingMark(text, input.placeholders);
  if ((wantMark || haveMark) && !(wantMark && haveMark && sameMark(wantMark, haveMark))) hints.push({ code: "leading_mark_differs", values: [wantMark, haveMark] });
  const want = finalPunctuation(source);
  const have = finalPunctuation(text);
  if (want !== have) hints.push({ code: "punctuation_differs", values: [want, have] });
  for (const g of glossaryHits(source, input.glossary || []))
    if (g.translation.trim() && !usesTranslation(text, g.translation, g.lang)) hints.push({ code: "glossary_unused", values: [g.term, g.translation] });
  return { errors, hints };
}

// Line ends as the editor and the files use them internally.
export const normalizeText = (text: string) => text.replace(/\r\n?/g, "\n");
