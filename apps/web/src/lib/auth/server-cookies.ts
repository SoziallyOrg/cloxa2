import "server-only";

import { cookies } from "next/headers";

import { requestIsSecure } from "@/lib/supabase/server";

import { cookieSecurity, isCloxaCookie } from "./cookies";

/** Sets one of Cloxa's signed cookies with the standard security flags. */
export async function setCloxaCookie(
  name: string,
  value: string,
  maxAgeSeconds: number,
): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(name, value, {
    ...cookieSecurity(await requestIsSecure()),
    maxAge: maxAgeSeconds,
  });
}

export async function deleteCloxaCookie(name: string): Promise<void> {
  const cookieStore = await cookies();
  cookieStore.set(name, "", { ...cookieSecurity(await requestIsSecure()), maxAge: 0 });
}

/** Clears every Supabase and Cloxa cookie the browser sent (logout). */
export async function clearAllCloxaCookies(): Promise<void> {
  const cookieStore = await cookies();
  const security = cookieSecurity(await requestIsSecure());
  for (const { name } of cookieStore.getAll()) {
    if (isCloxaCookie(name)) cookieStore.set(name, "", { ...security, maxAge: 0 });
  }
}
