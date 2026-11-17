// The list of an original language (English source, German reference):
// browsable and searchable like the others, read-only, one filter ("all").
import Link from "next/link";
import { listOriginals, originalCounts } from "@/lib/store";
import { formatNumber, type Locale, type T } from "@/lib/i18n";
import { listHref } from "@/lib/list-href";
import { LANG_NAMES, type Component, type OriginalLang } from "@/lib/types";

export function OriginalList({ c, lang, q, page, t, locale }: { c: Component; lang: OriginalLang; q: string; page: number; t: T; locale: Locale }) {
  const list = listOriginals({ componentId: c.id, q, page });
  const o = originalCounts(c.id);
  const n = (v: number) => formatNumber(locale, v);
  const state = { q };
  const onlyInCode = t("– nur im Code", "– only in the code");
  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label={t("Pfad", "Breadcrumb")}>
          <Link href="/">{t("Übersicht", "Overview")}</Link>
          <span aria-hidden="true">/</span>
          <span>{c.repo}</span>
        </nav>
        <h1>
          {c.title} · <span lang={lang}>{LANG_NAMES[lang].native}</span>
        </h1>
        <p className="row">
          <span className="badge original">{lang === "en" ? t("Original · Ausgangstext", "Original · source") : t("Original", "Original")}</span>
          <span className="muted small">
            {lang === "en"
              ? t(`${n(o.total)} Texte · nur lesen`, `${n(o.total)} texts · read-only`)
              : t(`${n(o.german)} von ${n(o.total)} Texten auf Deutsch · der Rest steht nur im Code · nur lesen`, `${n(o.german)} of ${n(o.total)} texts in German · the rest is only in the code · read-only`)}
          </span>
        </p>
      </div>
      <div className="toolbar">
        <nav className="tabs" aria-label={t("Filter", "Filter")}>
          <Link href={listHref(c.id, lang, state)} aria-current="page">
            {t("Alle", "All")} {n(o.total)}
          </Link>
        </nav>
        <form className="search" method="get" role="search">
          <label className="visually-hidden" htmlFor="q">
            {t("Suchen in Schlüssel, Englisch und Deutsch", "Search key, English and German")}
          </label>
          <input id="q" name="q" type="search" defaultValue={q} maxLength={200} placeholder={t("Schlüssel oder Text …", "Key or text …")} />
          <button className="button" type="submit">
            {t("Suchen", "Search")}
          </button>
        </form>
      </div>
      {list.rows.length ? (
        <ul className="entries">
          {list.rows.map((row) => (
            <li key={row.id}>
              <Link className="entry original" href={listHref(c.id, lang, { q, page: list.page }, row.id)}>
                <span className="key">{row.key}</span>
                <span className="source" lang="en">
                  {row.source}
                </span>
                <span className={row.german ? "target" : "target empty"} lang="de">
                  {row.german || onlyInCode}
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card empty-state">{q ? t("Nichts gefunden.", "Nothing found.") : t("Keine Einträge.", "No entries.")}</div>
      )}
      {list.pages > 1 && (
        <nav className="pager" aria-label={t("Seiten", "Pages")}>
          {list.page > 1 ? (
            <Link className="button small" href={listHref(c.id, lang, { q, page: list.page - 1 })} rel="prev">
              {t("Zurück", "Previous")}
            </Link>
          ) : null}
          <span>{t(`Seite ${list.page} von ${list.pages} · ${n(list.total)} Einträge`, `Page ${list.page} of ${list.pages} · ${n(list.total)} entries`)}</span>
          {list.page < list.pages ? (
            <Link className="button small" href={listHref(c.id, lang, { q, page: list.page + 1 })} rel="next">
              {t("Weiter", "Next")}
            </Link>
          ) : null}
        </nav>
      )}
    </>
  );
}
