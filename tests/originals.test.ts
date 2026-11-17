import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, importFixture, req, signIn, useTempData } from "./helpers";
import { one } from "../lib/db";
import { handle } from "../lib/http";
import { confirmRoute, saveRoute } from "../lib/routes";
import { listOriginals, originalCounts, originalDetail } from "../lib/store";
import { formatDateTime } from "../lib/i18n";
import { config, validTimeZone } from "../lib/config";

useTempData();
importFixture("flowplan-web", "flowplan");
importFixture("flowplan-app-store", "flowplan-app");
const de = JSON.parse(readFileSync(join(FIXTURES, "flowplan/locales/reference/de.json"), "utf8")) as Record<string, string>;

test("originals: the overview counts every English text and the German ones", () => {
  const o = originalCounts("flowplan-web");
  assert.equal(o.total, Object.keys(de).length);
  assert.equal(o.german, Object.values(de).filter(Boolean).length);
  assert.ok(o.german < o.total, "the fixture has texts that are only in the code");
  assert.deepEqual(originalCounts("flowplan-app-store"), { total: 8, german: 8 }, "store: de-DE/*.txt");
});

test("originals: the German list is browsable and searchable, a missing German text is empty", () => {
  const all = listOriginals({ componentId: "flowplan-web" });
  assert.equal(all.total, Object.keys(de).length);
  assert.equal(all.rows[0].key, Object.keys(de)[0]);
  const found = listOriginals({ componentId: "flowplan-web", q: "Arbeitsbereich" });
  assert.deepEqual(found.rows.map((r) => [r.key, r.german]), [["Workspace", "Arbeitsbereich"]]);
  const onlyInCode = Object.keys(de).find((k) => !de[k])!;
  const row = listOriginals({ componentId: "flowplan-web", q: onlyInCode }).rows.find((r) => r.key === onlyInCode)!;
  assert.equal(row.german, "");
  const store = listOriginals({ componentId: "flowplan-app-store", q: "Notizen" });
  assert.ok(store.rows.some((r) => r.key === "app-store/description"));
  const id = one<{ id: number }>("SELECT id FROM strings WHERE component_id='flowplan-web' AND key='Workspace'")!.id;
  const detail = originalDetail(id)!;
  assert.equal(detail.string.de_reference, "Arbeitsbereich");
  assert.deepEqual(detail.glossary.map((g) => [g.lang, g.hits.map((h) => h.translation)]), [["fr", ["Espace de travail"]], ["zh", ["工作区"]]]);
});

test("originals: saving or confirming English or German is refused with 400", async () => {
  const { cookie } = signIn("yannicschuller");
  const id = one<{ id: number }>("SELECT id FROM strings WHERE component_id='flowplan-web' AND key='Workspace'")!.id;
  for (const lang of ["en", "de"]) {
    const save = await handle(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: id, lang, text: "Workspace!" }, cookie })));
    assert.equal(save.status, 400, `save ${lang}`);
    const confirm = await handle(() => confirmRoute(req("/api/translations/confirm", { method: "POST", json: { stringId: id, lang }, cookie })));
    assert.equal(confirm.status, 400, `confirm ${lang}`);
  }
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM translations WHERE lang IN ('en','de')")!.n, 0);
});

test("dates in TRANSLATE_TIME_ZONE (default Europe/Berlin), an unknown zone falls back", () => {
  const at = Date.UTC(2026, 0, 15, 12, 0);
  delete process.env.TRANSLATE_TIME_ZONE;
  assert.equal(config.timeZone(), "Europe/Berlin");
  assert.match(formatDateTime("de", at, config.timeZone()), /13:00/);
  process.env.TRANSLATE_TIME_ZONE = "America/New_York";
  assert.match(formatDateTime("en", at, config.timeZone()), /07:00/);
  process.env.TRANSLATE_TIME_ZONE = "UTC";
  assert.match(formatDateTime("en", at, config.timeZone()), /12:00/);
  const errors: unknown[] = [];
  const log = console.error;
  console.error = (...args: unknown[]) => errors.push(args);
  try {
    assert.equal(validTimeZone("Mars/Olympus_Mons"), "Europe/Berlin");
    assert.equal(validTimeZone("Mars/Olympus_Mons"), "Europe/Berlin");
  } finally {
    console.error = log;
  }
  assert.equal(errors.length, 1, "logged once");
  delete process.env.TRANSLATE_TIME_ZONE;
});
