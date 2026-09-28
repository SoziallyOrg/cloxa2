import { describe, expect, it } from "vitest";

import { countsAsActivity } from "./request-kind";

const h = (entries: Record<string, string>) => new Headers(entries);
const navigation = { "sec-fetch-dest": "document", accept: "text/html" };

describe("countsAsActivity", () => {
  it("counts document navigations and server-action POSTs", () => {
    expect(countsAsActivity("GET", h(navigation))).toBe(true);
    expect(countsAsActivity("GET", h({ accept: "text/html,*/*" }))).toBe(true);
    expect(countsAsActivity("POST", h({ "next-action": "abc123" }))).toBe(true);
  });

  it("ignores every kind of prefetch", () => {
    expect(
      countsAsActivity("GET", h({ ...navigation, "next-router-prefetch": "1" })),
    ).toBe(false);
    expect(
      countsAsActivity("GET", h({ ...navigation, "sec-purpose": "prefetch" })),
    ).toBe(false);
    expect(
      countsAsActivity(
        "GET",
        h({ ...navigation, "sec-purpose": "prefetch;prerender" }),
      ),
    ).toBe(false);
    expect(countsAsActivity("GET", h({ ...navigation, purpose: "prefetch" }))).toBe(
      false,
    );
    expect(
      countsAsActivity(
        "POST",
        h({ "next-action": "abc", "next-router-prefetch": "1" }),
      ),
    ).toBe(false);
  });

  it("ignores RSC fetches, subresources and other methods", () => {
    expect(countsAsActivity("GET", h({ rsc: "1", "sec-fetch-dest": "empty" }))).toBe(
      false,
    );
    expect(countsAsActivity("GET", h({ rsc: "1" }))).toBe(false);
    expect(countsAsActivity("GET", h({ "sec-fetch-dest": "image" }))).toBe(false);
    expect(countsAsActivity("POST", h({}))).toBe(false);
    expect(countsAsActivity("HEAD", h(navigation))).toBe(false);
  });
});
