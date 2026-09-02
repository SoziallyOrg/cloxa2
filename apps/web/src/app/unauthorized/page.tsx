import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { StatusState } from "@/components/status-state";
import { LogoutForm } from "@/components/logout-form";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export default async function UnauthorizedPage({
  searchParams,
}: {
  searchParams: Promise<{ melding?: string }>;
}) {
  const { melding } = await searchParams;
  return (
    <StatusState
      action={
        <>
          <Button asChild>
            <Link href="/login">{nlBE.common.openLogin}</Link>
          </Button>
          <Button asChild variant="secondary">
            <Link href="/">{nlBE.common.backHome}</Link>
          </Button>
          <LogoutForm />
        </>
      }
      description={
        melding === "meerdere-lidmaatschappen"
          ? nlBE.states.unauthorized.unsupported
          : nlBE.states.unauthorized.description
      }
      icon={ShieldAlert}
      title={nlBE.states.unauthorized.title}
    />
  );
}
