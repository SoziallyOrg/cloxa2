"use client";

import { ErrorView } from "@/components/ui/ErrorView";

export default function ErrorPage({ retry }: { error: Error; retry: () => void }) {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-readable flex-col">
      <ErrorView onRetry={retry} />
    </main>
  );
}
