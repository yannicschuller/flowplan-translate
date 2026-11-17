import type { Metadata } from "next";
import Link from "next/link";
import { pageT, pageUser } from "@/lib/page";
import { glossary, languageNote } from "@/lib/glossary";
import { isTargetLang, LANG_NAMES, TARGET_LANGS, type TargetLang } from "@/lib/types";
import { errorMessage } from "@/lib/notices";

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await pageT();
  return { title: t("Glossar", "Glossary") };
}

export default async function Glossary({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t, locale }, user, sp] = await Promise.all([pageT(), pageUser(), searchParams]);
  const lang: TargetLang = isTargetLang(sp.lang) ? sp.lang : "fr";
  const reviewer = user?.role === "reviewer";
  const terms = glossary(lang);
  const note = languageNote(lang);
  const here = `/glossary?lang=${lang}`;
  const error = typeof sp.error === "string" ? sp.error : "";
  return (
    <>
      <div className="page-head">
        <h1>{t("Glossar", "Glossary")}</h1>
        <p className="lede">
          {t(
            "Wie Flowplans Begriffe in jeder Sprache heißen. Der Editor zeigt die Begriffe eines Textes und weist darauf hin, wenn eine Übersetzung sie nicht verwendet.",
            "How Flowplan's terms are called in each language. The editor shows a text's terms and points out when a translation doesn't use them.",
          )}
        </p>
      </div>
      {error && <p className="notice err">{errorMessage(error, t)}</p>}
      {sp.saved && <p className="notice ok">{t("Gespeichert.", "Saved.")}</p>}
      <div className="toolbar">
        <nav className="tabs" aria-label={t("Sprache", "Language")}>
          {TARGET_LANGS.map((l) => (
            <Link key={l} href={`/glossary?lang=${l}`} aria-current={l === lang ? "page" : undefined}>
              <span lang={l}>{LANG_NAMES[l].native}</span>
              <span className="visually-hidden"> ({locale === "de" ? LANG_NAMES[l].de : LANG_NAMES[l].en})</span>
            </Link>
          ))}
        </nav>
      </div>
      <div className="stack">
        <section className="card stack" aria-labelledby="note-label">
          <h2 id="note-label">{t("Hinweis für diese Sprache", "Note for this language")}</h2>
          {reviewer ? (
            <form method="post" action="/api/glossary" className="stack">
              <input type="hidden" name="action" value="note" />
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="next" value={here} />
              <label className="visually-hidden" htmlFor="note">
                {t("Hinweis", "Note")}
              </label>
              <textarea id="note" name="note" defaultValue={note} maxLength={1000} rows={2} />
              <div>
                <button className="button small" type="submit">
                  {t("Hinweis speichern", "Save note")}
                </button>
              </div>
            </form>
          ) : (
            <p className="text">{note || t("Kein Hinweis.", "No note.")}</p>
          )}
        </section>
        {reviewer && (
          <section className="card stack" aria-labelledby="add-label">
            <h2 id="add-label">{t("Begriff hinzufügen", "Add a term")}</h2>
            <form method="post" action="/api/glossary" className="term-form">
              <input type="hidden" name="lang" value={lang} />
              <input type="hidden" name="next" value={here} />
              <label>
                {t("Begriff (Englisch)", "Term (English)")}
                <input name="term" required maxLength={100} lang="en" />
              </label>
              <label>
                {t("Übersetzung", "Translation")}
                <input name="translation" required maxLength={200} lang={lang} />
              </label>
              <label>
                {t("Notiz", "Note")}
                <input name="note" maxLength={500} />
              </label>
              <button className="button primary" type="submit">
                {t("Hinzufügen", "Add")}
              </button>
            </form>
          </section>
        )}
        <section className="card" aria-labelledby="terms-label">
          <h2 id="terms-label" className="visually-hidden">
            {t("Begriffe", "Terms")}
          </h2>
          {terms.length ? (
            <table className="terms">
              <thead>
                <tr>
                  <th scope="col">{t("Begriff", "Term")}</th>
                  <th scope="col">{t("Übersetzung", "Translation")}</th>
                  <th scope="col">{t("Notiz", "Note")}</th>
                  {reviewer && <th scope="col" className="actions"><span className="visually-hidden">{t("Aktionen", "Actions")}</span></th>}
                </tr>
              </thead>
              <tbody>
                {terms.map((g) => (
                  <tr key={g.id}>
                    <td lang="en">
                      <strong>{g.term}</strong>
                    </td>
                    <td lang={lang}>{g.translation}</td>
                    <td className="muted">{g.note}</td>
                    {reviewer && (
                      <td className="actions">
                        <div className="term-actions">
                        <details className="edit">
                          <summary>{t("Bearbeiten", "Edit")}</summary>
                          <form method="post" action="/api/glossary" className="term-form">
                            <input type="hidden" name="id" value={g.id} />
                            <input type="hidden" name="lang" value={lang} />
                            <input type="hidden" name="next" value={here} />
                            <label>
                              {t("Begriff", "Term")}
                              <input name="term" defaultValue={g.term} required maxLength={100} />
                            </label>
                            <label>
                              {t("Übersetzung", "Translation")}
                              <input name="translation" defaultValue={g.translation} required maxLength={200} />
                            </label>
                            <label>
                              {t("Notiz", "Note")}
                              <input name="note" defaultValue={g.note} maxLength={500} />
                            </label>
                            <button className="button small" type="submit">
                              {t("Speichern", "Save")}
                            </button>
                          </form>
                        </details>
                        <form method="post" action="/api/glossary" className="inline">
                          <input type="hidden" name="action" value="delete" />
                          <input type="hidden" name="id" value={g.id} />
                          <input type="hidden" name="next" value={here} />
                          <button className="button small ghost danger" type="submit">
                            {t("Löschen", "Delete")}
                          </button>
                        </form>
                        </div>
                      </td>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="muted">{t("Noch keine Begriffe.", "No terms yet.")}</p>
          )}
        </section>
      </div>
    </>
  );
}
