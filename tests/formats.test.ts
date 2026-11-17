import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { adapters, FormatError } from "../lib/formats";
import { FIXTURES } from "./helpers";

const fixture = (...p: string[]) => readFileSync(join(FIXTURES, ...p), "utf8");
const flat = adapters["flat-json"];
const nested = adapters["nested-json"];
const txt = adapters["txt-files"];

// The lines that differ between two texts.
function diffLines(a: string, b: string) {
  const x = a.split("\n");
  const y = b.split("\n");
  assert.equal(x.length, y.length, "line count changed");
  return x.map((line, i) => (line === y[i] ? -1 : i)).filter((i) => i >= 0);
}

test("flat-json: reads keys in file order, incl. ||context keys, unicode and escapes", () => {
  const entries = flat.read(fixture("flowplan/locales/en.json"));
  const keys = entries.map((e) => e.key);
  assert.ok(keys.includes("Block||account"));
  assert.equal(entries.find((e) => e.key === "Block||account")!.text, "Block");
  const quoted = entries.find((e) => e.key.startsWith("<aside"))!;
  assert.equal(quoted.text, '<aside data-callout="true"><p>💡 A callout for what matters.</p></aside>');
  assert.ok(entries.some((e) => e.text.includes("\n")), "escaped line breaks are decoded");
  assert.deepEqual(keys, Object.keys(JSON.parse(fixture("flowplan/locales/en.json"))));
});

test("flat-json: write without changes is byte-identical (LF and CRLF)", () => {
  for (const name of ["en", "fr", "zh"]) {
    const original = fixture(`flowplan/locales/${name}.json`);
    assert.equal(flat.write(original, new Map()).content, original);
    const crlf = original.replace(/\n/g, "\r\n");
    assert.equal(flat.write(crlf, new Map()).content, crlf);
    // Writing every value as it is changes nothing either.
    const same = new Map(flat.read(original).map((e) => [e.key, e.text]));
    assert.equal(flat.write(original, same).content, original);
  }
});

test("flat-json: one change changes exactly one line, escaped like JSON.stringify", () => {
  const original = fixture("flowplan/locales/fr.json");
  const value = 'Bloquer « compte » – "vraiment"\nzwei Zeilen \\ é 中';
  const { content, missing } = flat.write(original, new Map([["Block||account", value]]));
  assert.deepEqual(missing, []);
  const changed = diffLines(original, content);
  assert.equal(changed.length, 1);
  assert.equal(content.split("\n")[changed[0]], `  "Block||account": ${JSON.stringify(value)},`);
  assert.equal(JSON.parse(content)["Block||account"], value);
  // Same as the generator (JSON.stringify(obj, null, 2) + "\n") would write.
  const obj = JSON.parse(original);
  obj["Block||account"] = value;
  assert.equal(content, JSON.stringify(obj, null, 2) + "\n");
});

test("flat-json: CRLF file keeps CRLF after a change; missing keys are reported, never added", () => {
  const crlf = fixture("flowplan/locales/zh.json").replace(/\n/g, "\r\n");
  const { content, missing } = flat.write(crlf, new Map([["Page", "页"], ["Not in the file", "x"]]));
  assert.deepEqual(missing, ["Not in the file"]);
  assert.ok(!content.replace(/\r\n/g, "").includes("\n"), "no bare LF");
  assert.equal(diffLines(crlf, content).length, 1);
  assert.equal(Object.keys(JSON.parse(content)).length, Object.keys(JSON.parse(crlf)).length);
});

test("flat-json: keeps an original escaping style it does not touch", () => {
  const original = '{\n  "a": "caf\\u00e9",\n  "b": "x"\n}\n';
  const { content } = flat.write(original, new Map([["b", "y"]]));
  assert.equal(content, '{\n  "a": "caf\\u00e9",\n  "b": "y"\n}\n');
  assert.equal(flat.read(original)[0].text, "café");
});

test("flat-json: invalid JSON is a FormatError", () => {
  assert.throws(() => flat.read('{"a": "b",}'), FormatError);
  assert.throws(() => flat.read('["a"]'), FormatError);
});

test("nested-json: dotted key paths, round trip, minimal change", () => {
  const original = fixture("flowplan-app/locales/fr.json");
  const entries = nested.read(original);
  assert.ok(entries.some((e) => e.key === "ios.NSCameraUsageDescription"));
  assert.ok(entries.some((e) => e.key === "android.share_label"));
  assert.equal(nested.write(original, new Map()).content, original);
  const { content } = nested.write(original, new Map([["ios.NSCameraUsageDescription", "Flowplan utilise l’appareil photo quand vous prenez une photo."]]));
  assert.equal(diffLines(original, content).length, 1);
  assert.equal(JSON.parse(content).ios.NSCameraUsageDescription, "Flowplan utilise l’appareil photo quand vous prenez une photo.");
  assert.deepEqual(nested.write(original, new Map([["ios.Nope", "x"]])).missing, ["ios.Nope"]);
});

test("txt-files: trailing newline kept, absent newline kept, CRLF kept, multi-line text", () => {
  assert.equal(txt.read("Flowplan\n")[0].text, "Flowplan");
  assert.equal(txt.write("Flowplan\n", new Map([["", "Flowplan – Notes"]])).content, "Flowplan – Notes\n");
  assert.equal(txt.write("Flowplan", new Map([["", "Flowplan – Notes"]])).content, "Flowplan – Notes");
  const crlf = "Line one\r\n\r\nLine two\r\n";
  assert.equal(txt.read(crlf)[0].text, "Line one\n\nLine two");
  assert.equal(txt.write(crlf, new Map()).content, crlf);
  assert.equal(txt.write(crlf, new Map([["", "Eins\n\nZwei"]])).content, "Eins\r\n\r\nZwei\r\n");
  const description = fixture("flowplan-app/store/app-store/fr-FR/description.txt");
  const text = txt.read(description)[0].text;
  assert.equal(txt.write(description, new Map([["", text]])).content, description);
  const lines = text.split("\n");
  lines[2] = "UNE LIGNE CHANGÉE";
  const changed = txt.write(description, new Map([["", lines.join("\n")]])).content;
  assert.equal(diffLines(description, changed).length, 1);
});
