// Smoke test in a real browser: a translator suggests a French text, the
// blocking placeholder check fires, the fixed text is saved, then the
// reviewer accepts it. No GitHub: sessions come straight from the database.
import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../playwright.config";

const seed = () => JSON.parse(readFileSync(join(dataDir, "browser-test.json"), "utf8")) as { translator: string; reviewer: string; entry: number };

async function signedIn(context: BrowserContext, token: string, baseURL: string) {
  await context.addCookies([{ name: "ft_session", value: token, url: baseURL, httpOnly: true, sameSite: "Lax" }]);
}
// Any violation of the Content Security Policy shows up as a console error.
function watchCsp(page: Page) {
  const violations: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error" && /Content Security Policy|Refused to/i.test(m.text())) violations.push(m.text());
  });
  return violations;
}

test("translate, see the placeholder check block, fix it, accept as reviewer", async ({ browser, baseURL }) => {
  const { translator, reviewer, entry } = seed();
  const url = `/c/flowplan-web/fr/${entry}`;

  const t = await browser.newContext({ locale: "en-GB" });
  await signedIn(t, translator, baseURL!);
  const page = await t.newPage();
  const csp = watchCsp(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Translate Flowplan" })).toBeVisible();
  await page.goto(url);
  const source = (await page.locator(".source-text").innerText()).trim();
  expect(source).toContain("{0}");
  const field = page.getByRole("textbox", { name: "Your suggestion" });
  await field.fill(source.replace("{0}", "").replace(/\s+/g, " ").trim() || "x");
  await expect(page.locator(".issues .error")).toContainText("Placeholders missing: {0}");
  await field.press("Control+Enter");
  await expect(page.locator(".notice.err")).toContainText("Not saved");
  await expect(page).toHaveURL(new RegExp(`${url}$`));

  const fixed = `${source} (fr)`;
  await field.fill(fixed);
  await expect(page.locator(".issues .error")).toHaveCount(0);
  await field.press("Control+Enter");
  await expect(page).not.toHaveURL(new RegExp(`${url}$`));
  await expect(page.locator(".notice.ok")).toContainText("Suggestion saved");
  expect(csp).toEqual([]);
  await t.close();

  const r = await browser.newContext({ locale: "en-GB" });
  await signedIn(r, reviewer, baseURL!);
  const review = await r.newPage();
  await review.goto(url);
  const suggestion = review.locator(".suggestion").filter({ hasText: "by helper" });
  await expect(suggestion.locator(".text")).toHaveText(fixed);
  await suggestion.getByRole("button", { name: "Accept" }).click();
  await expect(review.locator(".notice.ok")).toContainText("Suggestion accepted");
  await expect(review.locator(".badge.done").first()).toBeVisible();
  await expect(review.getByText(fixed, { exact: true }).first()).toBeVisible();
  // The overview now offers a pull request for the accepted text.
  await review.goto("/");
  await expect(review.getByRole("button", { name: /Create pull request \(1\)/ })).toBeEnabled();
  // The originals: German is browsable and read-only, a text without German says so.
  await review.goto("/c/flowplan-web/de?q=checked");
  await expect(review.getByRole("heading", { level: 1 })).toContainText("Deutsch");
  await review.locator(".entry").filter({ hasText: "checked||health" }).click();
  await expect(review).toHaveURL(/\/c\/flowplan-web\/de\/\d+/);
  await expect(review.getByText("this text has no German version", { exact: false })).toBeVisible();
  await expect(review.getByRole("textbox")).toHaveCount(0);
  await r.close();
});
