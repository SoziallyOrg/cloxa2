import { resolve } from "node:path";

import { expect, test, type Page } from "@playwright/test";

/**
 * Design-review screenshots of every primitive (`/preview`), at phone and
 * desktop size, (`pnpm screens`). Phones are shot section by
 * section, with the nav bar collapsed and the tab bar in place; desktop is
 * one tall shot. Then each overlay (sheets, action sheet, alert) and a
 * pushed page. Needs no account and no data.
 */
const OUT = resolve(process.cwd(), "output/screens");
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
const SECTIONS = [
  "lijsten",
  "bediening",
  "knoppen",
  "bladen",
  "laden",
  "leeg",
  "navigatie",
  "status",
  "formulieren",
] as const;
const OVERLAYS = [
  ["blad-half", "Open blad (half)"],
  ["blad-groot", "Open blad (groot)"],
  ["actieblad", "Open actieblad"],
  ["waarschuwing", "Open waarschuwing"],
] as const;

async function shot(page: Page, name: string): Promise<void> {
  // No hover or focus ring left from the last action.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.screenshot({ path: `${OUT}/${name}.png`, animations: "disabled" });
}

test("every primitive, in both form factors", async ({ page }) => {
  test.setTimeout(300_000);

  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    {
      const suffix = viewport;
      await page.setViewportSize(size);
      await page.emulateMedia({ reducedMotion: "reduce" });
      await page.goto("/preview");
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Voorbeeldweergave",
      );

      if (viewport === "phone") {
        await shot(page, `preview-00-top-${suffix}`);
        for (const [index, id] of SECTIONS.entries()) {
          await page
            .locator(`#${id}`)
            .evaluate((element) => element.scrollIntoView({ block: "start" }));
          // Let the nav bar's IntersectionObserver catch up.
          await page.evaluate(
            () =>
              new Promise((done) =>
                requestAnimationFrame(() => requestAnimationFrame(done)),
              ),
          );
          await shot(
            page,
            `preview-${String(index + 1).padStart(2, "0")}-${id}-${suffix}`,
          );
        }
        await page.evaluate(() => window.scrollTo(0, 0));
      } else {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ ...size, height });
        await shot(page, `preview-all-${suffix}`);
        await page.setViewportSize(size);
      }

      for (const [name, opener] of OVERLAYS) {
        await page.getByRole("button", { name: opener, exact: true }).click();
        await expect(page.locator("dialog[open]")).toHaveCount(1);
        await shot(page, `preview-${name}-${suffix}`);
        await page.keyboard.press("Escape");
        await expect(page.locator("dialog[open]")).toHaveCount(0);
      }

      await page.getByRole("link", { name: /^Doorklikken/ }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText("Detail");
      await shot(page, `preview-push-${suffix}`);
      await page.getByRole("link", { name: "Voorbeeldweergave" }).click();
      await expect(page.getByRole("heading", { level: 1 })).toHaveText(
        "Voorbeeldweergave",
      );
    }
  }
});
