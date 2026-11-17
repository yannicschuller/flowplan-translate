import { test } from "node:test";
import assert from "node:assert/strict";
import { checkTranslation, countBytes, countChars, glossaryHits, MAX_INPUT } from "../lib/checks";
import { comparePlaceholders, placeholders } from "../lib/placeholders";
import type { CheckInput } from "../lib/checks";

const codes = (r: { errors: { code: string }[] } | { hints: { code: string }[] }, key: "errors" | "hints") =>
  (r as Record<string, { code: string }[]>)[key].map((i) => i.code);
const check = (over: Partial<CheckInput>) => checkTranslation({ source: "Save", text: "Enregistrer", format: "flat-json", placeholders: ["brace"], ...over });

test("placeholders: brace style {0} {name}", () => {
  assert.deepEqual(placeholders("{0} of {1} – {name}", ["brace"]), ["{0}", "{1}", "{name}"]);
  assert.deepEqual(comparePlaceholders("{0} records", "enregistrements", ["brace"]), { missing: ["{0}"], extra: [] });
  assert.deepEqual(comparePlaceholders("{0} and {0}", "{0}", ["brace"]).missing, ["{0}"], "multiset: twice is twice");
  assert.deepEqual(comparePlaceholders("{0}", "{0} {1}", ["brace"]).extra, ["{1}"]);
  assert.deepEqual(comparePlaceholders("{1} → {0}", "{0} ← {1}", ["brace"]), { missing: [], extra: [] }, "order may change");
});

test("placeholders: printf %@ %d %s %1$s %2$@, and %% is no placeholder", () => {
  assert.deepEqual(placeholders("Added %@, %d items, %s, %1$s of %2$@, 100%% done, %lld", ["printf"]), ["%@", "%d", "%s", "%1$s", "%2$@", "%lld"]);
  assert.deepEqual(comparePlaceholders("%1$s of %2$s", "%2$s sur %1$s", ["printf"]), { missing: [], extra: [] });
  assert.deepEqual(comparePlaceholders("%1$s of %2$s", "%1$s sur %2$d", ["printf"]), { missing: ["%2$s"], extra: ["%2$d"] });
  assert.deepEqual(placeholders("50 % sûr", ["printf"]), []);
});

test("placeholders: ${applicationName} counts once, not also as {applicationName}", () => {
  const styles = ["brace", "printf", "dollar"] as const;
  assert.deepEqual(placeholders("Add a task to ${applicationName}", [...styles]), ["${applicationName}"]);
  assert.deepEqual(comparePlaceholders("Add a task to ${applicationName}", "Ajouter une tâche à {applicationName}", [...styles]), {
    missing: ["${applicationName}"],
    extra: ["{applicationName}"],
  });
  assert.deepEqual(placeholders("{0}", []), [], "a component without placeholder styles");
});

test("checks: blocking errors for placeholders, empty, input cap, control characters", () => {
  assert.deepEqual(codes(check({ source: "{0} records", text: "enregistrements" }), "errors"), ["placeholders_missing"]);
  assert.deepEqual(codes(check({ text: "   " }), "errors"), ["empty"]);
  assert.deepEqual(codes(check({ text: "x".repeat(MAX_INPUT + 1) }), "errors"), ["too_long_input"]);
  assert.deepEqual(codes(check({ text: "Enre\u0007gistrer" }), "errors"), ["control_chars"]);
  assert.deepEqual(codes(check({ text: "Enre\rgistrer" }), "errors"), ["control_chars"]);
  assert.deepEqual(check({ source: "{0} records", text: "{0} enregistrements" }).errors, []);
});

test("checks: limits count code points and bytes like the store test", () => {
  assert.equal(countChars("😀é"), 2);
  assert.equal(countBytes("知识库"), 9);
  assert.equal(countChars("  ab  "), 2, "trimmed");
  const name = { format: "txt-files" as const, placeholders: [], limit: { chars: 30 } };
  assert.deepEqual(check({ ...name, source: "Flowplan – Notes & Projects", text: "Flowplan – Notes et projets" }).errors, []);
  assert.deepEqual(codes(check({ ...name, source: "x", text: "Flowplan – Notes, projets et bien plus" }), "errors"), ["too_many_chars"]);
  // 30 emoji are 30 characters (code points) – allowed.
  assert.deepEqual(check({ ...name, source: "x", text: "😀".repeat(30) }).errors, []);
  const keywords = { format: "txt-files" as const, placeholders: [], limit: { bytes: 100, keywords: true } };
  assert.deepEqual(check({ ...keywords, source: "wiki,tasks", text: "知识库,任务,看板,日记,团队,自托管,待办,习惯,小组件,计划,协作,wiki" }).errors, []);
  assert.deepEqual(codes(check({ ...keywords, source: "a", text: "知识库".repeat(12) }), "errors"), ["too_many_bytes"]);
  assert.deepEqual(codes(check({ ...keywords, source: "a", text: "wiki, tâches" }), "errors"), ["keywords_format"]);
  assert.deepEqual(codes(check({ ...keywords, source: "a", text: "wiki,,tâches" }), "errors"), ["keywords_format"]);
  const repeat = check({ ...keywords, source: "a", text: "wiki,tâches,wiki" });
  assert.deepEqual(codes(repeat, "errors"), ["keywords_repeat"]);
  assert.deepEqual(repeat.errors[0].values, ["wiki"]);
});

test("checks: txt fields – no line breaks in single-line fields, no edge whitespace", () => {
  const txt = { format: "txt-files" as const, placeholders: [] };
  assert.deepEqual(codes(check({ ...txt, source: "Name", text: "Nom\nsuite" }), "errors"), ["line_breaks"]);
  assert.deepEqual(check({ ...txt, source: "A\n\nB", text: "A\n\nB", limit: { multiline: true } }).errors, []);
  assert.deepEqual(codes(check({ ...txt, source: "A", text: "A\n", limit: { multiline: true } }), "errors"), ["edge_whitespace_txt"]);
  assert.deepEqual(codes(check({ ...txt, source: "A", text: " A" }), "errors"), ["edge_whitespace_txt"]);
});

test("checks: hints – whitespace, final punctuation, glossary", () => {
  assert.deepEqual(codes(check({ source: " · {0} failed", text: "· {0} échoué" }), "hints"), ["whitespace_differs"]);
  assert.deepEqual(codes(check({ source: "Saved.", text: "Enregistré" }), "hints"), ["punctuation_differs"]);
  assert.deepEqual(check({ source: "Saved.", text: "已保存。" }).hints, [], "full-width full stop counts as the same");
  assert.deepEqual(check({ source: "Open:", text: "Ouvrir :" }).hints, []);
  const glossary = [{ id: 1, lang: "fr", term: "Workspace", translation: "Espace de travail", note: "" }];
  assert.equal(glossaryHits("Open a workspace", glossary).length, 1);
  assert.equal(glossaryHits("Open all workspaces", glossary).length, 1, "plural");
  assert.equal(glossaryHits("Workspacey", glossary).length, 0, "whole words only");
  const hint = check({ source: "Open a workspace", text: "Ouvrir un bureau", glossary });
  assert.deepEqual(codes(hint, "hints"), ["glossary_unused"]);
  assert.deepEqual(hint.hints[0].values, ["Workspace", "Espace de travail"]);
  assert.deepEqual(check({ source: "Your workspaces", text: "Vos espaces de travail", glossary }).hints, [], "plural of the translation counts");
  assert.deepEqual(check({ source: "Open a workspace", text: "Ouvrir un bureau", glossary }).errors, [], "hints never block");
});

test("placeholders: index style {0} only – a literal {Content} is text", () => {
  assert.deepEqual(placeholders("{0} in {Content}", ["index"]), ["{0}"]);
  assert.deepEqual(comparePlaceholders("{Content}", "{Contenu}", ["index"]), { missing: [], extra: [] });
});
