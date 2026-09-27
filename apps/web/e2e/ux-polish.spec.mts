import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const screenshots = resolve("output/playwright", `acceptance-ux-${Date.now()}`);
test.beforeEach(async ({ context }) => {
  // Fresh browser contexts only. No request can reach retained app or Auth services.
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3174"
      ? route.continue()
      : route.abort(),
  );
});

test("contextual DST, keyboard choices, stale-choice clearing and exact endpoint preservation", async ({
  page,
}) => {
  await page.goto("/employee/corrections");
  await page.getByRole("button", { name: "Correctie aanvragen", exact: true }).click();
  const start = page.getByLabel("Voorgestelde start", { exact: true });
  const end = page.getByLabel("Voorgesteld einde", { exact: true });
  await expect(start).toHaveValue("04/09/2026 08:00");
  await expect(end).toHaveValue("04/09/2026 16:30");
  await expect(page.locator('[name="proposed_start_local_expected"]')).toHaveValue(
    "2026-09-04T06:00:12.123456Z",
  );
  await end.fill("04/09/2026 16:45");
  await expect(page.locator('[name="proposed_end_local_expected"]')).toHaveValue("");
  await expect(page.locator('[name="proposed_start_local_expected"]')).toHaveValue(
    "2026-09-04T06:00:12.123456Z",
  );
  await expect(page.locator("select")).toHaveCount(0);
  await start.fill("25/10/2026 02:30");
  const occurrence = page.getByLabel("Voorgestelde start: welk tijdstip?");
  await expect(occurrence).toHaveValue("");
  await expect(
    page.getByText(
      "Door de overgang naar wintertijd komt dit tijdstip twee keer voor.",
    ),
  ).toBeVisible();
  await occurrence.focus();
  await page.keyboard.press("ArrowDown");
  await page.keyboard.press("Enter");
  await expect(occurrence).toHaveValue("earlier");
  await start.fill("25/10/2026 02:31");
  await expect(occurrence).toHaveValue("");
  await start.fill("29/03/2026 02:30");
  await expect(page.locator("select")).toHaveCount(0);
  await expect(start).toHaveAttribute("aria-invalid", "true");
  await expect(page.getByText(/Dit tijdstip bestaat niet/)).toBeVisible();
  await page.getByRole("button", { name: "Formulier sluiten" }).click();
  await expect(
    page.getByRole("button", { name: "Correctie aanvragen", exact: true }),
  ).toBeFocused();
});

test("work status refreshes on navigation, focus and clock actions; old account responses cannot win", async ({
  page,
}) => {
  await page.goto("/employee");
  const status = page.getByLabel("Huidige werkstatus");
  await expect(status).toContainText("Aan het werk · gestart om 09:00");
  await page.getByRole("link", { name: "Registraties", exact: true }).click();
  await expect(status).toContainText("Aan het werk");
  await page.evaluate(() => {
    window.uxState = { status: "on_break", currentStartedAt: "2026-09-07T07:00:00Z" };
    window.dispatchEvent(new Event("focus"));
  });
  await expect(status).toContainText("Met pauze");
  await expect(status).not.toContainText("Aan het werk");
  await page.evaluate(() => {
    window.uxState = { status: "not_working", currentStartedAt: null };
    window.dispatchEvent(new Event("cloxa:clock-changed"));
  });
  await expect(status).toContainText("Niet aan het werk");
  await page.evaluate(() => {
    window.uxState = null;
    window.dispatchEvent(new Event("focus"));
  });
  await expect(status).toContainText("Werkstatus niet beschikbaar");
  await expect(status).not.toContainText("Niet aan het werk");
  await page.evaluate(() => {
    window.uxState = { status: "working", currentStartedAt: "2026-09-07T07:00:00Z" };
    window.uxDelay = 300;
    window.dispatchEvent(new Event("focus"));
  });
  // Revalidation keeps an unavailable state truthful; it no longer resets every read.
  await expect(status).toContainText("Werkstatus niet beschikbaar");
  await expect(status.getByRole("button", { name: "Controleren…" })).toBeDisabled();
  await page.getByText("Synthetische testbediening", { exact: true }).click();
  await page.evaluate(() => {
    window.uxState = null;
  });
  await page.getByRole("button", { name: "Wissel testaccount" }).click();
  await expect(status).toContainText("Werkstatus niet beschikbaar");
  await expect(status).not.toContainText("Aan het werk");
  await page.evaluate(() => window.dispatchEvent(new Event("cloxa:signing-out")));
  await expect(status).toContainText("Werkstatus wordt gecontroleerd");
});

test("semantic badge text, colors and measured contrast; linked applied decision", async ({
  page,
}) => {
  await page.goto("/employee/corrections");
  const rows = page.getByTestId("correction-requests");
  for (const tone of ["success", "attention", "error", "neutral"])
    await expect(rows.locator(`[data-tone="${tone}"]`)).toHaveCount(1);
  await expect(
    page.getByTestId("closed-entries").getByText("Gecorrigeerd", { exact: true }),
  ).toHaveCount(1);
  await page.getByTestId("closed-entries").getByText("Beslissing bekijken").click();
  await expect(
    page.getByText("Laatste toegepaste tijdaanvraag · Goedgekeurd"),
  ).toBeVisible();
  await page.getByRole("link", { name: "Link naar deze beslissing" }).click();
  await expect(page).toHaveURL(/#decision-synthetic-applied-decision$/);
  await expect(
    page.getByText(/Dit is geen volledig historisch overzicht/),
  ).toBeVisible();
  const ratios = await page.locator(".status-badge").evaluateAll((elements) =>
    elements.map((element) => {
      const color = getComputedStyle(element);
      const luminance = (rgb: string) => {
        const channels = rgb
          .match(/[\d.]+/g)!
          .slice(0, 3)
          .map(Number)
          .map((value) => {
            const s = value / 255;
            return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
          });
        return channels[0]! * 0.2126 + channels[1]! * 0.7152 + channels[2]! * 0.0722;
      };
      const a = luminance(color.color),
        b = luminance(color.backgroundColor);
      return {
        text: element.textContent,
        ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05),
      };
    }),
  );
  for (const result of ratios) {
    expect(result.text?.trim()).toBeTruthy();
    expect(result.ratio).toBeGreaterThanOrEqual(4.5);
  }
  console.log("Badge contrast", JSON.stringify(ratios));
});

for (const width of [1280, 320])
  test(`synthetic screenshots and unclipped keyboard navigation at ${width}px`, async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width, height: 900 });
    await mkdir(screenshots, { recursive: true });
    for (const route of [
      "/employee",
      "/employee/corrections",
      "/employee/break-corrections",
      "/manager/corrections",
    ]) {
      await page.goto(route);
      await expect(
        page.locator(".workspace-navigation a[aria-current='page']"),
      ).toHaveCount(1);
      if (!route.startsWith("/manager"))
        await expect(page.getByLabel("Huidige werkstatus")).toContainText(
          "Aan het werk",
        );
      if (route === "/employee/corrections") {
        await page.screenshot({
          path: resolve(screenshots, `registrations-${width}.png`),
          fullPage: true,
        });
        await page
          .getByRole("button", { name: "Correctie aanvragen", exact: true })
          .click();
      }
      if (route === "/manager/corrections")
        await page.locator("li details > summary").first().click();
      const overflow = await page.evaluate(
        () => document.documentElement.scrollWidth > innerWidth,
      );
      expect(overflow).toBe(false);
      for (const box of await page
        .locator("nav a, input:visible, select:visible, textarea:visible")
        .evaluateAll((elements) =>
          elements.map((element) => {
            const r = element.getBoundingClientRect();
            return { x: r.x, right: r.right };
          }),
        )) {
        expect(box.x).toBeGreaterThanOrEqual(0);
        expect(box.right).toBeLessThanOrEqual(width);
      }
      await page.locator("nav a").first().focus();
      await expect(page.locator("nav a").first()).toBeFocused();
      await page.keyboard.press("Tab");
      await expect(page.locator("nav a").nth(1)).toBeFocused();
      await page.screenshot({
        path: resolve(
          screenshots,
          `${route.slice(1).replaceAll("/", "-")}-${width}.png`,
        ),
        fullPage: true,
      });
    }
    expect(errors).toEqual([]);
    console.log("Synthetic screenshots:", screenshots);
  });
