// The glossary per language (term → translation, with a note) and one note
// per language (e.g. the form of address), maintained by reviewers.
import { all, now, one, run } from "./db";
import { HttpError } from "./http";
import { isTargetLang, type GlossaryEntry } from "./types";
import type { SessionUser } from "./auth";

export const glossary = (lang: string) =>
  all<GlossaryEntry>("SELECT id,lang,term,translation,note FROM glossary WHERE lang=? ORDER BY term COLLATE NOCASE", lang);

export const languageNote = (lang: string) => one<{ note: string }>("SELECT note FROM language_notes WHERE lang=?", lang)?.note ?? "";

const clean = (v: unknown, max: number) => (typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) : "");

function requireReviewerUser(user: SessionUser) {
  if (user.role !== "reviewer") throw new HttpError(403, "not_reviewer", "Nur für Reviewer. / Reviewers only.");
}

// Adds a term or changes the one with the same term (case-insensitive).
export function saveTerm(user: SessionUser, input: { lang: unknown; term: unknown; translation: unknown; note?: unknown; id?: number | null }) {
  requireReviewerUser(user);
  if (!isTargetLang(input.lang)) throw new HttpError(400, "invalid_lang", "Unknown language.");
  const term = clean(input.term, 100);
  const translation = clean(input.translation, 200);
  const note = clean(input.note, 500);
  if (!term || !translation) throw new HttpError(400, "invalid_term", "Term and translation are needed.");
  const at = now();
  if (input.id) {
    const changed = run("UPDATE glossary SET term=?,translation=?,note=?,updated_at=?,updated_by=? WHERE id=? AND lang=?", term, translation, note, at, user.id, input.id, input.lang).changes;
    if (!Number(changed)) throw new HttpError(404, "not_found", "Term not found.");
    return;
  }
  run(
    "INSERT INTO glossary(lang,term,translation,note,updated_at,updated_by) VALUES(?,?,?,?,?,?) ON CONFLICT(lang,term COLLATE NOCASE) DO UPDATE SET translation=excluded.translation,note=excluded.note,updated_at=excluded.updated_at,updated_by=excluded.updated_by",
    input.lang,
    term,
    translation,
    note,
    at,
    user.id,
  );
}

export function deleteTerm(user: SessionUser, id: number) {
  requireReviewerUser(user);
  run("DELETE FROM glossary WHERE id=?", id);
}

export function saveLanguageNote(user: SessionUser, lang: unknown, note: unknown) {
  requireReviewerUser(user);
  if (!isTargetLang(lang)) throw new HttpError(400, "invalid_lang", "Unknown language.");
  run("INSERT INTO language_notes(lang,note,updated_at) VALUES(?,?,?) ON CONFLICT(lang) DO UPDATE SET note=excluded.note,updated_at=excluded.updated_at", lang, clean(note, 1000), now());
}
