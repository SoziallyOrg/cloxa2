import { LoaderCircle } from "lucide-react";

import { StatusState } from "@/components/status-state";
import { nlBE } from "@/i18n/nl-BE";

export default function Loading() {
  return (
    <StatusState
      announcement="status"
      description={nlBE.states.loading.description}
      icon={LoaderCircle}
      live
      title={nlBE.states.loading.title}
    />
  );
}
