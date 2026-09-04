"use server";
import "server-only";
import { revalidatePath } from "next/cache";
import { performTeamChange } from "./server";

export async function changeTeam(value: unknown) {
  const state = await performTeamChange(value);
  if (state.result) {
    // A refresh failure must not turn an exact committed result into uncertainty.
    try {
      for (const path of [
        "/manager/team",
        "/manager",
        "/employee",
        "/manager/exports",
        "/manager/exports-v2",
      ])
        revalidatePath(path);
    } catch {
      /* A later page refresh loads current data; retain confirmed outcome. */
    }
  }
  return state;
}
