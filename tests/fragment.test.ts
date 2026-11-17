import { test } from "node:test";
import assert from "node:assert/strict";
import { fragmentNotice, fragmentOf, initialCase, leadingMark, sameMark, trailingMark } from "../lib/fragment";
import { checkTranslation, type CheckInput } from "../lib/checks";
import { translate } from "../lib/i18n";

const hints = (over: Partial<CheckInput>) =>
  checkTranslation({ source: "Save", text: "Enregistrer", format: "flat-json", placeholders: ["brace"], ...over }).hints.map((h) => h.code);

test("initialCase: first letter, after marks and placeholders; names and scripts without case count as none", () => {
  assert.equal(initialCase(" · container in total: {0}"), "lower");
  assert.equal(initialCase("Container insgesamt"), "upper");
  assert.equal(initialCase("{0} items", ["brace"]), "lower", "the placeholder is skipped");
  assert.equal(initialCase("{Name} added", ["brace"]), "lower", "a placeholder's letters don't count");
  assert.equal(initialCase("iCloud sync"), "", "a name with a capital inside");
  assert.equal(initialCase("macOS"), "");
  assert.equal(initialCase(" · 容器总计：{0}", ["brace"]), "", "Chinese has no case");
  assert.equal(initialCase("éléments"), "lower");
  assert.equal(initialCase("123 — …"), "");
});

test("leading and trailing marks: fragment signs, not quotes, brackets or sentence ends", () => {
  assert.equal(leadingMark(" · container"), "·");
  assert.equal(leadingMark("– or later"), "–");
  assert.equal(leadingMark("(optional)"), "", "an opening bracket is ordinary text");
  assert.equal(leadingMark("“Inbox” deleted"), "");
  assert.equal(leadingMark('"Inbox" deleted'), "");
  assert.equal(leadingMark("{0} items", ["brace"]), "", "a placeholder is no mark");
  assert.equal(trailingMark("Name:"), ":");
  assert.equal(trailingMark("Loading..."), "…");
  assert.equal(trailingMark("Loading…"), "…");
  assert.equal(trailingMark("in total: {0}", ["brace"]), "");
  assert.equal(trailingMark("Saved."), "", "a sentence end is no fragment sign");
  assert.equal(trailingMark("Really?"), "");
  assert.equal(trailingMark("(optional)"), "");
  assert.ok(sameMark(":", "："), "full-width counts as the same");
  assert.ok(sameMark("…", "..."));
  assert.ok(!sameMark("·", "-"));
});

test("fragmentOf: the source of the Discord question is a fragment; whole texts are not", () => {
  assert.deepEqual(fragmentOf(" · container in total: {0} (with file cache)", ["brace"]), {
    lowercaseStart: true,
    leadingMark: "·",
    trailingMark: "",
    leadingSpace: true,
    trailingSpace: false,
  });
  assert.equal(fragmentOf("Save"), null);
  assert.equal(fragmentOf("Saved."), null);
  assert.equal(fragmentOf("Delete “{0}”?", ["brace"]), null);
  assert.equal(fragmentOf("iCloud"), null);
  assert.equal(fragmentOf("{0} items", ["brace"])?.lowercaseStart, true);
  assert.equal(fragmentOf("Total: ")?.trailingSpace, true);
});

test("fragmentNotice: names what to keep, in both languages", () => {
  const f = fragmentOf(" · container in total: {0}", ["brace"])!;
  assert.equal(fragmentNotice(f, translate("en")), "Fragment: keep the leading space, the leading ‘·’ and the lowercase start like the source.");
  assert.equal(fragmentNotice(f, translate("de")), "Satzteil: Behalte das Leerzeichen am Anfang, das „·“ am Anfang und den kleinen Anfangsbuchstaben wie im Ausgangstext bei.");
  assert.equal(fragmentNotice(fragmentOf("and more")!, translate("en")), "Fragment: keep the lowercase start like the source.");
});

test("checks: hints when the first letter's case or the leading mark differs (never blocking)", () => {
  const source = " · container in total: {0} (with file cache)";
  assert.deepEqual(hints({ source, text: " · conteneurs au total : {0} (avec cache de fichiers)" }), []);
  assert.deepEqual(hints({ source, text: " · Conteneurs au total : {0} (avec cache de fichiers)" }), ["case_differs"]);
  assert.deepEqual(hints({ source, text: " conteneurs au total : {0} (avec cache de fichiers)" }), ["leading_mark_differs"]);
  assert.deepEqual(hints({ source, text: " · 容器总计：{0}（含文件缓存）" }), [], "Chinese: no case, full-width allowed");
  assert.deepEqual(hints({ source: "Save", text: "enregistrer" }), ["case_differs"]);
  assert.deepEqual(hints({ source: "iCloud sync", text: "Synchronisation iCloud" }), [], "a name in the source has no case");
  assert.deepEqual(hints({ source: "Name:", text: "Nom :" }), []);
  const result = checkTranslation({ source, text: " · Conteneurs : {0}", format: "flat-json", placeholders: ["brace"] });
  assert.deepEqual(result.errors, []);
  assert.deepEqual(result.hints.find((h) => h.code === "case_differs")?.values, ["lower", "upper"]);
});
