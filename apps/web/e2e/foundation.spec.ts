import { expect, test } from "@playwright/test";

const publicRoutes = [
  { heading: "Werkuren die correcties zichtbaar houden.", path: "/" },
  { heading: "Aanmelden", path: "/login" },
  {
    heading: "Registreren kan alleen via uitnodiging.",
    path: "/signup",
  },
  { heading: "Wachtwoord herstellen", path: "/forgot-password" },
  { heading: "Geen toegang", path: "/unauthorized" },
] as const;

for (const route of publicRoutes) {
  test(`${route.path} toont Nederlandse routeshell`, async ({ page }) => {
    const browserErrors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") {
        browserErrors.push(message.text());
      }
    });
    page.on("pageerror", (error) => browserErrors.push(error.message));

    const response = await page.goto(route.path);

    expect(response?.status()).toBe(200);
    await expect(
      page.getByRole("heading", { level: 1, name: route.heading }),
    ).toBeVisible();
    await expect(page.locator("main")).toHaveCount(1);
    await expect(page.getByRole("heading", { level: 1 })).toHaveCount(1);
    expect(browserErrors).toEqual([]);
  });
}

test("openbare registratie blijft uitgeschakeld", async ({ page }) => {
  await page.goto("/signup");

  await expect(
    page.getByText("Openbare registratie blijft uitgeschakeld."),
  ).toBeVisible();
  await expect(page.locator("form")).toHaveCount(0);
  await expect(page.getByRole("button", { name: /account aanmaken/i })).toHaveCount(0);
});

for (const path of ["/employee", "/manager"] as const) {
  test(`${path} stuurt een anonieme bezoeker naar aanmelden`, async ({ page }) => {
    await page.goto(path);

    await expect(page).toHaveURL(/\/login\?volgende=/);
    expect(new URL(page.url()).searchParams.get("volgende")).toBe(path);
    await expect(
      page.getByRole("heading", { level: 1, name: "Aanmelden" }),
    ).toBeVisible();
  });
}

test("auth callback zonder code eindigt gecontroleerd", async ({ page, request }) => {
  const callbackResponse = await request.get("/auth/callback", {
    maxRedirects: 0,
  });

  expect(callbackResponse.status()).toBe(307);
  expect(callbackResponse.headers()["cache-control"]).toContain("no-store");
  expect(callbackResponse.headers().expires).toBe("0");
  expect(callbackResponse.headers().pragma).toBe("no-cache");

  const response = await page.goto("/auth/callback");

  expect(response?.status()).toBe(200);
  await expect(page).toHaveURL(/\/login\?melding=aanmelding-mislukt$/);
  await expect(
    page.getByRole("heading", { level: 1, name: "Aanmelden" }),
  ).toBeVisible();
});

test("onbekend adres toont Nederlandse 404", async ({ page }) => {
  const response = await page.goto("/bestaat-niet");

  expect(response?.status()).toBe(404);
  await expect(
    page.getByRole("heading", { level: 1, name: "Pagina niet gevonden" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: "Terug naar start" })).toBeVisible();
});

test("manifest beschrijft web-app zonder service worker", async ({ page, request }) => {
  const response = await request.get("/manifest.webmanifest");

  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  await expect(response.json()).resolves.toMatchObject({
    display: "standalone",
    lang: "nl-BE",
    name: "Cloxa",
    short_name: "Cloxa",
    start_url: "/",
  });

  await page.goto("/");
  const registrations = await page.evaluate(async () => {
    if (!("serviceWorker" in navigator)) {
      return [];
    }

    return navigator.serviceWorker.getRegistrations();
  });

  expect(registrations).toHaveLength(0);
});

test("publieke routes blijven bruikbaar op 320 pixels", async ({ page }) => {
  await page.setViewportSize({ height: 800, width: 320 });

  for (const route of publicRoutes) {
    await page.goto(route.path);
    const dimensions = await page.evaluate(() => ({
      clientWidth: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
    }));

    expect(dimensions.scrollWidth, route.path).toBeLessThanOrEqual(
      dimensions.clientWidth,
    );
  }
});
