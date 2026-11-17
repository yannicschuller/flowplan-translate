import { test } from "node:test";
import assert from "node:assert/strict";
import { importFixture, req, signIn, useTempData } from "./helpers";
import { one } from "../lib/db";
import { badgeColor, badgeMarkdown, coverage, renderSvg, textWidth } from "../lib/badge";
import { badgeRoute } from "../lib/routes";
import { counts, saveTranslation } from "../lib/store";
import { handle } from "../lib/http";
import { componentsOf } from "../lib/components";

useTempData();
importFixture("flowplan-web", "flowplan");
importFixture("flowplan-app-system", "flowplan-app");
importFixture("flowplan-app-ui", "flowplan-app");
const get = (query: string, init: RequestInit = {}) => handle(() => badgeRoute(req(`/api/badge?${query}`, init)));
const pct = (componentIds: string[], lang: string) => {
  const c = coverage(componentIds, lang);
  return Math.floor((c.done / c.total) * 100);
};

test("colours exactly as flowplan's README script", () => {
  assert.equal(badgeColor(100), "2ea44f");
  assert.equal(badgeColor(99), "a3c51c");
  assert.equal(badgeColor(90), "a3c51c");
  assert.equal(badgeColor(89), "dfb317");
  assert.equal(badgeColor(50), "dfb317");
  assert.equal(badgeColor(49), "e05d44");
  assert.equal(badgeColor(0), "e05d44");
});

test("coverage counts like the overview, per component, repository and everything", async () => {
  const web = counts("flowplan-web", "fr");
  assert.deepEqual(coverage(["flowplan-web"], "fr"), { total: web.total, done: web.done });
  const expected = Math.floor((web.done / web.total) * 100);
  const svg = await get("component=flowplan-web&lang=fr");
  assert.equal(svg.status, 200);
  const body = await svg.text();
  assert.match(body, new RegExp(`>${expected} %</text>`));
  assert.match(body, /<title>Français: \d+ % translated<\/title>/);
  assert.match(body, new RegExp(`fill="#${badgeColor(expected)}"`));
  // A repository by name or owner/name: all its components together.
  const appIds = componentsOf("yannicschuller/flowplan-app").map((c) => c.id);
  const appPct = pct(appIds, "zh");
  for (const repo of ["flowplan-app", "yannicschuller/flowplan-app", "Flowplan-App"]) {
    const json = await get(`repo=${repo}&lang=zh&format=json`);
    assert.deepEqual(await json.json(), { schemaVersion: 1, label: "简体中文", message: `${appPct} %`, color: badgeColor(appPct) });
    assert.equal(json.headers.get("access-control-allow-origin"), "*");
  }
  const everything = await (await get("lang=fr&format=json")).json();
  assert.equal(everything.message, `${pct(["flowplan-web", "flowplan-app-system", "flowplan-app-ui"], "fr")} %`, "components without texts add nothing");
  // An outdated translation no longer counts; a new accepted one does.
  const reviewer = { ...signIn("yannicschuller").user, role: "reviewer" as const };
  const missing = one<{ id: number }>(
    "SELECT s.id FROM strings s WHERE s.component_id='flowplan-web' AND NOT EXISTS (SELECT 1 FROM translations t WHERE t.string_id=s.id AND t.lang='fr' AND t.status IN ('accepted','exported'))",
  )!.id;
  const before = coverage(["flowplan-web"], "fr").done;
  const source = one<{ source: string }>("SELECT source FROM strings WHERE id=?", missing)!.source;
  saveTranslation(reviewer, missing, "fr", `${source} (fr)`);
  assert.equal(coverage(["flowplan-web"], "fr").done, before + 1);
});

test("headers: SVG type, cache, nosniff, restrictive CSP; no cookies set or read", async () => {
  const r = await get("repo=flowplan&lang=fr", { headers: { cookie: "ft_session=whatever" } });
  assert.equal(r.headers.get("content-type"), "image/svg+xml; charset=utf-8");
  assert.equal(r.headers.get("cache-control"), "public, max-age=600");
  assert.equal(r.headers.get("x-content-type-options"), "nosniff");
  assert.match(r.headers.get("content-security-policy")!, /^default-src 'none'/);
  assert.equal(r.headers.get("set-cookie"), null);
  const body = await r.text();
  assert.doesNotMatch(body, /<style|<script|style=/);
  const json = await get("repo=flowplan&lang=fr&format=json");
  assert.equal(json.headers.get("set-cookie"), null);
  assert.equal(json.headers.get("content-type"), "application/json; charset=utf-8");
});

test("400 without lang, grey 404 for unknown language, repository or component", async () => {
  const noLang = await get("repo=flowplan");
  assert.equal(noLang.status, 400);
  assert.match(await noLang.text(), /fill="#9f9f9f"/);
  for (const q of ["lang=xx", "lang=de", "repo=nope&lang=fr", "component=nope&lang=fr", "repo=someone/flowplan-x&lang=fr"]) {
    const r = await get(`${q}&format=json`);
    assert.equal(r.status, 404, q);
    const data = await r.json();
    assert.equal(data.message, "unknown");
    assert.equal(data.color, "9f9f9f");
  }
});

test("escaping, label override and CJK width", async () => {
  const r = await get(`component=flowplan-web&lang=fr&label=${encodeURIComponent('<b>"Fr" & co</b>')}`);
  const body = await r.text();
  assert.match(body, /&lt;b&gt;&quot;Fr&quot; &amp; co&lt;\/b&gt;/);
  assert.doesNotMatch(body, /<b>/);
  const svg = renderSvg("A<&>", "1 %", "2ea44f", "t'it\"le");
  assert.match(svg, /<title>t&apos;it&quot;le<\/title>/);
  // Four CJK characters are as wide as about eight Latin ones.
  assert.ok(textWidth("简体中文") >= 2 * textWidth("abcd") * 0.95, `${textWidth("简体中文")} vs ${textWidth("abcd")}`);
  assert.ok(textWidth("简体中文") > textWidth("Français"));
  const zh = renderSvg("简体中文", "97 %", "a3c51c", "x");
  const width = Number(/width="(\d+)"/.exec(zh)![1]);
  assert.equal(width, textWidth("简体中文") + textWidth("97 %") + 24);
});

test("the Markdown snippet for a README", () => {
  assert.equal(
    badgeMarkdown("https://translate.flowplan.org", "yannicschuller/flowplan", "fr", "flowplan-web"),
    "[![Français](https://translate.flowplan.org/api/badge?repo=flowplan&lang=fr)](https://translate.flowplan.org/c/flowplan-web/fr)",
  );
});
