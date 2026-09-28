/**
 * Concurrency proof for the kiosk limits and lock order (ADR 005). pgTAP runs
 * in one session; here many sessions hit one device at once.
 *
 * Fixtures use random ids and are left in place (audit rows are append-only;
 * local DB state is disposable).
 */
import { randomBytes, randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { databaseUrl } from "./database-url";

const PARALLEL = 10;
const ROUNDS = 8;
const PIN = "2580";
const WRONG_PIN = "1397";

let sql: postgres.Sql;
let organizationId: string;
let siteId: string;
let employeeId: string;
let adminUserId: string;

type Outcome =
  | { ok: true; row: Record<string, unknown> }
  | { ok: false; code: string; message: string };

async function run(
  role: "anon" | "authenticated",
  claims: object,
  query: (tx: postgres.TransactionSql) => Promise<postgres.RowList<postgres.Row[]>>,
): Promise<Outcome> {
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${JSON.stringify(claims)}, true)`;
      await tx.unsafe(`set local role ${role}`);
      return query(tx);
    });
    return { ok: true, row: rows[0] ?? {} };
  } catch (error) {
    if (error instanceof postgres.PostgresError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

const anon = (
  query: (tx: postgres.TransactionSql) => Promise<postgres.RowList<postgres.Row[]>>,
) => run("anon", { role: "anon" }, query);

function admin(
  query: (tx: postgres.TransactionSql) => Promise<postgres.RowList<postgres.Row[]>>,
) {
  const now = Math.floor(Date.now() / 1000);
  return run(
    "authenticated",
    {
      sub: adminUserId,
      role: "authenticated",
      aal: "aal2",
      amr: [{ method: "totp", timestamp: now }],
    },
    query,
  );
}

/** A paired device with a known secret, on the fixture site. */
async function newDevice(): Promise<{ id: string; secret: string }> {
  const id = randomUUID();
  const secret = randomBytes(32).toString("hex");
  await sql`
    insert into public.kiosk_devices (id, organization_id, site_id, name, created_by, secret_hash)
    values (${id}, ${organizationId}, ${siteId}, 'Concurrency kiosk', ${adminUserId},
      extensions.digest(decode(${secret}, 'hex'), 'sha256'))`;
  return { id, secret };
}

beforeAll(async () => {
  sql = postgres(databaseUrl(), { max: PARALLEL + 2, onnotice: () => undefined });
  organizationId = randomUUID();
  siteId = randomUUID();
  employeeId = randomUUID();
  adminUserId = randomUUID();

  await sql.begin(async (tx) => {
    await tx`insert into public.organizations (id, name) values (${organizationId}, 'Kiosk concurrency org')`;
    await tx`insert into public.sites (id, organization_id, name) values (${siteId}, ${organizationId}, 'Site')`;
    await tx`insert into auth.users (id, email) values (${adminUserId}, ${`kiosk-${adminUserId}@example.test`})`;
    await tx`
      insert into public.memberships (organization_id, user_id, role, status)
      values (${organizationId}, ${adminUserId}, 'admin', 'active')`;
    await tx`
      insert into public.employees (id, organization_id, display_name)
      values (${employeeId}, ${organizationId}, 'Kiosk-only employee')`;
    await tx`
      insert into public.site_assignments (organization_id, site_id, employee_id)
      values (${organizationId}, ${siteId}, ${employeeId})`;
    await tx`
      insert into public.employee_pins (employee_id, organization_id, pin_hash, set_by)
      values (${employeeId}, ${organizationId}, extensions.crypt(${PIN}, extensions.gen_salt('bf', 10)), ${adminUserId})`;
  });

  // Open every pooled connection up front so the calls below truly overlap.
  await Promise.all(
    Array.from({ length: PARALLEL + 2 }, () => sql`select pg_sleep(0.05)`),
  );
});

afterAll(async () => {
  await sql.end();
});

describe("kiosk PIN checks under concurrency", () => {
  it("records exactly 5 failures out of parallel wrong PINs, then locks", async () => {
    const device = await newDevice();

    const outcomes = await Promise.all(
      Array.from({ length: PARALLEL }, () =>
        anon(
          (tx) => tx`
            select error_code, tries_left
            from public.rpc_kiosk_status(${device.secret}, ${employeeId}, ${WRONG_PIN})`,
        ),
      ),
    );

    const codes = outcomes.map((outcome) =>
      outcome.ok ? outcome.row.error_code : outcome.code,
    );
    expect(codes.filter((code) => code === "pin_invalid")).toHaveLength(4);
    expect(codes.filter((code) => code === "pin_locked")).toHaveLength(PARALLEL - 4);
    const triesLeft = outcomes
      .map((outcome) => (outcome.ok ? outcome.row.tries_left : null))
      .filter((value) => value !== null)
      .sort();
    expect(triesLeft).toEqual([1, 2, 3, 4]);

    const [attempts] = await sql<{ count: number }[]>`
      select count(*)::int as count from private.kiosk_attempts
      where device_id = ${device.id} and employee_id = ${employeeId}`;
    expect(attempts?.count).toBe(5);

    const after = await anon(
      (tx) => tx`
        select error_code from public.rpc_kiosk_status(${device.secret}, ${employeeId}, ${PIN})`,
    );
    expect(after).toMatchObject({ ok: true, row: { error_code: "pin_locked" } });
  });

  it("never deadlocks: the 30th failure, a revoke and a pairing race", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const device = await newDevice();
      await sql`
        insert into private.kiosk_attempts (kind, device_id, employee_id)
        select 'pin_failure', ${device.id}, gen_random_uuid() from generate_series(1, 29)`;
      const [issued] = await sql<{ code: string }[]>`
        select o_code as code from private.kiosk_issue_code(${organizationId}, ${device.id})`;

      const outcomes = await Promise.all([
        anon(
          (tx) => tx`
            select error_code from public.rpc_kiosk_clock(
              ${device.secret}, ${employeeId}, ${WRONG_PIN}, 'clock_in', ${randomUUID()})`,
        ),
        admin((tx) => tx`select public.rpc_kiosk_revoke(${device.id})`),
        anon(
          (tx) =>
            tx`select ok, error_code from public.rpc_kiosk_pair(${issued?.code ?? ""})`,
        ),
        admin(
          (tx) =>
            tx`select pairing_code from public.rpc_kiosk_new_pairing_code(${device.id})`,
        ),
      ]);

      for (const [index, outcome] of outcomes.entries()) {
        // A new code after the revoke is refused on purpose; anything else,
        // above all a deadlock (40P01), is a failure.
        if (!outcome.ok && index === 3 && outcome.message === "device_revoked")
          continue;
        expect(outcome, `round ${round}, call ${index}`).toMatchObject({ ok: true });
      }

      const [state] = await sql<{ status: string }[]>`
        select status from public.kiosk_devices where id = ${device.id}`;
      expect(state?.status).toBe("revoked");
    }
  });
});
