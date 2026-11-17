"use client";
// The editor for one text: the translation field with live checks, the
// suggestions (accept/reject for reviewers) and "still correct" for an
// outdated translation. Ctrl/Cmd+Enter saves and goes to the next open text.
// Everything is rendered as React text – never as HTML.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale, useT } from "./i18n";
import { fillPreview, placeholderUsage, sampleValues } from "@/lib/preview";
import { checkTranslation, countBytes, countChars } from "@/lib/checks";
import { issueMessage } from "@/lib/issue-messages";
import { listHref, type ListState } from "@/lib/list-href";
import type { CheckResult, Format, GlossaryEntry, Issue, Limit, PlaceholderStyle } from "@/lib/types";

export type EditorSuggestion = { id: number; text: string; author: string | null; mine: boolean; outdated: boolean; checks: CheckResult };
export type EditorProps = {
  stringId: number;
  componentId: string;
  lang: string;
  format: Format;
  placeholders: PlaceholderStyle[];
  limit?: Limit;
  source: string;
  status: "done" | "missing" | "outdated";
  current: { text: string; author: string | null; exported: boolean; prNumber: number | null } | null;
  initial: string;
  suggestions: EditorSuggestion[];
  glossary: GlossaryEntry[];
  role: "reviewer" | "translator" | null;
  listState: ListState;
  // What happened to the previous text ("save and next").
  saved?: string;
};

type Message = { kind: "ok" | "err"; text: string; issues?: Issue[] };

export function Editor(props: EditorProps) {
  const t = useT();
  const router = useRouter();
  const [text, setText] = useState(props.initial);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const savedText = (outcome: string) =>
    outcome === "suggested"
      ? t("Vorschlag gespeichert – danke! Hier ist der nächste offene Text.", "Suggestion saved – thank you! Here is the next open text.")
      : outcome === "unchanged"
        ? t("Unverändert.", "Unchanged.")
        : outcome === "confirmed"
          ? t("Bestätigt.", "Confirmed.")
          : t("Übersetzung akzeptiert.", "Translation accepted.");
  const area = useRef<HTMLTextAreaElement>(null);
  const locale = useLocale();
  // Sample values for the preview: only here in the browser, never saved.
  const [samples, setSamples] = useState(() => sampleValues(props.source, props.placeholders, locale));
  const usage = useMemo(() => placeholderUsage(props.source, text, props.placeholders), [props.source, text, props.placeholders]);

  // Puts a placeholder at the caret (replacing a selection) and keeps the caret after it.
  const insert = (token: string) => {
    const el = area.current;
    const start = el ? el.selectionStart : text.length;
    const end = el ? el.selectionEnd : text.length;
    setText(text.slice(0, start) + token + text.slice(end));
    requestAnimationFrame(() => {
      if (!el) return;
      el.focus();
      el.setSelectionRange(start + token.length, start + token.length);
    });
  };
  const signedIn = props.role !== null;
  const reviewer = props.role === "reviewer";

  const live = useMemo(
    () => (text ? checkTranslation({ source: props.source, text, format: props.format, limit: props.limit, placeholders: props.placeholders, glossary: props.glossary }) : null),
    [text, props.source, props.format, props.limit, props.placeholders, props.glossary],
  );

  // To the next open text, saying on it what happened to this one.
  const go = useCallback(
    (next: number | null, outcome: string) => {
      if (next && next !== props.stringId) {
        const href = listHref(props.componentId, props.lang, props.listState, next);
        router.push(`${href}${href.includes("?") ? "&" : "?"}saved=${encodeURIComponent(outcome)}`);
      } else router.refresh();
    },
    [router, props.componentId, props.lang, props.listState, props.stringId],
  );

  const post = useCallback(
    async (url: string, body: unknown): Promise<{ ok: boolean; data: Record<string, unknown> }> => {
      setBusy(true);
      try {
        const response = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
        const data = (await response.json().catch(() => ({}))) as Record<string, unknown>;
        if (!response.ok) {
          const checks = data.checks as CheckResult | undefined;
          setMessage({
            kind: "err",
            text:
              response.status === 422
                ? t("Nicht gespeichert – bitte korrigiere:", "Not saved – please fix:")
                : response.status === 401
                  ? t("Bitte melde dich (neu) an.", "Please sign in (again).")
                  : typeof data.message === "string"
                    ? data.message
                    : t("Das hat nicht geklappt.", "That didn't work."),
            issues: checks?.errors,
          });
          return { ok: false, data };
        }
        return { ok: true, data };
      } catch {
        setMessage({ kind: "err", text: t("Keine Verbindung zum Server.", "No connection to the server.") });
        return { ok: false, data: {} };
      } finally {
        setBusy(false);
      }
    },
    [t],
  );

  const save = useCallback(async () => {
    if (!signedIn || busy) return;
    if (live?.errors.length) {
      setMessage({ kind: "err", text: t("Nicht gespeichert – bitte korrigiere:", "Not saved – please fix:"), issues: live.errors });
      return;
    }
    const { ok, data } = await post("/api/translations", { stringId: props.stringId, lang: props.lang, text });
    if (!ok) return;
    const outcome = String(data.outcome);
    setMessage({ kind: "ok", text: savedText(outcome) });
    go((data.next as number | null) ?? null, outcome);
  }, [signedIn, busy, live, post, props.stringId, props.lang, text, t, go]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.ctrlKey || event.metaKey)) {
        event.preventDefault();
        void save();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [save]);

  // A new entry (after "save and next"): its own text and a clean slate.
  useEffect(() => {
    setText(props.initial);
    setSamples(sampleValues(props.source, props.placeholders, locale));
    setMessage(props.saved ? { kind: "ok", text: savedText(props.saved) } : null);
    area.current?.focus();
  }, [props.stringId, props.initial, props.saved]);

  const confirm = async () => {
    const { ok, data } = await post("/api/translations/confirm", { stringId: props.stringId, lang: props.lang });
    if (!ok) return;
    setMessage({ kind: "ok", text: data.outcome === "suggested" ? t("Als Vorschlag gespeichert: noch korrekt.", "Saved as a suggestion: still correct.") : t("Bestätigt.", "Confirmed.") });
    go((data.next as number | null) ?? null, String(data.outcome));
  };
  const decide = async (id: number, decision: "accept" | "reject") => {
    const { ok } = await post(`/api/suggestions/${id}/${decision}`, {});
    if (!ok) return;
    setMessage({ kind: "ok", text: decision === "accept" ? t("Vorschlag akzeptiert.", "Suggestion accepted.") : t("Vorschlag abgelehnt.", "Suggestion rejected.") });
    router.refresh();
  };

  const chars = countChars(text);
  const bytes = countBytes(text);
  const over = (props.limit?.chars !== undefined && chars > props.limit.chars) || (props.limit?.bytes !== undefined && bytes > props.limit.bytes);
  const long = props.limit?.multiline || props.source.length > 400;

  return (
    <div className="stack">
      <section className="card stack translation-box" aria-labelledby="translation-label">
        <div>
          <label className="field-label" htmlFor="translation" id="translation-label">
            {reviewer ? t("Übersetzung", "Translation") : t("Dein Vorschlag", "Your suggestion")}
          </label>
          <textarea
            id="translation"
            ref={area}
            className={long ? "long" : undefined}
            lang={props.lang}
            value={text}
            maxLength={10_000}
            disabled={!signedIn}
            spellCheck
            onChange={(e) => setText(e.target.value)}
            aria-describedby="translation-help"
          />
          <div className="row small" id="translation-help">
            <span className="muted">
              {signedIn ? (
                <>
                  <span className="kbd">Ctrl</span>/<span className="kbd">⌘</span> + <span className="kbd">Enter</span> {t("speichert und springt zum nächsten offenen Text", "saves and jumps to the next open text")}
                </>
              ) : (
                <a href={`/login?next=${encodeURIComponent(listHref(props.componentId, props.lang, props.listState, props.stringId))}`}>{t("Zum Übersetzen anmelden", "Sign in to translate")}</a>
              )}
            </span>
            <span className="spacer" />
            {props.limit && (props.limit.chars !== undefined || props.limit.bytes !== undefined) && (
              <span className={over ? "counter over" : "counter"}>
                {props.limit.chars !== undefined && `${chars} / ${props.limit.chars} ${t("Zeichen", "characters")}`}
                {props.limit.chars !== undefined && props.limit.bytes !== undefined && " · "}
                {props.limit.bytes !== undefined && `${bytes} / ${props.limit.bytes} Bytes`}
              </span>
            )}
          </div>
        </div>
        {usage.length > 0 && signedIn && (
          <div className="ph-insert">
            <span className="field-label">{t("Platzhalter einfügen", "Insert placeholder")}</span>
            <div className="row">
              {usage.map((u) => {
                const done = u.have >= u.want;
                return (
                  <button
                    key={u.token}
                    type="button"
                    className={done ? "ph-chip done" : "ph-chip missing"}
                    // Keep the caret in the field.
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => insert(u.token)}
                    aria-label={`${t("Einfügen", "Insert")} ${u.token} (${u.have}/${u.want})`}
                    title={done ? t("schon so oft wie im Ausgangstext", "used as often as in the source") : t("fehlt noch", "still missing")}
                  >
                    <span className="mono">{u.token}</span>
                    <span className="ph-count" aria-hidden="true">
                      {done ? "✓" : `${u.have}/${u.want}`}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}
        {live && (live.errors.length > 0 || live.hints.length > 0) && (
          <ul className="issues" aria-live="polite">
            {live.errors.map((issue, i) => (
              <li key={`e${i}`} className="error">
                {issueMessage(issue, t)}
              </li>
            ))}
            {live.hints.map((issue, i) => (
              <li key={`h${i}`} className="hint">
                {issueMessage(issue, t)}
              </li>
            ))}
          </ul>
        )}
        {message && (
          <div className={message.kind === "ok" ? "notice ok" : "notice err"} role={message.kind === "err" ? "alert" : "status"}>
            {message.text}
            {message.issues && message.issues.length > 0 && (
              <ul>
                {message.issues.map((issue, i) => (
                  <li key={i}>{issueMessage(issue, t)}</li>
                ))}
              </ul>
            )}
          </div>
        )}
        <div className="row">
          <button className="button primary" type="button" onClick={() => void save()} disabled={!signedIn || busy || !text.trim()}>
            {reviewer ? t("Speichern und weiter", "Save and next") : t("Vorschlagen und weiter", "Suggest and next")}
          </button>
          {props.status === "outdated" && props.current && (
            <button className="button" type="button" onClick={() => void confirm()} disabled={!signedIn || busy}>
              {t("Noch korrekt", "Still correct")}
            </button>
          )}
          <button className="button ghost" type="button" onClick={() => setText(props.source)} disabled={!signedIn}>
            {t("Ausgangstext übernehmen", "Copy source")}
          </button>
        </div>
      </section>

      {usage.length > 0 && (
        <section className="card stack preview" aria-labelledby="preview-label">
          <h2 id="preview-label">{t("Vorschau mit Beispielwerten", "Preview with sample values")}</h2>
          <div className="preview-values">
            {usage.map((u, i) => (
              <label key={u.token}>
                <span className="ph">{u.token}</span>
                <input
                  id={`sample-${i}`}
                  value={samples[u.token] ?? ""}
                  maxLength={100}
                  onChange={(e) => setSamples({ ...samples, [u.token]: e.target.value })}
                />
              </label>
            ))}
          </div>
          <div>
            <div className="field-label">{reviewer ? t("Übersetzung", "Translation") : t("Dein Vorschlag", "Your suggestion")}</div>
            <p className="text preview-text" lang={props.lang} data-testid="preview-translation">
              {text ? fillPreview(text, props.placeholders, samples) : <span className="muted">–</span>}
            </p>
          </div>
          <div>
            <div className="field-label">{t("Englisch (Ausgangstext)", "English (source)")}</div>
            <p className="text preview-text muted" lang="en">
              {fillPreview(props.source, props.placeholders, samples)}
            </p>
          </div>
        </section>
      )}

      <section className="card stack" aria-labelledby="suggestions-label">
        <h2 id="suggestions-label">{t("Vorschläge", "Suggestions")}</h2>
        {props.suggestions.length ? (
          <ul className="suggestions">
            {props.suggestions.map((s) => (
              <li key={s.id} className="suggestion">
                <div className="text" lang={props.lang}>
                  {s.text}
                </div>
                <div className="by">
                  <span>{s.author ? t(`von ${s.author}`, `by ${s.author}`) : t("unbekannt", "unknown")}</span>
                  {s.mine && <span className="badge">{t("deiner", "yours")}</span>}
                  {s.outdated && <span className="badge outdated">{t("zu einem älteren Ausgangstext", "for an older source")}</span>}
                  {s.checks.errors.length > 0 && <span className="badge missing">{t("besteht die Prüfungen nicht", "fails the checks")}</span>}
                </div>
                <div className="row">
                  {reviewer && (
                    <>
                      <button className="button small primary" type="button" disabled={busy || s.checks.errors.length > 0} onClick={() => void decide(s.id, "accept")}>
                        {t("Akzeptieren", "Accept")}
                      </button>
                      <button className="button small danger" type="button" disabled={busy} onClick={() => void decide(s.id, "reject")}>
                        {t("Ablehnen", "Reject")}
                      </button>
                    </>
                  )}
                  {signedIn && (
                    <button className="button small ghost" type="button" onClick={() => setText(s.text)}>
                      {t("In das Feld übernehmen", "Copy into the field")}
                    </button>
                  )}
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted small">{t("Noch keine offenen Vorschläge.", "No open suggestions yet.")}</p>
        )}
      </section>
    </div>
  );
}
