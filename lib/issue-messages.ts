// What the checks (lib/checks.ts) say, in the visitor's language. Client-safe.
import type { T } from "./i18n";
import type { Issue } from "./types";

const list = (values?: string[]) => (values || []).join("  ");

export function issueMessage(issue: Issue, t: T): string {
  const n = String(issue.limit ?? "");
  const actual = String(issue.actual ?? "");
  switch (issue.code) {
    case "empty":
      return t("Die Übersetzung ist leer.", "The translation is empty.");
    case "too_long_input":
      return t(`Zu lang: höchstens ${n} Zeichen.`, `Too long: at most ${n} characters.`);
    case "placeholders_missing":
      return t(`Platzhalter fehlen: ${list(issue.values)}`, `Placeholders missing: ${list(issue.values)}`);
    case "placeholders_extra":
      return t(`Platzhalter, die der Ausgangstext nicht hat: ${list(issue.values)}`, `Placeholders the source doesn't have: ${list(issue.values)}`);
    case "too_many_chars":
      return t(`${actual} Zeichen – erlaubt sind höchstens ${n}.`, `${actual} characters – at most ${n} are allowed.`);
    case "too_many_bytes":
      return t(`${actual} Bytes – erlaubt sind höchstens ${n} (ein chinesisches Zeichen sind 3 Bytes).`, `${actual} bytes – at most ${n} are allowed (a Chinese character is 3 bytes).`);
    case "keywords_format":
      return t("Schlüsselwörter: durch Kommas getrennt, ohne leere Einträge und ohne Leerzeichen um die Kommas.", "Keywords: separated by commas, no empty entries and no spaces around the commas.");
    case "keywords_repeat":
      return t(`Schlüsselwörter doppelt: ${list(issue.values)}`, `Keywords repeated: ${list(issue.values)}`);
    case "control_chars":
      return t("Die Übersetzung enthält Steuerzeichen.", "The translation contains control characters.");
    case "line_breaks":
      return t("Dieses Feld ist einzeilig: keine Zeilenumbrüche.", "This field is a single line: no line breaks.");
    case "edge_whitespace_txt":
      return t("Keine Leerzeichen oder Leerzeilen am Anfang oder Ende.", "No spaces or blank lines at the start or end.");
    case "whitespace_differs":
      return t("Leerzeichen am Anfang oder Ende weichen vom Ausgangstext ab.", "Leading or trailing spaces differ from the source.");
    case "punctuation_differs":
      return t("Das Satzzeichen am Ende weicht vom Ausgangstext ab.", "The final punctuation differs from the source.");
    case "case_differs":
      return issue.values?.[0] === "lower"
        ? t("Der Ausgangstext beginnt klein (ein Satzteil, der an anderen Text anschließt) – beginne auch klein.", "The source starts lowercase (a fragment joined to other text) – start lowercase too.")
        : t("Der Ausgangstext beginnt mit einem Großbuchstaben – beginne auch mit einem.", "The source starts with a capital letter – start with one too.");
    case "leading_mark_differs": {
      const [want, have] = issue.values || [];
      return want
        ? t(`Der Ausgangstext beginnt mit „${want}“ – behalte es am Anfang.`, `The source starts with ‘${want}’ – keep it at the start.`)
        : t(`Der Ausgangstext beginnt nicht mit „${have}“.`, `The source doesn't start with ‘${have}’.`);
    }
    case "glossary_unused": {
      const [term, translation] = issue.values || [];
      return t(`Glossar: „${term}“ wird hier „${translation}“ übersetzt.`, `Glossary: “${term}” is translated “${translation}” here.`);
    }
  }
}
