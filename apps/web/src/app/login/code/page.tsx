import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { CodeForm } from "@/components/auth/CodeForm";
import { Stack } from "@/components/ui/Stack";
import { verifyCode } from "@/lib/auth/actions/login";
import { COOKIE } from "@/lib/auth/cookies";
import { readFlow } from "@/lib/auth/session-cookies";
import { env } from "@/lib/env.server";

export default async function LoginCodePage() {
  const cookieStore = await cookies();
  // No (valid) flow cookie means the 10 minutes ran out or step 1 was skipped.
  if (!readFlow(cookieStore.get(COOKIE.flow)?.value, env.FLOW_COOKIE_SECRET)) {
    redirect("/login");
  }

  return (
    <AuthShell title={t("loginCode.title")}>
      <p
        role="status"
        className="rounded-md border-2 border-border bg-status-off-bg p-4 text-lg"
      >
        {t("loginCode.sent")}
      </p>
      <CodeForm
        id="login-code"
        label={t("loginCode.label")}
        hint={t("loginCode.hint")}
        submitLabel={t("loginCode.submit")}
        action={verifyCode}
      />
      <Stack gap="sm">
        <p className="text-base text-ink/70">{t("loginCode.noMail")}</p>
        <Link
          href="/login"
          className="focus-ring self-start text-lg font-semibold underline"
        >
          {t("loginCode.restart")}
        </Link>
      </Stack>
    </AuthShell>
  );
}
