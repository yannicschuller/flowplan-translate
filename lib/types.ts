// Shapes shared by the server and the browser (no Node imports here).

export const FORMATS = ["flat-json", "nested-json", "txt-files"] as const;
export type Format = (typeof FORMATS)[number];

// Placeholder syntaxes a component's texts use (lib/placeholders.ts).
//   index:  {0} {1} (numbered only – {Content} stays literal text)
//   brace:  {0} {1} {name}
//   printf: %@ %d %s %1$s %2$@ %lld
//   dollar: ${applicationName}
export const PLACEHOLDER_STYLES = ["index", "brace", "printf", "dollar"] as const;
export type PlaceholderStyle = (typeof PLACEHOLDER_STYLES)[number];

// Every language this tool can translate into: French, Simplified Chinese,
// Russian, Polish and European Portuguese. Which of them a component offers
// is its `targets` list in components.json (Russian, Polish and Portuguese:
// the web app, the mobile app and the desktop app, not the website).
export const TARGET_LANGS = ["fr", "zh", "ru", "pl", "pt"] as const;
export type TargetLang = (typeof TARGET_LANGS)[number];
export const isTargetLang = (v: unknown): v is TargetLang => (TARGET_LANGS as readonly unknown[]).includes(v);
// English (the source) and German (the reference) are shown read-only as
// "Original" languages: browsable and searchable, never written.
export const ORIGINAL_LANGS = ["en", "de"] as const;
export type OriginalLang = (typeof ORIGINAL_LANGS)[number];
export const isOriginalLang = (v: unknown): v is OriginalLang => v === "en" || v === "de";
export type ViewLang = TargetLang | OriginalLang;
export const isViewLang = (v: unknown): v is ViewLang => isTargetLang(v) || isOriginalLang(v);
export const LANG_NAMES: Record<ViewLang, { de: string; en: string; native: string }> = {
  en: { de: "Englisch", en: "English", native: "English" },
  de: { de: "Deutsch", en: "German", native: "Deutsch" },
  fr: { de: "Französisch", en: "French", native: "Français" },
  zh: { de: "Chinesisch (vereinfacht)", en: "Chinese (Simplified)", native: "简体中文" },
  ru: { de: "Russisch", en: "Russian", native: "Русский" },
  pl: { de: "Polnisch", en: "Polish", native: "Polski" },
  pt: { de: "Portugiesisch (Portugal)", en: "Portuguese (Portugal)", native: "Português" },
};

// A length limit, counted like flowplan-app's test/store.test.ts: on the
// trimmed text, characters as code points, bytes as UTF-8.
export type Limit = {
  chars?: number;
  bytes?: number;
  // App Store keywords: comma-separated, no empty entries, no spaces around
  // commas, no keyword twice.
  keywords?: boolean;
  // Line breaks allowed (default: yes for JSON catalogues, no for txt fields).
  multiline?: boolean;
};

// txt-files: one plain-text file per entry. `key` and `path` are patterns
// with {field} and {locale}; `locales` maps a language to its folder name.
export type TxtGroup = {
  key: string;
  path: string;
  locales: Record<string, string>;
  fields: string[];
};

export type Component = {
  id: string;
  title: string;
  repo: string;
  branch: string;
  format: Format;
  source: string;
  reference?: string;
  targets: TargetLang[];
  // flat-json / nested-json: language → file path. txt-files: groups.
  files: Record<string, string> | TxtGroup[];
  // Optional { "key": "comment" } file with notes for translators.
  context?: string;
  placeholders: PlaceholderStyle[];
  limits: Record<string, Limit>;
};

export type IssueCode =
  | "empty"
  | "too_long_input"
  | "placeholders_missing"
  | "placeholders_extra"
  | "too_many_chars"
  | "too_many_bytes"
  | "keywords_format"
  | "keywords_repeat"
  | "control_chars"
  | "line_breaks"
  | "edge_whitespace_txt"
  | "whitespace_differs"
  | "punctuation_differs"
  | "case_differs"
  | "leading_mark_differs"
  | "glossary_unused";

export type Issue = { code: IssueCode; values?: string[]; limit?: number; actual?: number };
export type CheckResult = { errors: Issue[]; hints: Issue[] };

export type GlossaryEntry = { id: number; lang: string; term: string; translation: string; note: string };
