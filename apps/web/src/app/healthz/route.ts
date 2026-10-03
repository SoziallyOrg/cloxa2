// Liveness/readiness probe for the Docker HEALTHCHECK and the deploy
// workflow. Deliberately does nothing: no DB, no auth, no PII, so it stays
// cheap and can't fail for reasons unrelated to "is the process up".
export const dynamic = "force-dynamic";

export function GET(): Response {
  return Response.json({ status: "ok" }, { headers: { "Cache-Control": "no-store" } });
}
