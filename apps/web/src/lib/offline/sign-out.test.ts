import { describe, expect, it } from "vitest";

import { signOutDecision } from "./sign-out";

describe("signOutDecision", () => {
  it("signs out straight away when nothing is queued", () => {
    expect(signOutDecision(0, false)).toBe("sign_out");
  });

  it("warns first when actions are still queued", () => {
    expect(signOutDecision(2, false)).toBe("warn");
  });

  it("signs out after the warning was confirmed", () => {
    expect(signOutDecision(2, true)).toBe("sign_out");
  });
});
