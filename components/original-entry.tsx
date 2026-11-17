// One text of an original language, read-only: key, English, German,
// context and the glossary terms it contains. No field, no suggestions.
import Link from "next/link";
import { originalDetail } from "@/lib/store";
import { listHref } from "@/lib/list-href";
import { LANG_NAMES, type OriginalLang } from "@/lib/types";
import type { T } from "@/lib/i18n";

export function OriginalEntry({ detail, lang, q, page, t }: { detail: NonNullable<ReturnType<typeof originalDetail>>; lang: OriginalLang; q: string; page: number; t: T }) {
  const { string: s, component: c } = detail;
  const keyContext = c.format === "flat-json" && s.key.includes("||") ? s.key.slice(s.key.indexOf("||") + 2) : "";
  const hits = detail.glossary.filter((g) => g.hits.length);
  const german = (
    <div>
      <div className="field-label">{lang === "de" ? t("Deutsch", "German") : t("Deutsch (Referenz)", "German (reference)")}</div>
      {s.de_reference ? (
        <p className={lang === "de" ? "text source-text" : "text reference-text"} lang="de">
          {s.de_reference}
        </p>
      ) : (
        <p className="muted">
          – <span className="small">{t("nur im Code: zu diesem Text gibt es keine deutsche Fassung in den Dateien.", "only in the code: this text has no German version in the files.")}</span>
        </p>
      )}
    </div>
  );
  const english = (
    <div>
      <div className="field-label">{t("Englisch (Ausgangstext)", "English (source)")}</div>
      <p className={lang === "en" ? "text source-text" : "text reference-text"} lang="en">
        {s.source}
      </p>
    </div>
  );
  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label={t("Pfad", "Breadcrumb")}>
          <Link href="/">{t("Übersicht", "Overview")}</Link>
          <span aria-hidden="true">/</span>
          <Link href={listHref(c.id, lang, { q, page })}>
            {c.title} · {LANG_NAMES[lang].native}
          </Link>
        </nav>
        <div className="row">
          <h1 className="mono small">{s.key}</h1>
          <span className="badge original">{lang === "en" ? t("Original · Ausgangstext", "Original · source") : t("Original", "Original")}</span>
        </div>
      </div>
      <div className="editor">
        <section className="card stack" aria-label={t("Texte", "Texts")}>
          {lang === "en" ? english : german}
          {lang === "en" ? german : english}
          <p className="muted small">
            {t("Nur lesen: Englisch und Deutsch kommen aus dem Code und werden hier nicht geändert. ", "Read-only: English and German come from the code and are not changed here. ")}
            {c.targets.map((target, i) => (
              <span key={target}>
                {i > 0 && " · "}
                <Link href={`/c/${c.id}/${target}/${s.id}`} lang={target}>
                  {t(`Übersetzen: ${LANG_NAMES[target].native}`, `Translate: ${LANG_NAMES[target].native}`)}
                </Link>
              </span>
            ))}
          </p>
        </section>
        <aside className="stack">
          <section className="card stack" aria-labelledby="context-label">
            <h2 id="context-label">{t("Kontext", "Context")}</h2>
            <dl className="facts">
              <dt>{t("Datei", "File")}</dt>
              <dd className="mono">{s.file}</dd>
              {keyContext && (
                <>
                  <dt>{t("Bedeutung", "Meaning")}</dt>
                  <dd>{keyContext}</dd>
                </>
              )}
              {s.context && (
                <>
                  <dt>{t("Hinweis", "Note")}</dt>
                  <dd className="text">{s.context}</dd>
                </>
              )}
            </dl>
          </section>
          <section className="card stack" aria-labelledby="glossary-label">
            <h2 id="glossary-label">{t("Glossar", "Glossary")}</h2>
            {hits.length ? (
              <ul className="glossary-hits">
                {hits.flatMap((g) =>
                  g.hits.map((h) => (
                    <li key={`${g.lang}-${h.id}`}>
                      <strong>{h.term}</strong> → <span lang={g.lang}>{h.translation}</span> <span className="muted small">({LANG_NAMES[g.lang].native})</span>
                      {h.note && <div className="note">{h.note}</div>}
                    </li>
                  )),
                )}
              </ul>
            ) : (
              <p className="muted small">{t("Kein Glossarbegriff in diesem Text.", "No glossary term in this text.")}</p>
            )}
          </section>
        </aside>
      </div>
    </>
  );
}
