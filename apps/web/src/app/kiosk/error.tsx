"use client";

import { KioskShell } from "@/components/kiosk/KioskShell";
import { ErrorView } from "@/components/ui/ErrorView";

/** The tablet failed to load: a calm retry under the brand bar (nothing is lost). */
export default function KioskError({ retry }: { error: Error; retry: () => void }) {
  return (
    <KioskShell>
      <ErrorView onRetry={retry} />
    </KioskShell>
  );
}
