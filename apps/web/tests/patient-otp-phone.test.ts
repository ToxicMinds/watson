// Sign-in codes by WhatsApp (owner, 28 Oct: "through my number"): the patient types the number they
// gave their practitioner, written any usual way; Watson reads it as the database does (normal_phone),
// and the Auth account behind a WhatsApp sign-in has an address nobody can receive mail at.
import { describe, expect, it } from "vitest";
import {
  otpContactHash, phoneSignInEmail, normalizePatientPhone, whatsappCodeMessage,
} from "../../../supabase/functions/_shared/patient-otp.ts";

const PEPPER = "test-only-pepper-0123456789-abcdef";

describe("a patient's WhatsApp number", () => {
  it("is read the way the database reads it, with its country code", () => {
    expect(normalizePatientPhone("+421 905 111 222")).toBe("+421905111222");
    expect(normalizePatientPhone("00421 905-111-222")).toBe("+421905111222");
    expect(normalizePatientPhone("(+421) 905 111 222")).toBe("+421905111222");
  });

  it("is refused without a country code or with too few or too many digits", () => {
    for (const typed of ["0905 111 222", "+0905111222", "+12345", "+4219051112223334", "", "jana@example.com"]) {
      expect(normalizePatientPhone(typed), typed).toBeNull();
    }
  });

  it("hashes like any contact, apart from the same number written as an email would be", async () => {
    expect(await otpContactHash(PEPPER, "+421905111222")).toBe(await otpContactHash(PEPPER, "+421905111222"));
    expect(await otpContactHash(PEPPER, "+421905111222")).not.toBe(await otpContactHash(PEPPER, "+421905111223"));
  });

  it("signs in to an account whose email address no mail can reach", () => {
    expect(phoneSignInEmail("+421905111222")).toBe("whatsapp-421905111222@patients.watson.invalid");
  });

  it("gets its code in a message that says what it is and that it expires", () => {
    const message = whatsappCodeMessage("01234567");
    expect(message).toContain("01234567");
    expect(message).toContain("10 minutes");
    expect(message).toMatch(/never share/i);
  });
});
