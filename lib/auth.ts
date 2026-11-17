// Sign-in only with GitHub, through the GitHub App's user authorization
// (OAuth). The user's token is used once to read GET /user and then
// dropped. Sessions are random tokens in an httpOnly cookie; the database
// keeps only their SHA-256.
import { now, one, run } from "./db";
import { randomToken, sha256 } from "./secret";
import { HttpError, cookie, requireSameOrigin, setCookie } from "./http";
import { config, isReviewerLogin } from "./config";
import { githubFetch } from "./github";

export const SESSION_COOKIE = "ft_session";
export const OAUTH_STATE_COOKIE = "ft_oauth";
export const SESSION_DAYS = 30;

export type User = { id: number; github_id: number; login: string; name: string; created_at: number };
export type Role = "translator" | "reviewer";
export type SessionUser = User & { role: Role };

const withRole = (user: User): SessionUser => ({ ...user, role: isReviewerLogin(user.login) ? "reviewer" : "translator" });
export const isReviewer = (user: { role: Role } | null | undefined) => user?.role === "reviewer";

export function upsertUser(profile: { id: number; login: string; name?: string | null }): User {
  const at = now();
  run(
    "INSERT INTO users(github_id,login,name,created_at,last_login_at) VALUES(?,?,?,?,?) ON CONFLICT(github_id) DO UPDATE SET login=excluded.login,name=excluded.name,last_login_at=excluded.last_login_at",
    profile.id,
    profile.login,
    (profile.name || "").slice(0, 100),
    at,
    at,
  );
  return one<User>("SELECT id,github_id,login,name,created_at FROM users WHERE github_id=?", profile.id)!;
}

export function createSession(userId: number) {
  const token = randomToken();
  const at = now();
  run("INSERT INTO sessions(token_hash,user_id,created_at,expires_at) VALUES(?,?,?,?)", sha256(token), userId, at, at + SESSION_DAYS * 86_400_000);
  return token;
}
export const sessionCookie = (token: string) => setCookie(SESSION_COOKIE, token, { maxAge: SESSION_DAYS * 86_400 });
export const clearSessionCookie = () => setCookie(SESSION_COOKIE, "", { maxAge: 0 });

export function userForSessionToken(token: string | undefined | null): SessionUser | null {
  if (!token || token.length > 100) return null;
  const row = one<User & { expires_at: number }>(
    "SELECT u.id,u.github_id,u.login,u.name,u.created_at,s.expires_at FROM sessions s JOIN users u ON u.id=s.user_id WHERE s.token_hash=?",
    sha256(token),
  );
  if (!row || row.expires_at < now()) return null;
  const { expires_at: _expires, ...user } = row;
  return withRole(user);
}
export function destroySession(token: string | undefined) {
  if (token) run("DELETE FROM sessions WHERE token_hash=?", sha256(token));
}

export const currentUser = (request: Request) => userForSessionToken(cookie(request, SESSION_COOKIE));

// A writing request: same origin (CSRF) and a valid session.
export function requireUser(request: Request): SessionUser {
  requireSameOrigin(request);
  const user = currentUser(request);
  if (!user) throw new HttpError(401, "signed_out", "Bitte melde dich an. / Please sign in.");
  return user;
}
export function requireReviewer(request: Request): SessionUser {
  const user = requireUser(request);
  if (user.role !== "reviewer") throw new HttpError(403, "not_reviewer", "Nur für Reviewer. / Reviewers only.");
  return user;
}

// ---- GitHub OAuth (user-to-server) ----

export const callbackUrl = () => `${config.publicUrl()}/api/auth/callback`;

export function authorizeUrl(state: string) {
  const oauth = config.oauth();
  if (!oauth) throw new HttpError(404, "github_off", "GitHub sign-in is not configured.");
  const url = new URL(`${config.githubWeb()}/login/oauth/authorize`);
  url.searchParams.set("client_id", oauth.clientId);
  url.searchParams.set("redirect_uri", callbackUrl());
  url.searchParams.set("state", state);
  return url.toString();
}

// Exchanges the code on the server and reads the user; the token is not kept.
export async function githubProfile(code: string) {
  const oauth = config.oauth();
  if (!oauth) throw new HttpError(404, "github_off", "GitHub sign-in is not configured.");
  const tokenResponse = await githubFetch(`${config.githubWeb()}/login/oauth/access_token`, {
    method: "POST",
    headers: { Accept: "application/json", "Content-Type": "application/json" },
    body: JSON.stringify({ client_id: oauth.clientId, client_secret: oauth.clientSecret, code, redirect_uri: callbackUrl() }),
  });
  const tokenData = (await tokenResponse.json().catch(() => ({}))) as { access_token?: string };
  if (!tokenResponse.ok || !tokenData.access_token) throw new HttpError(400, "github_failed", "GitHub sign-in failed.");
  const userResponse = await githubFetch(`${config.githubApi()}/user`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/vnd.github+json" },
  });
  const profile = (await userResponse.json().catch(() => ({}))) as { id?: number; login?: string; name?: string | null };
  if (!userResponse.ok || typeof profile.id !== "number" || typeof profile.login !== "string" || !/^[A-Za-z0-9-]{1,39}$/.test(profile.login))
    throw new HttpError(400, "github_failed", "GitHub sign-in failed.");
  return { id: profile.id, login: profile.login, name: profile.name ?? "" };
}
