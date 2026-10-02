import type { ReactNode } from "react";

import { t } from "@cloxa/i18n";

import { shortDisplayName } from "@/components/employee/account-name";
import { ManageFrame } from "@/components/manage/ManageFrame";
import { requireManager } from "@/lib/auth/context";
import { loadClockBar } from "@/lib/clock/bar";
import { createClient } from "@/lib/supabase/server";

/** aal2, MFA at most 12 hours old and activity in the last 30 minutes. */
export default async function SecuredManageLayout({
  children,
}: {
  children: ReactNode;
}) {
  const context = await requireManager();
  const supabase = await createClient();
  const [employeeResult, pendingResult, clockBar] = await Promise.all([
    context.employeeId
      ? supabase
          .from("employees")
          .select("display_name")
          .eq("id", context.employeeId)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }),
    supabase
      .from("correction_requests")
      .select("id", { count: "exact", head: true })
      .eq("status", "pending"),
    // A manager who also clocks sees the clock bar while clocked in.
    context.employeeId ? loadClockBar(context.employeeId) : Promise.resolve(null),
  ]);
  // Both are niceties in the frame: a failed read shows less, never an error page.
  const fullName =
    employeeResult.data?.display_name ?? context.claims.email ?? t("account.open");
  const pendingRequests = pendingResult.error ? 0 : (pendingResult.count ?? 0);

  return (
    <ManageFrame
      account={{
        fullName,
        shortName: employeeResult.data
          ? shortDisplayName(employeeResult.data.display_name)
          : fullName,
        canClock: context.employeeId !== null,
        employeeId: context.employeeId,
      }}
      pendingRequests={pendingRequests}
      clockBar={clockBar}
    >
      {children}
    </ManageFrame>
  );
}
