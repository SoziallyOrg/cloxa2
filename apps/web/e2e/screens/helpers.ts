import { resolve } from "node:path";

import { expect, type Page } from "@playwright/test";

import { loginWithEmailCode, resetFactors, totp } from "../support";

/** Shared by the design-review screenshots (`pnpm screens`). */
export const OUT = resolve(process.cwd(), "output/screens");
export const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: { width: 1440, height: 900 },
} as const;
/** Between the phone-like and the docked-panel layouts (side panel becomes a sheet). */
export const MID_VIEWPORT = { width: 1100, height: 800 } as const;
/** The shared tablet (kiosk): landscape and portrait. */
export const TABLET_VIEWPORTS = {
  "tablet-liggend": { width: 1024, height: 768 },
  "tablet-staand": { width: 768, height: 1024 },
} as const;
export const SETTLED = { timeout: 20_000 };

export const button = (page: Page, name: string) =>
  page.getByRole("button", { name, exact: true });

/** The sidebar (desktop) or the tab bar (phone): whichever is showing. */
export const tab = (page: Page, name: string) =>
  page.getByRole("navigation").getByRole("link", { name, exact: true });

/**
 * Every viewport. The viewport grows to the page height
 * instead of a `fullPage` shot, which would leave the fixed tab bar halfway
 * down a long page. Open sheets and loading states are shot at the plain
 * viewport size.
 */
export async function capture(page: Page, name: string, whole = true): Promise<void> {
  await captureAt(page, name, VIEWPORTS, whole);
  await page.setViewportSize(VIEWPORTS.phone);
}

/** The same shot at any set of named viewports (the file suffix is the key). */
export async function captureAt(
  page: Page,
  name: string,
  viewports: Record<string, { width: number; height: number }>,
  whole = true,
  keepFocus = false,
): Promise<void> {
  // No hover state or focus ring left from the last click.
  await page.mouse.move(0, 0);
  if (!keepFocus) {
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  }
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const [viewport, size] of Object.entries(viewports)) {
    await page.setViewportSize(size);
    // Let the layout follow the new size: `min-h-dvh` pages would otherwise
    // report the previous (taller) viewport as their height.
    // (A timer, not requestAnimationFrame: frames stall behind an open dialog.)
    await page.waitForTimeout(150);
    if (whole) {
      const height = await page.evaluate(() => document.documentElement.scrollHeight);
      await page.setViewportSize({ ...size, height: Math.max(size.height, height) });
    }
    await page.waitForFunction(() =>
      Array.from(document.images).every(
        (image) => image.complete && image.naturalWidth > 0,
      ),
    );
    await page.evaluate(() =>
      Promise.all(Array.from(document.images).map((image) => image.decode())),
    );
    await page.screenshot({
      path: `${OUT}/${name}-${viewport}.png`,
      animations: "disabled",
    });
  }
}

/** Phone and desktop with the focus ring left on (for the keyboard focus review). */
export async function captureFocus(page: Page, name: string): Promise<void> {
  await captureAt(page, name, VIEWPORTS, false, true);
  await page.setViewportSize(VIEWPORTS.phone);
}

/** The same shot at 1100x800 (the side panel is a sheet there), `-midden`. */
export async function captureMid(
  page: Page,
  name: string,
  whole = true,
): Promise<void> {
  await captureAt(page, name, { midden: MID_VIEWPORT }, whole);
  await page.setViewportSize(VIEWPORTS.phone);
}

/** Phone only: scrolled down, so the large title has collapsed into the bar. */
export async function captureScrolled(page: Page, name: string): Promise<void> {
  await page.setViewportSize(VIEWPORTS.phone);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.evaluate(() => window.scrollTo(0, 260));
  // Let the nav bar's IntersectionObserver catch up.
  await page.evaluate(
    () =>
      new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
  await page.screenshot({ path: `${OUT}/${name}-phone.png`, animations: "disabled" });
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

/** Email code, then TOTP set-up; returns the secret for later checks. */
export async function enrol(
  page: Page,
  email: string,
  shots: boolean,
): Promise<string> {
  await resetFactors(email);
  await loginWithEmailCode(page, email);
  await expect(page).toHaveURL(/\/manage\/beveiliging\/instellen$/, SETTLED);
  if (shots) await capture(page, "beheer-mfa-instellen");
  await button(page, "Start met instellen").click();
  await expect(page.getByRole("img", { name: /QR-code/ })).toBeVisible(SETTLED);
  if (shots) await capture(page, "beheer-mfa-qr");
  const secret = (await page.getByTestId("totp-secret").innerText()).replace(/\s/g, "");
  await page.getByLabel("Code uit je app").fill(totp(secret));
  await button(page, "Bevestig en ga verder").click();
  await expect(page).toHaveURL(/\/manage$/, SETTLED);
  return secret;
}
