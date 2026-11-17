import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageT, pageUser } from "@/lib/page";
import { component } from "@/lib/components";
import { counts, isFilter, listEntries, type Filter } from "@/lib/store";
import { isOriginalLang, isTargetLang, isViewLang, LANG_NAMES } from "@/lib/types";
import { formatNumber } from "@/lib/i18n";
import { listHref } from "@/lib/list-href";
import { ProgressBar } from "@/components/progress-bar";
import { OriginalList } from "@/components/original-list";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ component: string; lang: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { component: id, lang } = await params;
  const c = component(id);
  return { title: c && isViewLang(lang) ? `${c.title} · ${LANG_NAMES[lang].native}` : undefined };
}

export default async function List({ params, searchParams }: Props) {
  const [{ component: id, lang }, sp, { t, locale }, user] = await Promise.all([params, searchParams, pageT(), pageUser()]);
  const c = component(id);
  if (c && isOriginalLang(lang)) {
    const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
    return <OriginalList c={c} lang={lang} q={q} page={Number(typeof sp.page === "string" ? sp.page : 1) || 1} t={t} locale={locale} />;
  }
  if (!c || !isTargetLang(lang) || !c.targets.includes(lang)) notFound();
  const filterParam = typeof sp.filter === "string" ? sp.filter : "missing";
  const filter: Filter = isFilter(filterParam) && filterParam !== "open" ? filterParam : "missing";
  const q = typeof sp.q === "string" ? sp.q.slice(0, 200) : "";
  const page = Number(typeof sp.page === "string" ? sp.page : 1) || 1;
  const list = listEntries({ componentId: c.id, lang, filter, q, page });
  const k = counts(c.id, lang);
  const n = (v: number) => formatNumber(locale, v);
  const tabs: { filter: Filter; label: string; count?: number }[] = [
    { filter: "missing", label: t("Fehlt", "Missing"), count: k.missing },
    { filter: "outdated", label: t("Veraltet", "Outdated"), count: k.outdated },
    { filter: "all", label: t("Alle", "All"), count: k.total },
    ...(user?.role === "reviewer" ? [{ filter: "suggested" as Filter, label: t("Vorschläge", "Suggestions"), count: k.suggested }] : []),
  ];
  const statusLabel = { done: t("fertig", "done"), outdated: t("veraltet", "outdated"), missing: t("fehlt", "missing") };
  const langName = locale === "de" ? LANG_NAMES[lang].de : LANG_NAMES[lang].en;
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
        <ProgressBar total={k.total} done={k.done} outdated={k.outdated} label={t(`${n(k.done)} von ${n(k.total)} fertig`, `${n(k.done)} of ${n(k.total)} done`)} />
        <p className="muted small">
          {t(
            `${n(k.done)} fertig · ${n(k.outdated)} veraltet · ${n(k.missing)} fehlen · ${langName}`,
            `${n(k.done)} done · ${n(k.outdated)} outdated · ${n(k.missing)} missing · ${langName}`,
          )}
        </p>
      </div>
      <div className="toolbar">
        <nav className="tabs" aria-label={t("Filter", "Filter")}>
          {tabs.map((tab) => (
            <Link key={tab.filter} href={listHref(c.id, lang, { filter: tab.filter, q })} aria-current={tab.filter === filter ? "page" : undefined}>
              {tab.label}
              {tab.count !== undefined ? ` ${n(tab.count)}` : ""}
            </Link>
          ))}
        </nav>
        <form className="search" method="get" role="search">
          {filter !== "missing" && <input type="hidden" name="filter" value={filter} />}
          <label className="visually-hidden" htmlFor="q">
            {t("Suchen in Schlüssel, Ausgangstext und Übersetzung", "Search key, source and translation")}
          </label>
          <input id="q" name="q" type="search" defaultValue={q} maxLength={200} placeholder={t("Schlüssel, Text oder Übersetzung …", "Key, text or translation …")} />
          <button className="button" type="submit">
            {t("Suchen", "Search")}
          </button>
        </form>
      </div>
      {list.rows.length ? (
        <ul className="entries">
          {list.rows.map((row) => (
            <li key={row.id}>
              <Link className="entry" href={listHref(c.id, lang, { filter, q, page: list.page }, row.id)}>
                <span className="key">{row.key}</span>
                <span className="source" lang="en">
                  {row.source}
                </span>
                <span className={row.translation === null ? "target empty" : "target"} lang={lang}>
                  {row.translation ?? "—"}
                </span>
                <span className="meta">
                  {row.suggestions > 0 && <span className="badge">{t(`${row.suggestions} Vorschl.`, `${row.suggestions} sugg.`)}</span>}
                  <span className={`badge ${row.status}`}>{statusLabel[row.status]}</span>
                </span>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <div className="card empty-state">
          {q ? t("Nichts gefunden.", "Nothing found.") : filter === "missing" ? t("Hier fehlt nichts – danke!", "Nothing missing here – thank you!") : t("Keine Einträge.", "No entries.")}
        </div>
      )}
      {list.pages > 1 && (
        <nav className="pager" aria-label={t("Seiten", "Pages")}>
          {list.page > 1 ? (
            <Link className="button small" href={listHref(c.id, lang, { filter, q, page: list.page - 1 })} rel="prev">
              {t("Zurück", "Previous")}
            </Link>
          ) : null}
          <span>{t(`Seite ${list.page} von ${list.pages} · ${n(list.total)} Einträge`, `Page ${list.page} of ${list.pages} · ${n(list.total)} entries`)}</span>
          {list.page < list.pages ? (
            <Link className="button small" href={listHref(c.id, lang, { filter, q, page: list.page + 1 })} rel="next">
              {t("Weiter", "Next")}
            </Link>
          ) : null}
        </nav>
      )}
    </>
  );
}
