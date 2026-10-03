"use client";

import { ErrorView } from "@/components/ui/ErrorView";

/** A page in `/manage` failed to load: a calm retry, inside the manage frame. */
export default function ManageError({ retry }: { error: Error; retry: () => void }) {
  return (
    <div className="flex flex-1 flex-col pb-10">
      <ErrorView onRetry={retry} />
    </div>
  );
}
