import { describe, expect, it } from "vitest";

import { initials, shortDisplayName } from "./account-name";

describe("account names", () => {
  it("shortens to the first name and the last initial", () => {
    expect(shortDisplayName("Jan Janssens")).toBe("Jan J.");
    expect(shortDisplayName("Maximiliaan Van den Broeck-Vercruysse")).toBe(
      "Maximiliaan B.",
    );
    expect(shortDisplayName("  Cher ")).toBe("Cher");
  });

  it("takes the first and last initial for the avatar", () => {
    expect(initials("Sanne Peeters")).toBe("SP");
    expect(initials("els")).toBe("E");
  });
});
