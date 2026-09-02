import { FileQuestion } from "lucide-react";
import Link from "next/link";

import { StatusState } from "@/components/status-state";
import { Button } from "@/components/ui/button";
import { nlBE } from "@/i18n/nl-BE";

export default function NotFound() {
  return (
    <StatusState
      action={
        <Button asChild>
          <Link href="/">{nlBE.common.backHome}</Link>
        </Button>
      }
      description={nlBE.states.notFound.description}
      icon={FileQuestion}
      title={nlBE.states.notFound.title}
    />
  );
}
