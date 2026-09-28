import { describe, expect, it } from "vitest";

import {
  auditKeysetFilter,
  decodeAuditCursor,
  encodeAuditCursor,
  paginateAuditKeyset,
} from "./pagination";

const ID_A = "11111111-1111-1111-1111-111111111111";
const ID_B = "22222222-2222-2222-2222-222222222222";

describe("encodeAuditCursor / decodeAuditCursor", () => {
  it("round-trips", () => {
    const cursor = { createdAt: "2026-09-28T10:00:00.000Z", id: ID_A };
    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  });

  it("returns null for missing, empty or garbage input", () => {
    expect(decodeAuditCursor(null)).toBeNull();
    expect(decodeAuditCursor(undefined)).toBeNull();
    expect(decodeAuditCursor("")).toBeNull();
    expect(decodeAuditCursor("not-base64url-!!!")).toBeNull();
  });

  it("returns null when the decoded id isn't a uuid", () => {
    const bogus = Buffer.from("2026-09-28T10:00:00.000Z|not-a-uuid", "utf8").toString(
      "base64url",
    );
    expect(decodeAuditCursor(bogus)).toBeNull();
  });

  it("keeps the PostgREST timestamp verbatim", () => {
    const cursor = { createdAt: "2026-09-28T10:00:00.123456+00:00", id: ID_A };
    expect(decodeAuditCursor(encodeAuditCursor(cursor))).toEqual(cursor);
  });

  it("returns null for a date that parses but could inject into the filter", () => {
    for (const createdAt of [
      "2026-09-28 (x,y)",
      "2026-09-28T10:00:00Z,id.gt.0",
      "2026-09-28T10:00:00+02:00",
      "2026-09-28",
    ]) {
      const bogus = Buffer.from(`${createdAt}|${ID_A}`, "utf8").toString("base64url");
      expect(decodeAuditCursor(bogus)).toBeNull();
    }
  });

  it("returns null when the decoded date doesn't parse", () => {
    const bogus = Buffer.from(`not-a-date|${ID_A}`, "utf8").toString("base64url");
    expect(decodeAuditCursor(bogus)).toBeNull();
  });
});

describe("auditKeysetFilter", () => {
  it("builds a strictly-before filter for created_at desc, id desc", () => {
    expect(auditKeysetFilter({ createdAt: "2026-09-28T10:00:00.000Z", id: ID_A })).toBe(
      "created_at.lt.2026-09-28T10:00:00.000Z," +
        `and(created_at.eq.2026-09-28T10:00:00.000Z,id.lt.${ID_A})`,
    );
  });
});

describe("paginateAuditKeyset", () => {
  const row = (createdAt: string, id: string) => ({ createdAt, id });

  it("has no next page when fewer rows than the limit come back", () => {
    const rows = [row("2026-09-28T10:00:00.000Z", ID_A)];
    const page = paginateAuditKeyset(rows, 50);
    expect(page.items).toHaveLength(1);
    expect(page.nextCursor).toBeNull();
  });

  it("drops the extra row and returns a cursor for it when there's a next page", () => {
    const rows = [
      row("2026-09-28T10:02:00.000Z", ID_B),
      row("2026-09-28T10:01:00.000Z", ID_A),
    ];
    const page = paginateAuditKeyset(rows, 1);
    expect(page.items).toEqual([rows[0]]);
    expect(page.nextCursor).toBe(
      encodeAuditCursor({ createdAt: "2026-09-28T10:02:00.000Z", id: ID_B }),
    );
  });

  it("has no next page when the fetch exactly fills the limit", () => {
    const rows = [row("2026-09-28T10:00:00.000Z", ID_A)];
    const page = paginateAuditKeyset(rows, 1);
    expect(page.nextCursor).toBeNull();
  });
});
