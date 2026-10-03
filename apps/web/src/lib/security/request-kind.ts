/**
 * Whether a request is the user actually doing something, for the `/manage`
 * idle clock. Prefetches (hover, viewport, browser speculation) and RSC
 * payload fetches must not keep an unattended session alive; only full
 * document navigations and server-action POSTs count.
 */
export function countsAsActivity(
  method: string,
  headers: Pick<Headers, "get">,
): boolean {
  const purpose = `${headers.get("sec-purpose") ?? ""} ${headers.get("purpose") ?? ""}`;
  if (headers.get("next-router-prefetch") !== null || /prefetch/i.test(purpose)) {
    return false;
  }

  if (method === "POST") return headers.get("next-action") !== null;
  if (method !== "GET") return false;

  // Client-side RSC fetches carry `RSC: 1`; a real navigation never does.
  if (headers.get("rsc") !== null) return false;
  const destination = headers.get("sec-fetch-dest");
  if (destination !== null) return destination === "document";
  // Browsers without Fetch Metadata: fall back to what the request accepts.
  return (headers.get("accept") ?? "").includes("text/html");
}
