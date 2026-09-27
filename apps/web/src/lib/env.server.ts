import "server-only";

import { z } from "zod";

import { publicEnv } from "./env";

/**
 * Server-only env vars, including secrets. Importing this module from a
 * client component fails the build (see the `server-only` package).
 */
const serverSchema = z.object({
  SUPABASE_SECRET_KEY: z.string().min(1),
  CLOXA_SITE_URL: z.url(),
});

const serverOnlyEnv = serverSchema.parse({
  SUPABASE_SECRET_KEY: process.env["SUPABASE_SECRET_KEY"],
  CLOXA_SITE_URL: process.env["CLOXA_SITE_URL"],
});

export const env = {
  ...publicEnv,
  ...serverOnlyEnv,
};
