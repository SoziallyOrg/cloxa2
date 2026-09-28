"use server";

import { redirect } from "next/navigation";
import { z } from "zod";

import { env } from "@/lib/env.server";
import { createClient } from "@/lib/supabase/server";

import { requireSignedIn } from "../context";
import { COOKIE, ORG_TTL_SECONDS } from "../cookies";
import { clearAllCloxaCookies, setCloxaCookie } from "../server-cookies";
import { mintOrgChoice } from "../session-cookies";

async function signOut(scope: "local" | "global"): Promise<never> {
  const supabase = await createClient();
  const { error } = await supabase.auth.signOut({ scope });
  if (error) console.error("sign_out_failed", scope, error.code ?? error.status);
  // Cookies go regardless: this browser is signed out even if the call failed.
  await clearAllCloxaCookies();
  redirect("/login");
}

/** Sign out on this device only. POST-only (server action), never a GET link. */
export async function logout(): Promise<never> {
  return signOut("local");
}

/** Revoke every session of this user, on all devices. */
export async function logoutEverywhere(): Promise<never> {
  return signOut("global");
}

const organizationId = z.uuid();

/** Stores the chosen organization, if it is one of the user's active memberships. */
export async function chooseOrganization(formData: FormData): Promise<never> {
  const context = await requireSignedIn();
  const parsed = organizationId.safeParse(formData.get("organizationId"));
  const memberships = context.kind === "none" ? [] : context.memberships;

  if (
    parsed.success &&
    memberships.some((membership) => membership.organizationId === parsed.data)
  ) {
    await setCloxaCookie(
      COOKIE.org,
      mintOrgChoice(context.claims.userId, parsed.data, env.FLOW_COOKIE_SECRET),
      ORG_TTL_SECONDS,
    );
  }
  redirect("/start");
}
