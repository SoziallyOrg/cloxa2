import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { LoginForm } from "@/components/auth/LoginForm";
import { getAuthContext } from "@/lib/auth/context";
import { safeNextPath } from "@/lib/auth/redirects";
import { turnstileSiteKey } from "@/lib/auth/turnstile";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const context = await getAuthContext();
  if (context.kind !== "anonymous") redirect("/start");

  const params = await searchParams;
  const next = safeNextPath(params["next"]);
  const linkFailed = params["fout"] === "link";

  return (
    <AuthShell title={t("login.title")}>
      {linkFailed ? (
        <p role="alert" className="text-lg font-semibold text-status-error">
          {t("login.linkInvalid")}
        </p>
      ) : null}
      <p className="text-lg">{t("login.intro")}</p>
      <LoginForm next={next} turnstileSiteKey={turnstileSiteKey()} />
    </AuthShell>
  );
}
