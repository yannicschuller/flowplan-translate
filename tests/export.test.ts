import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { FIXTURES, signIn, useTempData } from "./helpers";
import { startGitHubMock } from "./github-mock";
import { one, all } from "../lib/db";
import { syncRepo } from "../lib/sync";
import { acceptSuggestion, entryDetail, saveTranslation } from "../lib/store";
import { createPullRequest } from "../lib/export";
import { HttpError } from "../lib/http";

useTempData();
const REPO = "yannicschuller/flowplan";
const files = (dir: string) => {
  const out: Record<string, string> = {};
  const walk = (d: string) => {
    for (const name of readdirSync(d)) {
      const p = join(d, name);
      if (statSync(p).isDirectory()) walk(p);
      else out[relative(dir, p)] = readFileSync(p, "utf8");
    }
  };
  walk(dir);
  return out;
};
const id = (key: string) => one<{ id: number }>("SELECT id FROM strings WHERE component_id='flowplan-web' AND key=?", key)!.id;
const missingFr = () => all<{ key: string }>(
  `SELECT s.key FROM strings s LEFT JOIN translations t ON t.string_id=s.id AND t.lang='fr' AND t.status IN ('accepted','exported')
   WHERE s.component_id='flowplan-web' AND t.id IS NULL ORDER BY s.position`,
).map((r) => r.key);

const gh = await startGitHubMock();

test("pull requests: new, update of the open one, closed → new, nothing to export", async () => {
  const original = files(join(FIXTURES, "flowplan"));
  gh.commitFiles(REPO, "main", { ...original, "README.md": "# Flowplan\n" });
  const state = await syncRepo(REPO);
  assert.deepEqual(state.errors, []);
  assert.equal(state.sha, gh.repos.get(REPO)!.branches.get("main"));

  const translator = { ...signIn("helper").user, role: "translator" as const };
  const reviewer = { ...signIn("yannicschuller").user, role: "reviewer" as const };
  await assert.rejects(createPullRequest(translator, REPO), (e: HttpError) => e.status === 403);
  await assert.rejects(createPullRequest(reviewer, REPO), (e: HttpError) => e.code === "nothing_to_export");

  // A translator's suggestion, accepted by the reviewer; a reviewer's own edit in zh.
  const [first, next] = missingFr();
  const target = entryDetail(id(first), "fr")!;
  const source = target.string.source;
  saveTranslation(translator, id(first), "fr", `${source} (fr)`);
  const suggestion = entryDetail(id(first), "fr")!.suggestions[0];
  acceptSuggestion(reviewer, suggestion.id);
  saveTranslation(reviewer, id("Page"), "zh", "页");

  const pr = await createPullRequest(reviewer, REPO);
  assert.equal(pr.created, true);
  assert.deepEqual(pr.files.sort(), ["locales/fr.json", "locales/zh.json"]);
  assert.deepEqual(pr.languages, { fr: 1, zh: 1 });
  const repo = gh.repos.get(REPO)!;
  const pull = repo.pulls.get(pr.number)!;
  assert.match(pull.head, /^translate\/\d{4}-\d{2}-\d{2}-[0-9a-f]{6}$/);
  assert.equal(pull.base, "main");
  assert.match(pull.body, /\| fr \| 1 \|/);
  assert.match(pull.body, /<details><summary>Changed texts \(2\)<\/summary>/);
  assert.match(pull.body, /\[helper\]\(https:\/\/github\.com\/helper\)/);
  // The commit: only the two changed files, the rest as on main.
  const head = repo.commits.get(repo.branches.get(pull.head)!)!;
  const mainSha = repo.branches.get("main")!;
  assert.deepEqual(head.parents, [mainSha]);
  assert.match(head.message, new RegExp(`Co-authored-by: helper <${translator.github_id}\\+helper@users\\.noreply\\.github\\.com>`));
  assert.doesNotMatch(head.message, /Other-Helper/);
  const treeCall = gh.calls.filter((c) => c.path.endsWith("/git/trees"));
  assert.deepEqual((treeCall[0].body as { tree: { path: string }[] }).tree.map((t) => t.path).sort(), ["locales/fr.json", "locales/zh.json"]);
  for (const p of ["locales/en.json", "locales/reference/de.json", "README.md"]) assert.equal(head.files.get(p), repo.commits.get(mainSha)!.files.get(p));
  const fr = head.files.get("locales/fr.json")!;
  const changedLines = fr.split("\n").filter((line, i) => line !== original["locales/fr.json"].split("\n")[i]);
  assert.equal(changedLines.length, 1);
  assert.equal(JSON.parse(fr)[first], `${source} (fr)`);
  assert.equal(Object.keys(JSON.parse(fr)).join(), Object.keys(JSON.parse(original["locales/fr.json"])).join(), "same keys, same order");
  // Marked exported with the number.
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM translations WHERE status='exported' AND pr_number=?", pr.number)!.n, 2);
  await assert.rejects(createPullRequest(reviewer, REPO), (e: HttpError) => e.code === "nothing_to_export");

  // Main moves on; a second accepted text goes into the open pull request.
  gh.commitFiles(REPO, "main", { "README.md": "# Flowplan\n\nMore.\n" }, "unrelated");
  const other = { ...signIn("Other-Helper").user, role: "translator" as const };
  saveTranslation(other, id(next), "fr", `${entryDetail(id(next), "fr")!.string.source} (fr)`);
  acceptSuggestion(reviewer, entryDetail(id(next), "fr")!.suggestions[0].id);
  const update = await createPullRequest(reviewer, REPO);
  assert.equal(update.created, false);
  assert.equal(update.number, pr.number);
  assert.equal(repo.pulls.size, 1);
  const head2 = repo.commits.get(repo.branches.get(pull.head)!)!;
  assert.deepEqual(head2.parents, [head.sha, repo.branches.get("main")], "a merge of the new main");
  assert.equal(head2.files.get("README.md"), "# Flowplan\n\nMore.\n");
  assert.match(head2.message, /Co-authored-by: helper/);
  assert.match(head2.message, /Co-authored-by: Other-Helper <\d+\+Other-Helper@users\.noreply\.github\.com>/);
  assert.match(repo.pulls.get(pr.number)!.body, /Changed texts \(3\)/);
  assert.equal(JSON.parse(head2.files.get("locales/fr.json")!)[first], `${source} (fr)`, "earlier changes stay");

  // Closed on GitHub without merging: the next export opens a new one with everything.
  repo.pulls.get(pr.number)!.state = "closed";
  const reopened = await createPullRequest(reviewer, REPO);
  assert.equal(reopened.created, true);
  assert.notEqual(reopened.number, pr.number);
  assert.equal(reopened.texts, 3);
  assert.equal(one<{ state: string }>("SELECT state FROM pull_requests WHERE number=?", pr.number)!.state, "closed");

  // Merged: the next sync sees the values in main – accepted, nothing pending.
  const merged = repo.commits.get(repo.branches.get(repo.pulls.get(reopened.number)!.head)!)!;
  gh.commitFiles(REPO, "main", Object.fromEntries(merged.files), "merge");
  await syncRepo(REPO);
  assert.equal(one<{ n: number }>("SELECT COUNT(*) AS n FROM translations WHERE status='exported'")!.n, 0);
  await assert.rejects(createPullRequest(reviewer, REPO), (e: HttpError) => e.code === "nothing_to_export");
});

test("keys missing in the target file are skipped and reported, never added", async () => {
  const reviewer = { ...signIn("yannicschuller").user, role: "reviewer" as const };
  const repo = gh.repos.get(REPO)!;
  const main = repo.commits.get(repo.branches.get("main")!)!;
  // fr.json on main lost a key (the catalogue script has not run yet).
  const fr = JSON.parse(main.files.get("locales/fr.json")!);
  const [gone, kept] = Object.keys(fr).filter((k) => !fr[k]);
  delete fr[gone];
  gh.commitFiles(REPO, "main", { "locales/fr.json": JSON.stringify(fr, null, 2) + "\n" });
  saveTranslation(reviewer, id(gone), "fr", `${entryDetail(id(gone), "fr")!.string.source} (fr)`);
  saveTranslation(reviewer, id(kept), "fr", `${entryDetail(id(kept), "fr")!.string.source} (fr)`);
  const pr = await createPullRequest(reviewer, REPO);
  assert.deepEqual(pr.skipped.map((s) => [s.key, s.reason]), [[gone, "key not in the target file"]]);
  const written = JSON.parse(gh.fileAt(REPO, repo.pulls.get(pr.number)!.head, "locales/fr.json")!);
  assert.ok(!(gone in written));
  assert.equal(written[kept], `${entryDetail(id(kept), "fr")!.string.source} (fr)`);
  assert.match(repo.pulls.get(pr.number)!.body, /Not included \(1\)/);
});

test("a repository without the App's installation: a readable sync error, other repositories still sync", async () => {
  const desktop = await syncRepo("yannicschuller/flowplan-desktop");
  assert.deepEqual(desktop.errors.map((e) => [e.code, e.message]), [["app_not_installed", "The GitHub App is not installed on yannicschuller/flowplan-desktop."]]);
  const web = await syncRepo(REPO);
  assert.deepEqual(web.errors, []);
});
