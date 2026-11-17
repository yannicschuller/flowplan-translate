// The state of the tool's pull requests on GitHub. A tracked pull request
// counts as open only while GitHub says so: every sync checks it, the
// overview checks it when the last check is older than five minutes, and a
// `pull_request` webhook (if the App subscribes to it) updates it at once.
// Closed without merging: its translations are pending export again right
// away. Merged: nothing to do – the next sync of main sees the values.
import { all, now, run, transaction } from "./db";
import { componentsOf } from "./components";
import { repoClient, type RepoClient } from "./github";

export const PULL_CHECK_MS = 5 * 60_000;
const LAZY_TIMEOUT_MS = 2_500;

type Tracked = { number: number; checked_at: number | null };
const trackedOpen = (repo: string) => all<Tracked>("SELECT number,checked_at FROM pull_requests WHERE repo=? AND state='open'", repo);

export function markPull(repo: string, number: number, state: "open" | "closed" | "merged", at = now()) {
  transaction(() => {
    run("UPDATE pull_requests SET state=?,checked_at=?,updated_at=? WHERE repo=? AND number=?", state, at, at, repo, number);
    if (state !== "closed") return;
    const ids = componentsOf(repo).map((c) => c.id);
    if (!ids.length) return;
    run(
      `UPDATE translations SET status='accepted',updated_at=? WHERE status='exported' AND pr_number=?
       AND string_id IN (SELECT id FROM strings WHERE component_id IN (${ids.map(() => "?").join(",")}))`,
      at,
      number,
      ...ids,
    );
  });
}

// Asks GitHub for every tracked open pull request of the repository (one
// call each). Errors are logged and leave the state as it was.
export async function refreshPulls(repo: string, client?: RepoClient, at = now()) {
  const open = trackedOpen(repo);
  if (!open.length) return;
  try {
    client ??= await repoClient(repo);
  } catch (error) {
    console.error(`Pull request check for ${repo} failed:`, (error as Error).message);
    return;
  }
  for (const pr of open) {
    try {
      const pull = await client.pull(pr.number);
      markPull(repo, pr.number, pull.state === "open" ? "open" : pull.merged ? "merged" : "closed", at);
    } catch (error) {
      console.error(`Pull request check for ${repo}#${pr.number} failed:`, (error as Error).message);
    }
  }
}

const attempts = globalThis as unknown as { translatePullChecks?: Map<string, number> };

// For the overview: only when the last check is old, at most once per five
// minutes per repository (also after a failure), waiting at most 2.5 s – a
// slower check finishes in the background.
export async function refreshPullsIfStale(repo: string, at = now()) {
  const open = trackedOpen(repo);
  if (!open.some((p) => !p.checked_at || at - p.checked_at >= PULL_CHECK_MS)) return;
  const map = (attempts.translatePullChecks ??= new Map());
  if (at - (map.get(repo) ?? 0) < PULL_CHECK_MS) return;
  map.set(repo, at);
  const check = refreshPulls(repo).catch((error) => console.error(`Pull request check for ${repo} failed:`, error));
  await Promise.race([check, new Promise((resolve) => setTimeout(resolve, LAZY_TIMEOUT_MS).unref?.())]);
}
export const forgetPullChecks = () => attempts.translatePullChecks?.clear();
