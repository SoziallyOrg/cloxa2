import { ShieldAlert } from "lucide-react";
import Link from "next/link";

import { StatusState } from "@/components/status-state";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export default function UnauthorizedPage() {
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
        </>
      }
      description={nlBE.states.unauthorized.description}
      icon={ShieldAlert}
      title={nlBE.states.unauthorized.title}
    />
  );
}
