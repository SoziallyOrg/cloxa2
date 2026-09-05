import "server-only";
import { randomUUID } from "node:crypto";
import { getAuthContext } from "@/lib/auth/session";
import { createSupabaseServerClient } from "@/lib/supabase/server";
import {
  parseTeam,
  parseTeamResult,
  teamFailure,
  teamInputSchema,
  teamResultCopy,
  type TeamActionState,
} from "./model";

export async function getManagerTeam() {
  try {
    const client = await createSupabaseServerClient();
    const auth = await getAuthContext(client);
    if (auth.state !== "authorized" || auth.role !== "manager") return null;
    const requestId = randomUUID();
    const response = await client.rpc("get_manager_team", { request_id: requestId });
    return response.error
      ? null
      : parseTeam(response.data, requestId, auth.organizationId);
  } catch {
    return null;
  }
}

export async function performTeamChange(value: unknown): Promise<TeamActionState> {
  const parsed = teamInputSchema.safeParse(value);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    for (const issue of parsed.error.issues) {
      const key = issue.path[0];
      if (key === "display_name")
        fieldErrors[key] =
          "Vul een naam van 1 tot 100 tekens in, zonder besturingstekens.";
      if (key === "employee_code")
        fieldErrors[key] =
          "Gebruik hoogstens 32 tekens, zonder besturingstekens, of laat dit veld leeg.";
      if (key === "organization_name" || key === "worksite_name")
        fieldErrors[key] =
          "Vul een naam van 1 tot 120 tekens in, zonder besturingstekens.";
    }
    return { message: "Controleer de ingevulde velden.", fieldErrors };
  }
  const p = parsed.data;
  try {
    const client = await createSupabaseServerClient();
    const auth = await getAuthContext(client);
    if (auth.state !== "authorized" || auth.role !== "manager")
      return { message: teamFailure };
    let worksiteId = "";
    if (p.action === "update_settings") {
      const readId = randomUUID();
      const read = await client.rpc("get_manager_team", { request_id: readId });
      const view = read.error
        ? null
        : parseTeam(read.data, readId, auth.organizationId);
      if (!view) return { message: teamFailure };
      worksiteId = view.worksite_id;
    }
    const response =
      p.action === "update_profile"
        ? await client.rpc("update_employee_profile", {
            request_id: p.request_id,
            target_membership_id: p.target_membership_id,
            display_name: p.display_name,
            employee_code: p.employee_code!,
          })
        : p.action === "update_settings"
          ? await client.rpc("update_pilot_settings", {
              request_id: p.request_id,
              organization_name: p.organization_name,
              worksite_name: p.worksite_name,
            })
          : await client.rpc("change_employee_membership_status", {
              request_id: p.request_id,
              target_membership_id: p.target_membership_id,
              action: p.action,
              confirmed: p.confirmed,
            });
    if (response.error) return { message: teamFailure };
    const result = parseTeamResult(response.data, p, {
      organization_id: auth.organizationId,
      worksite_id: worksiteId,
    });
    return result
      ? { result, message: teamResultCopy[result.result_code] }
      : { message: teamFailure };
  } catch {
    return { message: teamFailure };
  }
}
