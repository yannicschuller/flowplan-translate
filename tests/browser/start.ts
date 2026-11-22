// Starts the production (standalone) build for the browser tests: a fresh
// data directory, the fixture catalogues imported (no GitHub), and two test
// sessions created directly in the database (no real account). Run by
// playwright.config.ts as its web server; `npm run build` must have run.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

const root = resolve(import.meta.dirname, "..", "..");
const port = Number(process.env.PORT || 3123);
const dataDir = process.env.TRANSLATE_DATA_DIR!;
process.env.TRANSLATE_COMPONENTS_FILE = join(root, "components.json");
process.env.TRANSLATE_URL = `http://127.0.0.1:${port}`;
rmSync(dataDir, { recursive: true, force: true });
mkdirSync(dataDir, { recursive: true });

const { importSnapshot } = await import("../../lib/sync");
const { allPaths, components } = await import("../../lib/components");
const { createSession, upsertUser } = await import("../../lib/auth");
const { one, closeDb } = await import("../../lib/db");

const fixtures = join(root, "tests", "fixtures");
const dirOf: Record<string, string> = { "yannicschuller/flowplan": "flowplan", "yannicschuller/flowplan-app": "flowplan-app", "yannicschuller/flowplan-desktop": "flowplan-desktop" };
for (const c of components()) {
  // Repositories without fixture catalogues (the website) stay unsynced.
  if (!dirOf[c.repo]) continue;
  const files = new Map(allPaths(c).map((p) => {
    const file = join(fixtures, dirOf[c.repo], p);
    return [p, existsSync(file) ? readFileSync(file, "utf8") : null] as const;
  }));
  importSnapshot(c, files);
}
const translator = upsertUser({ id: 9001, login: "helper", name: "Helper" });
const reviewer = upsertUser({ id: 9002, login: "yannicschuller", name: "Yannic" });
// The first French text with a {0} placeholder that is still missing.
const entry = one<{ id: number }>(
  `SELECT s.id FROM strings s WHERE s.component_id='flowplan-web' AND s.source LIKE '%{0}%'
   AND NOT EXISTS (SELECT 1 FROM translations t WHERE t.string_id=s.id AND t.lang='fr') ORDER BY s.position LIMIT 1`,
)!;
writeFileSync(join(dataDir, "browser-test.json"), JSON.stringify({ translator: createSession(translator.id), reviewer: createSession(reviewer.id), entry: entry.id }));
closeDb();

// The standalone server needs the static files next to it.
const standalone = join(root, ".next", "standalone");
cpSync(join(root, ".next", "static"), join(standalone, ".next", "static"), { recursive: true });
cpSync(join(root, "public"), join(standalone, "public"), { recursive: true });
const server = spawn(process.execPath, ["--disable-warning=ExperimentalWarning", join(standalone, "server.js")], {
  stdio: "inherit",
  env: { ...process.env, PORT: String(port), HOSTNAME: "127.0.0.1", NODE_ENV: "production" },
});
const stop = () => server.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
server.on("exit", (code) => process.exit(code ?? 0));
