import { expect, test } from "@playwright/test";

import { capture } from "./helpers";

/**
 * The public website (`pnpm screens`): landing, request form (empty and with
 * errors), the thank-you page and the privacy text. No account, no data.
 */
test("the public website", async ({ page }) => {
  test.setTimeout(180_000);

  await page.goto("/");
  await expect(page.getByRole("heading", { level: 1 })).toContainText(
    "Werktijd registreren",
  );
  // The screenshots are lazy; a full-page shot needs them loaded.
  await page.evaluate(() => {
    for (const image of Array.from(document.images)) image.loading = "eager";
  });
  await capture(page, "site-landing");

  // The FAQ with an answer open.
  await page.getByText("Vervangt Cloxa mijn Dimona?").click();
  await capture(page, "site-landing-faq", false);

  await page.goto("/aanvragen");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Vraag een pilot aan",
  );
  await capture(page, "site-aanvragen");

  await page.getByLabel("Naam van het bedrijf").fill("Bakkerij Zon (fictief)");
  await page.getByLabel("Ondernemingsnummer").fill("BE 0403.019.262");
  await page.getByLabel("Je e-mailadres").fill("geen-email");
  await page.getByRole("button", { name: "Verstuur aanvraag" }).click();
  await expect(page.getByText("Dit ondernemingsnummer klopt niet")).toBeVisible();
  await capture(page, "site-aanvragen-fouten");

  await page.goto("/aanvragen/verstuurd");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Bedankt voor je aanvraag",
  );
  await capture(page, "site-aanvragen-verstuurd");

  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText("Privacyverklaring");
  await capture(page, "site-privacy");
});
