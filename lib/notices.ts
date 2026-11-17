// The result of a form action (?error=…, ?synced=…, ?pr=…) as a sentence.
import type { T } from "./i18n";

export function errorMessage(code: string, t: T): string {
  switch (code) {
    case "nothing_to_export":
      return t("Nichts Neues zu exportieren: Alle akzeptierten Übersetzungen sind schon in main oder im offenen Pull Request.", "Nothing new to export: every accepted translation is already in main or in the open pull request.");
    case "github_failed":
      return t("GitHub hat nicht wie erwartet geantwortet. Details stehen im Server-Log.", "GitHub did not answer as expected. The server log has the details.");
    case "rate_limited":
      return t("Zu viele Anfragen – bitte warte einen Moment.", "Too many requests – please wait a moment.");
    case "not_reviewer":
      return t("Das dürfen nur Reviewer.", "Only reviewers can do this.");
    case "signed_out":
      return t("Bitte melde dich an.", "Please sign in.");
    case "invalid_term":
      return t("Begriff und Übersetzung sind nötig.", "Term and translation are needed.");
    case "github_off":
      return t("Die Anmeldung mit GitHub ist auf diesem Server nicht eingerichtet.", "Sign-in with GitHub is not set up on this server.");
    case "github_state":
      return t("Die Anmeldung ist abgelaufen oder kam nicht von hier. Versuch es noch einmal.", "The sign-in expired or did not start here. Please try again.");
    case "not_found":
      return t("Nicht gefunden – vielleicht schon entschieden?", "Not found – maybe already decided?");
    default:
      return t("Das hat nicht geklappt.", "That didn't work.");
  }
}
