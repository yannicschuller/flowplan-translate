// Sync: reads a repository's catalogues from GitHub (main, with the
// installation token) and brings the database up to date:
//  - new source texts appear, removed ones are hidden (never deleted),
//    changed ones get a new source_hash – their translations are outdated
//    until someone confirms or changes them;
//  - target-language values are re-imported: a value someone edited in the
//    repository directly wins and becomes the accepted one, unless the tool
//    holds a newer accepted value that is not in the repository yet – then
//    the tool's is kept and a note says so.
import { all, now, one, run, transaction } from "./db";
import { sha256 } from "./secret";
import { adapters, FormatError, type Entry } from "./formats";
import { allPaths, catalogueFile, componentsOf, txtFiles } from "./components";
import { repoClient, GitHubError } from "./github";
import type { Component } from "./types";

export type SyncProblem = { component: string | null; message: string };
export type ImportResult = { errors: SyncProblem[]; notes: SyncProblem[]; added: number; changed: number; removed: number; imported: number };

type SourceEntry = { key: string; text: string; file: string };
type Snapshot = Map<string, string | null>;

// The entries of one language: key → text (null: the file is not there).
function readLanguage(c: Component, lang: string, files: Snapshot, problems: SyncProblem[]): { entries: SourceEntry[]; missingFiles: string[] } | null {
  const missingFiles: string[] = [];
  if (c.format === "txt-files") {
    const entries: SourceEntry[] = [];
    for (const [key, path] of txtFiles(c, lang)) {
      const content = files.get(path);
      if (content === null || content === undefined) {
        missingFiles.push(path);
        continue;
      }
      entries.push({ key, text: adapters["txt-files"].read(content)[0].text, file: path });
    }
    return { entries, missingFiles };
  }
  const path = catalogueFile(c, lang)!;
  const content = files.get(path);
  if (content === null || content === undefined) return { entries: [], missingFiles: [path] };
  try {
    return { entries: adapters[c.format].read(content).map((e: Entry) => ({ ...e, file: path })), missingFiles };
  } catch (error) {
    if (error instanceof FormatError) {
      problems.push({ component: c.id, message: `${path}: ${error.message}` });
      return null;
    }
    throw error;
  }
}

type CurrentRow = { id: number; string_id: number; text: string; status: string };

// Applies one snapshot of a component's files (path → content, null = not
// found) to the database, in one transaction.
export function importSnapshot(c: Component, files: Snapshot, at = now()): ImportResult {
  const result: ImportResult = { errors: [], notes: [], added: 0, changed: 0, removed: 0, imported: 0 };
  const source = readLanguage(c, c.source, files, result.errors);
  if (!source) return result;
  for (const path of source.missingFiles) result.errors.push({ component: c.id, message: `file not found: ${path}` });
  if (!source.entries.length) {
    if (!source.missingFiles.length) result.errors.push({ component: c.id, message: "the source catalogue has no texts" });
    return result;
  }
  const reference = c.reference ? readLanguage(c, c.reference, files, result.notes) : null;
  const referenceMap = new Map((reference?.entries || []).map((e) => [e.key, e.text]));
  let contextMap = new Map<string, string>();
  if (c.context) {
    const content = files.get(c.context);
    if (content) {
      try {
        contextMap = new Map(adapters["flat-json"].read(content).map((e) => [e.key, e.text]));
      } catch {
        result.notes.push({ component: c.id, message: `${c.context}: not a valid { "key": "comment" } file` });
      }
    }
  }
  const targets = new Map<string, Map<string, string>>();
  for (const lang of c.targets) {
    const read = readLanguage(c, lang, files, result.errors);
    if (!read) continue;
    if (c.format !== "txt-files" && read.missingFiles.length) {
      result.errors.push({ component: c.id, message: `file not found: ${read.missingFiles[0]}` });
      continue;
    }
    targets.set(lang, new Map(read.entries.map((e) => [e.key, e.text])));
  }

  const entries = source.entries.filter((e) => e.text.trim() !== "");
  transaction(() => {
    const existing = new Map(
      all<{ id: number; key: string; source: string; de_reference: string; context: string; file: string; position: number; removed: number }>(
        "SELECT id,key,source,de_reference,context,file,position,removed FROM strings WHERE component_id=?",
        c.id,
      ).map((r) => [r.key, r]),
    );
    const ids = new Map<string, { id: number; hash: string }>();
    entries.forEach((e, position) => {
      const hash = sha256(e.text);
      const de = referenceMap.get(e.key) ?? "";
      const context = contextMap.get(e.key) ?? "";
      const old = existing.get(e.key);
      if (!old) {
        const r = run(
          "INSERT INTO strings(component_id,key,source,source_hash,de_reference,context,file,position,removed,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,0,?,?)",
          c.id,
          e.key,
          e.text,
          hash,
          de,
          context,
          e.file,
          position,
          at,
          at,
        );
        ids.set(e.key, { id: Number(r.lastInsertRowid), hash });
        result.added++;
        return;
      }
      ids.set(e.key, { id: old.id, hash });
      if (old.source !== e.text || old.de_reference !== de || old.context !== context || old.file !== e.file || old.position !== position || old.removed) {
        if (old.source !== e.text) result.changed++;
        run(
          "UPDATE strings SET source=?,source_hash=?,de_reference=?,context=?,file=?,position=?,removed=0,updated_at=? WHERE id=?",
          e.text,
          hash,
          de,
          context,
          e.file,
          position,
          at,
          old.id,
        );
      }
    });
    for (const [key, old] of existing)
      if (!ids.has(key) && !old.removed) {
        run("UPDATE strings SET removed=1,updated_at=? WHERE id=?", at, old.id);
        result.removed++;
      }

    // Target languages: re-import what the repository holds.
    for (const [lang, values] of targets) {
      const current = new Map(
        all<CurrentRow>(
          "SELECT t.id,t.string_id,t.text,t.status FROM translations t JOIN strings s ON s.id=t.string_id WHERE s.component_id=? AND t.lang=? AND t.status IN ('accepted','exported')",
          c.id,
          lang,
        ).map((r) => [r.string_id, r]),
      );
      const repoValues = new Map(
        all<{ string_id: number; text: string }>(
          "SELECT r.string_id,r.text FROM repo_values r JOIN strings s ON s.id=r.string_id WHERE s.component_id=? AND r.lang=?",
          c.id,
          lang,
        ).map((r) => [r.string_id, r.text]),
      );
      const kept: string[] = [];
      for (const e of entries) {
        const { id, hash } = ids.get(e.key)!;
        const repoText = values.get(e.key) ?? "";
        const cur = current.get(id);
        const before = repoValues.get(id);
        if (!cur) {
          if (repoText) {
            acceptFromRepo(id, lang, repoText, hash, at);
            result.imported++;
          }
        } else if (cur.text === repoText) {
          // In the repository now (e.g. a merged pull request).
          if (cur.status === "exported") run("UPDATE translations SET status='accepted',updated_at=? WHERE id=?", at, cur.id);
        } else if (before !== undefined && cur.text === before) {
          // The tool was in step with the repository, and the repository
          // changed: someone edited the file directly – the repository wins.
          run("UPDATE translations SET status='replaced',updated_at=? WHERE id=?", at, cur.id);
          if (repoText) acceptFromRepo(id, lang, repoText, hash, at);
          result.imported++;
        } else if (repoText) kept.push(e.key);
        if (before !== repoText) run("INSERT INTO repo_values(string_id,lang,text) VALUES(?,?,?) ON CONFLICT(string_id,lang) DO UPDATE SET text=excluded.text", id, lang, repoText);
      }
      if (kept.length)
        result.notes.push({
          component: c.id,
          message: `${lang}: kept the tool's newer accepted value for ${kept.length} ${kept.length === 1 ? "key" : "keys"} that differ in the repository (${kept.slice(0, 5).join(", ")}${kept.length > 5 ? ", …" : ""})`,
        });
    }
  });
  return result;
}

function acceptFromRepo(stringId: number, lang: string, text: string, hash: string, at: number) {
  run("INSERT INTO translations(string_id,lang,text,based_on_hash,status,created_at,updated_at) VALUES(?,?,?,?,'accepted',?,?)", stringId, lang, text, hash, at, at);
}

// ---- From GitHub ----

export type SyncState = { repo: string; sha: string; synced_at: number | null; errors: SyncProblem[]; notes: SyncProblem[] };

export function syncState(repo: string): SyncState {
  const row = one<{ repo: string; sha: string; synced_at: number | null; errors: string; notes: string }>("SELECT * FROM sync_state WHERE repo=?", repo);
  return row ? { ...row, errors: JSON.parse(row.errors), notes: JSON.parse(row.notes) } : { repo, sha: "", synced_at: null, errors: [], notes: [] };
}
function saveState(repo: string, sha: string, errors: SyncProblem[], notes: SyncProblem[], at: number) {
  run(
    "INSERT INTO sync_state(repo,sha,synced_at,errors,notes) VALUES(?,?,?,?,?) ON CONFLICT(repo) DO UPDATE SET sha=excluded.sha,synced_at=excluded.synced_at,errors=excluded.errors,notes=excluded.notes",
    repo,
    sha,
    at,
    JSON.stringify(errors.slice(0, 100)),
    JSON.stringify(notes.slice(0, 100)),
  );
}

// Runs fn over items with at most `limit` at a time.
async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const i = next++;
        out[i] = await fn(items[i]);
      }
    }),
  );
  return out;
}

export async function syncRepo(repo: string): Promise<SyncState> {
  const list = componentsOf(repo);
  const at = now();
  const errors: SyncProblem[] = [];
  const notes: SyncProblem[] = [];
  let sha = syncState(repo).sha;
  try {
    const client = await repoClient(repo);
    sha = await client.headSha(list[0]?.branch || "main");
    for (const c of list) {
      try {
        const paths = allPaths(c);
        const contents = await mapLimit(paths, 6, (path) => client.file(path, sha));
        const result = importSnapshot(c, new Map(paths.map((p, i) => [p, contents[i]])), at);
        errors.push(...result.errors);
        notes.push(...result.notes);
      } catch (error) {
        if (!(error instanceof GitHubError)) console.error(error);
        errors.push({ component: c.id, message: (error as Error).message });
      }
    }
  } catch (error) {
    if (!(error instanceof GitHubError)) console.error(error);
    errors.push({ component: null, message: (error as Error).message });
  }
  saveState(repo, sha, errors, notes, at);
  return syncState(repo);
}

// One sync per repository at a time; a request during a sync runs once more afterwards.
const running = globalThis as unknown as { translateSyncs?: Map<string, { promise: Promise<SyncState>; again: boolean }> };
export function queueSync(repo: string): Promise<SyncState> {
  const map = (running.translateSyncs ??= new Map());
  const active = map.get(repo);
  if (active) {
    active.again = true;
    return active.promise;
  }
  const entry = { again: false, promise: Promise.resolve() as unknown as Promise<SyncState> };
  entry.promise = (async () => {
    try {
      let state = await syncRepo(repo);
      while (entry.again) {
        entry.again = false;
        state = await syncRepo(repo);
      }
      return state;
    } finally {
      map.delete(repo);
    }
  })();
  map.set(repo, entry);
  return entry.promise;
}

export const componentErrors = (id: string, state: SyncState) => state.errors.filter((e) => e.component === id || e.component === null);
