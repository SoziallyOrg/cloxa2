import { test, expect } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
const screenshots = resolve("output/playwright", `workspace-ux-${Date.now()}`);
for (const owner of ["header", "panel"] as const) {
  test(`single clock feedback and focus from ${owner}, silent navigation`, async ({
    page,
  }) => {
    await page.goto("/employee");
    const controls = page.locator(`.clock-controls-${owner}`);
    await expect(
      controls.getByRole("button", { name: "Start pauze", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => {
      window.uxActionDelay = 500;
    });
    await controls.getByRole("button", { name: "Start pauze", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Start pauze — bezig…", exact: true }),
    ).toHaveCount(1);
    for (const button of await page.locator(".clock-controls button").all())
      await expect(button).toBeDisabled();
    await expect(page.locator(".clock-feedback")).toHaveCount(1);
    await expect(controls.locator(".clock-feedback")).toBeFocused();
    await expect(page.locator(".clock-feedback[role=status]")).toHaveCount(1);
    expect(await page.evaluate(() => window.uxActions.length)).toBe(1);
    await page
      .getByRole("navigation", { name: "Medewerkernavigatie" })
      .getByRole("link", { name: "Registraties", exact: true })
      .click();
    await expect(page.locator(".clock-controls-header .clock-feedback")).toHaveCount(1);
    await expect(page.locator(".clock-feedback[role]")).toHaveCount(0);
    await page
      .getByRole("navigation", { name: "Medewerkernavigatie" })
      .getByRole("link", { name: "Tijdklok", exact: true })
      .click();
    await expect(page.locator(".clock-feedback")).toHaveCount(1);
    await expect(page.locator(".clock-feedback[role]")).toHaveCount(0);
    await page.evaluate(() => {
      window.uxActionRefused = true;
    });
    await controls
      .getByRole("button", { name: "Pauze beëindigen", exact: true })
      .click();
    await expect(page.locator(".clock-feedback[role=alert]")).toHaveCount(1);
    await expect(controls.locator(".clock-feedback")).toBeFocused();
    await expect(page.locator(".clock-feedback")).toHaveCount(1);
  });
}
test("other employee pages present fresh feedback only in header", async ({ page }) => {
  await page.goto("/employee/requests");
  await page
    .getByLabel("Snelle klokbediening")
    .getByRole("button", { name: "Start pauze", exact: true })
    .click();
  await expect(page.locator(".clock-feedback")).toHaveCount(1);
  await expect(
    page.locator(".clock-controls-header .clock-feedback[role=status]"),
  ).toBeFocused();
});
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3174"
      ? route.continue()
      : route.abort(),
  );
});
for (const width of [1280, 1366, 1440, 1536, 1600, 1800, 1920, 2160, 2560]) {
  test(`one shared header/content grid at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of ["/employee/requests", "/manager/corrections"]) {
      await page.goto(route);
      if (route.startsWith("/employee"))
        await expect(page.getByLabel("Huidige werkstatus")).toContainText(
          "Aan het werk",
        );
      const r = await page.evaluate(() => {
        const rect = (selector: string) => {
          const b = document.querySelector(selector)!.getBoundingClientRect();
          return {
            x: b.x,
            right: b.right,
            y: b.y,
            bottom: b.bottom,
            width: b.width,
            height: b.height,
          };
        };
        return {
          title: rect(".workspace-heading h1"),
          content: rect(".workspace-surface"),
          secondary: rect(".workspace-secondary"),
          account: rect(".workspace-account"),
          rail: rect(".workspace-navigation"),
          header: rect(".workspace-header"),
          overflow: document.documentElement.scrollWidth > innerWidth,
        };
      });
      expect(Math.abs(r.title.x - r.content.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.secondary.x - r.content.x)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.account.right - r.content.right)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.rail.y - r.header.bottom)).toBeLessThanOrEqual(1);
      expect(Math.abs(r.rail.bottom - 1000)).toBeLessThanOrEqual(1);
      expect(r.content.width).toBeLessThanOrEqual(1152);
      expect(r.overflow).toBe(false);
      const nav = page.locator(".workspace-navigation");
      expect(
        await nav
          .locator("[aria-current=page]")
          .evaluate((el) => getComputedStyle(el).backgroundColor),
      ).toBe("rgb(217, 232, 237)");
      await expect(nav.locator("a")).toHaveCount(route.startsWith("/employee") ? 3 : 4);
    }
  });
}
test("provider survives page-shell remounts without status/loading or geometry flicker (synthetic router)", async ({
  page,
}) => {
  await page.goto("/employee");
  await expect(page.getByLabel("Huidige werkstatus")).toContainText("Aan het werk");
  await page.evaluate(() => {
    window.uxDelay = 1000;
  });
  const before = await page.locator(".workspace-header").boundingBox();
  const reads = await page.evaluate(() => window.uxReads);
  await page
    .getByRole("navigation", { name: "Medewerkernavigatie" })
    .getByRole("link", { name: "Aanvragen", exact: true })
    .click();
  await expect(page.getByLabel("Huidige werkstatus")).toContainText("Aan het werk");
  await expect(page.getByLabel("Huidige werkstatus")).not.toContainText(
    "gecontroleerd",
  );
  expect(await page.evaluate(() => window.uxReads)).toBe(reads);
  const after = await page.locator(".workspace-header").boundingBox();
  expect(after!.height).toBe(before!.height);
  await page.evaluate(() => window.dispatchEvent(new Event("focus")));
  await expect(page.getByLabel("Huidige werkstatus")).toContainText("Aan het werk");
  await page
    .getByRole("navigation", { name: "Medewerkernavigatie" })
    .getByRole("link", { name: "Registraties", exact: true })
    .click();
  await expect(page.getByLabel("Huidige werkstatus")).toContainText("Aan het werk");
});
for (const width of [320, 390, 834, 1440])
  test(`header/panel coordination and break interlock at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/employee");
    const header = page.getByLabel("Snelle klokbediening"),
      panel = page.getByLabel("Tijdklokbediening", { exact: true });
    await expect(
      header.getByRole("button", { name: "Start pauze", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => {
      window.uxActionDelay = 500;
    });
    await header.getByRole("button", { name: "Start pauze", exact: true }).click();
    for (const button of await panel.getByRole("button").all())
      await expect(button).toBeDisabled();
    await expect(page.getByLabel("Huidige werkstatus")).toContainText("Met pauze");
    await expect(
      header.getByRole("button", { name: "Stop werk", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Stop werk", exact: true }),
    ).toHaveCount(0);
    await expect(panel).toContainText("pauze");
    await panel.getByRole("button", { name: "Pauze beëindigen", exact: true }).click();
    await expect(
      header.getByRole("button", { name: "Start pauze", exact: true }),
    ).toBeEnabled();
    await header.getByRole("button", { name: "Stop werk", exact: true }).click();
    await expect(
      header.getByRole("button", { name: "Start werk", exact: true }),
    ).toBeEnabled();
    await panel.getByRole("button", { name: "Start werk", exact: true }).click();
    await expect(
      header.getByRole("button", { name: "Stop werk", exact: true }),
    ).toBeEnabled();
    const actions = await page.evaluate(() => window.uxActions);
    expect(actions.map((a) => a.intent)).toEqual([
      "start_break",
      "end_break",
      "clock_out",
      "clock_in",
    ]);
    expect(new Set(actions.map((a) => a.id)).size).toBe(4);
    for (const action of actions)
      expect(action.keys.sort()).toEqual(["operation", "request_id"]);
    await page.evaluate(() => {
      window.uxState = null;
      window.dispatchEvent(new Event("focus"));
    });
    await expect(page.getByLabel("Huidige werkstatus")).toContainText(
      "niet beschikbaar",
    );
    await expect(
      header.getByRole("button", { name: "Stop werk", exact: true }),
    ).toHaveCount(0);
    await expect(
      panel.getByRole("button", { name: "Start pauze", exact: true }),
    ).toHaveCount(0);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
    ).toBe(true);
    const targets = await header
      .getByRole("button")
      .evaluateAll((els) => els.map((el) => el.getBoundingClientRect().height));
    for (const height of targets) expect(height).toBeGreaterThanOrEqual(44);
  });
test("compact multi-break records, exact details and nested decision permalink", async ({
  page,
}) => {
  await page.goto("/employee/registrations");
  const record = page.getByTestId("closed-entries");
  await expect(record).toContainText("04/09/2026 08:00–16:30");
  await expect(record.locator(".record-breaks")).toHaveText(
    "Pauzes: 12:00–12:30; 13:57–13:58",
  );
  await expect(record.locator(".record-totals dt")).toHaveText([
    "Bruto",
    "Pauze",
    "Netto",
  ]);
  await expect(record.getByText("Exact tijdstip", { exact: true })).toHaveCount(2); // Only decision support, not each record endpoint.
  await expect(record.locator(".record-details")).toHaveCount(1);
  await record.getByText("Details van registratie", { exact: true }).click();
  await expect(record.locator(".record-exact")).toContainText("12.123456");
  await expect(record.locator(".record-details")).toContainText(
    "Totalen zijn berekend met exacte tijdstippen",
  );
  // Place the actual decision in a collapsed ancestor to test permalink recovery.
  await page.evaluate(() => {
    const decision = document.querySelector(
      '[id="decision-synthetic-applied-decision"]',
    )!;
    const outer = document.createElement("details");
    outer.id = "synthetic-ancestor";
    outer.innerHTML = "<summary>Onderliggende gegevens</summary>";
    decision.parentElement!.insertBefore(outer, decision);
    outer.appendChild(decision);
    location.hash = "decision-synthetic-applied-decision";
  });
  await expect(page.locator("#synthetic-ancestor")).toHaveAttribute("open", "");
  await expect(
    page.getByText("Laatste toegepaste tijdaanvraag · Goedgekeurd"),
  ).toBeVisible();
});
test("updated wide desktop and mobile screenshot compositions", async ({ page }) => {
  await mkdir(screenshots, { recursive: true });
  for (const width of [390, 834, 1280, 1920, 2560]) {
    await page.setViewportSize({ width, height: 1000 });
    for (const route of [
      "/employee",
      "/employee/registrations",
      "/manager/corrections",
    ]) {
      await page.goto(route);
      if (route.startsWith("/employee"))
        await expect(page.getByLabel("Huidige werkstatus")).toContainText(
          "Aan het werk",
        );
      await page.screenshot({
        path: resolve(
          screenshots,
          `${width}-${route.slice(1).replaceAll("/", "-")}.png`,
        ),
      });
    }
  }
  console.log("Workspace screenshots:", screenshots);
});
