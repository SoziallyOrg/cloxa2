/**
 * Placeholder Supabase types. Regenerate with `pnpm db:types` once
 * migrations exist; this file is checked in so imports resolve before then.
 */

export type Json = string | number | boolean | null | { [key: string]: Json } | Json[];

export interface Database {
  public: {
    Tables: Record<string, never>;
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
}
