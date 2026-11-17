// "Create pull request": the accepted translations of one repository that
// are not in its main branch yet go back as one pull request. The files are
// rewritten from main's current content (fetched now, never a stale copy),
// format-preservingly, through the Git Data API with the installation token.
// An open pull request of the tool for that repository gets a new commit and
// a new description instead of a second pull request.
import { randomBytes } from "node:crypto";
import { all, now, one, run, transaction } from "./db";
import { HttpError } from "./http";
import { adapters } from "./formats";
import { catalogueFile, componentsOf, txtFiles } from "./components";
import { repoClient, GitHubError } from "./github";
import { config } from "./config";
import { markPull } from "./pulls";
import type { SessionUser } from "./auth";
import type { Component } from "./types";

type Candidate = {
  id: number;
  component_id: string;
  key: string;
  lang: string;
  text: string;
  status: string;
  pr_number: number | null;
  author_id: number | null;
  login: string | null;
  github_id: number | null;
  repo_text: string | null;
};

function candidates(c: Component) {
  return all<Candidate>(
    `SELECT t.id,s.component_id,s.key,t.lang,t.text,t.status,t.pr_number,t.author_id,u.login,u.github_id,r.text AS repo_text
     FROM translations t JOIN strings s ON s.id=t.string_id
       LEFT JOIN users u ON u.id=t.author_id
       LEFT JOIN repo_values r ON r.string_id=t.string_id AND r.lang=t.lang
     WHERE s.component_id=? AND s.removed=0 AND t.status IN ('accepted','exported')
     ORDER BY t.lang, s.position`,
    c.id,
  ).filter((row) => (c.targets as string[]).includes(row.lang));
}

// Accepted values that differ from the last synced repository state.
export function pendingCount(repo: string) {
  return componentsOf(repo)
    .flatMap(candidates)
    .filter((row) => row.status === "accepted" && row.repo_text !== row.text).length;
}

export type OpenPull = { number: number; branch: string; base_sha: string };
export const trackedPull = (repo: string) =>
  one<OpenPull & { state: string }>("SELECT number,branch,base_sha,state FROM pull_requests WHERE repo=? AND state='open' ORDER BY id DESC LIMIT 1", repo) ?? null;

export type ExportResult = {
  number: number;
  url: string;
  created: boolean;
  files: string[];
  languages: Record<string, number>;
  texts: number;
  skipped: { component: string; lang: string; key: string; reason: string }[];
};

const sanitize = (s: string, max = 100) => {
  const flat = s.replace(/[`\r\n\t|<>]/g, " ");
  return flat.length > max ? `${flat.slice(0, max - 1)}…` : flat;
};
const noreply = (row: { github_id: number; login: string }) => `${row.login} <${row.github_id}+${row.login}@users.noreply.github.com>`;

export function commitMessage(languages: string[], texts: number, titles: string[], authors: { github_id: number; login: string }[]) {
  const lines = [`Update translations: ${languages.join(", ")}`, "", `${texts} ${texts === 1 ? "text" : "texts"} in ${titles.join(", ")}, from flowplan-translate.`];
  if (authors.length) lines.push("", ...authors.map((a) => `Co-authored-by: ${noreply(a)}`));
  return lines.join("\n");
}

export function pullBody(input: {
  included: { component: string; lang: string; key: string }[];
  authors: { login: string }[];
  skipped: ExportResult["skipped"];
}) {
  const byLang = new Map<string, number>();
  for (const row of input.included) byLang.set(row.lang, (byLang.get(row.lang) || 0) + 1);
  const lines = [
    `Translations from [flowplan-translate](${config.publicUrl()}), accepted by a reviewer.`,
    "",
    "| Language | Texts |",
    "| --- | ---: |",
    ...[...byLang].map(([lang, n]) => `| ${lang} | ${n} |`),
    "",
    `<details><summary>Changed texts (${input.included.length})</summary>`,
    "",
  ];
  const MAX_LISTED = 400;
  for (const row of input.included.slice(0, MAX_LISTED)) lines.push(`- ${sanitize(row.component, 60)} · ${row.lang} · \`${sanitize(row.key)}\``);
  if (input.included.length > MAX_LISTED) lines.push(`- … and ${input.included.length - MAX_LISTED} more`);
  lines.push("", "</details>", "");
  if (input.authors.length) lines.push(`**Contributors:** ${input.authors.map((a) => `[${a.login}](https://github.com/${a.login})`).join(", ")}`, "");
  if (input.skipped.length) {
    lines.push(`<details><summary>Not included (${input.skipped.length})</summary>`, "");
    for (const s of input.skipped.slice(0, 100)) lines.push(`- ${sanitize(s.component, 60)} · ${s.lang} · \`${sanitize(s.key)}\`: ${s.reason}`);
    lines.push("", "</details>", "");
  }
  return lines.join("\n");
}

const branchName = (at: number) => `translate/${new Date(at).toISOString().slice(0, 10)}-${randomBytes(3).toString("hex")}`;

export async function createPullRequest(user: SessionUser, repo: string, at = now()): Promise<ExportResult> {
  if (user.role !== "reviewer") throw new HttpError(403, "not_reviewer", "Nur für Reviewer. / Reviewers only.");
  const list = componentsOf(repo);
  if (!list.length) throw new HttpError(404, "unknown_repo", "This repository has no components.");
  const branch = list[0].branch;
  const rows = new Map(list.map((c) => [c.id, candidates(c)]));

  let client;
  try {
    client = await repoClient(repo);
  } catch (error) {
    if (error instanceof GitHubError && error.code === "app_not_installed") throw new HttpError(502, "app_not_installed", error.message);
    throw new HttpError(502, "github_failed", (error as Error).message);
  }
  try {
    const mainSha = await client.headSha(branch);
    // The tool's open pull request, if GitHub says it is still open.
    let open = trackedPull(repo);
    if (open) {
      const pull = await client.pull(open.number);
      if (pull.state !== "open") {
        markPull(repo, open.number, pull.merged ? "merged" : "closed", at);
        open = null;
      }
    }

    const files: { path: string; content: string }[] = [];
    const included: Candidate[] = [];
    const skipped: ExportResult["skipped"] = [];
    for (const c of list) {
      const own = rows.get(c.id)!;
      for (const lang of c.targets) {
        const forLang = own.filter((r) => r.lang === lang);
        if (!forLang.length) continue;
        if (c.format === "txt-files") {
          const paths = txtFiles(c, lang);
          for (const row of forLang) {
            const path = paths.get(row.key);
            const original = path ? await client.file(path, mainSha) : null;
            if (!path || original === null) {
              skipped.push({ component: c.title, lang, key: row.key, reason: `file not found${path ? `: ${path}` : ""}` });
              continue;
            }
            if (adapters["txt-files"].read(original)[0].text === row.text) continue;
            files.push({ path, content: adapters["txt-files"].write(original, new Map([["", row.text]])).content });
            included.push(row);
          }
          continue;
        }
        const path = catalogueFile(c, lang)!;
        const original = await client.file(path, mainSha);
        if (original === null) {
          for (const row of forLang) skipped.push({ component: c.title, lang, key: row.key, reason: `file not found: ${path}` });
          continue;
        }
        const adapter = adapters[c.format];
        const inFile = new Map(adapter.read(original).map((e) => [e.key, e.text]));
        const changes = new Map<string, string>();
        for (const row of forLang) {
          if (!inFile.has(row.key)) {
            // Keys are added by the repository's own catalogue script, never here.
            skipped.push({ component: c.title, lang, key: row.key, reason: "key not in the target file" });
            continue;
          }
          if (inFile.get(row.key) === row.text) continue;
          changes.set(row.key, row.text);
          included.push(row);
        }
        if (!changes.size) continue;
        const written = adapter.write(original, changes);
        if (written.content !== original) files.push({ path, content: written.content });
      }
    }

    const fresh = included.filter((r) => r.status === "accepted" || r.pr_number !== open?.number);
    if (!fresh.length) throw new HttpError(409, "nothing_to_export", "Nothing new to export: every accepted translation is already in main or in the open pull request.", { skipped });

    const authorsById = new Map<number, { github_id: number; login: string }>();
    for (const r of included) if (r.author_id && r.github_id && r.login) authorsById.set(r.author_id, { github_id: r.github_id, login: r.login });
    const authors = [...authorsById.values()].sort((a, b) => a.login.localeCompare(b.login));
    const languages = [...new Set(included.map((r) => r.lang))].sort();
    const titles = list.filter((c) => included.some((r) => r.component_id === c.id)).map((c) => c.title);

    const baseTree = await client.commitTree(mainSha);
    const blobs = [];
    for (const f of files) blobs.push({ path: f.path, sha: await client.createBlob(f.content) });
    const tree = await client.createTree(baseTree, blobs);
    const message = commitMessage(languages, included.length, titles, authors);
    const titleOf = new Map(list.map((c) => [c.id, c.title]));
    const body = pullBody({
      included: included.map((r) => ({ component: titleOf.get(r.component_id) || r.component_id, lang: r.lang, key: r.key })),
      authors,
      skipped,
    });

    let number: number;
    let url: string;
    let created = false;
    if (open) {
      const head = await client.branchSha(open.branch);
      // A merge of main when main moved since the last commit, so the pull request stays mergeable.
      const parents = open.base_sha === mainSha ? [head] : [head, mainSha];
      const commit = await client.createCommit(message, tree, parents);
      await client.moveBranch(open.branch, commit);
      const pull = await client.updatePull(open.number, { body });
      number = pull.number;
      url = pull.html_url;
      run("UPDATE pull_requests SET base_sha=?,checked_at=?,updated_at=? WHERE repo=? AND number=?", mainSha, at, at, repo, open.number);
    } else {
      const name = branchName(at);
      const commit = await client.createCommit(message, tree, [mainSha]);
      await client.createBranch(name, commit);
      const pull = await client.createPull({ title: `Translations: ${languages.join(", ")} (${new Date(at).toISOString().slice(0, 10)})`, head: name, base: branch, body });
      number = pull.number;
      url = pull.html_url;
      created = true;
      run("INSERT INTO pull_requests(repo,number,branch,state,base_sha,checked_at,created_at,updated_at) VALUES(?,?,?,'open',?,?,?,?)", repo, number, name, mainSha, at, at, at);
    }
    transaction(() => {
      for (const r of included) run("UPDATE translations SET status='exported',pr_number=?,updated_at=? WHERE id=? AND status IN ('accepted','exported')", number, at, r.id);
    });
    const byLang: Record<string, number> = {};
    for (const r of included) byLang[r.lang] = (byLang[r.lang] || 0) + 1;
    return { number, url, created, files: files.map((f) => f.path), languages: byLang, texts: included.length, skipped };
  } catch (error) {
    if (error instanceof GitHubError) throw new HttpError(502, "github_failed", error.message);
    throw error;
  }
}
