// Texts and translations: the overview counts, the list, one entry for the
// editor, and the writing actions (suggest, accept, reject, confirm).
//
// Per text and language there is at most one current translation (status
// accepted, or exported = accepted and in an open pull request). It is
// outdated when the source text changed since (based_on_hash ≠ source_hash).
// Translators suggest; a reviewer's own save, accept and confirm are final.
import type { SQLInputValue } from "node:sqlite";
import { all, now, one, run, transaction } from "./db";
import { HttpError } from "./http";
import { checkTranslation, MAX_INPUT, normalizeText, glossaryHits } from "./checks";
import { component } from "./components";
import { glossary } from "./glossary";
import type { SessionUser } from "./auth";
import type { CheckResult, Component, GlossaryEntry, TargetLang } from "./types";
import { isTargetLang } from "./types";

export const FILTERS = ["missing", "outdated", "all", "suggested", "open"] as const;
export type Filter = (typeof FILTERS)[number];
export const isFilter = (v: unknown): v is Filter => (FILTERS as readonly unknown[]).includes(v);
export const PAGE_SIZE = 50;

export type EntryStatus = "done" | "missing" | "outdated";

export type Counts = { total: number; done: number; outdated: number; missing: number; suggested: number; pending: number };

// Per component and language: done, outdated, missing, open suggestions,
// and accepted values that are not in the repository yet.
export function counts(componentId: string, lang: string): Counts {
  const row = one<{ total: number; done: number; outdated: number }>(
    `SELECT COUNT(*) AS total,
       COALESCE(SUM(t.id IS NOT NULL AND t.based_on_hash = s.source_hash), 0) AS done,
       COALESCE(SUM(t.id IS NOT NULL AND t.based_on_hash != s.source_hash), 0) AS outdated
     FROM strings s LEFT JOIN translations t ON t.string_id=s.id AND t.lang=? AND t.status IN ('accepted','exported')
     WHERE s.component_id=? AND s.removed=0`,
    lang,
    componentId,
  )!;
  const suggested = one<{ n: number }>(
    "SELECT COUNT(DISTINCT t.string_id) AS n FROM translations t JOIN strings s ON s.id=t.string_id WHERE s.component_id=? AND s.removed=0 AND t.lang=? AND t.status='suggested'",
    componentId,
    lang,
  )!.n;
  const pending = one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM translations t JOIN strings s ON s.id=t.string_id
       LEFT JOIN repo_values r ON r.string_id=t.string_id AND r.lang=t.lang
     WHERE s.component_id=? AND s.removed=0 AND t.lang=? AND t.status='accepted' AND (r.text IS NULL OR r.text != t.text)`,
    componentId,
    lang,
  )!.n;
  const total = Number(row.total);
  const done = Number(row.done);
  const outdated = Number(row.outdated);
  return { total, done, outdated, missing: total - done - outdated, suggested: Number(suggested), pending: Number(pending) };
}

const likeEscape = (q: string) => `%${q.replace(/[\\%_]/g, (m) => `\\${m}`)}%`;

export type ListRow = { id: number; key: string; source: string; translation: string | null; status: EntryStatus; suggestions: number };

function filterSql(filter: Filter) {
  const missing = "t.id IS NULL";
  const outdated = "(t.id IS NOT NULL AND t.based_on_hash != s.source_hash)";
  switch (filter) {
    case "missing":
      return missing;
    case "outdated":
      return outdated;
    case "open":
      return `(${missing} OR ${outdated})`;
    case "suggested":
      return "EXISTS (SELECT 1 FROM translations x WHERE x.string_id=s.id AND x.lang=? AND x.status='suggested')";
    default:
      return "1";
  }
}

export function listEntries(input: { componentId: string; lang: string; filter: Filter; q?: string; page?: number }) {
  const where = ["s.component_id=?", "s.removed=0", filterSql(input.filter)];
  const params: SQLInputValue[] = [input.componentId];
  if (input.filter === "suggested") params.push(input.lang);
  const q = (input.q || "").trim().slice(0, 200);
  if (q) {
    where.push("(s.key LIKE ? ESCAPE '\\' OR s.source LIKE ? ESCAPE '\\' OR t.text LIKE ? ESCAPE '\\')");
    params.push(likeEscape(q), likeEscape(q), likeEscape(q));
  }
  const from = `FROM strings s LEFT JOIN translations t ON t.string_id=s.id AND t.lang=? AND t.status IN ('accepted','exported') WHERE ${where.join(" AND ")}`;
  const total = Number(one<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, input.lang, ...params)!.n);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(input.page || 1)), pages);
  const rows = all<{ id: number; key: string; source: string; translation: string | null; based_on_hash: string | null; source_hash: string; suggestions: number }>(
    `SELECT s.id,s.key,s.source,s.source_hash,t.text AS translation,t.based_on_hash,
       (SELECT COUNT(*) FROM translations x WHERE x.string_id=s.id AND x.lang=? AND x.status='suggested') AS suggestions
     ${from} ORDER BY s.position LIMIT ? OFFSET ?`,
    input.lang,
    input.lang,
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  );
  return {
    total,
    page,
    pages,
    rows: rows.map((r): ListRow => ({
      id: r.id,
      key: r.key,
      source: r.source,
      translation: r.translation,
      status: r.translation === null ? "missing" : r.based_on_hash === r.source_hash ? "done" : "outdated",
      suggestions: Number(r.suggestions),
    })),
  };
}

type StringRow = { id: number; component_id: string; key: string; source: string; source_hash: string; de_reference: string; context: string; file: string; position: number; removed: number };
type TranslationRow = { id: number; string_id: number; lang: string; text: string; based_on_hash: string; status: string; author_id: number | null; reviewer_id: number | null; pr_number: number | null; created_at: number; updated_at: number };

export const getString = (id: number) => one<StringRow>("SELECT * FROM strings WHERE id=?", id) ?? null;
const currentOf = (stringId: number, lang: string) =>
  one<TranslationRow>("SELECT * FROM translations WHERE string_id=? AND lang=? AND status IN ('accepted','exported')", stringId, lang) ?? null;

export type Suggestion = { id: number; text: string; author: string | null; authorId: number | null; outdated: boolean; at: number; checks: CheckResult };

export function entryDetail(stringId: number, lang: TargetLang) {
  const s = getString(stringId);
  if (!s || s.removed) return null;
  const c = component(s.component_id);
  if (!c || !c.targets.includes(lang)) return null;
  const terms = glossary(lang);
  const current = currentOf(stringId, lang);
  const currentAuthor = current?.author_id ? one<{ login: string }>("SELECT login FROM users WHERE id=?", current.author_id)?.login ?? null : null;
  const suggestions = all<TranslationRow & { login: string | null }>(
    "SELECT t.*,u.login FROM translations t LEFT JOIN users u ON u.id=t.author_id WHERE t.string_id=? AND t.lang=? AND t.status='suggested' ORDER BY t.updated_at DESC",
    stringId,
    lang,
  ).map(
    (t): Suggestion => ({
      id: t.id,
      text: t.text,
      author: t.login,
      authorId: t.author_id,
      outdated: t.based_on_hash !== s.source_hash,
      at: t.updated_at,
      checks: runChecks(c, s, t.text, terms),
    }),
  );
  const status: EntryStatus = !current ? "missing" : current.based_on_hash === s.source_hash ? "done" : "outdated";
  return {
    string: s,
    component: c,
    lang,
    status,
    current: current ? { id: current.id, text: current.text, status: current.status, prNumber: current.pr_number, author: currentAuthor } : null,
    suggestions,
    glossary: glossaryHits(s.source, terms),
    allGlossary: terms,
    limit: c.limits[s.key],
  };
}
export type EntryDetail = NonNullable<ReturnType<typeof entryDetail>>;

const runChecks = (c: Component, s: StringRow, text: string, terms: GlossaryEntry[]) =>
  checkTranslation({ source: s.source, text, format: c.format, limit: c.limits[s.key], placeholders: c.placeholders, glossary: terms });

// The next missing or outdated text after this one (wrapping around), for "save and next".
export function nextOpen(componentId: string, lang: string, afterPosition: number): number | null {
  const sql = `SELECT s.id FROM strings s LEFT JOIN translations t ON t.string_id=s.id AND t.lang=? AND t.status IN ('accepted','exported')
    WHERE s.component_id=? AND s.removed=0 AND (t.id IS NULL OR t.based_on_hash != s.source_hash) AND s.position %s ? ORDER BY s.position LIMIT 1`;
  const after = one<{ id: number }>(sql.replace("%s", ">"), lang, componentId, afterPosition);
  if (after) return after.id;
  return one<{ id: number }>(sql.replace("%s", "<"), lang, componentId, afterPosition)?.id ?? null;
}

function loadForWrite(stringId: number, lang: unknown) {
  if (!isTargetLang(lang)) throw new HttpError(400, "invalid_lang", "Unknown language.");
  const s = getString(stringId);
  if (!s || s.removed) throw new HttpError(404, "not_found", "Text not found.");
  const c = component(s.component_id);
  if (!c || !c.targets.includes(lang)) throw new HttpError(404, "not_found", "This language is not translated for this component.");
  return { s, c, lang };
}

export class CheckFailed extends HttpError {
  constructor(public checks: CheckResult) {
    super(422, "checks_failed", "The translation does not pass the checks.", { checks });
  }
}

export type SaveOutcome = { outcome: "suggested" | "accepted" | "confirmed" | "unchanged"; checks: CheckResult; next: number | null };

function replaceCurrent(stringId: number, lang: string, at: number) {
  run("UPDATE translations SET status='replaced',updated_at=? WHERE string_id=? AND lang=? AND status IN ('accepted','exported')", at, stringId, lang);
}

// Saves a translation: a reviewer's is accepted at once, a translator's is
// a suggestion (one open suggestion per person and text, updated in place).
export function saveTranslation(user: SessionUser, stringId: number, langInput: unknown, textInput: unknown, at = now()): SaveOutcome {
  if (typeof textInput !== "string") throw new HttpError(400, "invalid_text", "Text missing.");
  if (textInput.length > MAX_INPUT) throw new CheckFailed({ errors: [{ code: "too_long_input", limit: MAX_INPUT, actual: textInput.length }], hints: [] });
  const { s, c, lang } = loadForWrite(stringId, langInput);
  const text = normalizeText(textInput);
  const checks = runChecks(c, s, text, glossary(lang));
  if (checks.errors.length) throw new CheckFailed(checks);
  const next = () => nextOpen(c.id, lang, s.position);
  return transaction(() => {
    const current = currentOf(s.id, lang);
    if (current && current.text === text) {
      if (current.based_on_hash === s.source_hash) return { outcome: "unchanged" as const, checks, next: next() };
      if (user.role === "reviewer") {
        run("UPDATE translations SET based_on_hash=?,reviewer_id=?,updated_at=? WHERE id=?", s.source_hash, user.id, at, current.id);
        return { outcome: "confirmed" as const, checks, next: next() };
      }
    }
    if (user.role === "reviewer") {
      replaceCurrent(s.id, lang, at);
      run(
        "INSERT INTO translations(string_id,lang,text,based_on_hash,status,author_id,reviewer_id,created_at,updated_at) VALUES(?,?,?,?,'accepted',?,?,?,?)",
        s.id,
        lang,
        text,
        s.source_hash,
        user.id,
        user.id,
        at,
        at,
      );
      return { outcome: "accepted" as const, checks, next: next() };
    }
    const own = one<{ id: number }>("SELECT id FROM translations WHERE string_id=? AND lang=? AND status='suggested' AND author_id=?", s.id, lang, user.id);
    if (own) run("UPDATE translations SET text=?,based_on_hash=?,updated_at=? WHERE id=?", text, s.source_hash, at, own.id);
    else
      run(
        "INSERT INTO translations(string_id,lang,text,based_on_hash,status,author_id,created_at,updated_at) VALUES(?,?,?,?,'suggested',?,?,?)",
        s.id,
        lang,
        text,
        s.source_hash,
        user.id,
        at,
        at,
      );
    return { outcome: "suggested" as const, checks, next: next() };
  });
}

// "Still correct": the current translation fits the changed source. A
// reviewer's confirmation is final; a translator's is a suggestion with the
// same text, for a reviewer to accept.
export function confirmCurrent(user: SessionUser, stringId: number, lang: unknown, at = now()): SaveOutcome {
  const { s } = loadForWrite(stringId, lang);
  const current = currentOf(s.id, lang as string);
  if (!current) throw new HttpError(409, "nothing_to_confirm", "There is no translation to confirm.");
  return saveTranslation(user, stringId, lang, current.text, at);
}

function suggestionForReview(user: SessionUser, translationId: number) {
  if (user.role !== "reviewer") throw new HttpError(403, "not_reviewer", "Nur für Reviewer. / Reviewers only.");
  const t = one<TranslationRow>("SELECT * FROM translations WHERE id=?", translationId);
  if (!t || t.status !== "suggested") throw new HttpError(404, "not_found", "Suggestion not found (or already decided).");
  const { s, c } = loadForWrite(t.string_id, t.lang);
  return { t, s, c };
}

export function acceptSuggestion(user: SessionUser, translationId: number, at = now()) {
  const { t, s, c } = suggestionForReview(user, translationId);
  const checks = runChecks(c, s, t.text, glossary(t.lang));
  if (checks.errors.length) throw new CheckFailed(checks);
  transaction(() => {
    replaceCurrent(s.id, t.lang, at);
    run("UPDATE translations SET status='accepted',reviewer_id=?,updated_at=? WHERE id=?", user.id, at, t.id);
  });
  return { stringId: s.id, lang: t.lang, next: nextOpen(c.id, t.lang, s.position) };
}

export function rejectSuggestion(user: SessionUser, translationId: number, at = now()) {
  const { t, s } = suggestionForReview(user, translationId);
  run("UPDATE translations SET status='rejected',reviewer_id=?,updated_at=? WHERE id=?", user.id, at, t.id);
  return { stringId: s.id, lang: t.lang };
}


// ---- The originals: English (source) and German (reference), read-only ----

// Every text has its English source; German exists where the reference file
// has one ("" there: the text has no German counterpart, it is only in the code).
export function originalCounts(componentId: string) {
  const row = one<{ total: number; german: number }>(
    "SELECT COUNT(*) AS total, COALESCE(SUM(de_reference != ''), 0) AS german FROM strings WHERE component_id=? AND removed=0",
    componentId,
  )!;
  return { total: Number(row.total), german: Number(row.german) };
}

export type OriginalRow = { id: number; key: string; source: string; german: string };

export function listOriginals(input: { componentId: string; q?: string; page?: number }) {
  const where = ["component_id=?", "removed=0"];
  const params: SQLInputValue[] = [input.componentId];
  const q = (input.q || "").trim().slice(0, 200);
  if (q) {
    where.push("(key LIKE ? ESCAPE '\\' OR source LIKE ? ESCAPE '\\' OR de_reference LIKE ? ESCAPE '\\')");
    params.push(likeEscape(q), likeEscape(q), likeEscape(q));
  }
  const from = `FROM strings WHERE ${where.join(" AND ")}`;
  const total = Number(one<{ n: number }>(`SELECT COUNT(*) AS n ${from}`, ...params)!.n);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const page = Math.min(Math.max(1, Math.floor(input.page || 1)), pages);
  const rows = all<{ id: number; key: string; source: string; de_reference: string }>(
    `SELECT id,key,source,de_reference ${from} ORDER BY position LIMIT ? OFFSET ?`,
    ...params,
    PAGE_SIZE,
    (page - 1) * PAGE_SIZE,
  );
  return { total, page, pages, rows: rows.map((r): OriginalRow => ({ id: r.id, key: r.key, source: r.source, german: r.de_reference })) };
}

// One text read-only: key, English, German, context and the glossary terms
// it contains (per target language).
export function originalDetail(stringId: number) {
  const s = getString(stringId);
  if (!s || s.removed) return null;
  const c = component(s.component_id);
  if (!c) return null;
  return {
    string: s,
    component: c,
    glossary: c.targets.map((lang) => ({ lang, hits: glossaryHits(s.source, glossary(lang)) })),
  };
}
