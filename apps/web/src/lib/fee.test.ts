import { describe, expect, it } from "vitest";
import { euros, feeSchema, fromCents, toCents } from "./fee";

describe("a fee", () => {
  it("is typed in euros, with a comma or a point, or left empty for a free consultation", () => {
    expect(toCents("40")).toBe(4000);
    expect(toCents("40,50")).toBe(4050);
    expect(toCents(" 0.5 ")).toBe(50);
    expect(toCents("")).toBeNull();
    expect(fromCents(4050)).toBe("40.50");
    expect(fromCents(null)).toBe("");
    expect(euros(4000)).toBe("€40.00");
  });

  it("must be between 0.50 and 1000 euros", () => {
    for (const ok of ["", "40", "40.00", "0,50", "1000"]) expect(feeSchema.safeParse(ok).success).toBe(true);
    for (const bad of ["0.49", "1000.01", "forty", "40.123", "-5"]) expect(feeSchema.safeParse(bad).success).toBe(false);
  });

  it("of 0 is a free consultation: no payment at all (owner, 24 Oct)", () => {
    for (const free of ["0", "0.00", "0,0", " 0 "]) {
      expect(feeSchema.safeParse(free).success).toBe(true);
      expect(toCents(free)).toBeNull();
    }
  });
});
