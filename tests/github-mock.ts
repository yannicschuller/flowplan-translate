// A local stand-in for the parts of GitHub's API the tool uses: App
// installation tokens (the JWT is verified against the throwaway key's
// public half), contents, the Git Data API, pull requests and OAuth.
// Repositories live in memory as commits of path → content.
import { createServer, type IncomingMessage, type Server } from "node:http";
import { createHash, createVerify, generateKeyPairSync } from "node:crypto";
import { after } from "node:test";

type Commit = { sha: string; tree: string; parents: string[]; message: string; files: Map<string, string> };
type Pull = { number: number; head: string; base: string; title: string; body: string; state: "open" | "closed"; merged: boolean };

export type MockRepo = {
  branches: Map<string, string>;
  commits: Map<string, Commit>;
  trees: Map<string, Map<string, string>>;
  blobs: Map<string, string>;
  pulls: Map<number, Pull>;
};

const hash = (s: string) => createHash("sha1").update(s).digest("hex");

export async function startGitHubMock() {
  const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const pem = privateKey.export({ type: "pkcs1", format: "pem" }).toString();
  const repos = new Map<string, MockRepo>();
  const calls: { method: string; path: string; body?: unknown }[] = [];
  let pullNumber = 1;
  const oauth = { code: "good-code", user: { id: 4242, login: "octo-translator", name: "Octo" } };

  function repo(name: string) {
    let r = repos.get(name);
    if (!r) {
      r = { branches: new Map(), commits: new Map(), trees: new Map(), blobs: new Map(), pulls: new Map() };
      repos.set(name, r);
    }
    return r;
  }
  function commitFiles(name: string, branch: string, files: Record<string, string>, message = "commit") {
    const r = repo(name);
    const parent = r.branches.get(branch);
    const base = parent ? new Map(r.commits.get(parent)!.files) : new Map<string, string>();
    for (const [p, c] of Object.entries(files)) base.set(p, c);
    const tree = hash(JSON.stringify([...base]));
    r.trees.set(tree, base);
    const sha = hash(`${tree}${parent}${message}${Math.random()}`);
    r.commits.set(sha, { sha, tree, parents: parent ? [parent] : [], message, files: base });
    r.branches.set(branch, sha);
    return sha;
  }

  const read = (req: IncomingMessage) =>
    new Promise<string>((resolve) => {
      const chunks: Buffer[] = [];
      req.on("data", (c) => chunks.push(c));
      req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    });
  const verifyJwt = (auth: string | undefined) => {
    const jwt = (auth || "").replace(/^Bearer /, "");
    const [h, p, s] = jwt.split(".");
    if (!h || !p || !s) return false;
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    return v.verify(publicKey, Buffer.from(s, "base64url"));
  };

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url || "/", "http://x");
    const raw = await read(req);
    const body = raw ? JSON.parse(raw) : undefined;
    calls.push({ method: req.method || "GET", path: url.pathname, body });
    const send = (status: number, data: unknown) => {
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify(data));
    };
    const auth = req.headers.authorization;
    if (url.pathname === "/login/oauth/access_token" && req.method === "POST")
      return send(200, body?.code === oauth.code ? { access_token: "user-token-xyz" } : { error: "bad_verification_code" });
    if (url.pathname === "/user") return auth === "Bearer user-token-xyz" ? send(200, oauth.user) : send(401, { message: "Bad credentials" });

    let m = /^\/repos\/([^/]+\/[^/]+)\/installation$/.exec(url.pathname);
    if (m) return verifyJwt(auth) ? (repos.has(m[1]) ? send(200, { id: 77 }) : send(404, { message: "Not Found" })) : send(401, { message: "bad jwt" });
    if (/^\/app\/installations\/77\/access_tokens$/.test(url.pathname))
      return verifyJwt(auth) ? send(201, { token: "inst-token", expires_at: new Date(Date.now() + 3600_000).toISOString() }) : send(401, { message: "bad jwt" });

    m = /^\/repos\/([^/]+\/[^/]+)(\/.*)$/.exec(url.pathname);
    if (!m) return send(404, { message: "Not Found" });
    if (auth !== "Bearer inst-token") return send(401, { message: "Bad credentials" });
    const r = repos.get(m[1]);
    if (!r) return send(404, { message: "Not Found" });
    const rest = decodeURIComponent(m[2]);
    let n: RegExpExecArray | null;
    if ((n = /^\/git\/ref\/heads\/(.+)$/.exec(rest))) {
      const sha = r.branches.get(n[1]);
      return sha ? send(200, { object: { sha } }) : send(404, { message: "Not Found" });
    }
    if ((n = /^\/git\/refs\/heads\/(.+)$/.exec(rest)) && req.method === "PATCH") {
      if (!r.branches.has(n[1])) return send(422, { message: "Reference does not exist" });
      if (!r.commits.has(body.sha)) return send(422, { message: "Object does not exist" });
      r.branches.set(n[1], body.sha);
      return send(200, { object: { sha: body.sha } });
    }
    if (rest === "/git/refs" && req.method === "POST") {
      const name = String(body.ref).replace(/^refs\/heads\//, "");
      if (r.branches.has(name)) return send(422, { message: "Reference already exists" });
      r.branches.set(name, body.sha);
      return send(201, { ref: body.ref });
    }
    if ((n = /^\/contents\/(.+)$/.exec(rest))) {
      const ref = url.searchParams.get("ref") || "main";
      const commit = r.commits.get(ref) || r.commits.get(r.branches.get(ref) || "");
      const content = commit?.files.get(n[1]);
      if (content === undefined) return send(404, { message: "Not Found" });
      res.writeHead(200, { "content-type": "application/vnd.github.raw+json" });
      return res.end(content);
    }
    if ((n = /^\/git\/commits\/(\w+)$/.exec(rest))) {
      const c = r.commits.get(n[1]);
      return c ? send(200, { sha: c.sha, tree: { sha: c.tree } }) : send(404, { message: "Not Found" });
    }
    if (rest === "/git/blobs" && req.method === "POST") {
      const content = Buffer.from(body.content, body.encoding === "base64" ? "base64" : "utf8").toString("utf8");
      const sha = hash(`blob${content}`);
      r.blobs.set(sha, content);
      return send(201, { sha });
    }
    if (rest === "/git/trees" && req.method === "POST") {
      const base = r.trees.get(body.base_tree);
      if (!base) return send(422, { message: "base_tree not found" });
      const files = new Map(base);
      for (const t of body.tree) files.set(t.path, r.blobs.get(t.sha)!);
      const sha = hash(JSON.stringify([...files]));
      r.trees.set(sha, files);
      return send(201, { sha });
    }
    if (rest === "/git/commits" && req.method === "POST") {
      const files = r.trees.get(body.tree);
      if (!files) return send(422, { message: "tree not found" });
      const sha = hash(`${body.tree}${body.parents.join()}${body.message}${Math.random()}`);
      r.commits.set(sha, { sha, tree: body.tree, parents: body.parents, message: body.message, files });
      return send(201, { sha });
    }
    if (rest === "/pulls" && req.method === "POST") {
      const number = pullNumber++;
      r.pulls.set(number, { number, head: body.head, base: body.base, title: body.title, body: body.body, state: "open", merged: false });
      return send(201, { number, html_url: `https://github.com/${m[1]}/pull/${number}` });
    }
    if ((n = /^\/pulls\/(\d+)$/.exec(rest))) {
      const p = r.pulls.get(Number(n[1]));
      if (!p) return send(404, { message: "Not Found" });
      if (req.method === "PATCH") Object.assign(p, body);
      return send(200, { number: p.number, state: p.state, merged: p.merged, html_url: `https://github.com/${m[1]}/pull/${p.number}`, head: { ref: p.head } });
    }
    return send(404, { message: `mock: no route ${req.method} ${rest}` });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address() as { port: number };
  const base = `http://127.0.0.1:${address.port}`;
  after(() => new Promise<void>((resolve) => server.close(() => resolve())));

  // Point the tool at the mock.
  process.env.TRANSLATE_GITHUB_API = base;
  process.env.TRANSLATE_GITHUB_APP_ID = "12345";
  process.env.TRANSLATE_GITHUB_PRIVATE_KEY = pem.replace(/\n/g, "\\n");
  process.env.TRANSLATE_GITHUB_CLIENT_ID = "Iv1.test";
  process.env.TRANSLATE_GITHUB_CLIENT_SECRET = "test-client-secret";

  return { base, repos, repo, commitFiles, calls, oauth, fileAt: (name: string, ref: string, path: string) => {
    const r = repos.get(name)!;
    return r.commits.get(r.branches.get(ref) || ref)?.files.get(path);
  } };
}
