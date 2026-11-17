// Settings from the environment. Read on every call (not at import time), so
// tests can set them before the first use. Secrets come only from here.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { DEFAULT_TIME_ZONE } from "./i18n";

const text = (name: string) => (process.env[name] || "").trim();

// The maintainer is always a reviewer.
export const ALWAYS_REVIEWERS = ["yannicschuller"];

export const config = {
  // Where the SQLite database and the generated key live (one volume).
  dataDir: () => resolve(/*turbopackIgnore: true*/ text("TRANSLATE_DATA_DIR") || "./data"),
  // The public address, without a trailing slash: OAuth callback, Origin
  // check for writing requests, Secure cookies.
  publicUrl: () => (text("TRANSLATE_URL") || "http://localhost:3000").replace(/\/+$/, ""),
  publicOrigin: () => new URL(config.publicUrl()).origin,
  https: () => config.publicUrl().startsWith("https://"),
  // components.json: next to the app unless TRANSLATE_COMPONENTS_FILE points elsewhere (tests).
  componentsFile: () => resolve(/*turbopackIgnore: true*/ text("TRANSLATE_COMPONENTS_FILE") || "components.json"),
  reviewers: () =>
    new Set(
      [...ALWAYS_REVIEWERS, ...text("TRANSLATE_REVIEWERS").split(",")]
        .map((login) => login.trim().toLowerCase())
        .filter(Boolean),
    ),
  // GitHub's REST API; tests point it at a local mock server (the OAuth
  // code exchange then goes there too).
  githubApi: () => (text("TRANSLATE_GITHUB_API") || "https://api.github.com").replace(/\/+$/, ""),
  githubWeb: () => (text("TRANSLATE_GITHUB_API") ? config.githubApi() : "https://github.com"),
  oauth: () => {
    const clientId = text("TRANSLATE_GITHUB_CLIENT_ID");
    const clientSecret = text("TRANSLATE_GITHUB_CLIENT_SECRET");
    return clientId && clientSecret ? { clientId, clientSecret } : null;
  },
  app: () => {
    const appId = text("TRANSLATE_GITHUB_APP_ID");
    const privateKey = privateKeyPem();
    return appId && privateKey ? { appId, privateKey } : null;
  },
  webhookSecret: () => text("TRANSLATE_WEBHOOK_SECRET"),
  // IANA time zone for dates and times on the pages (default Europe/Berlin).
  timeZone: () => validTimeZone(text("TRANSLATE_TIME_ZONE")),
};

// Checked once per value; an unknown zone falls back to Europe/Berlin with a log line.
const checkedZones = new Map<string, string>();
export function validTimeZone(value: string): string {
  if (!value) return DEFAULT_TIME_ZONE;
  let zone = checkedZones.get(value);
  if (zone) return zone;
  try {
    zone = new Intl.DateTimeFormat("en", { timeZone: value }).resolvedOptions().timeZone;
  } catch {
    console.error(`TRANSLATE_TIME_ZONE "${value}" is not a known IANA time zone – using ${DEFAULT_TIME_ZONE}.`);
    zone = DEFAULT_TIME_ZONE;
  }
  checkedZones.set(value, zone);
  return zone;
}

// The App's private key: PEM in TRANSLATE_GITHUB_PRIVATE_KEY (real line
// breaks or "\n"-escaped on one line), or a file in TRANSLATE_GITHUB_PRIVATE_KEY_FILE.
function privateKeyPem(): string {
  const inline = text("TRANSLATE_GITHUB_PRIVATE_KEY");
  if (inline) return inline.replace(/\\n/g, "\n");
  const file = text("TRANSLATE_GITHUB_PRIVATE_KEY_FILE");
  if (!file) return "";
  return readFileSync(/*turbopackIgnore: true*/ file, "utf8").trim();
}

export const isReviewerLogin = (login: string | null | undefined) => !!login && config.reviewers().has(login.toLowerCase());
