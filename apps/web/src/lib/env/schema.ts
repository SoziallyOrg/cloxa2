import { z } from "zod";

const publicEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
  })
  .strict();

const serverEnvironmentSchema = publicEnvironmentSchema
  .extend({
    SUPABASE_SECRET_KEY: z.string().trim().min(1),
  })
  .strict();

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;
export type ServerEnvironment = z.infer<typeof serverEnvironmentSchema>;

export function parsePublicEnvironment(input: unknown): PublicEnvironment {
  return publicEnvironmentSchema.parse(input);
}

export function parseServerEnvironment(input: unknown): ServerEnvironment {
  return serverEnvironmentSchema.parse(input);
}
