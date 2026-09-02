import { ClipboardCheck } from "lucide-react";
import type { Metadata } from "next";

import { RoleShell } from "@/components/role-shell";
import { nlBE } from "@/i18n/nl-BE";

export const metadata: Metadata = {
  title: nlBE.manager.title,
};

export default function ManagerPage() {
  return (
    <RoleShell
      description={nlBE.manager.description}
      icon={ClipboardCheck}
      status={nlBE.manager.status}
      title={nlBE.manager.title}
    />
  );
}
