"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

const DEFAULT_INTERVAL_MS = 60_000;

/**
 * Refreshes the current server component tree every 60s so Vandaag stays
 * live. `router.refresh()` issues a GET with an `RSC` header, which
 * `lib/security/request-kind.ts` already treats as a non-activity prefetch,
 * so this does not keep the manager's idle timeout alive.
 */
export function AutoRefresh({
  intervalMs = DEFAULT_INTERVAL_MS,
}: {
  intervalMs?: number;
}) {
  const router = useRouter();

  useEffect(() => {
    const id = setInterval(() => router.refresh(), intervalMs);
    return () => clearInterval(id);
  }, [router, intervalMs]);

  return null;
}
