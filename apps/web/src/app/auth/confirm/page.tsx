import { redirect } from "next/navigation";

import { t } from "@cloxa/i18n";

import { AuthShell } from "@/components/auth/AuthShell";
import { ConfirmLinkForm } from "@/components/auth/ConfirmLinkForm";
import { parseConfirmType, parseTokenHash, safeNextPath } from "@/lib/auth/redirects";
import { turnstileSiteKey } from "@/lib/auth/turnstile";

type SearchParams = Record<string, string | string[] | undefined>;

/**
 * GET half of `/auth/confirm` (`?token_hash=…&type=…[&next=…]`): renders a
 * button and changes nothing. `type` and `next` are checked against
 * allowlists here and again on POST.
 */
export default async function ConfirmLinkPage({
  searchParams,
}: {
  searchParams: Promise<SearchParams>;
}) {
  const params = await searchParams;
  const tokenHash = parseTokenHash(params["token_hash"]);
  const type = parseConfirmType(params["type"]);
  if (!tokenHash || !type) redirect("/login?fout=link");

  return (
    <AuthShell title={t("auth.confirm.title")}>
      <p className="text-lg">{t("auth.confirm.intro")}</p>
      <ConfirmLinkForm
        tokenHash={tokenHash}
        type={type}
        next={safeNextPath(params["next"])}
        turnstileSiteKey={turnstileSiteKey()}
      />
    </AuthShell>
  );
}
