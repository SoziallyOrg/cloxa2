import { z } from "zod";

export const publicEnvironmentSchema = z
  .object({
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: z.string().trim().min(1),
    NEXT_PUBLIC_SUPABASE_URL: z.url(),
  })
  .strict();

export type PublicEnvironment = z.infer<typeof publicEnvironmentSchema>;

export function parsePublicEnvironment(input: unknown): PublicEnvironment {
  return publicEnvironmentSchema.parse(input);
}
