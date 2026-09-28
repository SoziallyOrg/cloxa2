import { redirect } from "next/navigation";

import { getAuthContext, routingState } from "@/lib/auth/context";
import { destinationFor } from "@/lib/auth/routing";

/** Post-login router: sends each person to the one place that fits their role. */
export default async function StartPage() {
  const context = await getAuthContext();
  redirect(destinationFor(routingState(context)));
}
