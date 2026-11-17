// A text with its placeholders as small monospace chips – React elements
// only, the text itself is never treated as HTML.
import { tokenize } from "@/lib/preview";
import type { PlaceholderStyle } from "@/lib/types";

export function PlaceholderText({ text, styles }: { text: string; styles: PlaceholderStyle[] }) {
  return (
    <>
      {tokenize(text, styles).map((s, i) =>
        s.kind === "placeholder" ? (
          <span key={i} className="ph">
            {s.text}
          </span>
        ) : (
          <span key={i}>{s.text}</span>
        ),
      )}
    </>
  );
}
