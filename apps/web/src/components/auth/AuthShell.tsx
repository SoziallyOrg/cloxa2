import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { Card } from "@/components/ui/Card";
import { Heading } from "@/components/ui/Heading";
import { Stack } from "@/components/ui/Stack";

export interface AuthShellProps {
  title: string;
  children: ReactNode;
}

/** Calm, centred single-column frame for login, MFA and access screens. */
export function AuthShell({ title, children }: AuthShellProps) {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-lg flex-col justify-center gap-8 p-4 sm:p-8">
      {/* Plain <img>: next/image adds an inline style attribute that the nonce CSP blocks. */}
      <img
        src="/branding/cloxa-compact.svg"
        alt={t("common.appName")}
        width={140}
        height={42}
      />
      <Card>
        <Stack gap="lg">
          <Heading level={1}>{title}</Heading>
          {children}
        </Stack>
      </Card>
    </main>
  );
}
