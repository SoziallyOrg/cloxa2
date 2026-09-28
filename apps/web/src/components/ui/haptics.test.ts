import { afterEach, describe, expect, it, vi } from "vitest";

import { error, tap } from "./haptics";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("haptics", () => {
  it("vibrates briefly on tap and twice on error", () => {
    const vibrate = vi.fn(() => true);
    vi.stubGlobal("navigator", { vibrate });

    expect(tap()).toBe(true);
    expect(error()).toBe(true);
    expect(vibrate).toHaveBeenNthCalledWith(1, 10);
    expect(vibrate).toHaveBeenNthCalledWith(2, [20, 60, 20]);
  });

  it("is a no-op without navigator.vibrate (iOS Safari, desktop)", () => {
    vi.stubGlobal("navigator", {});
    expect(tap()).toBe(false);
    expect(error()).toBe(false);
  });

  it("is a no-op on the server and when the browser refuses", () => {
    vi.stubGlobal("navigator", undefined);
    expect(tap()).toBe(false);

    vi.stubGlobal("navigator", {
      vibrate: () => {
        throw new Error("blocked");
      },
    });
    expect(error()).toBe(false);
  });
});
