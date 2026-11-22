// components.json: which catalogues of which repositories are translated
// here. Read and checked at start; every component is upserted into the
// components table (one that left the file is kept, but hidden).
import { readFileSync, statSync } from "node:fs";
import type { DatabaseSync } from "node:sqlite";
import { config } from "./config";
import { FORMATS, PLACEHOLDER_STYLES, TARGET_LANGS, isTargetLang, type Component, type Limit, type TxtGroup } from "./types";

const cache = globalThis as unknown as { translateComponents?: { file: string; mtime: number; list: Component[] } };

const fail = (message: string): never => {
  throw new Error(`components.json: ${message}`);
};
const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isPath = (v: unknown) => typeof v === "string" && /^[\w.@{}-]+(\/[\w.@{}-]+)*$/.test(v) && !v.split("/").includes("..");

export function parseComponents(raw: string): Component[] {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return fail("not valid JSON");
  }
  if (!isRecord(data) || !Array.isArray(data.components)) return fail('expected { "components": [ … ] }');
  const seen = new Set<string>();
  return data.components.map((c: unknown, i: number): Component => {
    if (!isRecord(c)) return fail(`component ${i} is not an object`);
    const id = typeof c.id === "string" && /^[a-z0-9][a-z0-9-]{0,63}$/.test(c.id) ? c.id : fail(`component ${i}: id must be lowercase letters, digits and dashes`);
    if (seen.has(id)) fail(`duplicate id ${id}`);
    seen.add(id);
    const where = `component ${id}`;
    const repo = typeof c.repo === "string" && /^[\w.-]+\/[\w.-]+$/.test(c.repo) ? c.repo : fail(`${where}: repo must be owner/name`);
    const format = FORMATS.find((f) => f === c.format) ?? fail(`${where}: format must be one of ${FORMATS.join(", ")}`);
    const source = typeof c.source === "string" ? c.source : "en";
    const reference = typeof c.reference === "string" ? c.reference : undefined;
    const targets =
      Array.isArray(c.targets) && c.targets.length && c.targets.every(isTargetLang) && new Set(c.targets).size === c.targets.length
        ? c.targets
        : fail(`${where}: targets must be a non-empty list of ${TARGET_LANGS.join(", ")}, each once`);
    const langs = [source, ...(reference ? [reference] : []), ...targets];
    let files: Component["files"];
    if (format === "txt-files") {
      if (!Array.isArray(c.files) || !c.files.length) return fail(`${where}: files must be a list of groups`);
      files = c.files.map((g: unknown, n: number): TxtGroup => {
        if (!isRecord(g) || typeof g.key !== "string" || !isPath(g.path) || !isRecord(g.locales) || !Array.isArray(g.fields))
          return fail(`${where}: files[${n}] needs key, path, locales and fields`);
        for (const lang of langs) if (typeof g.locales[lang] !== "string") fail(`${where}: files[${n}] has no locale folder for ${lang}`);
        if (!g.fields.every((f) => typeof f === "string" && /^[\w-]+$/.test(f))) fail(`${where}: files[${n}].fields`);
        return { key: g.key, path: g.path as string, locales: g.locales as Record<string, string>, fields: g.fields as string[] };
      });
    } else {
      if (!isRecord(c.files)) return fail(`${where}: files must map languages to paths`);
      for (const lang of langs) if (!isPath(c.files[lang])) fail(`${where}: no valid file for ${lang}`);
      files = c.files as Record<string, string>;
    }
    if (c.context !== undefined && !isPath(c.context)) fail(`${where}: context must be a path`);
    const placeholders = Array.isArray(c.placeholders) ? c.placeholders : [];
    if (!placeholders.every((p) => (PLACEHOLDER_STYLES as readonly unknown[]).includes(p))) fail(`${where}: placeholders must be of ${PLACEHOLDER_STYLES.join(", ")}`);
    const limits = isRecord(c.limits) ? (c.limits as Record<string, Limit>) : {};
    return {
      id,
      title: typeof c.title === "string" ? c.title : id,
      repo,
      branch: typeof c.branch === "string" && /^[\w./-]+$/.test(c.branch) ? c.branch : "main",
      format,
      source,
      reference,
      targets,
      files,
      context: typeof c.context === "string" ? c.context : undefined,
      placeholders: placeholders as Component["placeholders"],
      limits,
    };
  });
}

export function components(): Component[] {
  const file = config.componentsFile();
  const mtime = statSync(file).mtimeMs;
  const cached = cache.translateComponents;
  if (cached && cached.file === file && cached.mtime === mtime) return cached.list;
  const list = parseComponents(readFileSync(file, "utf8"));
  cache.translateComponents = { file, mtime, list };
  return list;
}
export const component = (id: string) => components().find((c) => c.id === id) ?? null;
export const repos = () => [...new Set(components().map((c) => c.repo))];
export const componentsOf = (repo: string) => components().filter((c) => c.repo === repo);

export function upsertComponents(conn: DatabaseSync, list = components()) {
  const at = Date.now();
  const stmt = conn.prepare(
    "INSERT INTO components(id,title,repo,format,config,active,updated_at) VALUES(?,?,?,?,?,1,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,repo=excluded.repo,format=excluded.format,config=excluded.config,active=1,updated_at=excluded.updated_at",
  );
  conn.exec("BEGIN");
  try {
    conn.prepare(`UPDATE components SET active=0 WHERE id NOT IN (${list.map(() => "?").join(",") || "''"})`).run(...list.map((c) => c.id));
    for (const c of list) stmt.run(c.id, c.title, c.repo, c.format, JSON.stringify(c), at);
    conn.exec("COMMIT");
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  }
}

// ---- Files of a component ----

const fill = (pattern: string, field: string, locale: string) => pattern.replaceAll("{field}", field).replaceAll("{locale}", locale);

// flat-json / nested-json: the one file of a language.
export function catalogueFile(c: Component, lang: string): string | null {
  return Array.isArray(c.files) ? null : (c.files[lang] ?? null);
}
// txt-files: key → file of a language, in the order of components.json.
export function txtFiles(c: Component, lang: string): Map<string, string> {
  const map = new Map<string, string>();
  if (!Array.isArray(c.files)) return map;
  for (const g of c.files) for (const field of g.fields) map.set(fill(g.key, field, g.locales[lang]), fill(g.path, field, g.locales[lang]));
  return map;
}
// Every path a sync reads for a component.
export function allPaths(c: Component): string[] {
  const langs = [c.source, ...(c.reference ? [c.reference] : []), ...c.targets];
  const paths = Array.isArray(c.files) ? langs.flatMap((l) => [...txtFiles(c, l).values()]) : langs.map((l) => catalogueFile(c, l)!);
  if (c.context) paths.push(c.context);
  return [...new Set(paths)];
}
