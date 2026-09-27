/**
 * Concurrency proof for correction approval against live clocking of the same
 * employee. Both take the per-employee lock (1003) first, so one waits for the
 * other and re-validates against its result: the effective sequence stays
 * valid and both hash chains stay linear.
 *
 * The race used: the employee is clocked in and has a pending request to
 * remove that clock_in. Approving it and clocking out live are each valid on
 * their own, but not together. Exactly one of them must win.
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

type Outcome = { ok: true; id: string } | { ok: false; code: string; message: string };

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

async function attempt(
  claims: string,
  run: (tx: postgres.TransactionSql) => Promise<{ id: string }[]>,
): Promise<Outcome> {
  try {
    const rows = await sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      await tx`set local role authenticated`;
      return run(tx);
    });
    const row = rows[0];
    if (!row) throw new Error("RPC returned no row");
    return { ok: true, id: row.id };
  } catch (error) {
    if (error instanceof postgres.PostgresError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

function clock(employee: Employee, type: string): Promise<Outcome> {
  return attempt(
    employeeClaims(employee.userId),
    (tx) => tx`select id from public.rpc_clock(${type}, ${randomUUID()}, ${siteId})`,
  );
}

async function requestRemoval(employee: Employee, eventId: string): Promise<string> {
  const outcome = await attempt(
    employeeClaims(employee.userId),
    (tx) => tx`
      select id from public.rpc_request_correction(
        'remove', ${[eventId]}::uuid[], '{}'::jsonb, 'Per ongeluk ingeklokt')`,
  );
  if (!outcome.ok) throw new Error(`request failed: ${outcome.message}`);
  return outcome.id;
}

function approve(requestId: string): Promise<Outcome> {
  return attempt(
    ownerClaims(),
    (tx) => tx`select id from public.rpc_decide_correction(${requestId}, 'approved')`,
  );
}

async function clockedInWithPendingRemoval(employee: Employee): Promise<string> {
  const clockIn = await clock(employee, "clock_in");
  if (!clockIn.ok) throw new Error(`clock_in failed: ${clockIn.message}`);
  return requestRemoval(employee, clockIn.id);
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
    await tx`insert into public.organizations (id, name) values (${organizationId}, 'Correction concurrency org')`;
    await tx`insert into public.sites (id, organization_id, name) values (${siteId}, ${organizationId}, 'Site')`;
    await tx`insert into auth.users (id, email) values (${ownerId}, ${`correction-owner-${ownerId}@example.test`})`;
    await tx`
      insert into public.memberships (organization_id, user_id, role, status)
      values (${organizationId}, ${ownerId}, 'owner', 'active')`;

    for (let e = 0; e < EMPLOYEES; e += 1) {
      const userId = randomUUID();
      const employeeId = randomUUID();
      await tx`insert into auth.users (id, email) values (${userId}, ${`correction-${userId}@example.test`})`;
      await tx`
        insert into public.memberships (organization_id, user_id, role, status)
        values (${organizationId}, ${userId}, 'employee', 'active')`;
      await tx`
        insert into public.employees (id, organization_id, user_id, display_name)
        values (${employeeId}, ${organizationId}, ${userId}, 'Correction concurrency employee')`;
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

describe("correction approval vs live clocking", () => {
  it("makes live clocking wait for an uncommitted approval, then re-validate", async () => {
    const [employee] = employees;
    if (!employee) throw new Error("no employee fixture");
    const requestId = await clockedInWithPendingRemoval(employee);

    let releaseApproval: () => void = () => undefined;
    const approvalHeld = new Promise<void>((resolve) => {
      releaseApproval = resolve;
    });
    let approvalDone: () => void = () => undefined;
    const approvalApplied = new Promise<void>((resolve) => {
      approvalDone = resolve;
    });

    // Approve, then hold the transaction (and its locks) open.
    const approval = sql.begin(async (tx) => {
      await tx`select set_config('request.jwt.claims', ${ownerClaims()}, true)`;
      await tx`set local role authenticated`;
      await tx`select id from public.rpc_decide_correction(${requestId}, 'approved')`;
      approvalDone();
      await approvalHeld;
    });
    await approvalApplied;

    let clockSettled = false;
    const clockOut = clock(employee, "clock_out").finally(() => {
      clockSettled = true;
    });

    // Wait until the live call is queued on the employee lock (1003).
    let waiting = 0;
    for (let i = 0; i < 50 && waiting === 0; i += 1) {
      const [row] = await sql<{ waiting: number }[]>`
        select count(*)::int as waiting from pg_locks
        where locktype = 'advisory' and classid = 1003 and not granted`;
      waiting = row?.waiting ?? 0;
      if (waiting === 0) await new Promise((resolve) => setTimeout(resolve, 50));
    }
    expect(waiting).toBeGreaterThan(0);
    expect(clockSettled).toBe(false);

    releaseApproval();
    await approval;

    // The clock_in it relied on is now voided: the employee is off.
    expect(await clockOut).toEqual({
      ok: false,
      code: "P0001",
      message: "invalid_transition",
    });
    expect(await effectiveSequenceProblems(employee)).toEqual([]);
  });

  it("lets exactly one of approval and live clock_out win, round after round", async () => {
    for (let round = 0; round < ROUNDS; round += 1) {
      const requests = await Promise.all(employees.map(clockedInWithPendingRemoval));

      const outcomes = await Promise.all(
        employees.map((employee, index) =>
          Promise.all([approve(requests[index] ?? ""), clock(employee, "clock_out")]),
        ),
      );

      for (const [approval, clockOut] of outcomes) {
        expect([approval.ok, clockOut.ok].filter(Boolean)).toHaveLength(1);
        if (!approval.ok) {
          expect({ code: approval.code, message: approval.message }).toEqual({
            code: "P0001",
            message: "invalid_sequence",
          });
        }
        if (!clockOut.ok) {
          expect({ code: clockOut.code, message: clockOut.message }).toEqual({
            code: "P0001",
            message: "invalid_transition",
          });
        }
      }
    }

    for (const employee of employees) {
      expect(await effectiveSequenceProblems(employee)).toEqual([]);
    }
  });

  it("keeps both chains linear and verifiable", async () => {
    const [stats] = await sql<
      {
        events: number;
        links: number;
        audit_rows: number;
        audit_links: number;
        clock_broken: string | null;
        audit_broken: string | null;
        unaudited_events: number;
      }[]
    >`
      select
        (select count(*)::int from public.clock_events where organization_id = ${organizationId}) as events,
        (select count(distinct prev_hash)::int from public.clock_events where organization_id = ${organizationId}) as links,
        (select count(*)::int from public.audit_log where organization_id = ${organizationId}) as audit_rows,
        (select count(distinct prev_hash)::int from public.audit_log where organization_id = ${organizationId}) as audit_links,
        private.verify_clock_chain(${organizationId}) as clock_broken,
        private.verify_audit_chain(${organizationId}) as audit_broken,
        (select count(*)::int from public.clock_events as event
          where event.organization_id = ${organizationId}
            and not exists (
              select 1 from public.audit_log as log
              where log.entity = 'clock_event' and log.entity_id = event.id)) as unaudited_events`;

    expect(stats?.events).toBeGreaterThan(0);
    expect(stats).toEqual({
      events: stats?.events,
      links: stats?.events,
      audit_rows: stats?.audit_rows,
      audit_links: stats?.audit_rows,
      clock_broken: null,
      audit_broken: null,
      unaudited_events: 0,
    });
  });
});
