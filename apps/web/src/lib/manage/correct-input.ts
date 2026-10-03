import { managerCorrectInput, type ManagerCorrectInput } from "@cloxa/db";

/**
 * The wizard's proposal plus the employee from the route, checked with the
 * same schema the RPC wrapper uses. The employee id always comes from the
 * caller, whatever the client put in the body.
 */
export function parseManagerCorrection(
  employeeId: string,
  input: unknown,
): ManagerCorrectInput | null {
  if (typeof input !== "object" || input === null || Array.isArray(input)) return null;
  const parsed = managerCorrectInput.safeParse({ ...input, employeeId });
  return parsed.success ? parsed.data : null;
}
