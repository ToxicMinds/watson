import { describe, expect, it } from "vitest";
import { browserClient, localStack } from "./local-stack";

const MAILPIT = "http://127.0.0.1:54324/api/v1";

describe("patient email OTP", () => {
  it("sends an eight-digit Auth code, issues a Supabase session, and provisions only patient role", async () => {
    const stack = localStack();
    const client = browserClient(stack);
    const email = `patient-otp-${crypto.randomUUID()}@watson.test`;

    const requested = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: true } });
    expect(requested.error).toBeNull();
    expect(requested.data.session).toBeNull();

    const inboxResponse = await fetch(`${MAILPIT}/messages`);
    expect(inboxResponse.ok).toBe(true);
    const inbox = await inboxResponse.json() as {
      messages: { ID: string; To: { Address: string }[] }[];
    };
    const messageInfo = inbox.messages.find((message) => message.To.some((recipient) => recipient.Address === email));
    expect(messageInfo).toBeDefined();
    const messageResponse = await fetch(`${MAILPIT}/message/${messageInfo!.ID}`);
    expect(messageResponse.ok).toBe(true);
    const message = await messageResponse.json() as { Subject: string; Text: string };
    expect(message.Subject).toBe("Your Watson sign-in code");
    const code = message.Text.match(/(?:^|\n)(\d{8})(?:\n|$)/)?.[1];
    expect(code).toMatch(/^\d{8}$/);

    const verified = await client.auth.verifyOtp({ email, token: code!, type: "email" });
    expect(verified.error).toBeNull();
    expect(verified.data.session?.access_token).toBeTruthy();

    const role = await client.rpc("bootstrap_patient_role");
    expect(role.error).toBeNull();
    expect(role.data).toEqual({ ok: true, roles: ["patient"] });
    expect((await client.rpc("current_user_roles")).data).toEqual(["patient"]);

    const replay = await client.auth.verifyOtp({ email, token: code!, type: "email" });
    expect(replay.error).not.toBeNull();
  });
});
