/**
 * The pure parts of the operator CLI (`pnpm ops`): argument parsing and the
 * confirmation guards. No I/O, so they can be tested. Runs on Node's built-in
 * TypeScript support: erasable syntax only.
 */

export type OpsCommand =
  | { kind: "requests"; envFile: string | null }
  | {
      kind: "activate";
      id: string;
      site: string | null;
      confirm: boolean;
      envFile: string | null;
    }
  | { kind: "reject"; id: string; confirm: boolean; envFile: string | null };

export type ParseResult =
  { ok: true; command: OpsCommand } | { ok: false; message: string };

export const USAGE = [
  "Gebruik: pnpm ops <commando>",
  "",
  "  requests                                 open pilotaanvragen tonen",
  '  activate <id> [--site "Naam"] --confirm  organisatie aanmaken en de contactpersoon uitnodigen',
  "  reject <id> --confirm                    aanvraag afwijzen",
  "",
  "  --env-file <pad>   omgevingsbestand laden (bv. voor productie)",
  "  --confirm          voer het echt uit (zonder dit toont het alleen wat er zou gebeuren)",
].join("\n");

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Splits `--flag=value` and `--flag value`; everything else is positional. */
export function parseOpsArgs(argv: readonly string[]): ParseResult {
  const positional: string[] = [];
  const flags = new Map<string, string | true>();

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index] as string;
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }
    const equals = arg.indexOf("=");
    const name = equals === -1 ? arg.slice(2) : arg.slice(2, equals);
    if (name === "confirm") {
      if (equals !== -1) return { ok: false, message: "--confirm heeft geen waarde." };
      flags.set(name, true);
    } else if (name === "site" || name === "env-file") {
      let value: string | undefined;
      if (equals !== -1) {
        value = arg.slice(equals + 1);
      } else {
        value = argv[index + 1];
        index += 1;
      }
      if (value === undefined || value.trim() === "" || value.startsWith("--")) {
        return { ok: false, message: `--${name} heeft een waarde nodig.` };
      }
      flags.set(name, value.trim());
    } else {
      return { ok: false, message: `Onbekende optie: --${name}` };
    }
  }

  const [name, id, ...extra] = positional;
  if (name === undefined) return { ok: false, message: "Geen commando opgegeven." };
  if (extra.length > 0) {
    return { ok: false, message: `Te veel argumenten: ${extra.join(" ")}` };
  }

  const envFileFlag = flags.get("env-file");
  const envFile = typeof envFileFlag === "string" ? envFileFlag : null;
  const confirm = flags.get("confirm") === true;
  const siteFlag = flags.get("site");
  const site = typeof siteFlag === "string" ? siteFlag : null;

  if (name === "requests") {
    if (id !== undefined)
      return { ok: false, message: "requests heeft geen argumenten." };
    if (site !== null || confirm) {
      return { ok: false, message: "requests kent alleen --env-file." };
    }
    return { ok: true, command: { kind: "requests", envFile } };
  }

  if (name === "activate" || name === "reject") {
    if (id === undefined || !UUID.test(id)) {
      return { ok: false, message: `${name} heeft een geldig aanvraag-id nodig.` };
    }
    if (name === "reject") {
      if (site !== null) return { ok: false, message: "reject kent geen --site." };
      return {
        ok: true,
        command: { kind: "reject", id: id.toLowerCase(), confirm, envFile },
      };
    }
    return {
      ok: true,
      command: { kind: "activate", id: id.toLowerCase(), site, confirm, envFile },
    };
  }

  return { ok: false, message: `Onbekend commando: ${name}` };
}

/** localhost, 127.x.x.x and ::1: a stack on this machine. */
export function isLoopbackHost(hostname: string): boolean {
  const host = hostname.toLowerCase();
  return (
    host === "localhost" ||
    host === "[::1]" ||
    host === "::1" ||
    /^127(\.\d{1,3}){3}$/.test(host)
  );
}

/** The `host[:port]` of a Supabase URL, or null when it isn't a URL. */
export function targetHost(rawUrl: string): string | null {
  try {
    return new URL(rawUrl).host.toLowerCase();
  } catch {
    return null;
  }
}

/** Anything but a loopback target needs the host typed back before it changes data. */
export function needsHostConfirmation(rawUrl: string): boolean {
  try {
    return !isLoopbackHost(new URL(rawUrl).hostname);
  } catch {
    return true;
  }
}

/** Whether what the operator typed is exactly the target's host. */
export function hostConfirmationMatches(typed: string, rawUrl: string): boolean {
  const host = targetHost(rawUrl);
  return host !== null && typed.trim().toLowerCase() === host;
}

/** Changing commands refuse without `--confirm`; returns the refusal, or null when fine. */
export function confirmRefusal(command: OpsCommand): string | null {
  if (command.kind === "requests" || command.confirm) return null;
  return "Niets gewijzigd. Voeg --confirm toe om dit echt uit te voeren.";
}
