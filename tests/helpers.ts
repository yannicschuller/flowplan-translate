// Every test file gets its own data directory and a known environment.
import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { after } from "node:test";
import { closeDb } from "../lib/db";
import { createSession, upsertUser, SESSION_COOKIE } from "../lib/auth";
import { allPaths, component } from "../lib/components";
import { importSnapshot } from "../lib/sync";
import { forgetTokens } from "../lib/github";

export const BASE = "http://localhost:3000";
export const FIXTURES = resolve(import.meta.dirname, "fixtures");

export function useTempData() {
  const dir = mkdtempSync(join(tmpdir(), "translate-test-"));
  process.env.TRANSLATE_DATA_DIR = dir;
  process.env.TRANSLATE_URL = BASE;
  process.env.TRANSLATE_COMPONENTS_FILE = resolve(import.meta.dirname, "..", "components.json");
  for (const name of [
    "TRANSLATE_REVIEWERS",
    "TRANSLATE_GITHUB_API",
    "TRANSLATE_GITHUB_APP_ID",
    "TRANSLATE_GITHUB_PRIVATE_KEY",
    "TRANSLATE_GITHUB_PRIVATE_KEY_FILE",
    "TRANSLATE_GITHUB_CLIENT_ID",
    "TRANSLATE_GITHUB_CLIENT_SECRET",
    "TRANSLATE_WEBHOOK_SECRET",
  ])
    delete process.env[name];
  forgetTokens();
  after(() => {
    closeDb();
    rmSync(dir, { recursive: true, force: true });
  });
  return dir;
}

// The files of a component as a sync would read them, from a fixture checkout.
export function fixtureSnapshot(componentId: string, root: string, overrides: Record<string, string | null> = {}) {
  const c = component(componentId)!;
  const files = new Map<string, string | null>();
  for (const path of allPaths(c)) {
    if (path in overrides) files.set(path, overrides[path]);
    else {
      const file = join(root, path);
      files.set(path, existsSync(file) ? readFileSync(file, "utf8") : null);
    }
  }
  return files;
}
export const importFixture = (componentId: string, repoDir: string, overrides: Record<string, string | null> = {}) =>
  importSnapshot(component(componentId)!, fixtureSnapshot(componentId, join(FIXTURES, repoDir), overrides));

let nextGithubId = 1000;
export function signIn(login: string) {
  const user = upsertUser({ id: nextGithubId++, login, name: login });
  const token = createSession(user.id);
  return { user, token, cookie: `${SESSION_COOKIE}=${token}` };
}

export function req(path: string, init: RequestInit & { json?: unknown; form?: Record<string, string>; cookie?: string; origin?: string | null } = {}) {
  const headers = new Headers(init.headers);
  let body = init.body;
  if (init.json !== undefined) {
    headers.set("content-type", "application/json");
    body = JSON.stringify(init.json);
  }
  if (init.form) {
    headers.set("content-type", "application/x-www-form-urlencoded");
    body = new URLSearchParams(init.form).toString();
  }
  if (init.cookie) headers.set("cookie", init.cookie);
  if (init.origin !== null && (init.method || "GET") !== "GET") headers.set("origin", init.origin ?? BASE);
  return new Request(BASE + path, { ...init, headers, body });
}
