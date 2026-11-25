import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, useTempData } from "./helpers";
import { components, parseComponents, txtFiles } from "../lib/components";
import { DatabaseSync } from "node:sqlite";
import { db, migrate, one, SCHEMA_VERSION } from "../lib/db";
import { glossary, languageNote } from "../lib/glossary";

useTempData();

test("components.json: every catalogue, valid, Russian and Polish only for the web app", () => {
  const list = components();
  assert.deepEqual(list.map((c) => c.id), [
    "flowplan-web",
    "flowplan-app-system",
    "flowplan-app-ui",
    "flowplan-app-capture",
    "flowplan-app-intents",
    "flowplan-app-widget-suite",
    "flowplan-app-store",
    "flowplan-desktop",
    "flowplan-website",
    "flowplan-website-demo",
  ]);
  const web = list[0];
  assert.deepEqual(web.targets, ["fr", "zh", "ru", "pl"]);
  for (const c of list.slice(1)) assert.deepEqual(c.targets, ["fr", "zh"], c.id);
  assert.equal((web.files as Record<string, string>).de, "locales/reference/de.json");
  assert.equal((web.files as Record<string, string>).ru, "locales/ru.json");
  assert.equal((web.files as Record<string, string>).pl, "locales/pl.json");
  const store = list.find((c) => c.id === "flowplan-app-store")!;
  assert.equal(txtFiles(store, "zh").get("app-store/name"), "store/app-store/zh-Hans/name.txt");
  assert.equal(txtFiles(store, "zh").get("google-play/title"), "store/google-play/zh-CN/title.txt");
  assert.ok(![...txtFiles(store, "en").values()].some((p) => /release_notes|changelog|url|video/.test(p)), "no release notes, URLs or video");
  assert.deepEqual(store.limits["app-store/keywords"], { bytes: 100, keywords: true });
  const website = list.find((c) => c.id === "flowplan-website")!;
  assert.equal(website.repo, "yannicschuller/flowplan-website");
  assert.equal(website.format, "nested-json");
  assert.equal((website.files as Record<string, string>).zh, "locales/site/zh.json");
  assert.throws(() => parseComponents('{"components":[{"id":"x","repo":"a/b","format":"po","targets":["fr"],"files":{}}]}'), /format/);
  assert.throws(() => parseComponents('{"components":[{"id":"x","repo":"a/b","format":"flat-json","targets":["de"],"files":{}}]}'), /targets/);
  assert.throws(() => parseComponents('{"components":[{"id":"x","repo":"a/b","format":"flat-json","targets":["ru","ru"],"files":{"en":"en.json","ru":"ru.json"}}]}'), /targets/);
  assert.throws(
    () => parseComponents('{"components":[{"id":"x","repo":"a/b","format":"flat-json","targets":["fr","ru"],"files":{"en":"en.json","fr":"fr.json"}}]}'),
    /no valid file for ru/,
  );
  assert.deepEqual(parseComponents('{"components":[{"id":"x","repo":"a/b","format":"flat-json","targets":["ru"],"files":{"en":"en.json","ru":"ru.json"}}]}')[0].targets, ["ru"]);
  assert.throws(
    () => parseComponents('{"components":[{"id":"x","repo":"a/b","format":"flat-json","targets":["fr"],"files":{"en":"../etc/passwd","fr":"fr.json"}}]}'),
    /no valid file for en/,
  );
});

test("database: versioned migrations, components upserted, glossary seeded from the catalogues' renderings", () => {
  db();
  assert.equal(one<{ version: number }>("SELECT version FROM schema_version")!.version, SCHEMA_VERSION);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM components WHERE active=1")!.n, components().length);
  const fr = JSON.parse(readFileSync(join(FIXTURES, "flowplan/locales/fr.json"), "utf8"));
  const zh = JSON.parse(readFileSync(join(FIXTURES, "flowplan/locales/zh.json"), "utf8"));
  for (const term of ["Workspace", "Database", "Page"]) {
    if (fr[term]) assert.equal(glossary("fr").find((g) => g.term === term)!.translation, fr[term]);
    if (zh[term]) assert.equal(glossary("zh").find((g) => g.term === term)!.translation, zh[term]);
  }
  assert.match(languageNote("fr"), /vous/);
  // Russian (migration 4): every core term, and the formal address as the note.
  assert.equal(glossary("ru").length, glossary("fr").length);
  assert.equal(glossary("ru").find((g) => g.term === "Workspace")!.translation, "Рабочее пространство");
  assert.equal(glossary("ru").find((g) => g.term === "Database")!.translation, "База данных");
  assert.equal(glossary("ru").find((g) => g.term === "Journal")!.translation, "Дневник");
  assert.match(languageNote("ru"), /«вы».*never «ты»/);
  // Polish (migration 5): every core term, and the informal address as the note.
  const plFile = JSON.parse(readFileSync(join(FIXTURES, "flowplan/locales/pl.json"), "utf8"));
  assert.ok("Workspace" in plFile, "the fixture catalogue has the web app's keys");
  assert.equal(glossary("pl").length, glossary("fr").length);
  assert.equal(glossary("pl").find((g) => g.term === "Workspace")!.translation, "Obszar roboczy");
  assert.equal(glossary("pl").find((g) => g.term === "Database")!.translation, "Baza danych");
  assert.equal(glossary("pl").find((g) => g.term === "Journal")!.translation, "Dziennik");
  assert.equal(glossary("pl").find((g) => g.term === "Record")!.translation, "Rekord");
  assert.match(glossary("pl").find((g) => g.term === "Record")!.note, /^Deutsch: Eintrag$/);
  assert.match(languageNote("pl"), /„ty”.*never the formal „Pan”/);
  // Seeding never overwrites a reviewer's term: migration 5 again over an edited Polish term.
  const conn = new DatabaseSync(":memory:");
  migrate(conn);
  conn.prepare("UPDATE glossary SET translation=? WHERE lang='pl' AND term='Workspace'").run("Przestrzeń robocza");
  conn.prepare("DELETE FROM glossary WHERE lang='pl' AND term='Tag'").run();
  conn.prepare("UPDATE schema_version SET version=4").run();
  migrate(conn);
  const term = (t: string) => (conn.prepare("SELECT translation FROM glossary WHERE lang='pl' AND term=?").get(t) as { translation: string }).translation;
  assert.equal(term("Workspace"), "Przestrzeń robocza");
  assert.equal(term("Tag"), "Tag");
  assert.equal((conn.prepare("SELECT version FROM schema_version").get() as { version: number }).version, SCHEMA_VERSION);
  conn.close();
});
