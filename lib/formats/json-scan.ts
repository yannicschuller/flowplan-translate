// A small JSON tokenizer that records, for every string value, its key path
// and the exact span of its token in the original text. The writers replace
// only those spans, so order, indentation, escaping style, line endings and
// the trailing newline of a catalogue stay byte for byte as they were.

export type JsonString = { path: string[]; start: number; end: number; value: string };

export class JsonScanError extends Error {
  constructor(message: string, public at: number) {
    super(`${message} at offset ${at}`);
  }
}

export function scanJson(text: string): { strings: JsonString[]; rootIsObject: boolean } {
  const strings: JsonString[] = [];
  let i = text.charCodeAt(0) === 0xfeff ? 1 : 0;

  const ws = () => {
    while (i < text.length) {
      const c = text[i];
      if (c === " " || c === "\t" || c === "\n" || c === "\r") i++;
      else break;
    }
  };
  const string = (): { value: string; start: number; end: number } => {
    const start = i;
    if (text[i] !== '"') throw new JsonScanError("expected a string", i);
    i++;
    let simple = true;
    while (i < text.length) {
      const c = text.charCodeAt(i);
      if (c === 0x22) break;
      if (c === 0x5c) {
        simple = false;
        i += 2;
        continue;
      }
      if (c < 0x20) throw new JsonScanError("control character in string", i);
      i++;
    }
    if (text[i] !== '"') throw new JsonScanError("unterminated string", start);
    i++;
    const raw = text.slice(start, i);
    let value: string;
    try {
      value = simple ? raw.slice(1, -1) : (JSON.parse(raw) as string);
    } catch {
      throw new JsonScanError("invalid escape in string", start);
    }
    return { value, start, end: i };
  };
  const value = (path: string[]): void => {
    ws();
    const c = text[i];
    if (c === "{") {
      i++;
      ws();
      if (text[i] === "}") {
        i++;
        return;
      }
      for (;;) {
        ws();
        const key = string().value;
        ws();
        if (text[i] !== ":") throw new JsonScanError("expected ':'", i);
        i++;
        value([...path, key]);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "}") {
          i++;
          return;
        }
        throw new JsonScanError("expected ',' or '}'", i);
      }
    }
    if (c === "[") {
      i++;
      ws();
      if (text[i] === "]") {
        i++;
        return;
      }
      for (let n = 0; ; n++) {
        value([...path, String(n)]);
        ws();
        if (text[i] === ",") {
          i++;
          continue;
        }
        if (text[i] === "]") {
          i++;
          return;
        }
        throw new JsonScanError("expected ',' or ']'", i);
      }
    }
    if (c === '"') {
      const s = string();
      strings.push({ path, ...s });
      return;
    }
    const m = /^(?:-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|true|false|null)/.exec(text.slice(i, i + 64));
    if (!m) throw new JsonScanError("unexpected character", i);
    i += m[0].length;
  };

  ws();
  const rootIsObject = text[i] === "{";
  value([]);
  ws();
  if (i !== text.length) throw new JsonScanError("unexpected content after the end", i);
  return { strings, rootIsObject };
}

// Replaces spans from the back, so earlier offsets stay valid.
export function replaceSpans(text: string, spans: { start: number; end: number; replacement: string }[]) {
  let out = text;
  for (const s of [...spans].sort((a, b) => b.start - a.start)) out = out.slice(0, s.start) + s.replacement + out.slice(s.end);
  return out;
}
