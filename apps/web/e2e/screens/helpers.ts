import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

/** Shared by the design-review screenshots (`pnpm screens`). */
export const OUT = resolve(process.cwd(), "output/screens");
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
export const SCHEMES = ["light", "dark"] as const;
export const SETTLED = { timeout: 20_000 };

export const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** The sidebar (desktop) or the tab bar (phone): whichever is showing. */
export const tab = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });

/**
 * Every viewport × colour scheme. The viewport grows to the page height
 * instead of a `fullPage` shot, which would leave the fixed tab bar halfway
 * down a long page. Open sheets and loading states are shot at the plain
 * viewport size.
 */
export async function capture(page: Page, name: string, whole = true): Promise<void> {
  // No hover state or focus ring left from the last click.
  await page.mouse.move(0, 0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  for (const [viewport, size] of Object.entries(VIEWPORTS)) {
    for (const colorScheme of SCHEMES) {
      await page.setViewportSize(size);
      await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
      if (whole) {
        const height = await page.evaluate(() => document.documentElement.scrollHeight);
        await page.setViewportSize({ ...size, height: Math.max(size.height, height) });
      }
      await page.screenshot({
        path: `${OUT}/${name}-${viewport}-${colorScheme}.png`,
        animations: "disabled",
      });
    }
  }
  await page.setViewportSize(VIEWPORTS.phone);
}

/** Phone only: scrolled down, so the large title has collapsed into the bar. */
export async function captureScrolled(page: Page, name: string): Promise<void> {
  await page.setViewportSize(VIEWPORTS.phone);
  for (const colorScheme of SCHEMES) {
    await page.emulateMedia({ colorScheme, reducedMotion: "reduce" });
    await page.evaluate(() => window.scrollTo(0, 260));
    // Let the nav bar's IntersectionObserver catch up.
    await page.evaluate(
      () =>
        new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
    );
    await page.screenshot({
      path: `${OUT}/${name}-phone-${colorScheme}.png`,
      animations: "disabled",
    });
  }
  await page.evaluate(() => window.scrollTo(0, 0));
}

/** Closes an open sheet, and drops the focus ring it hands back. */
export async function closeSheet(page: Page): Promise<void> {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
}

/**
 * The dev-only `preview_state` cookie (CLOXA_PREVIEW builds only): `laden`
 * holds a page's data so its `loading.tsx` shows, `fout` makes it fail.
 */
export async function previewState(
  page: Page,
  state: "laden" | "fout" | null,
): Promise<void> {
  const url = new URL(page.url()).origin;
  if (state === null) {
    await page.context().clearCookies({ name: "preview_state" });
    return;
  }
  await page.context().addCookies([{ name: "preview_state", value: state, url }]);
}
