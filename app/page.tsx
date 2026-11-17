import Link from "next/link";
import { pageT, pageUser } from "@/lib/page";
import { componentsOf, repos } from "@/lib/components";
import { counts } from "@/lib/store";
import { syncState } from "@/lib/sync";
import { pendingCount, trackedPull } from "@/lib/export";
import { formatDateTime, formatNumber } from "@/lib/i18n";
import { LANG_NAMES } from "@/lib/types";
import { errorMessage } from "@/lib/notices";
import { ProgressBar } from "@/components/progress-bar";

export const dynamic = "force-dynamic";

export default async function Overview({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t, locale }, user, sp] = await Promise.all([pageT(), pageUser(), searchParams]);
  const reviewer = user?.role === "reviewer";
  const param = (k: string) => (typeof sp[k] === "string" ? (sp[k] as string) : "");
  const n = (v: number) => formatNumber(locale, v);
  const here = "/";
  return (
    <>
      <div className="page-head">
        <h1>{t("Flowplan übersetzen", "Translate Flowplan")}</h1>
        <p className="lede">
          {t(
            "Wähle einen Bereich und eine Sprache. Deine Vorschläge prüft ein Reviewer; akzeptierte Übersetzungen gehen als Pull Request in das Repository.",
            "Pick a part and a language. A reviewer checks your suggestions; accepted translations go to the repository as a pull request.",
          )}
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
          return (
            <section key={repo} className="card repo" aria-labelledby={`repo-${repo}`}>
              <div className="repo-head">
                <div>
                  <h2 id={`repo-${repo}`}>
                    <a href={`https://github.com/${repo}`}>{repo}</a>
                  </h2>
                  <p className="repo-meta">
                    {state.synced_at
                      ? t(`Synchronisiert ${formatDateTime(locale, state.synced_at)}`, `Synced ${formatDateTime(locale, state.synced_at)}`) + (state.sha ? ` · ${state.sha.slice(0, 7)}` : "")
                      : t("Noch nicht synchronisiert", "Not synced yet")}
                    {open && (
                      <>
                        {" · "}
                        <a href={`https://github.com/${repo}/pull/${open.number}`}>{t(`offener Pull Request #${open.number}`, `open pull request #${open.number}`)}</a>
                      </>
                    )}
                  </p>
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
                      {e.message}
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
              <table className="progress-table">
                <thead>
                  <tr>
                    <th scope="col">{t("Bereich", "Part")}</th>
                    <th scope="col">{t("Sprache", "Language")}</th>
                    <th scope="col">{t("Fortschritt", "Progress")}</th>
                    <th scope="col" className="num">
                      {t("Fertig", "Done")}
                    </th>
                    <th scope="col" className="num">
                      {t("Veraltet", "Outdated")}
                    </th>
                    <th scope="col" className="num">
                      {t("Fehlt", "Missing")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {componentsOf(repo).flatMap((c) =>
                    c.targets.map((lang) => {
                      const k = counts(c.id, lang);
                      const href = `/c/${c.id}/${lang}`;
                      const name = locale === "de" ? LANG_NAMES[lang].de : LANG_NAMES[lang].en;
                      return (
                        <tr key={`${c.id}-${lang}`}>
                          <td className="component-cell">
                            <Link href={href}>{c.title}</Link>
                          </td>
                          <td className="lang">
                            <Link href={href} lang={lang}>
                              {LANG_NAMES[lang].native}
                            </Link>
                            <span className="visually-hidden"> ({name})</span>
                          </td>
                          <td className="progress-cell">
                            {k.total ? (
                              <ProgressBar total={k.total} done={k.done} outdated={k.outdated} label={t(`${c.title}, ${name}: ${n(k.done)} von ${n(k.total)} fertig`, `${c.title}, ${name}: ${n(k.done)} of ${n(k.total)} done`)} />
                            ) : (
                              <span className="muted small">{t("Noch keine Texte", "No texts yet")}</span>
                            )}
                          </td>
                          <td className="num" data-label={t("Fertig", "Done")}>
                            {n(k.done)}
                          </td>
                          <td className="num" data-label={t("Veraltet", "Outdated")}>
                            {k.outdated ? <Link href={`${href}?filter=outdated`}>{n(k.outdated)}</Link> : n(k.outdated)}
                          </td>
                          <td className="num" data-label={t("Fehlt", "Missing")}>
                            {k.missing ? <Link href={`${href}?filter=missing`}>{n(k.missing)}</Link> : n(k.missing)}
                          </td>
                        </tr>
                      );
                    }),
                  )}
                </tbody>
              </table>
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
