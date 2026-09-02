"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";

import { StatusState } from "@/components/status-state";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <StatusState
      action={
        <>
          <Button onClick={reset} type="button">
            {nlBE.states.error.retry}
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">{nlBE.common.backHome}</Link>
          </Button>
        </>
      }
      announcement="alert"
      description={nlBE.states.error.description}
      icon={CircleAlert}
      title={nlBE.states.error.title}
    />
  );
}
