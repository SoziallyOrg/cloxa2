// What global-setup.ts provides to every test file.
import "vitest";

declare module "vitest" {
  export interface ProvidedContext {
    databaseUrl: string;
  }
}
