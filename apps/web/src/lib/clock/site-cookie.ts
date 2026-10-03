import "server-only";

import { cookies } from "next/headers";

/**
 * Which site an employee assigned to more than one clocks at. Not security
 * sensitive (every RPC re-checks the assignment server-side), so this is a
 * plain cookie, independent of the signed auth cookies in `lib/auth`.
 */
const SITE_COOKIE = "cx_site";
const SITE_TTL_SECONDS = 30 * 24 * 3600;

export async function readChosenSiteId(): Promise<string | null> {
  const cookieStore = await cookies();
  return cookieStore.get(SITE_COOKIE)?.value ?? null;
}

export async function setChosenSiteId(siteId: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(SITE_COOKIE, siteId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: SITE_TTL_SECONDS,
  });
}
