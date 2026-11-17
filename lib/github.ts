// A small GitHub REST client on plain fetch: timeouts, clear errors, the
// App's JWT (RS256) and installation access tokens. TRANSLATE_GITHUB_API
// points it at a local mock server in tests.
import { createSign } from "node:crypto";
import { config } from "./config";

export class GitHubError extends Error {
  // code: "app_not_installed" when the App has no installation on the repository.
  constructor(public status: number, public path: string, message: string, public code = "") {
    super(message);
  }
}

const TIMEOUT_MS = 20_000;

export async function githubFetch(url: string, init: RequestInit = {}, timeoutMs = TIMEOUT_MS): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("User-Agent", "flowplan-translate");
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  if (!headers.has("Accept")) headers.set("Accept", "application/vnd.github+json");
  const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
  try {
    return await fetch(url, { ...init, headers, redirect: "follow", signal: AbortSignal.timeout(timeoutMs) });
  } catch (error) {
    const reason = (error as Error)?.name === "TimeoutError" ? `timed out after ${timeoutMs / 1000} s` : (error as Error)?.message || "network error";
    throw new GitHubError(0, path, `GitHub ${init.method || "GET"} ${path}: ${reason}`);
  }
}

const b64url = (data: string | Buffer) => Buffer.from(data).toString("base64url");

// The App's own JWT: valid ten minutes (with a minute of clock skew).
export function appJwt(appId: string, privateKey: string, at = Date.now()) {
  const iat = Math.floor(at / 1000) - 60;
  const header = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = b64url(JSON.stringify({ iat, exp: iat + 600, iss: appId }));
  const signer = createSign("RSA-SHA256");
  signer.update(`${header}.${payload}`);
  return `${header}.${payload}.${signer.sign(privateKey).toString("base64url")}`;
}

async function failure(response: Response, method: string, path: string) {
  let detail = "";
  try {
    const body = (await response.json()) as { message?: string };
    detail = body.message ? `: ${body.message}` : "";
  } catch {
    // no JSON body
  }
  return new GitHubError(response.status, path, `GitHub ${method} ${path} answered ${response.status}${detail}`);
}

async function call<T>(token: string, method: string, path: string, body?: unknown, auth = "Bearer"): Promise<T> {
  const response = await githubFetch(`${config.githubApi()}${path}`, {
    method,
    headers: { Authorization: `${auth} ${token}`, ...(body !== undefined ? { "Content-Type": "application/json" } : {}) },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) throw await failure(response, method, path);
  return (response.status === 204 ? {} : await response.json()) as T;
}

const tokens = globalThis as unknown as { translateTokens?: Map<string, { token: string; expires: number }> };

// An installation access token for the repository (cached until five
// minutes before it runs out).
export async function installationToken(repo: string): Promise<string> {
  const app = config.app();
  if (!app) throw new GitHubError(0, "", "The GitHub App is not configured (TRANSLATE_GITHUB_APP_ID, TRANSLATE_GITHUB_PRIVATE_KEY).");
  const cache = (tokens.translateTokens ??= new Map());
  const cached = cache.get(`${config.githubApi()} ${repo}`);
  if (cached && cached.expires - 5 * 60_000 > Date.now()) return cached.token;
  const jwt = appJwt(app.appId, app.privateKey);
  let installation: { id: number };
  try {
    installation = await call<{ id: number }>(jwt, "GET", `/repos/${repo}/installation`);
  } catch (error) {
    if (error instanceof GitHubError && error.status === 404)
      throw new GitHubError(404, error.path, `The GitHub App is not installed on ${repo}.`, "app_not_installed");
    throw error;
  }
  const access = await call<{ token: string; expires_at: string }>(jwt, "POST", `/app/installations/${installation.id}/access_tokens`, {});
  cache.set(`${config.githubApi()} ${repo}`, { token: access.token, expires: Date.parse(access.expires_at) || Date.now() + 30 * 60_000 });
  return access.token;
}
export const forgetTokens = () => tokens.translateTokens?.clear();

const encodePath = (path: string) => path.split("/").map(encodeURIComponent).join("/");

// One repository, with its installation token.
export async function repoClient(repo: string) {
  const token = await installationToken(repo);
  const api = <T>(method: string, path: string, body?: unknown) => call<T>(token, method, `/repos/${repo}${path}`, body);
  return {
    async headSha(branch: string) {
      const ref = await api<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodePath(branch)}`);
      return ref.object.sha;
    },
    // A file's bytes as UTF-8 text at a commit, or null when it does not exist.
    async file(path: string, ref: string): Promise<string | null> {
      const url = `${config.githubApi()}/repos/${repo}/contents/${encodePath(path)}?ref=${encodeURIComponent(ref)}`;
      const response = await githubFetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: "application/vnd.github.raw+json" } });
      if (response.status === 404) return null;
      if (!response.ok) throw await failure(response, "GET", `/repos/${repo}/contents/${path}`);
      return Buffer.from(await response.arrayBuffer()).toString("utf8");
    },
    async commitTree(sha: string) {
      return (await api<{ tree: { sha: string } }>("GET", `/git/commits/${sha}`)).tree.sha;
    },
    async createBlob(content: string) {
      return (await api<{ sha: string }>("POST", "/git/blobs", { content: Buffer.from(content, "utf8").toString("base64"), encoding: "base64" })).sha;
    },
    async createTree(baseTree: string, files: { path: string; sha: string }[]) {
      return (await api<{ sha: string }>("POST", "/git/trees", { base_tree: baseTree, tree: files.map((f) => ({ path: f.path, mode: "100644", type: "blob", sha: f.sha })) })).sha;
    },
    async createCommit(message: string, tree: string, parents: string[]) {
      return (await api<{ sha: string }>("POST", "/git/commits", { message, tree, parents })).sha;
    },
    async createBranch(branch: string, sha: string) {
      await api("POST", "/git/refs", { ref: `refs/heads/${branch}`, sha });
    },
    async moveBranch(branch: string, sha: string) {
      await api("PATCH", `/git/refs/heads/${encodePath(branch)}`, { sha, force: false });
    },
    async branchSha(branch: string) {
      return (await api<{ object: { sha: string } }>("GET", `/git/ref/heads/${encodePath(branch)}`)).object.sha;
    },
    async pull(number: number) {
      return api<{ number: number; state: string; merged?: boolean; html_url: string; head: { ref: string } }>("GET", `/pulls/${number}`);
    },
    async createPull(input: { title: string; head: string; base: string; body: string }) {
      return api<{ number: number; html_url: string }>("POST", "/pulls", input);
    },
    async updatePull(number: number, input: { body: string; title?: string }) {
      return api<{ number: number; html_url: string }>("PATCH", `/pulls/${number}`, input);
    },
  };
}
export type RepoClient = Awaited<ReturnType<typeof repoClient>>;
