import { test, expect, type Page } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";

const screenshots = resolve("output/playwright", `responsive-ux-${Date.now()}`);
test.beforeEach(async ({ context }) => {
  await context.route("**/*", (route) =>
    new URL(route.request().url()).origin === "http://127.0.0.1:3174"
      ? route.continue()
      : route.abort(),
  );
});
async function geometry(page: Page) {
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth),
  ).toBe(true);
  await expect(page.locator(".workspace-navigation")).toHaveCount(1);
  await expect(page.locator(".workspace-navigation [aria-current=page]")).toHaveCount(
    1,
  );
  await expect(page.getByText("Publieke kop", { exact: false })).toHaveCount(0);
  const boxes = await page
    .locator(
      ".workspace-navigation a, .workspace-secondary a, .workspace-account summary, input:visible:not([type=checkbox]), select:visible, textarea:visible, button:visible",
    )
    .evaluateAll((elements) =>
      elements.map((element) => {
        const rect = element.getBoundingClientRect();
        const style = getComputedStyle(element);
        return {
          label: element.textContent?.slice(0, 60),
          x: rect.x,
          right: rect.right,
          height: rect.height,
          width: rect.width,
          font: parseFloat(style.fontSize),
        };
      }),
    );
  for (const box of boxes) {
    expect(box.x, JSON.stringify(box)).toBeGreaterThanOrEqual(0);
    expect(box.right, JSON.stringify(box)).toBeLessThanOrEqual(
      page.viewportSize()!.width,
    );
    expect(box.height, JSON.stringify(box)).toBeGreaterThanOrEqual(44);
    expect(box.width, JSON.stringify(box)).toBeGreaterThanOrEqual(44);
  }
}
for (const width of [
  320, 360, 375, 390, 412, 430, 512, 600, 639, 640, 641, 768, 834, 880, 927, 928, 929,
  1023, 1024, 1025, 1137, 1280, 1440,
]) {
  test(`fluid geometry ${width} CSS px, employee and expanded long manager request`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/employee/registrations");
    await expect(page.getByLabel("Huidige werkstatus")).toContainText("Aan het werk");
    await page
      .getByRole("button", { name: "Correctie aanvragen", exact: true })
      .click();
    await geometry(page);
    expect(
      await page
        .locator(".workspace-navigation")
        .evaluate((el) => getComputedStyle(el).position),
    ).toBe(width < 928 ? "fixed" : "sticky");
    const inputRadii = await page
      .locator("input:visible, textarea:visible")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).borderRadius));
    expect(inputRadii.length).toBeGreaterThan(0);
    for (const radius of inputRadii) expect(radius).toBe("12px");
    await page.goto("/manager/corrections?stress=1");
    await page.getByTestId("review-pending").locator("summary").first().click();
    await geometry(page);
    const surfaces = await page
      .locator(".workspace-surface, [data-testid=review-pending] .rounded-surface")
      .evaluateAll((els) => els.map((el) => getComputedStyle(el).borderRadius));
    expect(surfaces).toEqual(["16px", "16px", "16px"]);
    await expect(page.getByLabel("Huidige werkstatus")).toHaveCount(0);
    await expect(
      page.locator('.workspace-navigation a[href^="/employee"]'),
    ).toHaveCount(0);
  });
}

for (const width of [390, 768, 1280]) {
  test(`navigation, persistent status, account, forms and modal keyboard interaction at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 820 });
    await page.goto("/employee");
    const primary = page.getByRole("navigation", { name: "Medewerkernavigatie" });
    await expect(primary.getByRole("link")).toHaveText([
      "Tijdklok",
      "Registraties",
      "Aanvragen",
    ]);
    await primary.getByRole("link", { name: "Registraties", exact: true }).click();
    await expect(page.getByTestId("closed-entries")).toBeVisible();
    await expect(page.getByTestId("correction-requests")).not.toBeVisible();
    await primary.getByRole("link", { name: "Aanvragen", exact: true }).click();
    await expect(page.getByTestId("correction-requests")).toBeVisible();
    await expect(page.getByTestId("closed-entries")).not.toBeVisible();
    await expect(
      page
        .getByRole("navigation", { name: "Soort aanvraag" })
        .getByRole("link", { name: "Werktijd" }),
    ).toHaveAttribute("aria-current", "page");
    await page.getByRole("link", { name: "Pauzes", exact: true }).click();
    await expect(primary.getByRole("link", { name: "Aanvragen" })).toHaveAttribute(
      "aria-current",
      "page",
    );
    await expect(
      page.getByRole("link", { name: "Pauzes", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await page.evaluate(() => scrollTo(0, document.body.scrollHeight));
    const status = page.getByLabel("Huidige werkstatus");
    await expect(status).toContainText("Aan het werk");
    const box = await status.boundingBox();
    expect(box!.y).toBeGreaterThanOrEqual(0);
    expect(box!.y + box!.height).toBeLessThan(180);
    await page.locator(".workspace-account summary").click();
    await expect(page.getByRole("button", { name: "Afmelden" })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator(".workspace-account summary")).toBeFocused();
    await expect(page.getByRole("button", { name: "Afmelden" })).not.toBeVisible();
    await page.locator(".workspace-account summary").click();
    await page.getByRole("button", { name: "Afmelden" }).click();
    await expect(status).toContainText("Werkstatus wordt gecontroleerd");
    await expect(page.getByRole("alert")).toContainText("Synthetische afmelding");
    await page.goto("/manager/corrections?stress=1");
    const manager = page.getByRole("navigation", { name: "Managernavigatie" });
    await expect(manager.getByRole("link")).toHaveText([
      "Overzicht",
      "Aanvragen",
      "Team",
      "Meer",
    ]);
    await page.getByTestId("review-pending").locator("summary").first().click();
    const reject = page.getByRole("button", { name: "Afwijzen", exact: true });
    await reject.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    expect(await dialog.evaluate((el) => getComputedStyle(el).borderRadius)).toBe(
      "16px",
    );
    await page
      .getByLabel("Reden van afwijzing", { exact: true })
      .fill("Synthetische lange toelichting ".repeat(12));
    await page.getByRole("button", { name: "Afwijzing bevestigen" }).click();
    await expect(dialog.getByRole("alert")).toContainText(
      "Synthetische validatiemelding",
    );
    await expect(dialog.getByRole("alert")).toBeFocused();
    // Focus remains in the native modal, including after a long synthetic error.
    await page.keyboard.press("Tab");
    expect(
      await page.evaluate(() => Boolean(document.activeElement?.closest("dialog"))),
    ).toBe(true);
    await geometry(page);
    await page.keyboard.press("Escape");
    await expect(dialog).not.toBeVisible();
    await expect(reject).toBeFocused();
    await manager.getByRole("link", { name: "Meer", exact: true }).click();
    await page.getByText("Eerdere exportversie", { exact: true }).click();
    await expect(page.getByRole("link", { name: "Export v1 openen" })).toHaveAttribute(
      "href",
      "/manager/exports",
    );
    await page.getByRole("link", { name: /Export met pauzes Download/ }).click();
    await expect(
      manager.getByRole("link", { name: "Meer", exact: true }),
    ).toHaveAttribute("aria-current", "page");
    await geometry(page);
    await manager.getByRole("link", { name: "Team", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Medewerkers", exact: true }),
    ).toBeVisible();
    await geometry(page);
  });
}

test("short landscape, doubled text and zoom-equivalent reflow; measured bottom safe-area and keyboard fallback", async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.goto("/employee/registrations");
  await page.getByRole("button", { name: "Correctie aanvragen", exact: true }).click();
  await page.addStyleTag({ content: ".workspace-navigation {padding-bottom:34px;}" });
  await page.getByRole("button", { name: "Formulier sluiten" }).focus();
  await geometry(page);
  const last = page.getByRole("button", { name: "Formulier sluiten" });
  await last.evaluate((el) => el.scrollIntoView({ block: "center" }));
  const rect = await last.boundingBox();
  const nav = await page.locator(".workspace-navigation").boundingBox();
  expect(rect!.y + rect!.height).toBeLessThanOrEqual(nav!.y);
  await page.setViewportSize({ width: 640, height: 720 });
  await page.addStyleTag({ content: "html {font-size:200%;}" });
  await geometry(page);
  await page.getByLabel("Voorgestelde start", { exact: true }).fill("29/03/2026 02:30");
  await expect(page.getByText(/Dit tijdstip bestaat niet/)).toBeVisible();
  await geometry(page);
  await page.reload();
  await page.getByRole("button", { name: "Correctie aanvragen", exact: true }).click();
  // Synthetic visualViewport occlusion only: not a real OS keyboard claim.
  await page.evaluate(() => {
    const viewport = new EventTarget();
    Object.assign(viewport, { height: 350, scale: 1 });
    Object.defineProperty(window, "visualViewport", {
      configurable: true,
      value: viewport,
    });
  });
  await page.getByLabel("Voorgesteld einde", { exact: true }).focus();
  await expect(page.locator(".workspace-shell")).toHaveAttribute(
    "data-keyboard",
    "true",
  );
  expect(
    await page
      .locator(".workspace-navigation")
      .evaluate((el) => getComputedStyle(el).position),
  ).toBe("static");
  await expect(page.getByRole("button", { name: "Formulier sluiten" })).toBeAttached();
  await geometry(page);
});

test("short landscape modal keeps long validation and final actions reachable", async ({
  page,
}) => {
  await page.setViewportSize({ width: 740, height: 360 });
  await page.goto("/manager/corrections?stress=1");
  await page.getByTestId("review-pending").locator("summary").first().click();
  await page.getByRole("button", { name: "Afwijzen", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.getByRole("button", { name: "Afwijzing bevestigen" }).click();
  await expect(dialog.getByRole("alert")).toBeFocused();
  const cancel = dialog.getByRole("button", { name: "Annuleren" });
  await cancel.focus();
  await cancel.evaluate((el) => el.scrollIntoView({ block: "nearest" }));
  const frame = await dialog.boundingBox(),
    button = await cancel.boundingBox();
  expect(frame!.y).toBeGreaterThanOrEqual(0);
  expect(frame!.y + frame!.height).toBeLessThanOrEqual(360);
  expect(button!.y).toBeGreaterThanOrEqual(frame!.y);
  expect(button!.y + button!.height).toBeLessThanOrEqual(frame!.y + frame!.height);
  await geometry(page);
  await page.keyboard.press("Escape");
  await expect(
    page.getByRole("button", { name: "Afwijzen", exact: true }),
  ).toBeFocused();
});

test("phone/tablet/desktop and 320px edge compositions", async ({ page }) => {
  await mkdir(screenshots, { recursive: true });
  for (const [width, label] of [
    [390, "phone"],
    [834, "tablet"],
    [1280, "desktop"],
    [320, "edge"],
  ] as const) {
    await page.setViewportSize({ width, height: 900 });
    for (const route of [
      "/employee",
      "/employee/registrations",
      "/employee/requests",
      "/manager/corrections",
      "/manager/more",
    ]) {
      await page.goto(route);
      if (route.startsWith("/employee"))
        await expect(page.getByLabel("Huidige werkstatus")).toContainText(
          "Aan het werk",
        );
      if (route === "/manager/corrections")
        await page.getByTestId("review-pending").locator("summary").first().click();
      await page.screenshot({
        path: resolve(
          screenshots,
          `${label}-${width}-${route.slice(1).replaceAll("/", "-")}.png`,
        ),
        fullPage: false,
      });
    }
  }
  console.log("Responsive screenshots:", screenshots);
});
