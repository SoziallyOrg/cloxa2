import "server-only";

import { cookies } from "next/headers";

/**
 * Design-review hooks for `pnpm screens`: a `preview_state` cookie makes an
 * `/app` page hold its data (`laden`, to photograph `loading.tsx`) or fail
 * (`fout`, to photograph `error.tsx`). Only in `next dev` and in a local
 * production build started with CLOXA_PREVIEW=1; a no-op everywhere else.
 */
const HOLD_MS = 30_000;

function previewEnabled(): boolean {
  return process.env.NODE_ENV !== "production" || process.env["CLOXA_PREVIEW"] === "1";
}

export async function previewHold(): Promise<void> {
  if (!previewEnabled()) return;
  const state = (await cookies()).get("preview_state")?.value;
  if (state === "laden") await new Promise((done) => setTimeout(done, HOLD_MS));
  if (state === "fout") throw new Error("preview_error");
}
