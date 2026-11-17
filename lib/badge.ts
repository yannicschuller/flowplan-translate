// Coverage badges for READMEs, made here (no external service, no fonts):
//   GET /api/badge?lang=fr                       everything
//   GET /api/badge?repo=flowplan&lang=fr         one repository (name or owner/name)
//   GET /api/badge?component=flowplan-web&lang=fr one component
//   &label=…  another label   &format=json  shields.io endpoint JSON
// Coverage = current, not outdated translations / texts (as on the overview),
// from the database state of the last sync. Never reads or sets cookies.
import { one } from "./db";
import { components } from "./components";
import { isTargetLang, LANG_NAMES, type Component } from "./types";

// The colours of flowplan's README table (scripts/i18n-readme.mjs).
export const badgeColor = (pct: number) => (pct === 100 ? "2ea44f" : pct >= 90 ? "a3c51c" : pct >= 50 ? "dfb317" : "e05d44");
export const GREY = "9f9f9f";

// One aggregated query over the given components.
export function coverage(componentIds: string[], lang: string) {
  if (!componentIds.length) return { total: 0, done: 0 };
  const row = one<{ total: number; done: number }>(
    `SELECT COUNT(*) AS total, COALESCE(SUM(t.id IS NOT NULL AND t.based_on_hash = s.source_hash), 0) AS done
     FROM strings s LEFT JOIN translations t ON t.string_id=s.id AND t.lang=? AND t.status IN ('accepted','exported')
     WHERE s.removed=0 AND s.component_id IN (${componentIds.map(() => "?").join(",")})`,
    lang,
    ...componentIds,
  )!;
  return { total: Number(row.total), done: Number(row.done) };
}
export const percent = (done: number, total: number) => (total ? Math.floor((done / total) * 100) : 0);

// ---- Text width (like shields: Verdana 11 px, estimated per character) ----

const WIDE = /[ᄀ-ᅟ⺀-〾ぁ-㏿㐀-䶿一-鿿ꥠ-꥿가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}\u{20000}-\u{3fffd}]/u;
function charWidth(ch: string) {
  if (WIDE.test(ch)) return 14; // East Asian wide characters: about double
  if (/[ijlI.,:;'|!`]/.test(ch)) return 3.6;
  if (ch === " ") return 3.9;
  if (/[frt()[\]{}\-/\\"]/.test(ch)) return 4.6;
  if (/[mwMW%@]/.test(ch)) return 10.5;
  if (/[A-Z]/.test(ch)) return 7.6;
  if (/[0-9]/.test(ch)) return 7;
  return 6.6;
}
export const textWidth = (text: string) => Math.round([...text].reduce((w, ch) => w + charWidth(ch), 0));

const xml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");

// A flat badge with presentation attributes only (no <style>, no script).
export function renderSvg(label: string, message: string, color: string, title: string) {
  const pad = 6;
  const lw = textWidth(label) + pad * 2;
  const mw = textWidth(message) + pad * 2;
  const w = lw + mw;
  const font = "Verdana,Geneva,DejaVu Sans,PingFang SC,Microsoft YaHei,Noto Sans CJK SC,sans-serif";
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="20" role="img" aria-label="${xml(title)}"><title>${xml(title)}</title><linearGradient id="s" x2="0" y2="100%"><stop offset="0" stop-color="#bbb" stop-opacity=".1"/><stop offset="1" stop-opacity=".1"/></linearGradient><clipPath id="r"><rect width="${w}" height="20" rx="3" fill="#fff"/></clipPath><g clip-path="url(#r)"><rect width="${lw}" height="20" fill="#555"/><rect x="${lw}" width="${mw}" height="20" fill="#${color}"/><rect width="${w}" height="20" fill="url(#s)"/></g><g fill="#fff" text-anchor="middle" font-family="${font}" font-size="11"><text x="${lw / 2}" y="15" fill="#010101" fill-opacity=".3">${xml(label)}</text><text x="${lw / 2}" y="14">${xml(label)}</text><text x="${lw + mw / 2}" y="15" fill="#010101" fill-opacity=".3">${xml(message)}</text><text x="${lw + mw / 2}" y="14">${xml(message)}</text></g></svg>`;
}

export type Badge = { status: number; label: string; message: string; color: string; title: string };

// Which components a request means, or why none.
function scope(p: URLSearchParams): Component[] | null {
  const all = components();
  const component = p.get("component");
  const repo = p.get("repo");
  if (component) return all.filter((c) => c.id === component);
  if (repo) {
    const want = repo.toLowerCase();
    return all.filter((c) => c.repo.toLowerCase() === want || c.repo.split("/")[1].toLowerCase() === want);
  }
  return all;
}

export function badgeFor(p: URLSearchParams): Badge {
  const lang = p.get("lang");
  const custom = (p.get("label") || "").replace(/[\u0000-\u001f\u007f]/g, "").slice(0, 60);
  if (!lang) return { status: 400, label: custom || "translation", message: "lang missing", color: GREY, title: "Translation: lang missing" };
  const label = custom || (isTargetLang(lang) ? LANG_NAMES[lang].native : lang.slice(0, 20));
  const unknown = (): Badge => ({ status: 404, label, message: "unknown", color: GREY, title: `${label}: unknown` });
  if (!isTargetLang(lang)) return unknown();
  const list = scope(p)?.filter((c) => c.targets.includes(lang)) ?? [];
  if (!list.length) return unknown();
  const { done, total } = coverage(
    list.map((c) => c.id),
    lang,
  );
  if (!total) return { status: 200, label, message: "no texts", color: GREY, title: `${label}: no texts yet` };
  const pct = percent(done, total);
  return { status: 200, label, message: `${pct} %`, color: badgeColor(pct), title: `${label}: ${pct} % translated` };
}

export function badgeRoute(request: Request) {
  const p = new URL(request.url).searchParams;
  const badge = badgeFor(p);
  const cache = badge.status === 200 ? "public, max-age=600" : "public, max-age=60";
  if (p.get("format") === "json")
    return new Response(JSON.stringify({ schemaVersion: 1, label: badge.label, message: badge.message, color: badge.color }), {
      status: badge.status,
      headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Cache-Control": cache,
        "X-Content-Type-Options": "nosniff",
        "Access-Control-Allow-Origin": "*",
      },
    });
  return new Response(renderSvg(badge.label, badge.message, badge.color, badge.title), {
    status: badge.status,
    headers: {
      "Content-Type": "image/svg+xml; charset=utf-8",
      "Cache-Control": cache,
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'",
      "Access-Control-Allow-Origin": "*",
    },
  });
}

// The Markdown for a README: the badge, linked to the list of the language.
export function badgeMarkdown(base: string, repo: string, lang: string, linkComponent: string) {
  const name = repo.split("/")[1];
  const label = isTargetLang(lang) ? LANG_NAMES[lang].native : lang;
  return `[![${label}](${base}/api/badge?repo=${encodeURIComponent(name)}&lang=${lang})](${base}/c/${linkComponent}/${lang})`;
}
