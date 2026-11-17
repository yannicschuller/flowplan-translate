import { test } from "node:test";
import assert from "node:assert/strict";
import { fillPreview, placeholderUsage, sampleValue, sampleValues, tokenize } from "../lib/preview";

test("tokenize: plain text and placeholder chips per style, %% stays text", () => {
  assert.deepEqual(tokenize("· container in total: {0} (with file cache)", ["index"]), [
    { kind: "text", text: "· container in total: " },
    { kind: "placeholder", text: "{0}" },
    { kind: "text", text: " (with file cache)" },
  ]);
  assert.deepEqual(
    tokenize("Add a task to ${applicationName}: %1$s, 100%% %d", ["brace", "printf", "dollar"]).map((s) => [s.kind, s.text]),
    [
      ["text", "Add a task to "],
      ["placeholder", "${applicationName}"],
      ["text", ": "],
      ["placeholder", "%1$s"],
      ["text", ", 100%% "],
      ["placeholder", "%d"],
    ],
  );
  assert.deepEqual(tokenize("{Content}", ["index"]), [{ kind: "text", text: "{Content}" }]);
  assert.deepEqual(tokenize("", ["index"]), []);
  assert.deepEqual(tokenize("x {0}", []), [{ kind: "text", text: "x {0}" }]);
});

test("placeholderUsage: each source placeholder once, with how often each text uses it", () => {
  assert.deepEqual(placeholderUsage("%@: %@ ({0})", "%@ ({0}) {0}", ["printf", "index"]), [
    { token: "%@", want: 2, have: 1 },
    { token: "{0}", want: 1, have: 2 },
  ]);
  assert.deepEqual(placeholderUsage("Nothing here", "Rien", ["index"]), []);
});

test("sample values: numbers, names, words; per language", () => {
  assert.equal(sampleValue("{0}", "en", 0), "3");
  assert.equal(sampleValue("{1}", "en", 1), "Page A");
  assert.equal(sampleValue("{2}", "de", 2), "Seite B");
  assert.equal(sampleValue("%d", "en"), "3");
  assert.equal(sampleValue("%2$lld", "en"), "3");
  assert.equal(sampleValue("%@", "de"), "Beispiel");
  assert.equal(sampleValue("%1$s", "en"), "Example");
  assert.equal(sampleValue("{server}", "en"), "app.flowplan.org");
  assert.equal(sampleValue("{count}", "en"), "3");
  assert.equal(sampleValue("{target}", "en"), "target");
  assert.equal(sampleValue("${applicationName}", "en"), "Flowplan");
  assert.deepEqual(sampleValues("{1} of {0}", ["index"], "en"), { "{1}": "3", "{0}": "Page A" }, "in order of appearance");
});

test("fillPreview: values filled in as plain text, unknown placeholders and line breaks kept", () => {
  const values = { "{0}": "3", "%@": "<b>Beispiel</b>" };
  assert.equal(fillPreview("· {0} au total\n(cache)", ["index"], values), "· 3 au total\n(cache)");
  assert.equal(fillPreview("Ajoutée à %@ – {1}", ["printf", "index"], values), "Ajoutée à <b>Beispiel</b> – {1}");
  assert.equal(fillPreview("100%% %@", ["printf"], values), "100%% <b>Beispiel</b>");
});
