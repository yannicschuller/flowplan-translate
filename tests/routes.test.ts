import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { BASE, importFixture, req, signIn, useTempData } from "./helpers";
import { startGitHubMock } from "./github-mock";
import { one, run } from "../lib/db";
import { sha256 } from "../lib/secret";
import { handle } from "../lib/http";
import { callbackRoute, confirmRoute, exportRoute, glossaryRoute, healthRoute, loginRoute, logoutRoute, reviewRoute, saveRoute, syncRoute, webhookRoute } from "../lib/routes";
import { entryDetail } from "../lib/store";
import { glossary } from "../lib/glossary";
import { userForSessionToken } from "../lib/auth";

useTempData();
importFixture("flowplan-web", "flowplan");
importFixture("flowplan-app-system", "flowplan-app");
const stringId = (key: string) => one<{ id: number }>("SELECT id FROM strings WHERE component_id='flowplan-web' AND key=?", key)!.id;
const call = (fn: () => Promise<Response> | Response) => handle(fn);
const body = async (r: Response) => (await r.json()) as Record<string, unknown>;
const RECORDS = " · {0} records";

test("health answers with the service name", async () => {
  const r = await call(() => healthRoute());
  assert.deepEqual(await body(r), { service: "flowplan-translate", status: "ok" });
});

test("CSRF: a writing request without or with a foreign Origin is refused", async () => {
  const { cookie } = signIn("helper");
  const json = { stringId: stringId(RECORDS), lang: "fr", text: " · {0} enregistrement(s)" };
  for (const origin of [null, "https://evil.example", "null"]) {
    const r = await call(() => saveRoute(req("/api/translations", { method: "POST", json, cookie, origin })));
    assert.equal(r.status, 403, `origin ${origin}`);
    assert.equal((await body(r)).error, "cross_origin");
  }
  // Without Origin, a Referer of this site is enough.
  const viaReferer = await call(() => saveRoute(req("/api/translations", { method: "POST", json, cookie, origin: null, headers: { referer: `${BASE}/c/flowplan-web/fr` } })));
  assert.equal(viaReferer.status, 200);
  const r = await call(() => saveRoute(req("/api/translations", { method: "POST", json, cookie: "ft_session=nope" })));
  assert.equal(r.status, 401);
});

test("saving: blocking checks answer 422 with the issues, a translator's save is a suggestion", async () => {
  const { cookie } = signIn("helper2");
  const id = stringId(RECORDS);
  const bad = await call(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: id, lang: "fr", text: " · enregistrements" }, cookie })));
  assert.equal(bad.status, 422);
  const issues = (await body(bad)).checks as { errors: { code: string; values: string[] }[] };
  assert.deepEqual(issues.errors.map((e) => [e.code, e.values]), [["placeholders_missing", ["{0}"]]]);
  const good = await call(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: id, lang: "fr", text: " · {0} enregistrement(s)" }, cookie })));
  assert.equal((await body(good)).outcome, "suggested");
  const huge = await call(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: id, lang: "fr", text: "x".repeat(200_000) }, cookie })));
  assert.equal(huge.status, 413, "body size limit");
  const unknownLang = await call(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: id, lang: "de", text: "x" }, cookie })));
  assert.equal(unknownLang.status, 400);
});

test("Russian: saved where the component lists ru, refused elsewhere, unknown languages 400", async () => {
  const { cookie } = signIn("helper-ru");
  const reviewer = signIn("yannicschuller");
  const save = (json: Record<string, unknown>, c = cookie) => call(() => saveRoute(req("/api/translations", { method: "POST", json, cookie: c })));
  const web = stringId(RECORDS);
  const missing = await save({ stringId: web, lang: "ru", text: " · записей" });
  assert.equal(missing.status, 422, "the placeholder check works for ru");
  const suggested = await save({ stringId: web, lang: "ru", text: " · записей: {0}" });
  assert.equal(suggested.status, 200);
  assert.equal((await body(suggested)).outcome, "suggested");
  assert.equal(entryDetail(web, "ru")!.suggestions[0].text, " · записей: {0}");
  const accepted = await save({ stringId: web, lang: "ru", text: " · записей: {0}" }, reviewer.cookie);
  assert.equal((await body(accepted)).outcome, "accepted");
  assert.equal(entryDetail(web, "ru")!.current!.text, " · записей: {0}");
  // flowplan-app-system translates fr and zh only.
  const app = one<{ id: number }>("SELECT id FROM strings WHERE component_id='flowplan-app-system' LIMIT 1")!.id;
  assert.equal(entryDetail(app, "ru"), null);
  for (const c of [cookie, reviewer.cookie]) {
    const refused = await save({ stringId: app, lang: "ru", text: "Текст" }, c);
    assert.equal(refused.status, 404);
    assert.equal((await body(refused)).error, "not_found");
  }
  const confirm = await call(() => confirmRoute(req("/api/translations/confirm", { method: "POST", json: { stringId: app, lang: "ru" }, cookie })));
  assert.equal(confirm.status, 404);
  assert.equal((await save({ stringId: web, lang: "uk", text: "x" })).status, 400);
  // The glossary takes Russian terms and the Russian note.
  const term = await call(() => glossaryRoute(req("/api/glossary", { method: "POST", form: { lang: "ru", term: "Inbox", translation: "Входящие", note: "", next: "/glossary?lang=ru" }, cookie: reviewer.cookie })));
  assert.equal(term.headers.get("location"), "/glossary?lang=ru&saved=1");
  assert.equal(glossary("ru").find((g) => g.term === "Inbox")!.translation, "Входящие");
  const bad = await call(() => glossaryRoute(req("/api/glossary", { method: "POST", form: { lang: "uk", term: "Inbox", translation: "Вхідні", next: "/glossary" }, cookie: reviewer.cookie })));
  assert.match(bad.headers.get("location")!, /error=invalid_lang/);
});

test("Polish: saved where the component lists pl, refused elsewhere", async () => {
  const { cookie } = signIn("helper-pl");
  const reviewer = signIn("yannicschuller");
  const save = (json: Record<string, unknown>, c = cookie) => call(() => saveRoute(req("/api/translations", { method: "POST", json, cookie: c })));
  const web = stringId(RECORDS);
  const missing = await save({ stringId: web, lang: "pl", text: " · rekordy" });
  assert.equal(missing.status, 422, "the placeholder check works for pl");
  const suggested = await save({ stringId: web, lang: "pl", text: " · rekordy: {0}" });
  assert.equal(suggested.status, 200);
  assert.equal((await body(suggested)).outcome, "suggested");
  assert.equal(entryDetail(web, "pl")!.suggestions[0].text, " · rekordy: {0}");
  const accepted = await save({ stringId: web, lang: "pl", text: " · rekordy: {0}" }, reviewer.cookie);
  assert.equal((await body(accepted)).outcome, "accepted");
  assert.equal(entryDetail(web, "pl")!.current!.text, " · rekordy: {0}");
  // flowplan-app-system translates fr and zh only.
  const app = one<{ id: number }>("SELECT id FROM strings WHERE component_id='flowplan-app-system' LIMIT 1")!.id;
  assert.equal(entryDetail(app, "pl"), null);
  for (const c of [cookie, reviewer.cookie]) {
    const refused = await save({ stringId: app, lang: "pl", text: "Tekst" }, c);
    assert.equal(refused.status, 404);
    assert.equal((await body(refused)).error, "not_found");
  }
  const confirm = await call(() => confirmRoute(req("/api/translations/confirm", { method: "POST", json: { stringId: app, lang: "pl" }, cookie })));
  assert.equal(confirm.status, 404);
  // The glossary takes Polish terms.
  const term = await call(() => glossaryRoute(req("/api/glossary", { method: "POST", form: { lang: "pl", term: "Inbox", translation: "Skrzynka odbiorcza", note: "", next: "/glossary?lang=pl" }, cookie: reviewer.cookie })));
  assert.equal(term.headers.get("location"), "/glossary?lang=pl&saved=1");
  assert.equal(glossary("pl").find((g) => g.term === "Inbox")!.translation, "Skrzynka odbiorcza");
});

test("roles: a translator cannot accept, sync, export or edit the glossary; a reviewer can accept", async () => {
  const translator = signIn("helper3");
  const id = stringId(RECORDS);
  await call(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: id, lang: "zh", text: " · 共 {0} 条记录" }, cookie: translator.cookie })));
  const suggestion = entryDetail(id, "zh")!.suggestions.find((s) => s.author === "helper3")!;
  const denied = await call(() => reviewRoute(req(`/api/suggestions/${suggestion.id}/accept`, { method: "POST", json: {}, cookie: translator.cookie }), String(suggestion.id), "accept"));
  assert.equal(denied.status, 403);
  for (const route of [syncRoute, exportRoute, glossaryRoute]) {
    const r = await call(() => route(req("/api/x", { method: "POST", json: { repo: "yannicschuller/flowplan" }, cookie: translator.cookie })));
    assert.equal(r.status, 403);
  }
  process.env.TRANSLATE_REVIEWERS = "Some-Reviewer, other";
  const reviewer = signIn("some-reviewer");
  const ok = await call(() => reviewRoute(req(`/api/suggestions/${suggestion.id}/accept`, { method: "POST", json: {}, cookie: reviewer.cookie }), String(suggestion.id), "accept"));
  assert.equal(ok.status, 200);
  assert.equal(entryDetail(id, "zh")!.current!.text, " · 共 {0} 条记录");
  // A form post answers with a redirect back.
  const term = await call(() => glossaryRoute(req("/api/glossary", { method: "POST", form: { lang: "fr", term: "Inbox", translation: "Boîte de réception", note: "", next: "/glossary?lang=fr" }, cookie: reviewer.cookie })));
  assert.equal(term.status, 303);
  assert.equal(term.headers.get("location"), "/glossary?lang=fr&saved=1");
  assert.equal(glossary("fr").filter((g) => g.term.toLowerCase() === "inbox").length, 1, "same term, updated in place");
  const bad = await call(() => glossaryRoute(req("/api/glossary", { method: "POST", form: { lang: "fr", term: "", translation: "", next: "/glossary?lang=fr" }, cookie: reviewer.cookie })));
  assert.equal(bad.headers.get("location"), "/glossary?lang=fr&error=invalid_term");
  delete process.env.TRANSLATE_REVIEWERS;
  assert.equal(userForSessionToken(reviewer.token)!.role, "translator", "roles follow TRANSLATE_REVIEWERS");
  assert.equal(signIn("YannicSchuller").user.login, "YannicSchuller");
});

test("confirm: a translator's 'still correct' needs an existing translation", async () => {
  const { cookie } = signIn("helper4");
  const missing = one<{ id: number }>(
    "SELECT s.id FROM strings s WHERE s.component_id='flowplan-web' AND NOT EXISTS (SELECT 1 FROM translations t WHERE t.string_id=s.id AND t.lang='fr' AND t.status IN ('accepted','exported'))",
  )!.id;
  const r = await call(() => confirmRoute(req("/api/translations/confirm", { method: "POST", json: { stringId: missing, lang: "fr" }, cookie })));
  assert.equal(r.status, 409);
});

test("rate limit: saving suggestions per user, with a readable message", async () => {
  const { cookie, user } = signIn("speedy");
  run("INSERT INTO rate_limits(key,window_start,count) VALUES(?,?,?)", `save-min:${user.id}`, Date.now(), 120);
  const r = await call(() => saveRoute(req("/api/translations", { method: "POST", json: { stringId: stringId(RECORDS), lang: "fr", text: " · {0} enregistrement(s)" }, cookie })));
  assert.equal(r.status, 429);
  const data = await body(r);
  assert.match(String(data.message), /Too many requests/);
  assert.ok(Number(r.headers.get("retry-after")) > 0);
});

const sign = (secret: string, payload: string) => `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
const hook = (payload: string, signature: string | null, event = "push") =>
  req("/api/github/webhook", { method: "POST", body: payload, origin: null, headers: { "x-github-event": event, ...(signature ? { "x-hub-signature-256": signature } : {}) } });

test("webhook: signature checked, only pushes to main of a configured repository start a sync", async () => {
  const started: string[] = [];
  const start = (repo: string) => started.push(repo);
  const payload = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "yannicschuller/flowplan" } });
  assert.equal((await call(() => webhookRoute(hook(payload, sign("s3cret", payload)), start))).status, 503, "off without a secret");
  process.env.TRANSLATE_WEBHOOK_SECRET = "s3cret";
  assert.equal((await call(() => webhookRoute(hook(payload, null), start))).status, 401);
  assert.equal((await call(() => webhookRoute(hook(payload, sign("wrong", payload)), start))).status, 401);
  assert.equal((await call(() => webhookRoute(hook(payload + " ", sign("s3cret", payload)), start))).status, 401, "body changed");
  const ok = await call(() => webhookRoute(hook(payload, sign("s3cret", payload)), start));
  assert.equal(ok.status, 202);
  const branch = JSON.stringify({ ref: "refs/heads/feature", repository: { full_name: "yannicschuller/flowplan" } });
  assert.equal((await body(await call(() => webhookRoute(hook(branch, sign("s3cret", branch)), start)))).ignored, "ref");
  const other = JSON.stringify({ ref: "refs/heads/main", repository: { full_name: "someone/else" } });
  assert.equal((await body(await call(() => webhookRoute(hook(other, sign("s3cret", other)), start)))).ignored, "repository");
  const issue = JSON.stringify({ action: "opened" });
  assert.equal((await body(await call(() => webhookRoute(hook(issue, sign("s3cret", issue), "issues"), start)))).ignored, "event");
  await new Promise((resolve) => setTimeout(resolve, 10));
  assert.deepEqual(started, ["yannicschuller/flowplan"]);
});

test("sign-in: state checked, user read once, only the session's hash stored, sign-out deletes it", async () => {
  const gh = await startGitHubMock();
  const start = await call(() => loginRoute(req("/api/auth/login?next=/c/flowplan-web/fr")));
  assert.equal(start.status, 303);
  const location = new URL(start.headers.get("location")!);
  assert.equal(location.origin + location.pathname, `${gh.base}/login/oauth/authorize`);
  assert.equal(location.searchParams.get("redirect_uri"), `${BASE}/api/auth/callback`);
  const state = location.searchParams.get("state")!;
  const stateCookie = start.headers.get("set-cookie")!.split(";")[0];
  assert.match(start.headers.get("set-cookie")!, /HttpOnly; SameSite=Lax/);

  const forged = await call(() => callbackRoute(req(`/api/auth/callback?code=good-code&state=other`, { cookie: stateCookie })));
  assert.equal(forged.headers.get("location"), "/login?error=github_state");
  const done = await call(() => callbackRoute(req(`/api/auth/callback?code=good-code&state=${state}`, { cookie: stateCookie })));
  assert.equal(done.headers.get("location"), "/c/flowplan-web/fr");
  const session = done.headers.getSetCookie().find((c) => c.startsWith("ft_session="))!;
  assert.match(session, /HttpOnly; SameSite=Lax/);
  assert.doesNotMatch(session, /Secure/, "http in tests");
  assert.match(session, /Max-Age=2592000/);
  const token = decodeURIComponent(session.split(";")[0].slice("ft_session=".length));
  assert.ok(one("SELECT 1 FROM sessions WHERE token_hash=?", sha256(token)));
  assert.ok(!one("SELECT 1 FROM sessions WHERE token_hash=?", token), "never the token itself");
  assert.equal(one<{ login: string }>("SELECT login FROM users WHERE github_id=4242")!.login, "octo-translator");
  const bad = await call(() => callbackRoute(req(`/api/auth/callback?code=bad&state=${state}`, { cookie: stateCookie })));
  assert.equal(bad.headers.get("location"), "/login?error=github_failed");

  const out = await call(() => logoutRoute(req("/api/auth/logout", { method: "POST", form: {}, cookie: `ft_session=${token}` })));
  assert.equal(out.status, 303);
  assert.ok(!one("SELECT 1 FROM sessions WHERE token_hash=?", sha256(token)));

  process.env.TRANSLATE_URL = "https://translate.example.org";
  const secure = await call(() => loginRoute(new Request("https://translate.example.org/api/auth/login")));
  assert.match(secure.headers.get("set-cookie")!, /Secure/);
  process.env.TRANSLATE_URL = BASE;
});
