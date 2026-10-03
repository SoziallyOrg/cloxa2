import { expect, test, type Page } from "@playwright/test";

import { collectConsoleErrors, pilotRequestsOf, rejectPilotRequest } from "./support";

/**
 * The public website: landing page, request form, legal texts. No login, no
 * seeded data. Every request uses a unique address; the per-IP limit (10 a
 * day) is per run, because the Playwright config gives each run its own IP.
 */

const uniqueEmail = (label: string) =>
  `pilot-${label}-${Date.now()}-${Math.floor(Math.random() * 1e6)}@example.test`;

// A real number (BE0403019261) as people type it.
const VAT = "BE 0403.019.261";

async function fillRequest(page: Page, email: string) {
  await page.getByLabel("Naam van het bedrijf").fill("Bakkerij Zon (test)");
  await page.getByLabel("Ondernemingsnummer").fill(VAT);
  await page.getByLabel("Je naam").fill("Jo Testpersoon");
  await page.getByLabel("Je e-mailadres").fill(email);
  await page.getByLabel("Hoeveel medewerkers heb je?").selectOption("10-49");
  await page.getByLabel("In welke sector werk je?").selectOption("horeca");
  await page.getByLabel("Ja, jullie mogen contact met me opnemen").check();
}

test("the landing page loads under the CSP and tells the story", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const response = await page.goto("/");
  expect(response?.headers()["content-security-policy"]).toMatch(
    /script-src[^;]*'nonce-/,
  );

  await expect(page.locator("html")).toHaveAttribute("lang", "nl-BE");
  await expect(page).toHaveTitle(/Cloxa/);
  await expect(page.locator('meta[name="description"]')).toHaveAttribute(
    "content",
    /werktijd/,
  );
  await expect(page.locator('meta[property="og:image"]')).toHaveAttribute(
    "content",
    /\/marketing\/og\.png$/,
  );
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Werktijd registreren",
  );

  // The three benefits, each with its own heading.
  for (const title of [
    "Eenvoudig voor iedereen",
    "Betrouwbaar en veilig",
    "Minder administratie",
  ]) {
    await expect(page.getByRole("heading", { level: 3, name: title })).toBeVisible();
  }

  // The law note never overclaims.
  await expect(page.getByText("nog geen wet")).toBeVisible();

  // Both screenshots load (they are lazy: scroll them into view first).
  for (const name of [/Scherm van een medewerker/, /Scherm van een leidinggevende/]) {
    const image = page.getByRole("img", { name });
    await image.scrollIntoViewIfNeeded();
    await expect
      .poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth))
      .toBeGreaterThan(0);
  }

  // The FAQ answers what it promises.
  await page.getByText("Vervangt Cloxa mijn Dimona?").click();
  await expect(page.getByText("Nee. Cloxa vervangt Dimona niet")).toBeVisible();

  // The footer links.
  const footer = page.getByRole("contentinfo");
  for (const name of ["Privacy", "Voorwaarden", "Verwerkersovereenkomst", "Contact"]) {
    await expect(footer.getByRole("link", { name })).toBeVisible();
  }

  await page.waitForLoadState("networkidle");
  expect(consoleErrors).toEqual([]);

  await page.getByRole("link", { name: "Vraag een pilot aan" }).first().click();
  await expect(page).toHaveURL(/\/aanvragen$/);
});

test("robots.txt keeps the app out and sitemap.xml lists the public pages", async ({
  request,
}) => {
  const robots = await (await request.get("/robots.txt")).text();
  expect(robots).toContain("Allow: /");
  for (const path of ["/app", "/manage", "/kiosk", "/auth"]) {
    expect(robots).toContain(`Disallow: ${path}`);
  }
  expect(robots).toContain("Sitemap:");

  const sitemap = await (await request.get("/sitemap.xml")).text();
  for (const path of [
    "/aanvragen",
    "/privacy",
    "/voorwaarden",
    "/verwerkersovereenkomst",
  ]) {
    expect(sitemap).toContain(`${path}</loc>`);
  }
});

for (const { path, title } of [
  { path: "/privacy", title: "Privacyverklaring" },
  { path: "/voorwaarden", title: "Voorwaarden voor de pilot" },
  { path: "/verwerkersovereenkomst", title: "Verwerkersovereenkomst" },
]) {
  test(`${path} is a marked concept with a table of contents`, async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    await page.goto(path);
    await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
    await expect(page.getByText("Concept, nog niet juridisch nagekeken")).toBeVisible();
    await expect(page.getByText("[in te vullen]").first()).toBeVisible();
    await expect(page.getByText(/Laatst bijgewerkt: /)).toBeVisible();

    const toc = page.getByRole("navigation", { name: "Op deze pagina" });
    const first = toc.getByRole("link").first();
    const anchor = (await first.getAttribute("href"))!;
    await first.click();
    await expect(page).toHaveURL(new RegExp(`${anchor}$`));
    await page.waitForLoadState("networkidle");
    expect(consoleErrors).toEqual([]);
  });
}

test("the privacy text says what it keeps and for how long", async ({ page }) => {
  await page.goto("/privacy");
  await expect(page.getByText("12 maanden na de aanvraag")).toBeVisible();
  await expect(page.getByText("Minstens 5 jaar").first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Supabase" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "Cloudflare Turnstile" })).toBeVisible();
});

test("the request form keeps what was typed when something is wrong", async ({
  page,
}) => {
  const consoleErrors = collectConsoleErrors(page);
  await page.goto("/aanvragen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Vraag een pilot aan",
  );

  await page.getByLabel("Naam van het bedrijf").fill("Bakkerij Zon (test)");
  await page.getByLabel("Ondernemingsnummer").fill("BE 0403.019.262");
  await page.getByLabel("Je e-mailadres").fill("geen-email");
  await page.getByRole("button", { name: "Verstuur aanvraag" }).click();

  await expect(page.getByText("Dit ondernemingsnummer klopt niet")).toBeVisible();
  await expect(page.getByText("Dit e-mailadres klopt niet")).toBeVisible();
  await expect(page.getByText("Kies een antwoord.").first()).toBeVisible();
  await expect(page.getByText("Zonder je toestemming")).toBeVisible();
  await expect(page).toHaveURL(/\/aanvragen$/);
  // React resets the form after an action; the values come back from its state.
  await expect(page.getByLabel("Naam van het bedrijf")).toHaveValue(
    "Bakkerij Zon (test)",
  );
  await expect(page.getByLabel("Ondernemingsnummer")).toHaveValue("BE 0403.019.262");
  expect(consoleErrors).toEqual([]);
});

test("a request is stored and ends on a calm thank-you page", async ({ page }) => {
  const consoleErrors = collectConsoleErrors(page);
  const email = uniqueEmail("ok");
  await page.goto("/aanvragen");
  await fillRequest(page, email.toUpperCase());
  await page.getByLabel("Telefoonnummer").fill("0470 12 34 56");
  await page.getByLabel("Wil je nog iets kwijt?").fill("We klokken nu op papier.");
  await page.getByRole("button", { name: "Verstuur aanvraag" }).click();

  await expect(page).toHaveURL(/\/aanvragen\/verstuurd$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Bedankt voor je aanvraag",
  );
  await expect(page.getByText("Je krijgt hier geen automatische e-mail")).toBeVisible();

  const stored = await pilotRequestsOf(email);
  expect(stored).toHaveLength(1);
  expect(stored[0]).toMatchObject({
    company_name: "Bakkerij Zon (test)",
    vat_number: "BE0403019261",
    sector: "horeca",
  });
  await rejectPilotRequest(stored[0]!.id);

  await page.waitForLoadState("networkidle");
  expect(consoleErrors).toEqual([]);
});

test("the honeypot and the fourth request per address look the same and store nothing extra", async ({
  page,
}) => {
  // Honeypot: the hidden field is filled in by a script, never by a person.
  const trapped = uniqueEmail("bot");
  await page.goto("/aanvragen");
  await fillRequest(page, trapped);
  await page.locator('input[name="website"]').evaluate((input: HTMLInputElement) => {
    input.value = "https://spam.example.test";
  });
  await page.getByRole("button", { name: "Verstuur aanvraag" }).click();
  await expect(page).toHaveURL(/\/aanvragen\/verstuurd$/);
  expect(await pilotRequestsOf(trapped)).toHaveLength(0);

  // Limit: 3 per address per day. The 4th gets the same page and is not stored.
  const email = uniqueEmail("limit");
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    await page.goto("/aanvragen");
    await fillRequest(page, email);
    await page.getByRole("button", { name: "Verstuur aanvraag" }).click();
    await expect(page).toHaveURL(/\/aanvragen\/verstuurd$/);
    await expect(page.getByRole("heading", { level: 1 })).toHaveText(
      "Bedankt voor je aanvraag",
    );
  }
  const stored = await pilotRequestsOf(email);
  expect(stored).toHaveLength(3);
  for (const request of stored) await rejectPilotRequest(request.id);
});
