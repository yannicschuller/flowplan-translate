import type { Metadata } from "next";
import Link from "next/link";
import { pageT } from "@/lib/page";
import { PlaceholderText } from "@/components/placeholder-text";
import type { PlaceholderStyle } from "@/lib/types";

// The rules for translators, for every language here (French and
// Simplified Chinese) and per language. Static text, no data.
export const dynamic = "force-dynamic";

const DISCORD = "https://discord.gg/bCEdB6MPrR";
const ISSUES = "https://github.com/yannicschuller/flowplan/issues";
const STYLES: PlaceholderStyle[] = ["brace", "printf", "dollar"];

export async function generateMetadata(): Promise<Metadata> {
  const { t } = await pageT();
  return { title: t("Leitfaden", "Guidelines") };
}

// One example row: a label and the text, with placeholders as chips.
function Example({ label, text, lang, bad }: { label: string; text: string; lang: string; bad?: boolean }) {
  return (
    <>
      <dt className={bad ? "bad" : undefined}>{label}</dt>
      <dd className="text" lang={lang}>
        <PlaceholderText text={text} styles={STYLES} />
      </dd>
    </>
  );
}

export default async function Guide() {
  const { t } = await pageT();
  return (
    <>
      <div className="page-head">
        <h1>{t("Leitfaden fürs Übersetzen", "Translation guidelines")}</h1>
        <p className="lede">
          {t(
            "Ein paar kurze Regeln, damit Flowplan in jeder Sprache aus einem Guss wirkt. Der Editor prüft vieles davon beim Tippen und weist dich darauf hin.",
            "A few short rules so Flowplan reads as one piece in every language. The editor checks much of this while you type and points it out.",
          )}
        </p>
      </div>
      <div className="stack guide">
        <section className="card stack" aria-labelledby="g-source">
          <h2 id="g-source">{t("Englisch ist maßgeblich", "English is the source of truth")}</h2>
          <ul>
            <li>
              {t(
                "Übersetze aus dem englischen Ausgangstext. Er bestimmt den Sinn und auch Groß- und Kleinschreibung, Satzzeichen, Leerzeichen am Anfang und Ende und Zeichen wie · … und :.",
                "Translate from the English source. It sets the meaning and also casing, punctuation, leading and trailing spaces and symbols like · … and :.",
              )}
            </li>
            <li>
              {t(
                "Deutsch ist nur eine Referenz für den Sinn. Im Deutschen schreibt man Substantive groß – das ist Grammatik und kein Hinweis für deine Sprache.",
                "German is only a reference for the meaning. German capitalises nouns by grammar – that is no hint for your language.",
              )}
            </li>
          </ul>
          <dl className="guide-example">
            <Example label={t("Englisch", "English")} text=" · container in total: {0} (with file cache)" lang="en" />
            <Example label={t("Deutsch", "German")} text=" · Container insgesamt: {0} (mit Dateicache)" lang="de" />
            <Example label={t("Französisch ✓", "French ✓")} text={" · conteneurs au total : {0} (avec cache de fichiers)"} lang="fr" />
            <Example label={t("Französisch ✗", "French ✗")} text={" · Conteneurs au total : {0} (avec cache de fichiers)"} lang="fr" bad />
          </dl>
        </section>

        <section className="card stack" aria-labelledby="g-fragments">
          <h2 id="g-fragments">{t("Satzteile", "Fragments")}</h2>
          <ul>
            <li>
              {t(
                "Viele Texte sind Satzteile, die der Code an anderen Text anhängt. Behalte Groß- oder Kleinschreibung und die Zeichen und Leerzeichen am Anfang und Ende genau wie im Ausgangstext.",
                "Many texts are fragments that the code joins to other text. Keep the casing and the symbols and spaces at the start and end exactly like the source.",
              )}
            </li>
            <li>{t("Kein Punkt am Ende, wenn der Ausgangstext keinen hat – und umgekehrt.", "No final period if the source has none – and the other way round.")}</li>
            <li>
              {t(
                "Der Editor zeigt bei solchen Texten den Hinweis „Satzteil“ und warnt (ohne zu blockieren), wenn deine Übersetzung am Anfang oder Ende abweicht.",
                "The editor marks such texts as a “Fragment” and warns (without blocking) when your translation differs at the start or end.",
              )}
            </li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="g-placeholders">
          <h2 id="g-placeholders">{t("Platzhalter", "Placeholders")}</h2>
          <ul>
            <li>
              {t("Platzhalter wie ", "Placeholders like ")}
              <PlaceholderText text="{0}, {name}, %s, %1$s, ${applicationName}" styles={STYLES} />
              {t(
                " bleiben alle erhalten, genau so geschrieben – nicht übersetzen, keine Leerzeichen hinein. Ohne sie lässt sich nicht speichern.",
                " must all stay, written exactly the same – don't translate them or add spaces inside. Without them saving is blocked.",
              )}
            </li>
            <li>{t("Die Reihenfolge darf sich ändern, wenn deine Sprache es braucht.", "Their order may change if your language needs it.")}</li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="g-names">
          <h2 id="g-names">{t("Namen, Tasten und Code", "Names, keys and code")}</h2>
          <ul>
            <li>
              {t("Produktnamen bleiben unübersetzt: Flowplan, Flowplan Translate, GitHub, iCloud …", "Product names stay untranslated: Flowplan, Flowplan Translate, GitHub, iCloud …")}
            </li>
            <li>
              {t("Tastennamen bleiben, wie sie auf der Tastatur stehen: ", "Keyboard keys stay as printed on the keyboard: ")}
              <span className="kbd">Ctrl</span> <span className="kbd">⌘</span> <span className="kbd">Shift</span> <span className="kbd">Enter</span> <span className="kbd">Esc</span>
            </li>
            <li>
              {t("Markdown und Code bleiben, wie sie sind: ", "Markdown and inline code stay as they are: ")}
              <code>**…**</code> <code>`…`</code> <code>[…](https://…)</code>
              {t(" – übersetze nur den Text, nicht den Code oder die Adresse.", " – translate only the words, not the code or the address.")}
            </li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="g-length">
          <h2 id="g-length">{t("Länge", "Length")}</h2>
          <ul>
            <li>
              {t(
                "Bei Buttons, Beschriftungen und Menüs bleib nah an der Länge des Ausgangstexts – sonst wird abgeschnitten oder umbrochen.",
                "For buttons, labels and menus stay close to the length of the source – otherwise it gets cut off or wraps.",
              )}
            </li>
            <li>{t("Store-Texte haben feste Grenzen; der Editor zählt mit.", "Store texts have fixed limits; the editor counts along.")}</li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="g-fr">
          <h2 id="g-fr">
            <span lang="fr">Français</span> <span className="muted">· {t("Französisch", "French")}</span>
          </h2>
          <ul>
            <li>{t("Überall die Sie-Form „vous“, nie „tu“.", "Formal “vous” everywhere, never “tu”.")}</li>
            <li>
              {t(
                "Französische Typografie: ein geschütztes Leerzeichen (U+00A0) vor : ; ! ? und innerhalb von « ». Ein normales Leerzeichen in bestehenden Texten ist in Ordnung.",
                "French typography: a non-breaking space (U+00A0) before : ; ! ? and inside « ». A normal space in existing texts is fine.",
              )}
              <dl className="guide-example">
                <Example label="✓" text={"Supprimer « {0} » ?"} lang="fr" />
              </dl>
            </li>
            <li>
              {t(
                "Verwende die offiziellen Begriffe von Apple, Google und Microsoft (z. B. „Réglages“ auf iPhone und iPad, „Paramètres“ auf Android und Windows) und Flowplans ",
                "Use the official Apple, Google and Microsoft terms (e.g. “Réglages” on iPhone and iPad, “Paramètres” on Android and Windows) and Flowplan's ",
              )}
              <Link href="/glossary?lang=fr">{t("Glossar", "glossary")}</Link>.
            </li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="g-zh">
          <h2 id="g-zh">
            <span lang="zh">简体中文</span> <span className="muted">· {t("Chinesisch (vereinfacht)", "Chinese (Simplified)")}</span>
          </h2>
          <ul>
            <li>
              {t(
                "Im chinesischen Text vollbreite Satzzeichen: ，。：；！？（）“”. Platzhalter, Code, Adressen und Tastennamen behalten ihre ASCII-Zeichen.",
                "Full-width punctuation in Chinese text: ，。：；！？（）“”. Placeholders, code, addresses and key names keep their ASCII characters.",
              )}
            </li>
            <li>
              {t(
                "Keine Leerzeichen zwischen chinesischen Zeichen. Zwischen Chinesisch und lateinischen Wörtern, Zahlen oder Platzhaltern steht ein Leerzeichen, wie in den bestehenden Texten:",
                "No spaces between Chinese characters. Between Chinese and Latin words, numbers or placeholders there is a space, as in the existing texts:",
              )}
              <dl className="guide-example">
                <Example label="✓" text=" · 从 Git 接管了 {0} 个" lang="zh" />
              </dl>
            </li>
            <li>
              {t("Verwende die offiziellen Begriffe der Plattformen (z. B. „设置“ für Settings) und Flowplans ", "Use the platforms' official terms (e.g. “设置” for Settings) and Flowplan's ")}
              <Link href="/glossary?lang=zh">{t("Glossar", "glossary")}</Link>.
            </li>
          </ul>
        </section>

        <section className="card stack" aria-labelledby="g-unsure">
          <h2 id="g-unsure">{t("Wenn du unsicher bist", "When you're unsure")}</h2>
          <ul>
            <li>
              {t("Frag im Kanal #translations auf dem ", "Ask in the #translations channel on the ")}
              <a href={DISCORD}>{t("Flowplan-Discord", "Flowplan Discord")}</a>
              {t(" oder eröffne ein ", " or open an ")}
              <a href={ISSUES}>{t("Issue", "issue")}</a>.
            </li>
            <li>
              {t(
                "Nenn dabei den Schlüssel des Textes (oben im Editor), damit andere ihn finden – und hinterlass eine kurze Notiz, was du dir überlegt hast.",
                "Mention the text's key (at the top of the editor) so others find it – and leave a short note on what you considered.",
              )}
            </li>
          </ul>
        </section>
      </div>
    </>
  );
}
