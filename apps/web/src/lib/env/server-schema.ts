import "server-only";

import { z } from "zod";

import { publicEnvironmentSchema } from "./schema";

const serverEnvironmentSchema = publicEnvironmentSchema
  .extend({
    SUPABASE_SECRET_KEY: z.string().trim().min(1),
  })
  .strict();

export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parseServerEnvironment(input: unknown): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}
