import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { pageT, pageUser } from "@/lib/page";
import { entryDetail, isFilter, nextOpen } from "@/lib/store";
import { isTargetLang, LANG_NAMES } from "@/lib/types";
import { listHref } from "@/lib/list-href";
import { languageNote } from "@/lib/glossary";
import { Editor } from "@/components/editor";

export const dynamic = "force-dynamic";
type Props = { params: Promise<{ component: string; lang: string; id: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> };

async function load(params: Props["params"]) {
  const { component: componentId, lang, id } = await params;
  if (!isTargetLang(lang) || !/^\d{1,12}$/.test(id)) return null;
  const detail = entryDetail(Number(id), lang);
  if (!detail || detail.component.id !== componentId) return null;
  return detail;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const detail = await load(params);
  return { title: detail ? `${detail.string.key.slice(0, 60)} · ${LANG_NAMES[detail.lang].native}` : undefined };
}

export default async function EntryPage({ params, searchParams }: Props) {
  const [detail, sp, { t }, user] = await Promise.all([load(params), searchParams, pageT(), pageUser()]);
  if (!detail) notFound();
  const { string: s, component: c, lang } = detail;
  const filter = typeof sp.filter === "string" && isFilter(sp.filter) ? sp.filter : "missing";
  const listState = { filter, q: typeof sp.q === "string" ? sp.q.slice(0, 200) : "", page: Number(sp.page) || 1 };
  const own = user ? detail.suggestions.find((x) => x.authorId === user.id) : undefined;
  const keyContext = c.format === "flat-json" && s.key.includes("||") ? s.key.slice(s.key.indexOf("||") + 2) : "";
  const next = nextOpen(c.id, lang, s.position);
  const note = languageNote(lang);
  // Long texts (store descriptions): reference and current translation folded, so the field stays in reach.
  const long = s.source.length > 400;
  const statusLabel = { done: t("fertig", "done"), outdated: t("veraltet", "outdated"), missing: t("fehlt", "missing") }[detail.status];
  return (
    <>
      <div className="page-head">
        <nav className="crumbs" aria-label={t("Pfad", "Breadcrumb")}>
          <Link href="/">{t("Übersicht", "Overview")}</Link>
          <span aria-hidden="true">/</span>
          <Link href={listHref(c.id, lang, listState)}>
            {c.title} · {LANG_NAMES[lang].native}
          </Link>
        </nav>
        <div className="row">
          <h1 className="mono small">{s.key}</h1>
          <span className={`badge ${detail.status}`}>{statusLabel}</span>
          <span className="spacer" />
          {next && next !== s.id && (
            <Link className="button small ghost" href={listHref(c.id, lang, listState, next)}>
              {t("Nächster offener Text", "Next open text")} →
            </Link>
          )}
        </div>
      </div>
      <div className="editor">
        <div className="stack">
          <section className="card stack" aria-label={t("Ausgangstext", "Source text")}>
            <div>
              <div className="field-label">{t("Englisch (Ausgangstext)", "English (source)")}</div>
              <p className="text source-text" lang="en">
                {s.source}
              </p>
            </div>
            {s.de_reference &&
              (long ? (
                <details className="fold">
                  <summary className="field-label">{t("Deutsch (Referenz)", "German (reference)")}</summary>
                  <p className="text reference-text" lang="de">
                    {s.de_reference}
                  </p>
                </details>
              ) : (
                <div>
                  <div className="field-label">{t("Deutsch (Referenz)", "German (reference)")}</div>
                  <p className="text reference-text" lang="de">
                    {s.de_reference}
                  </p>
                </div>
              ))}
            {detail.current && long && (
              <details className="fold">
                <summary className="field-label">
                  {t("Aktuelle Übersetzung", "Current translation")}
                  {detail.status === "outdated" && <span className="badge outdated">{t("veraltet", "outdated")}</span>}
                </summary>
                <p className="text" lang={lang}>
                  {detail.current.text}
                </p>
              </details>
            )}
            {detail.current && !long && (
              <div>
                <div className="field-label">
                  {t("Aktuelle Übersetzung", "Current translation")}
                  {detail.current.status === "exported" && detail.current.prNumber && <span className="badge">{t(`im Pull Request #${detail.current.prNumber}`, `in pull request #${detail.current.prNumber}`)}</span>}
                </div>
                <p className="text" lang={lang}>
                  {detail.current.text}
                </p>
                {detail.status === "outdated" && <p className="small muted">{t("Der Ausgangstext hat sich seitdem geändert – passt sie noch?", "The source text changed since – does it still fit?")}</p>}
              </div>
            )}
          </section>
          <Editor
            stringId={s.id}
            componentId={c.id}
            lang={lang}
            format={c.format}
            placeholders={c.placeholders}
            limit={detail.limit}
            source={s.source}
            status={detail.status}
            current={detail.current ? { text: detail.current.text, author: detail.current.author, exported: detail.current.status === "exported", prNumber: detail.current.prNumber } : null}
            initial={own?.text ?? detail.current?.text ?? ""}
            suggestions={detail.suggestions.map((x) => ({ id: x.id, text: x.text, author: x.author, mine: !!user && x.authorId === user.id, outdated: x.outdated, checks: x.checks }))}
            glossary={detail.allGlossary}
            role={user?.role ?? null}
            listState={listState}
            saved={typeof sp.saved === "string" && ["suggested", "accepted", "confirmed", "unchanged"].includes(sp.saved) ? sp.saved : undefined}
          />
        </div>
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
              {c.placeholders.length > 0 && (
                <>
                  <dt>{t("Platzhalter", "Placeholders")}</dt>
                  <dd>{t("bleiben wie im Ausgangstext", "stay as in the source")}</dd>
                </>
              )}
              {detail.limit?.chars !== undefined && (
                <>
                  <dt>{t("Länge", "Length")}</dt>
                  <dd>{t(`höchstens ${detail.limit.chars} Zeichen`, `at most ${detail.limit.chars} characters`)}</dd>
                </>
              )}
              {detail.limit?.bytes !== undefined && (
                <>
                  <dt>{t("Länge", "Length")}</dt>
                  <dd>{t(`höchstens ${detail.limit.bytes} Bytes, durch Kommas getrennt, ohne Wiederholungen`, `at most ${detail.limit.bytes} bytes, comma-separated, no repeats`)}</dd>
                </>
              )}
            </dl>
            {note && (
              <p className="small muted" lang="en">
                {note}
              </p>
            )}
          </section>
          <section className="card stack" aria-labelledby="glossary-label">
            <h2 id="glossary-label">{t("Glossar", "Glossary")}</h2>
            {detail.glossary.length ? (
              <ul className="glossary-hits">
                {detail.glossary.map((g) => (
                  <li key={g.id}>
                    <strong>{g.term}</strong> → <span lang={lang}>{g.translation}</span>
                    {g.note && <div className="note">{g.note}</div>}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted small">{t("Kein Glossarbegriff in diesem Text.", "No glossary term in this text.")}</p>
            )}
            <Link className="small" href={`/glossary?lang=${lang}`}>
              {t("Ganzes Glossar", "Whole glossary")}
            </Link>
          </section>
        </aside>
      </div>
    </>
  );
}
