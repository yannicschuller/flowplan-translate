// GitHub's push webhook: a push to the branch of a configured repository
// starts a sync in the background; the answer comes at once. The request
// must carry a valid X-Hub-Signature-256 (HMAC-SHA256 of the body with
// TRANSLATE_WEBHOOK_SECRET), compared in constant time.
import { createHmac, timingSafeEqual } from "node:crypto";
import { config } from "./config";
import { HttpError, json, readBody } from "./http";
import { componentsOf } from "./components";
import { queueSync } from "./sync";

// GitHub's payloads are at most 25 MB; push events are far smaller.
const MAX_BODY = 5 * 1024 * 1024;

export function verifySignature(secret: string, body: Buffer, header: string | null) {
  if (!secret || !header || !header.startsWith("sha256=")) return false;
  const expected = Buffer.from(`sha256=${createHmac("sha256", secret).update(body).digest("hex")}`);
  const sent = Buffer.from(header);
  return sent.length === expected.length && timingSafeEqual(sent, expected);
}

export async function webhookRoute(request: Request, start: (repo: string) => unknown = queueSync) {
  const secret = config.webhookSecret();
  if (!secret) throw new HttpError(503, "webhook_off", "The webhook is not configured (TRANSLATE_WEBHOOK_SECRET).");
  const body = await readBody(request, MAX_BODY);
  if (!verifySignature(secret, body, request.headers.get("x-hub-signature-256"))) throw new HttpError(401, "bad_signature", "Invalid signature.");
  const event = request.headers.get("x-github-event") || "";
  if (event === "ping") return json({ ok: true, pong: true });
  if (event !== "push") return json({ ok: true, ignored: "event" }, { status: 202 });
  let payload: { ref?: string; repository?: { full_name?: string } };
  try {
    payload = JSON.parse(body.toString("utf8"));
  } catch {
    throw new HttpError(400, "invalid_json", "Invalid JSON body.");
  }
  const repo = payload.repository?.full_name || "";
  const list = componentsOf(repo);
  if (!list.length) return json({ ok: true, ignored: "repository" }, { status: 202 });
  if (payload.ref !== `refs/heads/${list[0].branch}`) return json({ ok: true, ignored: "ref" }, { status: 202 });
  // In the background: GitHub waits at most ten seconds for an answer.
  void Promise.resolve()
    .then(() => start(repo))
    .catch((error) => console.error(`Sync of ${repo} failed:`, error));
  return json({ ok: true, sync: repo }, { status: 202 });
}
