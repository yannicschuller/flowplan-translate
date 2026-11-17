// Screenshots of the main pages for a visual check (not part of the smoke
// test): SCREENSHOTS_DIR=/some/dir npm run test:browser. Desktop and phone,
// light and dark, German and English; fails on horizontal overflow.
import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { dataDir } from "../../playwright.config";

const dir = process.env.SCREENSHOTS_DIR;
test.skip(!dir, "SCREENSHOTS_DIR not set");

const VIEWPORTS = [
  { name: "desktop", width: 1440, height: 1000 },
  { name: "phone", width: 390, height: 844 },
];

test("main pages at desktop and phone width, light and dark, de and en", async ({ browser, baseURL }) => {
  test.setTimeout(300_000);
  const seed = JSON.parse(readFileSync(join(dataDir, "browser-test.json"), "utf8")) as { reviewer: string; entry: number };
  const pages = [
    { name: "overview", path: "/", signedIn: true },
    { name: "list", path: "/c/flowplan-web/fr?filter=all", signedIn: true },
    { name: "editor", path: `/c/flowplan-web/fr/${seed.entry}`, signedIn: true },
    { name: "store-editor", path: "/c/flowplan-app-store/zh?filter=all", signedIn: true, first: "app-store/description" },
    { name: "list-de", path: "/c/flowplan-web/de", signedIn: true },
    { name: "original-entry", path: "/c/flowplan-web/de?q=checked", signedIn: true, first: "checked" },
    { name: "glossary", path: "/glossary?lang=fr", signedIn: true },
    { name: "signin", path: "/login", signedIn: false },
  ];
  const overflow: string[] = [];
  for (const viewport of VIEWPORTS)
    for (const colorScheme of ["light", "dark"] as const)
      for (const locale of ["de-DE", "en-GB"]) {
        const context = await browser.newContext({ viewport, colorScheme, locale });
        const page = await context.newPage();
        for (const p of pages) {
          await context.clearCookies();
          if (p.signedIn) await context.addCookies([{ name: "ft_session", value: seed.reviewer, url: baseURL!, httpOnly: true, sameSite: "Lax" }]);
          await page.goto(p.path);
          if (p.first) await page.locator(".entry").filter({ hasText: p.first }).first().click({ timeout: 10_000 });
          await page.waitForLoadState("networkidle");
          const wide = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
          if (wide > 0) overflow.push(`${p.name} ${viewport.name} ${colorScheme} ${locale}: ${wide}px`);
          await page.screenshot({ path: join(dir!, `${p.name}-${viewport.name}-${colorScheme}-${locale.slice(0, 2)}.png`), fullPage: true });
        }
        await context.close();
      }
  expect(overflow).toEqual([]);
});
