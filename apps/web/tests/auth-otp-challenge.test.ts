import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import { adminClient, browserClient, localStack } from "./local-stack";

const stack = localStack();
type Result = { ok: boolean; error_category?: string };

function hash(seed: string): string {
  return createHash("sha256").update(seed).digest("hex");
}

async function call(name: string, args: Record<string, string>): Promise<Result> {
  const { data, error } = await adminClient(stack).rpc(name as never, args as never);
  expect(error).toBeNull();
  return data as unknown as Result;
}

describe("server-enforced patient OTP challenge", () => {
  it("does not expose challenge RPCs to anonymous clients", async () => {
    const anonymous = browserClient(stack);
    const { error } = await anonymous.rpc("issue_patient_otp_challenge" as never, {
      p_contact_hash: hash("contact"), p_code_hash: hash("code"), p_ip_hash: hash("ip"),
    } as never);
    expect(error).not.toBeNull();
  });

  it("limits each contact to five guesses and locks the challenge after the fifth failure", async () => {
    const contact = hash(`contact-${crypto.randomUUID()}`);
    const ip = hash(`ip-${crypto.randomUUID()}`);
    const correct = hash(`otp-${crypto.randomUUID()}`);
    const issued = await call("issue_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: correct, p_ip_hash: ip,
    });
    expect(issued).toEqual({ ok: true });

    for (let attempt = 0; attempt < 4; attempt++) {
      await expect(call("verify_patient_otp_challenge", {
        p_contact_hash: contact, p_code_hash: hash(`wrong-${attempt}-${crypto.randomUUID()}`), p_ip_hash: ip,
      })).resolves.toMatchObject({ ok: false, error_category: "INVALID_CODE" });
    }

    await expect(call("verify_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: hash("wrong-fifth"), p_ip_hash: ip,
    })).resolves.toMatchObject({ ok: false, error_category: "LOCKED" });
    await expect(call("verify_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: correct, p_ip_hash: ip,
    })).resolves.toMatchObject({ ok: false, error_category: "LOCKED" });
    await expect(call("issue_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: hash("replacement"), p_ip_hash: ip,
    })).resolves.toMatchObject({ ok: false, error_category: "LOCKED" });
  });

  it("enforces resend cooldown and consumes a correct challenge only once", async () => {
    const contact = hash(`contact-${crypto.randomUUID()}`);
    const ip = hash(`ip-${crypto.randomUUID()}`);
    const code = hash(`otp-${crypto.randomUUID()}`);
    expect(await call("issue_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: code, p_ip_hash: ip,
    })).toEqual({ ok: true });
    await expect(call("issue_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: hash("replacement"), p_ip_hash: ip,
    })).resolves.toMatchObject({ ok: false, error_category: "RATE_LIMITED" });

    expect(await call("verify_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: code, p_ip_hash: ip,
    })).toEqual({ ok: true });
    await expect(call("verify_patient_otp_challenge", {
      p_contact_hash: contact, p_code_hash: code, p_ip_hash: ip,
    })).resolves.toMatchObject({ ok: false, error_category: "INVALID_CODE" });
  });
});
