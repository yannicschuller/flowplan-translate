import Link from "next/link";
import { pageT, pageUser } from "@/lib/page";
import { componentsOf, repos } from "@/lib/components";
import { counts, originalCounts } from "@/lib/store";
import { syncState } from "@/lib/sync";
import { pendingCount, trackedPull } from "@/lib/export";
import { formatDateTime, formatNumber } from "@/lib/i18n";
import { LANG_NAMES, ORIGINAL_LANGS, TARGET_LANGS } from "@/lib/types";
import { errorMessage } from "@/lib/notices";
import { config } from "@/lib/config";
import { badgeMarkdown, percent } from "@/lib/badge";
import { refreshPullsIfStale } from "@/lib/pulls";
import { ProgressBar } from "@/components/progress-bar";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t, locale }, user, sp] = await Promise.all([pageT(), pageUser(), searchParams]);
  // "Open pull request #n" only while GitHub says so (checked at most every five minutes, briefly).
  await Promise.all(repos().map((repo) => refreshPullsIfStale(repo)));
  const reviewer = user?.role === "reviewer";
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const n = (v: number) => formatNumber(locale, v);
  const here = "/";
  const langName = (lang: keyof typeof LANG_NAMES) => (locale === "de" ? LANG_NAMES[lang].de : LANG_NAMES[lang].en);
  return (
    <>
      <div className="page-head">
        <h1>{t("Flowplan übersetzen", "Translate Flowplan")}</h1>
        <p className="lede">
          {t(
            "Wähle einen Bereich und eine Sprache. Deine Vorschläge prüft ein Reviewer; akzeptierte Übersetzungen gehen als Pull Request in das Repository.",
            "Pick a part and a language. A reviewer checks your suggestions; accepted translations go to the repository as a pull request.",
          )}{" "}
          <Link href="/guide">{t("Lies vorher kurz den Leitfaden.", "Read the guidelines first.")}</Link>
          {!user && (
            <>
              {" "}
              <Link href="/login">{t("Zum Übersetzen meldest du dich mit GitHub an.", "Sign in with GitHub to translate.")}</Link>
            </>
          )}
        </p>
      </div>
      {param("error") && <p className="notice err">{errorMessage(param("error"), t)}</p>}
      {param("synced") && <p className="notice ok">{t(`${param("synced")} ist synchronisiert.`, `${param("synced")} is synced.`)}</p>}
      {param("pr") && <p className="notice ok">{t(`Pull Request ${param("pr")} ist bereit.`, `Pull request ${param("pr")} is ready.`)}</p>}
      <div className="stack">
        {repos().map((repo) => {
          const state = syncState(repo);
          const open = trackedPull(repo);
          const pending = pendingCount(repo);
          // One column per target language any part of the repository offers.
          const langs = TARGET_LANGS.filter((l) => componentsOf(repo).some((c) => c.targets.includes(l)));
          // Coverage per language across the repository's parts, as the README badge counts it.
          const summary = langs.map((lang) => {
            const sum = componentsOf(repo)
              .filter((c) => c.targets.includes(lang))
              .map((c) => counts(c.id, lang))
              .reduce((a, k) => ({ total: a.total + k.total, done: a.done + k.done }), { total: 0, done: 0 });
            return { lang, total: sum.total, pct: percent(sum.done, sum.total) };
          });
          return (
            <section key={repo} className="card repo" aria-labelledby={`repo-${repo}`}>
              <div className="repo-head">
                <div className="repo-title">
                  <h2 id={`repo-${repo}`}>
                    <a href={`https://github.com/${repo}`}>{repo}</a>
                  </h2>
                  <p className="repo-meta">
                    {state.synced_at
                      ? t(`Synchronisiert ${formatDateTime(locale, state.synced_at, config.timeZone())}`, `Synced ${formatDateTime(locale, state.synced_at, config.timeZone())}`) + (state.sha ? ` · ${state.sha.slice(0, 7)}` : "")
                      : t("Noch nicht synchronisiert", "Not synced yet")}
                    {open && (
                      <>
                        {" · "}
                        <a href={`https://github.com/${repo}/pull/${open.number}`}>{t(`offener Pull Request #${open.number}`, `open pull request #${open.number}`)}</a>
                      </>
                    )}
                  </p>
                  {summary.some((x) => x.total > 0) && (
                    <p className="repo-sum">
                      <span className="visually-hidden">{t("Gesamtstand: ", "Overall: ")}</span>
                      {summary.map((x) => (
                        <span key={x.lang} className={x.total && x.pct === 100 ? "sum complete" : "sum"}>
                          <span lang={x.lang}>{LANG_NAMES[x.lang].native}</span> <b>{x.total ? t(`${n(x.pct)} %`, `${n(x.pct)}%`) : "–"}</b>
                        </span>
                      ))}
                    </p>
                  )}
                </div>
                {reviewer && (
                  <div className="repo-actions">
                    <form method="post" action="/api/sync">
                      <input type="hidden" name="repo" value={repo} />
                      <input type="hidden" name="next" value={here} />
                      <button className="button small" type="submit">
                        {t("Jetzt synchronisieren", "Sync now")}
                      </button>
                    </form>
                    <form method="post" action="/api/export">
                      <input type="hidden" name="repo" value={repo} />
                      <input type="hidden" name="next" value={here} />
                      {/* Never disabled: a pull request closed on GitHub sends its texts again, which the count does not know yet. */}
                      <button className="button small primary" type="submit">
                        {open ? t(`Pull Request aktualisieren (${n(pending)})`, `Update pull request (${n(pending)})`) : t(`Pull Request erstellen (${n(pending)})`, `Create pull request (${n(pending)})`)}
                      </button>
                    </form>
                  </div>
                )}
              </div>
              {reviewer && state.errors.length > 0 && (
                <ul className="problems" aria-label={t("Fehler beim Synchronisieren", "Sync errors")}>
                  {state.errors.map((e, i) => (
                    <li key={i}>
                      {e.component ? `${e.component}: ` : ""}
                      {e.code === "app_not_installed" ? errorMessage(e.code, t, repo) : e.message}
                    </li>
                  ))}
                </ul>
              )}
              {reviewer && state.notes.length > 0 && (
                <ul className="problems notes" aria-label={t("Hinweise", "Notes")}>
                  {state.notes.map((e, i) => (
                    <li key={i}>
                      {e.component ? `${e.component}: ` : ""}
                      {e.message}
                    </li>
                  ))}
                </ul>
              )}
              <div className="matrix-wrap">
                <table className="matrix">
                  <caption className="visually-hidden">{t(`Fortschritt in ${repo} je Bereich und Sprache`, `Progress in ${repo} per part and language`)}</caption>
                  <thead>
                    <tr>
                      <th scope="col" className="part">
                        {t("Bereich", "Part")}
                      </th>
                      <th scope="col" className="texts">
                        {t("Texte · Original", "Texts · original")}
                      </th>
                      {langs.map((lang) => (
                        <th key={lang} scope="col" className="target">
                          <span lang={lang}>{LANG_NAMES[lang].native}</span>
                          <span className="visually-hidden"> ({langName(lang)})</span>
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {componentsOf(repo).map((c) => {
                      const o = originalCounts(c.id);
                      const onlyInCode = o.total - o.german;
                      const cut = c.title.indexOf(" · ");
                      return (
                        <tr key={c.id}>
                          <th scope="row" className="part">
                            {cut > 0 ? (
                              <>
                                <span className="part-prefix">{c.title.slice(0, cut)} · </span>
                                {c.title.slice(cut + 3)}
                              </>
                            ) : (
                              c.title
                            )}
                          </th>
                          <td className="texts" data-label={t("Texte", "Texts")}>
                            <span className="texts-line">
                              <span className={o.total ? "count" : "count muted"}>{n(o.total)}</span>
                              {/* The originals: read-only lists to browse and search. */}
                              {ORIGINAL_LANGS.map((lang) => (
                                <Link
                                  key={lang}
                                  href={`/c/${c.id}/${lang}`}
                                  className="chip"
                                  title={lang === "en" ? t(`Englisch · Original · Ausgangstext (${n(o.total)})`, `English · original · source (${n(o.total)})`) : t(`Deutsch · Original (${n(o.german)})`, `German · original (${n(o.german)})`)}
                                >
                                  {lang.toUpperCase()}
                                  <span className="visually-hidden">
                                    {lang === "en"
                                      ? t(` – Englisch, Original und Ausgangstext von ${c.title}: ${n(o.total)} Texte`, ` – English, original and source of ${c.title}: ${n(o.total)} texts`)
                                      : t(` – Deutsch, Original von ${c.title}: ${n(o.german)} Texte`, ` – German, original of ${c.title}: ${n(o.german)} texts`)}
                                  </span>
                                </Link>
                              ))}
                            </span>
                            {onlyInCode > 0 && <span className="cell-note muted">{t(`${n(onlyInCode)} nur im Code`, `${n(onlyInCode)} only in the code`)}</span>}
                          </td>
                          {langs.map((lang) => {
                            const name = langName(lang);
                            if (!c.targets.includes(lang))
                              return (
                                <td key={lang} className="target na" data-label={LANG_NAMES[lang].native} title={t("Diese Sprache gibt es hier nicht", "Not offered here")}>
                                  <span aria-hidden="true">–</span>
                                  <span className="visually-hidden">{t(`${name}: hier nicht angeboten`, `${name}: not offered here`)}</span>
                                </td>
                              );
                            const k = counts(c.id, lang);
                            const href = `/c/${c.id}/${lang}`;
                            const pct = percent(k.done, k.total);
                            const complete = k.total > 0 && k.done === k.total;
                            const pctText = t(`${n(pct)} %`, `${n(pct)}%`);
                            return (
                              <td key={lang} className="target" data-label={LANG_NAMES[lang].native}>
                                <div className="cell">
                                {k.total ? (
                                  <Link href={href} className={complete ? "cell-link complete" : "cell-link"} title={t(`${n(k.done)} von ${n(k.total)} fertig`, `${n(k.done)} of ${n(k.total)} done`)}>
                                    <span className="visually-hidden">{`${name} – ${c.title}: `}</span>
                                    {complete ? (
                                      <span className="pct">
                                        <span aria-hidden="true">✓ </span>
                                        {pctText}
                                      </span>
                                    ) : (
                                      <>
                                        <ProgressBar className="thin" total={k.total} done={k.done} outdated={k.outdated} />
                                        <span className="pct">{pctText}</span>
                                      </>
                                    )}
                                    <span className="visually-hidden">{t(` (${n(k.done)} von ${n(k.total)} fertig)`, ` (${n(k.done)} of ${n(k.total)} done)`)}</span>
                                  </Link>
                                ) : (
                                  <Link href={href} className="cell-link empty">
                                    <span className="visually-hidden">{`${name} – ${c.title}: `}</span>
                                    {t("Noch keine Texte", "No texts yet")}
                                  </Link>
                                )}
                                {(k.outdated > 0 || k.missing > 0) && (
                                  <span className="counters">
                                    {k.outdated > 0 && (
                                      <Link href={`${href}?filter=outdated`} className="outdated">
                                        {t(`${n(k.outdated)} veraltet`, `${n(k.outdated)} outdated`)}
                                        <span className="visually-hidden">{` – ${name}, ${c.title}`}</span>
                                      </Link>
                                    )}
                                    {k.missing > 0 && (
                                      <Link href={`${href}?filter=missing`} className="missing">
                                        {k.missing === 1 ? t("1 fehlt", "1 missing") : t(`${n(k.missing)} fehlen`, `${n(k.missing)} missing`)}
                                        <span className="visually-hidden">{` – ${name}, ${c.title}`}</span>
                                      </Link>
                                    )}
                                  </span>
                                )}
                                </div>
                              </td>
                            );
                          })}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <details className="badges">
                <summary>{t("Badge für dein README", "Badge for your README")}</summary>
                <p className="muted small">
                  {t("Der Stand dieser Sprache über alle Bereiche des Repositorys, verlinkt auf die Liste zum Übersetzen:", "This language's coverage across all parts of the repository, linked to the list to translate:")}
                </p>
                {[...new Set(componentsOf(repo).flatMap((c) => c.targets))].map((lang) => {
                  const first = componentsOf(repo).find((c) => c.targets.includes(lang))!;
                  const name = repo.split("/")[1];
                  return (
                    <div key={lang} className="badge-snippet">
                      <img src={`/api/badge?repo=${encodeURIComponent(name)}&lang=${lang}`} alt={`${LANG_NAMES[lang].native} – ${t("Badge", "badge")}`} height={20} />
                      <pre>
                        <code>{badgeMarkdown(config.publicUrl(), repo, lang, first.id)}</code>
                      </pre>
                    </div>
                  );
                })}
              </details>
            </section>
          );
        })}
        <p className="legend">
          <span>
            <span className="dot done" />
            {t("fertig", "done")}
          </span>
          <span>
            <span className="dot outdated" />
            {t("veraltet: der Ausgangstext hat sich geändert", "outdated: the source text changed")}
          </span>
          <span>
            <span className="dot" />
            {t("fehlt", "missing")}
          </span>
        </p>
      </div>
    </>
  );
}
