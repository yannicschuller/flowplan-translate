// The logic of every API endpoint, on plain Request and Response
// (app/api/** only forwards here; tests call these directly). Writing
// requests pass requireUser()/requireReviewer() (Origin check + session)
// first – except the webhook, which is checked by its signature.
import { config } from "./config";
import { HttpError, clientIp, cookie, int, isForm, json, readInput, redirect, safeNext, setCookie, str, withParam } from "./http";
import { RateLimitError, LIMITS, ipKey, limit } from "./rate-limit";
import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  authorizeUrl,
  clearSessionCookie,
  createSession,
  destroySession,
  githubProfile,
  requireReviewer,
  requireUser,
  sessionCookie,
  upsertUser,
} from "./auth";
import { randomToken, safeEqual } from "./secret";
import { acceptSuggestion, confirmCurrent, rejectSuggestion, saveTranslation } from "./store";
import { deleteTerm, saveLanguageNote, saveTerm } from "./glossary";
import { componentsOf } from "./components";
import { queueSync } from "./sync";
import { createPullRequest } from "./export";
import { one } from "./db";

export { webhookRoute } from "./webhook";
export { badgeRoute } from "./badge";

export function healthRoute() {
  one("SELECT 1");
  return json({ service: "flowplan-translate", status: "ok" });
}

// A form post answers with a redirect back to `next` (the result or the
// error code in the query); fetch gets JSON.
async function action(request: Request, fn: (input: Record<string, unknown>) => Promise<{ data: Record<string, unknown>; param?: [string, string] }>) {
  const form = isForm(request);
  let input: Record<string, unknown> = {};
  try {
    input = await readInput(request);
    const { data, param } = await fn(input);
    if (!form) return json({ ok: true, ...data });
    const next = safeNext(input.next);
    return redirect(param ? withParam(next, param[0], param[1]) : next);
  } catch (error) {
    if (!form) throw error;
    if (error instanceof HttpError && error.code === "cross_origin") throw error;
    const code = error instanceof HttpError ? error.code : error instanceof RateLimitError ? "rate_limited" : "internal";
    if (code === "internal") console.error(error);
    return redirect(withParam(safeNext(input.next), "error", code));
  }
}

// ---- Sign-in ----

const STATE_PATH = "/api/auth";
export function loginRoute(request: Request) {
  const next = safeNext(new URL(request.url).searchParams.get("next"));
  if (!config.oauth()) return redirect("/login?error=github_off");
  const state = randomToken(24);
  // Only for the sign-in round trip (ten minutes), and only on the callback path.
  return redirect(authorizeUrl(state), [setCookie(OAUTH_STATE_COOKIE, `${state}|${next}`, { maxAge: 600, path: STATE_PATH })]);
}

export async function callbackRoute(request: Request) {
  const p = new URL(request.url).searchParams;
  const saved = cookie(request, OAUTH_STATE_COOKIE) || "";
  const bar = saved.indexOf("|");
  const state = bar > 0 ? saved.slice(0, bar) : "";
  const next = safeNext(bar > 0 ? saved.slice(bar + 1) : "/");
  const clear = setCookie(OAUTH_STATE_COOKIE, "", { maxAge: 0, path: STATE_PATH });
  const sent = p.get("state") || "";
  const code = p.get("code") || "";
  if (!state || !sent || !safeEqual(state, sent) || !code || code.length > 200) return redirect("/login?error=github_state", [clear]);
  try {
    limit(`signin:${ipKey(clientIp(request))}`, LIMITS.signIn);
    const user = upsertUser(await githubProfile(code));
    return redirect(next, [clear, sessionCookie(createSession(user.id))]);
  } catch (error) {
    const reason = error instanceof HttpError ? error.code : error instanceof RateLimitError ? "rate_limited" : "github_failed";
    if (reason === "github_failed" && !(error instanceof HttpError)) console.error(error);
    return redirect(`/login?error=${encodeURIComponent(reason)}`, [clear]);
  }
}

export async function logoutRoute(request: Request) {
  requireUser(request);
  destroySession(cookie(request, SESSION_COOKIE));
  if (isForm(request)) return redirect("/", [clearSessionCookie()]);
  return json({ ok: true }, { headers: { "Set-Cookie": clearSessionCookie() } });
}

// ---- Translating ----

const required = (v: unknown, name: string) => {
  const n = int(v);
  if (n === null) throw new HttpError(400, `invalid_${name}`, `${name} missing.`);
  return n;
};

// POST /api/translations {stringId, lang, text}
export async function saveRoute(request: Request) {
  const user = requireUser(request);
  const input = await readInput(request, 128 * 1024);
  limit(`save-min:${user.id}`, LIMITS.saveMinute);
  limit(`save-day:${user.id}`, LIMITS.saveDay);
  const result = saveTranslation(user, required(input.stringId, "stringId"), input.lang, input.text);
  return json({ ok: true, ...result });
}

// POST /api/translations/confirm {stringId, lang}: "still correct".
export async function confirmRoute(request: Request) {
  const user = requireUser(request);
  const input = await readInput(request);
  limit(`save-min:${user.id}`, LIMITS.saveMinute);
  limit(`save-day:${user.id}`, LIMITS.saveDay);
  return json({ ok: true, ...confirmCurrent(user, required(input.stringId, "stringId"), input.lang) });
}

// POST /api/suggestions/<id>/accept | reject
export async function reviewRoute(request: Request, idParam: string, decision: "accept" | "reject") {
  const user = requireUser(request);
  const id = required(idParam, "id");
  return action(request, async () => {
    limit(`review:${user.id}`, LIMITS.reviewMinute);
    const result = decision === "accept" ? acceptSuggestion(user, id) : rejectSuggestion(user, id);
    return { data: result };
  });
}

// ---- Reviewer actions on a repository ----

function repoFrom(input: Record<string, unknown>) {
  const repo = str(input.repo, 200);
  if (!componentsOf(repo).length) throw new HttpError(404, "unknown_repo", "This repository has no components.");
  return repo;
}

// POST /api/sync {repo}: "Sync now".
export async function syncRoute(request: Request) {
  const user = requireReviewer(request);
  return action(request, async (input) => {
    const repo = repoFrom(input);
    limit(`sync:${user.id}`, LIMITS.syncOrExport);
    const state = await queueSync(repo);
    return { data: { state }, param: ["synced", repo] };
  });
}

// POST /api/export {repo}: "Create pull request".
export async function exportRoute(request: Request) {
  const user = requireReviewer(request);
  return action(request, async (input) => {
    const repo = repoFrom(input);
    limit(`export:${user.id}`, LIMITS.syncOrExport);
    const result = await createPullRequest(user, repo);
    return { data: { result }, param: ["pr", `${repo}#${result.number}`] };
  });
}

// POST /api/glossary {action: save | delete | note, …}
export async function glossaryRoute(request: Request) {
  const user = requireReviewer(request);
  return action(request, async (input) => {
    limit(`glossary:${user.id}`, LIMITS.glossaryMinute);
    if (input.action === "delete") deleteTerm(user, required(input.id, "id"));
    else if (input.action === "note") saveLanguageNote(user, input.lang, input.note);
    else saveTerm(user, { lang: input.lang, term: input.term, translation: input.translation, note: input.note, id: int(input.id) });
    return { data: {}, param: ["saved", "1"] };
  });
}
