import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FIXTURES, req, signIn, useTempData } from "./helpers";
import { startGitHubMock } from "./github-mock";
import { all, one, run } from "../lib/db";
import { syncRepo } from "../lib/sync";
import { entryDetail, saveTranslation, counts } from "../lib/store";
import { createPullRequest, pendingCount, trackedPull } from "../lib/export";
import { forgetPullChecks, PULL_CHECK_MS, refreshPullsIfStale } from "../lib/pulls";
import { webhookRoute } from "../lib/routes";
import { handle } from "../lib/http";

useTempData();
const REPO = "yannicschuller/flowplan";
const gh = await startGitHubMock();
const files: Record<string, string> = {};
const walk = (d: string, root: string) => {
  for (const name of readdirSync(d)) {
    const p = join(d, name);
    if (statSync(p).isDirectory()) walk(p, root);
    else files[relative(root, p)] = readFileSync(p, "utf8");
  }
};
walk(join(FIXTURES, "flowplan"), join(FIXTURES, "flowplan"));
gh.commitFiles(REPO, "main", files);
await syncRepo(REPO);
const reviewer = { ...signIn("yannicschuller").user, role: "reviewer" as const };

// Accepts one more missing French text and exports: the tool's pull request.
async function exportOne() {
  const id = one<{ id: number }>(
    `SELECT s.id FROM strings s WHERE s.component_id='flowplan-web' AND s.removed=0
     AND NOT EXISTS (SELECT 1 FROM translations t WHERE t.string_id=s.id AND t.lang='fr' AND t.status IN ('accepted','exported')) ORDER BY s.position LIMIT 1`,
  )!.id;
  saveTranslation(reviewer, id, "fr", `${entryDetail(id, "fr")!.string.source} (fr)`);
  return { id, pr: await createPullRequest(reviewer, REPO) };
}
const exported = (n: number) => one<{ n: number }>("SELECT COUNT(*) AS n FROM translations WHERE status='exported' AND pr_number=?", n)!.n;
const age = () => run("UPDATE pull_requests SET checked_at=?", Date.now() - PULL_CHECK_MS - 1000);

test("open stays shown; closed without merging → not shown, its translations pending again (on sync)", async () => {
  const { pr } = await exportOne();
  assert.equal(trackedPull(REPO)?.number, pr.number);
  assert.equal(pendingCount(REPO), 0);
  await syncRepo(REPO);
  assert.equal(trackedPull(REPO)?.number, pr.number, "still open on GitHub");
  assert.equal(exported(pr.number), 1);

  gh.repos.get(REPO)!.pulls.get(pr.number)!.state = "closed";
  const done = counts("flowplan-web", "fr").done;
  await syncRepo(REPO);
  assert.equal(trackedPull(REPO), null, "the overview no longer shows it");
  assert.equal(one<{ state: string }>("SELECT state FROM pull_requests WHERE number=?", pr.number)!.state, "closed");
  assert.equal(exported(pr.number), 0);
  assert.equal(pendingCount(REPO), 1, "pending export again");
  assert.equal(counts("flowplan-web", "fr").done, done, "still translated");
});

test("merged → not shown; nothing changes until main has the values; the overview checks lazily", async () => {
  const { pr } = await exportOne();
  assert.equal(pr.texts, 2, "the earlier closed one comes along");
  const p = gh.repos.get(REPO)!.pulls.get(pr.number)!;
  p.state = "closed";
  p.merged = true;
  forgetPullChecks();
  const calls = () => gh.calls.filter((c) => c.path.endsWith(`/pulls/${pr.number}`) && c.method === "GET").length;
  const before = calls();
  await refreshPullsIfStale(REPO);
  assert.equal(calls(), before, "checked just now: no call");
  assert.equal(trackedPull(REPO)?.number, pr.number);
  age();
  await refreshPullsIfStale(REPO);
  assert.equal(calls(), before + 1, "one call per tracked open pull request");
  assert.equal(trackedPull(REPO), null);
  assert.equal(one<{ state: string }>("SELECT state FROM pull_requests WHERE number=?", pr.number)!.state, "merged");
  assert.equal(exported(pr.number), 2, "merged: still exported until the next sync of main sees them");
  await refreshPullsIfStale(REPO);
  assert.equal(calls(), before + 1, "nothing open left: no call");
});

test("a GitHub failure on the lazy check is logged and changes nothing", async () => {
  const { pr } = await exportOne();
  forgetPullChecks();
  age();
  const saved = process.env.TRANSLATE_GITHUB_API;
  process.env.TRANSLATE_GITHUB_API = "http://127.0.0.1:9"; // nothing listens there
  const { forgetTokens } = await import("../lib/github");
  forgetTokens();
  const log = console.error;
  const errors: unknown[] = [];
  console.error = (...a: unknown[]) => errors.push(a);
  try {
    await refreshPullsIfStale(REPO);
  } finally {
    console.error = log;
    process.env.TRANSLATE_GITHUB_API = saved;
    forgetTokens();
  }
  assert.ok(errors.length >= 1);
  assert.equal(trackedPull(REPO)?.number, pr.number);
});

test("pull_request webhook: closed without merging takes effect at once", async () => {
  process.env.TRANSLATE_WEBHOOK_SECRET = "hook-secret";
  const open = trackedPull(REPO)!;
  const payload = JSON.stringify({ action: "closed", pull_request: { number: open.number, merged: false }, repository: { full_name: REPO } });
  const signature = `sha256=${createHmac("sha256", "hook-secret").update(payload).digest("hex")}`;
  const r = await handle(() =>
    webhookRoute(req("/api/github/webhook", { method: "POST", body: payload, origin: null, headers: { "x-github-event": "pull_request", "x-hub-signature-256": signature } })),
  );
  assert.equal(r.status, 200);
  assert.equal(trackedPull(REPO), null);
  assert.equal(exported(open.number), 0);
  assert.ok(all("SELECT 1 FROM translations WHERE status='accepted' AND pr_number=?", open.number).length > 0);
  // Someone else's pull request: ignored.
  const other = JSON.stringify({ action: "closed", pull_request: { number: 9999, merged: false }, repository: { full_name: REPO } });
  const sig2 = `sha256=${createHmac("sha256", "hook-secret").update(other).digest("hex")}`;
  const ignored = await handle(() =>
    webhookRoute(req("/api/github/webhook", { method: "POST", body: other, origin: null, headers: { "x-github-event": "pull_request", "x-hub-signature-256": sig2 } })),
  );
  assert.equal((await ignored.json()).ignored, "pull_request");
});

test("pull_request webhook: reopened → open again; closed and merged → merged", async () => {
  const number = one<{ number: number }>("SELECT number FROM pull_requests WHERE repo=? AND state='closed' ORDER BY id DESC LIMIT 1", REPO)!.number;
  const send = async (action: string, merged: boolean) => {
    const payload = JSON.stringify({ action, pull_request: { number, merged }, repository: { full_name: REPO } });
    const signature = `sha256=${createHmac("sha256", "hook-secret").update(payload).digest("hex")}`;
    return handle(() => webhookRoute(req("/api/github/webhook", { method: "POST", body: payload, origin: null, headers: { "x-github-event": "pull_request", "x-hub-signature-256": signature } })));
  };
  assert.equal((await send("reopened", false)).status, 200);
  assert.equal(trackedPull(REPO)?.number, number);
  assert.equal((await send("closed", true)).status, 200);
  assert.equal(trackedPull(REPO), null);
  assert.equal(one<{ state: string }>("SELECT state FROM pull_requests WHERE number=?", number)!.state, "merged");
  const bad = JSON.stringify({ action: "closed", pull_request: { number, merged: false }, repository: { full_name: REPO } });
  const r = await handle(() => webhookRoute(req("/api/github/webhook", { method: "POST", body: bad, origin: null, headers: { "x-github-event": "pull_request", "x-hub-signature-256": "sha256=00" } })));
  assert.equal(r.status, 401, "same signature check");
  assert.equal(one<{ state: string }>("SELECT state FROM pull_requests WHERE number=?", number)!.state, "merged");
});
