import "server-only";

import { cookies } from "next/headers";

import { COOKIE } from "@/lib/auth/cookies";
import { requestIsSecure } from "@/lib/supabase/server";

const ONE_YEAR_SECONDS = 365 * 24 * 3600;
const SECRET = /^[0-9a-f]{64}$/;

/**
 * The kiosk's device secret: httpOnly, Strict (never sent from another site)
 * and scoped to `/kiosk`, so it never travels with `/app` or `/manage`
 * requests and a logout there cannot touch it.
 */
function options(secure: boolean, maxAge: number) {
  return {
    httpOnly: true,
    secure,
    sameSite: "strict" as const,
    path: "/kiosk",
    maxAge,
  };
}

export async function readKioskSecret(): Promise<string | null> {
  const value = (await cookies()).get(COOKIE.kiosk)?.value;
  return value !== undefined && SECRET.test(value) ? value : null;
}

/** Server Actions only: Server Components cannot set cookies. */
export async function setKioskSecret(secret: string): Promise<void> {
  (await cookies()).set(
    COOKIE.kiosk,
    secret,
    options(await requestIsSecure(), ONE_YEAR_SECONDS),
  );
}

export async function clearKioskSecret(): Promise<void> {
  (await cookies()).set(COOKIE.kiosk, "", options(await requestIsSecure(), 0));
}
