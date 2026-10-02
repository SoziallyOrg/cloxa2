"use client";

import { ErrorView } from "@/components/ui/ErrorView";

/** The correction page failed to load: a calm retry. Nothing was saved. */
export default function ManagerCorrectionError({
  retry,
}: {
  error: Error;
  retry: () => void;
}) {
  return (
    <div className="flex flex-1 flex-col pb-10">
      <ErrorView onRetry={retry} />
    </div>
  );
}
