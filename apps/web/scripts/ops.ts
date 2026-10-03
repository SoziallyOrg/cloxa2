/**
 * Operator CLI: pilot requests and onboarding. There is deliberately no web
 * super-admin; this runs on the operator's machine with the service key.
 *
 *   pnpm ops requests
 *   pnpm ops activate <request-id> [--site "Naam"] --confirm
 *   pnpm ops reject <request-id> --confirm
 *
 * Target: the Supabase URL and secret key from the environment
 * (NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SECRET_KEY): from `--env-file <path>`
 * when given, else from apps/web/.env.local (the local stack). Variables set in
 * the shell win over both files. See docs/deploy.md ("Een klant activeren").
 *
 * Changing commands print what they will do and refuse without `--confirm`.
 * Against anything but loopback the operator must also type the host back. The
 * key is never printed.
 *
 * Runs on Node's built-in TypeScript support: erasable syntax only, and
 * type-only imports from workspace packages.
 */
import { existsSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@cloxa/db";

import {
  confirmRefusal,
  hostConfirmationMatches,
  needsHostConfirmation,
  parseOpsArgs,
  targetHost,
  USAGE,
  type OpsCommand,
} from "./ops-lib.ts";

type Client = SupabaseClient<Database>;

interface PilotRequest {
  id: string;
  created_at: string;
  status: string;
  company_name: string;
  vat_number: string;
  contact_name: string;
  email: string;
  phone: string | null;
  employee_range: string;
  sector: string;
  message: string | null;
}

function die(message: string, code = 1): never {
  console.error(message);
  process.exit(code);
}

/** Only the error code and message of a failed call: never a key or a payload. */
function describeError(
  step: string,
  error: { message: string; code?: string | undefined } | null,
) {
  return `${step} mislukt: ${error?.code ?? ""} ${error?.message ?? "geen antwoord"}`.trim();
}

function connect(): { client: Client; url: string } {
  const url = process.env["NEXT_PUBLIC_SUPABASE_URL"] ?? process.env["SUPABASE_URL"];
  const key = process.env["SUPABASE_SECRET_KEY"];
  if (!url || !key) {
    die(
      "NEXT_PUBLIC_SUPABASE_URL en SUPABASE_SECRET_KEY ontbreken. Draai `pnpm --filter @cloxa/web setup:env` (lokaal) of geef --env-file mee.",
    );
  }
  if (targetHost(url) === null) die("NEXT_PUBLIC_SUPABASE_URL is geen geldige URL.");
  const client = createClient<Database>(url, key, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return { client, url };
}

async function fetchRequests(
  client: Client,
  id: string | null,
): Promise<PilotRequest[]> {
  const { data, error } = await client.rpc(
    "rpc_admin_list_pilot_requests",
    id === null ? {} : { p_id: id },
  );
  if (error) die(describeError("Aanvragen ophalen", error));
  return data as PilotRequest[];
}

function printRequest(request: PilotRequest): void {
  console.log(`  id:         ${request.id}`);
  console.log(`  status:     ${request.status}`);
  console.log(`  ontvangen:  ${request.created_at}`);
  console.log(`  bedrijf:    ${request.company_name} (${request.vat_number})`);
  console.log(`  contact:    ${request.contact_name} <${request.email}>`);
  console.log(`  telefoon:   ${request.phone ?? "-"}`);
  console.log(
    `  grootte:    ${request.employee_range} medewerkers, sector ${request.sector}`,
  );
  if (request.message)
    console.log(`  bericht:    ${request.message.replace(/\s+/g, " ")}`);
}

async function listRequests(client: Client): Promise<void> {
  const requests = await fetchRequests(client, null);
  if (requests.length === 0) {
    console.log("Geen open aanvragen.");
    return;
  }
  console.log(
    `${requests.length} open aanvra${requests.length === 1 ? "ag" : "gen"}:\n`,
  );
  for (const request of requests) {
    printRequest(request);
    console.log("");
  }
}

async function confirmHost(url: string): Promise<void> {
  if (!needsHostConfirmation(url)) return;
  const host = targetHost(url) as string;
  console.log(`\nDit is NIET je lokale stack: ${host}`);
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const typed = await rl.question(`Typ de host om door te gaan (${host}): `);
    if (!hostConfirmationMatches(typed, url)) die("Host komt niet overeen. Gestopt.");
  } finally {
    rl.close();
  }
}

/** The auth user for the contact: a fresh invite (Dutch email), or the existing account. */
async function inviteContact(client: Client, email: string): Promise<string> {
  const { data, error } = await client.auth.admin.inviteUserByEmail(email);
  if (!error && data.user) {
    console.log("Uitnodiging per e-mail verstuurd.");
    return data.user.id;
  }
  if (error && error.code !== "email_exists") {
    die(
      describeError("Uitnodigen", { message: error.message, code: error.code ?? "" }),
    );
  }

  // Already has a login (an earlier attempt, or a colleague elsewhere): reuse it.
  for (let page = 1; page <= 50; page += 1) {
    const { data: list, error: listError } = await client.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (listError) die(describeError("Gebruikers opzoeken", listError));
    const found = list.users.find((user) => user.email?.toLowerCase() === email);
    if (found) {
      console.log(
        "Dit e-mailadres heeft al een login: geen nieuwe uitnodiging verstuurd (inloggen kan met een e-mailcode).",
      );
      return found.id;
    }
    if (list.users.length < 200) break;
  }
  return die("Het e-mailadres bestaat al, maar de gebruiker werd niet gevonden.");
}

async function activate(
  client: Client,
  request: PilotRequest,
  site: string | null,
): Promise<void> {
  const userId = await inviteContact(client, request.email);
  const { data, error } = await client.rpc("rpc_admin_activate_pilot_request", {
    p_request_id: request.id,
    p_owner_user_id: userId,
    ...(site === null ? {} : { p_site_name: site }),
  });
  if (error || !data[0]) {
    die(describeError("Organisatie aanmaken", error));
  }
  const created = data[0];
  console.log("Klaar. Organisatie aangemaakt en aanvraag als geactiveerd gemarkeerd.");
  console.log(`  organisatie: ${created.organization_id}`);
  console.log(`  locatie:     ${created.site_id}`);
  console.log(
    "De eigenaar krijgt de uitnodiging en stelt bij de eerste keer zijn beveiligingsapp in.",
  );
}

async function reject(client: Client, request: PilotRequest): Promise<void> {
  const { data, error } = await client.rpc("rpc_admin_reject_pilot_request", {
    p_request_id: request.id,
  });
  if (error) die(describeError("Afwijzen", error));
  console.log(
    data ? "Aanvraag afgewezen." : "Niets gewijzigd: de aanvraag is niet meer open.",
  );
}

async function run(command: OpsCommand): Promise<void> {
  const { client, url } = connect();
  console.log(`Doel: ${targetHost(url)}\n`);

  if (command.kind === "requests") {
    await listRequests(client);
    return;
  }

  const [request] = await fetchRequests(client, command.id);
  if (!request) die("Geen aanvraag met dit id.");
  if (request.status !== "open")
    die(`Deze aanvraag is al ${request.status}. Niets te doen.`);

  console.log("Aanvraag:");
  printRequest(request);
  console.log("\nDit gaat er gebeuren:");
  if (command.kind === "activate") {
    console.log(`  1. ${request.email} uitnodigen (of hun bestaande login gebruiken)`);
    console.log(
      `  2. organisatie "${request.company_name}" aanmaken met eerste locatie "${command.site ?? request.company_name}", en de contactpersoon als eigenaar`,
    );
    console.log("  3. de aanvraag als geactiveerd markeren");
  } else {
    console.log("  de aanvraag als afgewezen markeren (er wordt niets verstuurd)");
  }

  const refusal = confirmRefusal(command);
  if (refusal) die(`\n${refusal}`);
  await confirmHost(url);

  console.log("");
  if (command.kind === "activate") await activate(client, request, command.site);
  else await reject(client, request);
}

async function main(): Promise<void> {
  const parsed = parseOpsArgs(process.argv.slice(2));
  if (!parsed.ok) die(`${parsed.message}\n\n${USAGE}`, 2);

  // Either the file named on the command line or the local one, never both:
  // .env.local must not quietly decide which stack a production run talks to.
  const envFile =
    parsed.command.envFile ?? fileURLToPath(new URL("../.env.local", import.meta.url));
  if (parsed.command.envFile !== null || existsSync(envFile)) {
    try {
      process.loadEnvFile(envFile);
    } catch {
      die(`Omgevingsbestand niet gevonden of onleesbaar: ${envFile}`);
    }
  }
  await run(parsed.command);
}

// Only when run as a script, so the pure parts stay importable.
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  await main();
}
