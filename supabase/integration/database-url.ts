import { inject } from "vitest";

/** The local database URL, resolved and checked once by `global-setup.ts`. */
export function databaseUrl(): string {
  return inject("databaseUrl");
}
