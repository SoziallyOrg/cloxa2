import { expect, test, type APIRequestContext } from "@playwright/test";

/**
 * Employee login with an emailed code, read from the local Mailpit.
 * Needs the local Supabase stack and `pnpm --filter @cloxa/web dev:seed`.
 */
const MAILPIT = "http://127.0.0.1:54324/api/v1";
const EMPLOYEE = "jan@demo.test";

interface MailpitSearch {
  messages: { ID: string; Created: string }[];
}

async function clearMailbox(
  request: APIRequestContext,
  address: string,
): Promise<void> {
  await request.delete(`${MAILPIT}/search`, { params: { query: `to:"${address}"` } });
}

async function latestCode(
  request: APIRequestContext,
  address: string,
): Promise<string> {
  let code: string | null = null;
  await expect
    .poll(
      async () => {
        const search = await request.get(`${MAILPIT}/search`, {
          params: { query: `to:"${address}"` },
        });
        const { messages } = (await search.json()) as MailpitSearch;
        const newest = messages[0];
        if (!newest) return null;
        const message = await request.get(`${MAILPIT}/message/${newest.ID}`);
        const { Text } = (await message.json()) as { Text: string };
        code = /\b(\d{6})\b/.exec(Text)?.[1] ?? null;
        return code;
      },
      { timeout: 20_000, message: "no code email arrived in Mailpit" },
    )
    .not.toBeNull();
  return code!;
}

test("employee logs in with an email code, cannot enter /manage, and logs out", async ({
  page,
  request,
}) => {
  await clearMailbox(request, EMPLOYEE);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);

  await page.getByLabel("Je e-mailadres").fill(EMPLOYEE);
  await page.getByRole("button", { name: "Stuur mij een code" }).click();

  await expect(page).toHaveURL(/\/login\/code$/);
  await expect(page.getByRole("status")).toContainText(
    "Als dit adres bij ons bekend is",
  );

  await page.getByLabel("Code uit de e-mail").fill(await latestCode(request, EMPLOYEE));
  await page.getByRole("button", { name: "Inloggen" }).click();

  await expect(page).toHaveURL(/\/app$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Mijn tijdsregistratie",
  );

  // An employee has no business in /manage and is sent back to /app.
  await page.goto("/manage");
  await expect(page).toHaveURL(/\/app$/);

  await page.getByRole("button", { name: "Afmelden", exact: true }).click();
  await expect(page).toHaveURL(/\/login$/);

  const cookies = await page.context().cookies();
  expect(cookies.filter((cookie) => /^(sb-|cx_)/.test(cookie.name))).toEqual([]);

  await page.goto("/app");
  await expect(page).toHaveURL(/\/login$/);
});
