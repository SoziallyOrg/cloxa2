/**
 * Concurrency proof for the live clock RPC and the per-org hash chains.
 * pgTAP runs in a single session, so it cannot show what happens when many
 * sessions append at once; this test does, against the local Supabase DB.
 *
 * Fixtures use random ids and are left in place: clock_events and audit_log
 * are append-only by design, and local DB state is disposable.
 */
import { execSync } from "node:child_process";
import { randomUUID } from "node:crypto";

import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const ORGS = 2;
const EMPLOYEES_PER_ORG = 2;
// 2 orgs x 2 employees x 5 attempts = 20 parallel calls per round.
const ATTEMPTS_PER_EMPLOYEE = 5;
const POOL_SIZE = ORGS * EMPLOYEES_PER_ORG * ATTEMPTS_PER_EMPLOYEE;

interface Employee {
  organizationId: string;
  siteId: string;
  userId: string;
  employeeId: string;
}

type Outcome = { ok: true; id: string } | { ok: false; code: string; message: string };

function databaseUrl(): string {
  const fromEnv = process.env.SUPABASE_DB_URL;
  if (fromEnv) return fromEnv;

  const output = execSync("supabase status -o json", {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  });
  const status = JSON.parse(output) as { DB_URL?: unknown };
  if (typeof status.DB_URL !== "string") {
    throw new Error(
      "`supabase status` reported no DB_URL. Is the local stack running?",
    );
  }
  return status.DB_URL;
}

let sql: postgres.Sql;
const organizationIds: string[] = [];
const employees: Employee[] = [];

beforeAll(async () => {
  sql = postgres(databaseUrl(), { max: POOL_SIZE, onnotice: () => undefined });

  await sql.begin(async (tx) => {
    for (let o = 0; o < ORGS; o += 1) {
      const organizationId = randomUUID();
      const siteId = randomUUID();
      organizationIds.push(organizationId);
      await tx`insert into public.organizations (id, name) values (${organizationId}, ${`Concurrency org ${o}`})`;
      await tx`insert into public.sites (id, organization_id, name) values (${siteId}, ${organizationId}, 'Site')`;

      for (let e = 0; e < EMPLOYEES_PER_ORG; e += 1) {
        const userId = randomUUID();
        const employeeId = randomUUID();
        await tx`insert into auth.users (id, email) values (${userId}, ${`concurrency-${userId}@example.test`})`;
        await tx`
          insert into public.memberships (organization_id, user_id, role, status)
          values (${organizationId}, ${userId}, 'employee', 'active')`;
        await tx`
          insert into public.employees (id, organization_id, user_id, display_name)
          values (${employeeId}, ${organizationId}, ${userId}, 'Concurrency employee')`;
        await tx`
          insert into public.site_assignments (organization_id, site_id, employee_id)
          values (${organizationId}, ${siteId}, ${employeeId})`;
        employees.push({ organizationId, siteId, userId, employeeId });
      }
    }
  });

  // Open every pooled connection up front so the calls below truly overlap
  // instead of queueing behind connection setup.
  await Promise.all(
    Array.from({ length: POOL_SIZE }, () => sql`select pg_sleep(0.05)`),
  );
});

afterAll(async () => {
  await sql.end();
});

async function clock(
  employee: Employee,
  type: string,
  idempotencyKey: string,
): Promise<Outcome> {
  try {
    const rows = await sql.begin(async (tx) => {
      const claims = JSON.stringify({
        sub: employee.userId,
        role: "authenticated",
        aal: "aal1",
      });
      await tx`select set_config('request.jwt.claims', ${claims}, true)`;
      await tx`set local role authenticated`;
      return tx<{ id: string }[]>`
        select id from public.rpc_clock(${type}, ${idempotencyKey}, ${employee.siteId})`;
    });
    const row = rows[0];
    if (!row) throw new Error("rpc_clock returned no row");
    return { ok: true, id: row.id };
  } catch (error) {
    if (error instanceof postgres.PostgresError) {
      return { ok: false, code: error.code, message: error.message };
    }
    throw error;
  }
}

function attempts<T>(make: (employee: Employee) => Promise<T>): Promise<T[][]> {
  return Promise.all(
    employees.map((employee) =>
      Promise.all(Array.from({ length: ATTEMPTS_PER_EMPLOYEE }, () => make(employee))),
    ),
  );
}

describe("live clocking under concurrency", () => {
  it("accepts exactly one clock_in per employee out of parallel attempts", async () => {
    const perEmployee = await attempts((employee) =>
      clock(employee, "clock_in", randomUUID()),
    );

    for (const outcomes of perEmployee) {
      expect(outcomes.filter((outcome) => outcome.ok)).toHaveLength(1);
      for (const outcome of outcomes) {
        if (!outcome.ok) {
          expect({ code: outcome.code, message: outcome.message }).toEqual({
            code: "P0001",
            message: "invalid_transition",
          });
        }
      }
    }
  });

  it("turns parallel retries with one idempotency key into a single clock_out", async () => {
    const keys = new Map(
      employees.map((employee) => [employee.employeeId, randomUUID()]),
    );
    const perEmployee = await attempts((employee) =>
      clock(employee, "clock_out", keys.get(employee.employeeId) ?? ""),
    );

    for (const outcomes of perEmployee) {
      const ids = new Set(
        outcomes.map((outcome) => (outcome.ok ? outcome.id : outcome.message)),
      );
      expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
      expect(ids.size).toBe(1);
    }

    const [{ count } = { count: -1 }] = await sql<{ count: number }[]>`
      select count(*)::int as count from public.clock_events
      where idempotency_key = any(${[...keys.values()]}::uuid[])`;
    expect(count).toBe(employees.length);
  });

  it("keeps each organization chain linear and verifiable", async () => {
    for (const organizationId of organizationIds) {
      const [stats] = await sql<
        {
          events: number;
          links: number;
          audit_rows: number;
          audit_links: number;
          clock_broken: string | null;
          audit_broken: string | null;
          clock_head_length: number;
          audit_head_length: number;
        }[]
      >`
        select
          (select count(*)::int from public.clock_events where organization_id = ${organizationId}) as events,
          (select count(distinct prev_hash)::int from public.clock_events where organization_id = ${organizationId}) as links,
          (select count(*)::int from public.audit_log where organization_id = ${organizationId}) as audit_rows,
          (select count(distinct prev_hash)::int from public.audit_log where organization_id = ${organizationId}) as audit_links,
          private.verify_clock_chain(${organizationId}) as clock_broken,
          private.verify_audit_chain(${organizationId}) as audit_broken,
          (select length::int from private.hash_chain_heads
            where organization_id = ${organizationId} and chain = 'clock_events') as clock_head_length,
          (select length::int from private.hash_chain_heads
            where organization_id = ${organizationId} and chain = 'audit_log') as audit_head_length`;

      // One clock_in and one clock_out per employee, each with one audit row.
      expect(stats).toEqual({
        events: EMPLOYEES_PER_ORG * 2,
        links: EMPLOYEES_PER_ORG * 2,
        audit_rows: EMPLOYEES_PER_ORG * 2,
        audit_links: EMPLOYEES_PER_ORG * 2,
        clock_broken: null,
        audit_broken: null,
        clock_head_length: EMPLOYEES_PER_ORG * 2,
        audit_head_length: EMPLOYEES_PER_ORG * 2,
      });
    }
  });
});
