import type { Metadata } from "next";
import { pageT, pageUser } from "@/lib/page";
import { config } from "@/lib/config";
import { safeNext } from "@/lib/http";
import { errorMessage } from "@/lib/notices";
import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";
export async function generateMetadata(): Promise<Metadata> {
  const { t } = await pageT();
  return { title: t("Anmelden", "Sign in") };
}

export default async function Login({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const [{ t }, user, sp] = await Promise.all([pageT(), pageUser(), searchParams]);
  const next = safeNext(typeof sp.next === "string" ? sp.next : "/", "/");
  if (user) redirect(next === "/login" ? "/" : next);
  const error = typeof sp.error === "string" ? sp.error : "";
  const enabled = !!config.oauth();
  return (
    <div className="signin card">
      <h1>{t("Anmelden", "Sign in")}</h1>
      <p className="lede">
        {t(
          "Zum Übersetzen meldest du dich mit deinem GitHub-Konto an. Wir lesen nur deinen Login und Namen; dein Name erscheint als Co-Autor im Pull Request.",
          "Sign in with your GitHub account to translate. We only read your login and name; your name appears as a co-author in the pull request.",
        )}
      </p>
      {error && <p className="notice err">{errorMessage(error, t)}</p>}
      {enabled ? (
        <a className="button github" href={`/api/auth/login?next=${encodeURIComponent(next)}`}>
          <svg width="18" height="18" viewBox="0 0 16 16" aria-hidden="true" fill="currentColor">
            <path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z" />
          </svg>
          {t("Mit GitHub anmelden", "Sign in with GitHub")}
        </a>
      ) : (
        <p className="notice warn">{errorMessage("github_off", t)}</p>
      )}
      <p className="muted small">
        {t(
          "Ein Cookie hält dich 30 Tage angemeldet; beim Abmelden wird die Sitzung gelöscht. Keine Tracker.",
          "A cookie keeps you signed in for 30 days; signing out deletes the session. No trackers.",
        )}
      </p>
    </div>
  );
}
