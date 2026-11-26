// One SQLite file in the data directory (node:sqlite). The schema is built by
// numbered migrations; the table schema_version holds the last one applied.
import { DatabaseSync, type SQLInputValue } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { join } from "node:path";
import { config } from "./config";
import {
  GLOSSARY_SEED,
  GLOSSARY_SEED_PL,
  GLOSSARY_SEED_PT,
  GLOSSARY_SEED_RU,
  LANGUAGE_NOTES_SEED,
  LANGUAGE_NOTES_SEED_PL,
  LANGUAGE_NOTES_SEED_PT,
  LANGUAGE_NOTES_SEED_RU,
} from "./glossary-seed";
import { upsertComponents } from "./components";

const sqlString = (s: string) => `'${s.replace(/'/g, "''")}'`;

type SeedTerm = { lang: string; term: string; translation: string; note: string };
// INSERT OR IGNORE: a term or note a reviewer already added stays as it is.
function seedSql(terms: SeedTerm[], notes: { lang: string; note: string }[]) {
  return [
    ...terms.map(
      (g) =>
        `INSERT OR IGNORE INTO glossary(lang,term,translation,note,updated_at) VALUES(${sqlString(g.lang)},${sqlString(g.term)},${sqlString(g.translation)},${sqlString(g.note)},0);`,
    ),
    ...notes.map((n) => `INSERT OR IGNORE INTO language_notes(lang,note,updated_at) VALUES(${sqlString(n.lang)},${sqlString(n.note)},0);`),
  ].join("\n");
}

const MIGRATIONS: string[] = [
  // 1: accounts, components and their texts, translations, glossary, sync, pull requests, rate limits
  `CREATE TABLE users (
     id INTEGER PRIMARY KEY,
     github_id INTEGER NOT NULL UNIQUE,
     login TEXT NOT NULL,
     name TEXT NOT NULL DEFAULT '',
     created_at INTEGER NOT NULL,
     last_login_at INTEGER
   );
   CREATE TABLE sessions (
     token_hash TEXT PRIMARY KEY,
     user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
     created_at INTEGER NOT NULL,
     expires_at INTEGER NOT NULL
   );
   CREATE INDEX sessions_user ON sessions(user_id);
   CREATE TABLE components (
     id TEXT PRIMARY KEY,
     title TEXT NOT NULL,
     repo TEXT NOT NULL,
     format TEXT NOT NULL,
     config TEXT NOT NULL,
     active INTEGER NOT NULL DEFAULT 1,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE strings (
     id INTEGER PRIMARY KEY,
     component_id TEXT NOT NULL REFERENCES components(id),
     key TEXT NOT NULL,
     source TEXT NOT NULL,
     source_hash TEXT NOT NULL,
     de_reference TEXT NOT NULL DEFAULT '',
     context TEXT NOT NULL DEFAULT '',
     file TEXT NOT NULL DEFAULT '',
     position INTEGER NOT NULL,
     removed INTEGER NOT NULL DEFAULT 0,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE(component_id, key)
   );
   CREATE INDEX strings_list ON strings(component_id, removed, position);
   -- What the repository's main branch holds per text and language (last sync).
   CREATE TABLE repo_values (
     string_id INTEGER NOT NULL REFERENCES strings(id) ON DELETE CASCADE,
     lang TEXT NOT NULL,
     text TEXT NOT NULL,
     PRIMARY KEY(string_id, lang)
   ) WITHOUT ROWID;
   -- status: suggested | accepted | exported (accepted, in an open pull
   -- request) | rejected | replaced (was accepted, a newer one took over).
   CREATE TABLE translations (
     id INTEGER PRIMARY KEY,
     string_id INTEGER NOT NULL REFERENCES strings(id),
     lang TEXT NOT NULL,
     text TEXT NOT NULL,
     based_on_hash TEXT NOT NULL,
     status TEXT NOT NULL,
     author_id INTEGER REFERENCES users(id),
     reviewer_id INTEGER REFERENCES users(id),
     pr_number INTEGER,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE UNIQUE INDEX translations_current ON translations(string_id, lang) WHERE status IN ('accepted','exported');
   CREATE INDEX translations_by_string ON translations(string_id, lang, status);
   CREATE INDEX translations_by_status ON translations(status, lang);
   CREATE TABLE glossary (
     id INTEGER PRIMARY KEY,
     lang TEXT NOT NULL,
     term TEXT NOT NULL,
     translation TEXT NOT NULL,
     note TEXT NOT NULL DEFAULT '',
     updated_at INTEGER NOT NULL,
     updated_by INTEGER REFERENCES users(id),
     UNIQUE(lang, term COLLATE NOCASE)
   );
   CREATE TABLE language_notes (
     lang TEXT PRIMARY KEY,
     note TEXT NOT NULL,
     updated_at INTEGER NOT NULL
   );
   CREATE TABLE sync_state (
     repo TEXT PRIMARY KEY,
     sha TEXT NOT NULL DEFAULT '',
     synced_at INTEGER,
     errors TEXT NOT NULL DEFAULT '[]',
     notes TEXT NOT NULL DEFAULT '[]'
   );
   CREATE TABLE pull_requests (
     id INTEGER PRIMARY KEY,
     repo TEXT NOT NULL,
     number INTEGER NOT NULL,
     branch TEXT NOT NULL,
     state TEXT NOT NULL,
     base_sha TEXT NOT NULL,
     created_at INTEGER NOT NULL,
     updated_at INTEGER NOT NULL,
     UNIQUE(repo, number)
   );
   CREATE TABLE rate_limits (
     key TEXT PRIMARY KEY,
     window_start INTEGER NOT NULL,
     count INTEGER NOT NULL
   );`,
  // 2: the glossary's core terms and the per-language notes (lib/glossary-seed.ts)
  seedSql(GLOSSARY_SEED, LANGUAGE_NOTES_SEED),
  // 3: when the state of a tracked pull request was last checked on GitHub
  `ALTER TABLE pull_requests ADD COLUMN checked_at INTEGER;`,
  // 4: Russian (ru) – its core glossary terms and its language note
  seedSql(GLOSSARY_SEED_RU, LANGUAGE_NOTES_SEED_RU),
  // 5: Polish (pl) – its core glossary terms and its language note
  seedSql(GLOSSARY_SEED_PL, LANGUAGE_NOTES_SEED_PL),
  // 6: European Portuguese (pt) – its core glossary terms and its language note
  seedSql(GLOSSARY_SEED_PT, LANGUAGE_NOTES_SEED_PT),
];
export const SCHEMA_VERSION = MIGRATIONS.length;

const holder = globalThis as unknown as { translateDb?: { db: DatabaseSync; dir: string } };

export function migrate(db: DatabaseSync) {
  db.exec("CREATE TABLE IF NOT EXISTS schema_version (version INTEGER NOT NULL)");
  const row = db.prepare("SELECT version FROM schema_version").get() as { version: number } | undefined;
  if (!row) db.exec("INSERT INTO schema_version(version) VALUES(0)");
  const current = Number(row?.version ?? 0);
  if (current > SCHEMA_VERSION) throw new Error(`Database schema ${current} is newer than this version (${SCHEMA_VERSION}).`);
  for (let v = current; v < SCHEMA_VERSION; v++) {
    db.exec("BEGIN");
    try {
      db.exec(MIGRATIONS[v]);
      db.prepare("UPDATE schema_version SET version=?").run(v + 1);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
  }
}

// The connection for the current data directory (a new one when it changed,
// which only tests do).
export function db(): DatabaseSync {
  const dir = config.dataDir();
  const open = holder.translateDb;
  if (open && open.dir === dir) return open.db;
  holder.translateDb?.db.close();
  mkdirSync(dir, { recursive: true });
  const conn = new DatabaseSync(join(/*turbopackIgnore: true*/ dir, "translate.db"));
  conn.exec("PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;");
  migrate(conn);
  // components.json → the components table, on every start.
  upsertComponents(conn);
  holder.translateDb = { db: conn, dir };
  return conn;
}
export function closeDb() {
  holder.translateDb?.db.close();
  holder.translateDb = undefined;
}

// Rows as plain objects (node:sqlite gives null-prototype ones, which React
// cannot hand to client components).
export const all = <T>(sql: string, ...params: SQLInputValue[]) => db().prepare(sql).all(...params).map((row) => ({ ...row })) as T[];
export const one = <T>(sql: string, ...params: SQLInputValue[]) => {
  const row = db().prepare(sql).get(...params);
  return (row ? { ...row } : undefined) as T | undefined;
};
export const run = (sql: string, ...params: SQLInputValue[]) => db().prepare(sql).run(...params);
let depth = 0;
// Nested calls join the outer transaction.
export function transaction<T>(fn: () => T): T {
  const conn = db();
  if (depth > 0) return fn();
  conn.exec("BEGIN IMMEDIATE");
  depth++;
  try {
    const result = fn();
    conn.exec("COMMIT");
    return result;
  } catch (error) {
    conn.exec("ROLLBACK");
    throw error;
  } finally {
    depth--;
  }
}
export const now = () => Date.now();
