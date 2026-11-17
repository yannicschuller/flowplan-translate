import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { FIXTURES, importFixture, signIn, useTempData } from "./helpers";
import { all, one, run } from "../lib/db";
import { counts, entryDetail, listEntries, saveTranslation } from "../lib/store";

useTempData();
const WEB = "flowplan-web";
const read = (p: string) => readFileSync(join(FIXTURES, "flowplan", p), "utf8");
const stringId = (key: string, componentId = WEB) => one<{ id: number }>("SELECT id FROM strings WHERE component_id=? AND key=?", componentId, key)!.id;
const edit = (json: string, changes: Record<string, string>) => {
  const o = JSON.parse(json);
  Object.assign(o, changes);
  return JSON.stringify(o, null, 2) + "\n";
};

test("first sync: source texts, German reference, repo translations count as accepted on the current source", () => {
  const result = importFixture(WEB, "flowplan");
  assert.deepEqual(result.errors, []);
  const en = JSON.parse(read("locales/en.json"));
  assert.equal(result.added, Object.keys(en).length);
  const block = one<{ source: string; de_reference: string }>("SELECT source,de_reference FROM strings WHERE key='Block||account'")!;
  assert.deepEqual({ ...block }, { source: "Block", de_reference: "Sperren" });
  const fr = JSON.parse(read("locales/fr.json"));
  const translated = Object.values(fr).filter(Boolean).length;
  const c = counts(WEB, "fr");
  assert.equal(c.done, translated);
  assert.equal(c.missing, c.total - translated);
  assert.equal(c.outdated, 0);
  assert.equal(c.pending, 0, "imported values are in the repository");
});

test("a missing reference or target file is reported cleanly, a missing source file stops only that component", () => {
  const noRef = importFixture(WEB, "flowplan", { "locales/reference/de.json": null });
  assert.deepEqual(noRef.errors, [], "the reference is optional");
  const noTarget = importFixture(WEB, "flowplan", { "locales/zh.json": null });
  assert.deepEqual(noTarget.errors.map((e) => e.message), ["file not found: locales/zh.json"]);
  const before = one<{ n: number }>("SELECT COUNT(*) AS n FROM strings WHERE component_id=? AND removed=0", WEB)!.n;
  const noSource = importFixture(WEB, "flowplan", { "locales/en.json": null });
  assert.deepEqual(noSource.errors.map((e) => e.message), ["file not found: locales/en.json"]);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM strings WHERE component_id=? AND removed=0", WEB)!.n, before, "nothing hidden");
  const broken = importFixture(WEB, "flowplan", { "locales/en.json": '{"a": ' });
  assert.match(broken.errors[0].message, /locales\/en\.json: invalid JSON/);
  // Components whose catalogues are not in the repository yet.
  const desktop = importFixture("flowplan-desktop", "nowhere");
  assert.deepEqual(desktop.errors.map((e) => e.message), ["file not found: locales/en.json"]);
});

test("a changed source makes the translation outdated until confirmed or changed", () => {
  // nested-json: the source changes, the target stays.
  importFixture("flowplan-app-system", "flowplan-app");
  const id = stringId("ios.NSCameraUsageDescription", "flowplan-app-system");
  assert.equal(entryDetail(id, "fr")!.status, "done");
  const en = readFileSync(join(FIXTURES, "flowplan-app/locales/en.json"), "utf8");
  const changed = en.replace("or scan a document.", "or scan a document or a receipt.");
  importFixture("flowplan-app-system", "flowplan-app", { "locales/en.json": changed });
  assert.equal(entryDetail(id, "fr")!.status, "outdated");
  assert.equal(counts("flowplan-app-system", "fr").outdated, 1);
  assert.deepEqual(
    listEntries({ componentId: "flowplan-app-system", lang: "fr", filter: "outdated" }).rows.map((r) => r.key),
    ["ios.NSCameraUsageDescription"],
  );
  // A translator's "still correct" is a suggestion; the reviewer's is final.
  const translator = signIn("helper").user;
  const reviewer = signIn("yannicschuller").user;
  const current = entryDetail(id, "fr")!.current!.text;
  assert.equal(saveTranslation({ ...translator, role: "translator" }, id, "fr", current).outcome, "suggested");
  assert.equal(entryDetail(id, "fr")!.status, "outdated");
  assert.equal(saveTranslation({ ...reviewer, role: "reviewer" }, id, "fr", current).outcome, "confirmed");
  assert.equal(entryDetail(id, "fr")!.status, "done");
});

test("removed keys are hidden, not deleted, and come back when they return", () => {
  const en = read("locales/en.json");
  const o = JSON.parse(en);
  delete o["Page"];
  importFixture(WEB, "flowplan", { "locales/en.json": JSON.stringify(o, null, 2) + "\n" });
  const row = one<{ removed: number }>("SELECT removed FROM strings WHERE key='Page' AND component_id=?", WEB)!;
  assert.equal(row.removed, 1);
  assert.ok(!listEntries({ componentId: WEB, lang: "fr", filter: "all" }).rows.some((r) => r.key === "Page"));
  assert.ok(one("SELECT 1 FROM translations t JOIN strings s ON s.id=t.string_id WHERE s.key='Page'"), "its translations stay");
  importFixture(WEB, "flowplan");
  assert.equal(one<{ removed: number }>("SELECT removed FROM strings WHERE key='Page' AND component_id=?", WEB)!.removed, 0);
});

test("values edited in the repository are re-imported; a newer unexported tool value is kept and noted", () => {
  const reviewer = { ...signIn("yannicschuller").user, role: "reviewer" as const };
  const fr = read("locales/fr.json");
  // 1. Someone edits fr.json directly: the repository wins.
  importFixture(WEB, "flowplan", { "locales/fr.json": edit(fr, { Database: "Base" }) });
  const db = stringId("Database");
  assert.equal(entryDetail(db, "fr")!.current!.text, "Base");
  assert.equal(entryDetail(db, "fr")!.status, "done");
  // 2. The tool accepts a newer value; the next sync (repo still "Base") keeps the tool's.
  saveTranslation(reviewer, db, "fr", "Base de données");
  const result = importFixture(WEB, "flowplan", { "locales/fr.json": edit(fr, { Database: "Base" }) });
  assert.equal(entryDetail(db, "fr")!.current!.text, "Base de données");
  assert.ok(result.notes.some((n) => n.message.includes("kept the tool's newer accepted value") && n.message.includes("Database")));
  assert.equal(counts(WEB, "fr").pending, 1);
  // 3. Once main has it (merged pull request), it is simply accepted and in the repository.
  run("UPDATE translations SET status='exported',pr_number=7 WHERE id=?", entryDetail(db, "fr")!.current!.id);
  importFixture(WEB, "flowplan", { "locales/fr.json": edit(fr, { Database: "Base de données" }) });
  const current = one<{ status: string; pr_number: number }>("SELECT status,pr_number FROM translations WHERE string_id=? AND lang='fr' AND status IN ('accepted','exported')", db)!;
  assert.equal(current.status, "accepted");
  assert.equal(counts(WEB, "fr").pending, 0);
  // 4. A value cleared in the repository is cleared here too.
  importFixture(WEB, "flowplan", { "locales/fr.json": edit(fr, { Database: "" }) });
  assert.equal(entryDetail(db, "fr")!.status, "missing");
  assert.equal(all("SELECT 1 FROM translations WHERE string_id=? AND lang='fr' AND status='replaced'", db).length >= 2, true);
});

test("txt-files and context files: keys per field, comments as context", () => {
  const store = importFixture("flowplan-app-store", "flowplan-app");
  assert.deepEqual(store.errors, []);
  const keys = all<{ key: string; file: string }>("SELECT key,file FROM strings WHERE component_id='flowplan-app-store' ORDER BY position");
  assert.deepEqual(keys.map((k) => k.key), [
    "app-store/name",
    "app-store/subtitle",
    "app-store/keywords",
    "app-store/promotional_text",
    "app-store/description",
    "google-play/title",
    "google-play/short_description",
    "google-play/full_description",
  ]);
  assert.equal(keys[0].file, "store/app-store/en-US/name.txt");
  const intents = importFixture("flowplan-app-intents", "flowplan-app");
  assert.deepEqual(intents.errors, []);
  const ctx = JSON.parse(readFileSync(join(FIXTURES, "flowplan-app/plugins/intents/locales/context.json"), "utf8"));
  const [key, comment] = Object.entries(ctx)[0] as [string, string];
  assert.equal(one<{ context: string }>("SELECT context FROM strings WHERE component_id='flowplan-app-intents' AND key=?", key)!.context, comment);
});

