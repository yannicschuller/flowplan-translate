// The format adapters: one interface for the three catalogue formats.
//   read(content)            → the entries in file order
//   write(original, changes) → the new content, changed only at the values
//                              of changed keys; keys not in the file are
//                              reported as missing and never added.
// txt-files: one file per entry; its single entry has the key "".
import type { Format } from "../types";
import { JsonScanError, replaceSpans, scanJson } from "./json-scan";

export type Entry = { key: string; text: string };
export type WriteResult = { content: string; missing: string[] };
export interface Adapter {
  read(content: string): Entry[];
  write(original: string, changes: Map<string, string>): WriteResult;
}

export class FormatError extends Error {}

// Escaping like JSON.stringify: quotes, backslashes and control characters,
// everything else (non-ASCII too) as it is.
const encodeJsonString = (text: string) => JSON.stringify(text);

function jsonAdapter(nested: boolean): Adapter {
  const keyOf = (path: string[]) => (nested ? path.join(".") : path.length === 1 ? path[0] : null);
  const scan = (content: string) => {
    try {
      const result = scanJson(content);
      if (!result.rootIsObject) throw new FormatError("the catalogue is not a JSON object");
      return result.strings;
    } catch (error) {
      if (error instanceof JsonScanError) throw new FormatError(`invalid JSON: ${error.message}`);
      throw error;
    }
  };
  return {
    read(content) {
      const entries: Entry[] = [];
      for (const s of scan(content)) {
        const key = keyOf(s.path);
        if (key !== null) entries.push({ key, text: s.value });
      }
      return entries;
    },
    write(original, changes) {
      const spans: { start: number; end: number; replacement: string }[] = [];
      const found = new Set<string>();
      for (const s of scan(original)) {
        const key = keyOf(s.path);
        if (key === null || !changes.has(key)) continue;
        found.add(key);
        const text = changes.get(key)!;
        if (text !== s.value) spans.push({ start: s.start, end: s.end, replacement: encodeJsonString(text) });
      }
      return { content: replaceSpans(original, spans), missing: [...changes.keys()].filter((k) => !found.has(k)) };
    },
  };
}

// A plain-text file: the text is the content without its trailing line
// breaks, with \n inside. Writing keeps the file's line ending style (LF or
// CRLF) and its trailing line breaks (none, one or more) as they were.
export const txtAdapter: Adapter = {
  read(content) {
    const body = content.replace(/^﻿/, "").replace(/(?:\r?\n)+$/, "");
    return [{ key: "", text: body.replace(/\r\n/g, "\n") }];
  },
  write(original, changes) {
    if (!changes.has("")) return { content: original, missing: [] };
    const bom = original.startsWith("﻿") ? "﻿" : "";
    const trailing = /(?:\r?\n)*$/.exec(original)![0];
    const eol = original.includes("\r\n") ? "\r\n" : "\n";
    const body = changes.get("")!.replace(/\r\n?/g, "\n").replace(/\n/g, eol);
    const next = bom + body + (original ? trailing : "\n");
    return { content: next, missing: [] };
  },
};

export const adapters: Record<Format, Adapter> = {
  "flat-json": jsonAdapter(false),
  "nested-json": jsonAdapter(true),
  "txt-files": txtAdapter,
};
