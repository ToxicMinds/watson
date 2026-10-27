import { describe, expect, it } from "vitest";
import { otpCodeHash, otpContactHash, otpIpHash, randomOtpCode } from "../../../supabase/functions/_shared/patient-otp.ts";

const PEPPER = "test-only-pepper-0123456789-abcdef";

describe("server OTP primitives", () => {
  it("normalizes email contact hashes without storing or returning contact text", async () => {
    const first = await otpContactHash(PEPPER, " Patient@Example.test ");
    const normalized = await otpContactHash(PEPPER, "patient@example.test");
    expect(first).toBe(normalized);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(first).not.toContain("patient");
  });

  it("domain-separates contact, code, and IP hashes", async () => {
    const contact = await otpContactHash(PEPPER, "patient@example.test");
    const code = await otpCodeHash(PEPPER, contact, "00004218");
    const ip = await otpIpHash(PEPPER, "203.0.113.12");
    expect(code).toMatch(/^[0-9a-f]{64}$/);
    expect(ip).toMatch(/^[0-9a-f]{64}$/);
    expect(code).not.toBe(contact);
    expect(ip).not.toBe(contact);
    expect(ip).not.toBe(code);
    expect(await otpCodeHash(PEPPER, contact, "00004219")).not.toBe(code);
  });

  it("generates exactly eight decimal digits, including leading zeroes", () => {
    for (let i = 0; i < 100; i++) expect(randomOtpCode()).toMatch(/^\d{8}$/);
  });

  it("rejects missing or weak HMAC secrets", async () => {
    await expect(otpContactHash("", "patient@example.test")).rejects.toThrow();
    await expect(otpContactHash("short", "patient@example.test")).rejects.toThrow();
  });
});
