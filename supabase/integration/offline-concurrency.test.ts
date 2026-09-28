/**
 * Concurrency proof for offline sync (rpc_clock_offline) against correction
 * approval of the same employee. Both take the per-employee lock (1003)
 * first, then the clock chain (1002) and the audit chain (1001), so they
 * serialize without deadlocks and each re-validates against the other.
 *
 * The race used: the employee is clocked in and has a pending request to
 * remove that clock_in, and syncs an offline clock_out captured after it.
 * - Sync first: the clock_out is recorded; approval then fails
 *   (invalid_sequence, a clock_out while off).
 * - Approval first: the clock_in is voided; the sync then turns the clock_out
 *   into a correction request (invalid_transition), never a recorded event.
 *
 * Fixtures use random ids and are left in place (append-only tables; local DB
 * state is disposable).
 */
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { databaseUrl } from "./database-url";

const EMPLOYEES = 8;
const ROUNDS = 3;
const POOL_SIZE = EMPLOYEES * 2 + 2;

interface Employee {
  userId: string;
  employeeId: string;
}

type Failure = { ok: false; code: string; message: string };

let sql: postgres.Sql;
const organizationId = randomUUID();
const siteId = randomUUID();
const ownerId = randomUUID();
const employees: Employee[] = [];

function employeeClaims(userId: string): string {
  return JSON.stringify({ sub: userId, role: "authenticated", aal: "aal1" });
}

function ownerClaims(): string {
  return JSON.stringify({
    sub: ownerId,
    role: "authenticated",
    aal: "aal2",
    amr: [{ method: "totp", timestamp: Math.floor(Date.now() / 1000) }],
  });
}

async function attempt<T>(
  claims: string,
  run: (tx: postgres.TransactionSql) => Promise<T[]>,
): Promise<{ ok: true; row: T } | Failure> {
  try {
    const rows: T[] = [];
    await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      await tx`set local role authenticated`;
      rows.push(...(await run(tx)));
    });
    const row = rows[0];
    if (!row) throw new Error("RPC returned no row");
    return { ok: true, row };
  } catch (error) {
    if (error instanceof postgres.PostgresError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

async function clockedInWithPendingRemoval(employee: Employee): Promise<string> {
  const clockIn = await attempt<{ id: string }>(
    employeeClaims(employee.userId),
    (tx) => tx`select id from public.rpc_clock('clock_in', ${randomUUID()}, ${siteId})`,
  );
  if (!clockIn.ok) throw new Error(`clock_in failed: ${clockIn.message}`);
  const request = await attempt<{ id: string }>(
    employeeClaims(employee.userId),
    (tx) => tx`
      select id from public.rpc_request_correction(
        'remove', ${[clockIn.row.id]}::uuid[], '{}'::jsonb, 'Per ongeluk ingeklokt')`,
  );
  if (!request.ok) throw new Error(`request failed: ${request.message}`);
  return request.row.id;
}

function approve(requestId: string) {
  return attempt<{ id: string }>(
    ownerClaims(),
    (tx) => tx`select id from public.rpc_decide_correction(${requestId}, 'approved')`,
  );
}

function syncClockOut(employee: Employee) {
  const capturedAt = new Date().toISOString();
  return attempt<{ outcome: string; reason: string | null }>(
    employeeClaims(employee.userId),
    (tx) => tx`
      select outcome, reason from public.rpc_clock_offline(
        'clock_out', ${randomUUID()}, ${siteId}, ${capturedAt}::timestamptz)`,
  );
}

const NEXT_STATE: Record<string, Record<string, string>> = {
  off: { clock_in: "working" },
  working: { clock_out: "off", break_start: "on_break" },
  on_break: { break_end: "working" },
};

async function effectiveSequenceProblems(employee: Employee): Promise<string[]> {
  const events = await sql<{ type: string }[]>`
    select event.type
    from public.clock_events as event
    where event.employee_id = ${employee.employeeId}
      and event.type <> 'void'
      and not exists (
        select 1 from public.clock_events as superseding
        where superseding.supersedes_event_id = event.id
      )
    order by event.occurred_at, event.server_at, event.id`;

  const problems: string[] = [];
  let state = "off";
  for (const { type } of events) {
    const next = NEXT_STATE[state]?.[type];
    if (next === undefined) {
      problems.push(`${type} while ${state}`);
      continue;
    }
    state = next;
  }
  if (state !== "off") problems.push(`ends ${state}`);
  return problems;
}

beforeAll(async () => {
  sql = postgres(databaseUrl(), { max: POOL_SIZE, onnotice: () => undefined });

  await sql.begin(async (tx) => {
    await tx`insert into public.organizations (id, name) values (${organizationId}, 'Offline concurrency org')`;
    await tx`insert into public.sites (id, organization_id, name) values (${siteId}, ${organizationId}, 'Site')`;
    await tx`insert into auth.users (id, email) values (${ownerId}, ${`offline-owner-${ownerId}@example.test`})`;
    await tx`
      insert into public.memberships (organization_id, user_id, role, status)
      values (${organizationId}, ${ownerId}, 'owner', 'active')`;

    for (let e = 0; e < EMPLOYEES; e += 1) {
      const userId = randomUUID();
      const employeeId = randomUUID();
      await tx`insert into auth.users (id, email) values (${userId}, ${`offline-${userId}@example.test`})`;
      await tx`
        insert into public.memberships (organization_id, user_id, role, status)
        values (${organizationId}, ${userId}, 'employee', 'active')`;
      await tx`
        insert into public.employees (id, organization_id, user_id, display_name)
        values (${employeeId}, ${organizationId}, ${userId}, 'Offline concurrency employee')`;
      await tx`
        insert into public.site_assignments (organization_id, site_id, employee_id)
        values (${organizationId}, ${siteId}, ${employeeId})`;
      employees.push({ userId, employeeId });
    }
  });

  await Promise.all(
    Array.from({ length: POOL_SIZE }, () => sql`select pg_sleep(0.05)`),
  );
});

afterAll(async () => {
  await sql.end();
});

describe("offline sync vs correction approval", () => {
  it("serializes without deadlocks and keeps a valid sequence, round after round", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const requests = await Promise.all(employees.map(clockedInWithPendingRemoval));

      const outcomes = await Promise.all(
        employees.map((employee, index) =>
          Promise.all([approve(requests[index] ?? ""), syncClockOut(employee)]),
        ),
      );

      for (const [approval, sync] of outcomes) {
        // The sync never errors: it records or asks the manager.
        expect(sync.ok).toBe(true);
        if (!sync.ok) continue;
        if (approval.ok) {
          expect(sync.row).toEqual({
            outcome: "correction_requested",
            reason: "invalid_transition",
          });
        } else {
          expect({ code: approval.code, message: approval.message }).toEqual({
            code: "P0001",
            message: "invalid_sequence",
          });
          expect(sync.row).toEqual({ outcome: "recorded", reason: null });
        }
      }
    }

    for (const employee of employees) {
      expect(await effectiveSequenceProblems(employee)).toEqual([]);
    }
  });

  it("keeps both chains verifiable", async () => {
    const [row] = await sql<{ clock: string | null; audit: string | null }[]>`
      select private.verify_clock_chain(${organizationId}) as clock,
             private.verify_audit_chain(${organizationId}) as audit`;
    expect(row).toEqual({ clock: null, audit: null });
  });
});
