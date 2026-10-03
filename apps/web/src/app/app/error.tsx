"use client";

import { ErrorView } from "@/components/ui/ErrorView";

/** A page in `/app` failed to load: a calm retry, inside the app frame. */
export default function EmployeeError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col pb-10">
      <ErrorView onRetry={retry} />
    </div>
  );
}
