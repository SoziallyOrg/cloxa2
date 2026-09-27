import { z } from "zod";

/**
 * Public env vars: inlined at build time and safe to ship to the browser.
 * Never put secrets here.
 */
const publicSchema = z.object({
  NEXT_PUBLIC_SUPABASE_URL: z.url(),
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().min(1),
});

export const publicEnv = publicSchema.parse({
  NEXT_PUBLIC_SUPABASE_URL: process.env["NEXT_PUBLIC_SUPABASE_URL"],
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env["NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"],
});
