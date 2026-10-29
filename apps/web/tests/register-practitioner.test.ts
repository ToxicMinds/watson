// Practitioners are made by Watson's own scripts (scripts/local-accounts.mjs, sample-practitioners.mjs),
// which hold the service key: since SEC-02 a new account is nobody until it is given a role. As with
// register_engine, only the service key may give it, and never to an engine.
import { describe, expect, it } from "vitest";
import { adminClient, browserClient, localStack, newEngine, PASSWORD } from "./local-stack";

const stack = localStack();

describe("making an account a practitioner", () => {
  it("is the service key's to do, and the account then acts as one", async () => {
    const admin = adminClient(stack);
    const email = `made-${crypto.randomUUID().slice(0, 8)}@watson.test`;
    const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true });
    const client = browserClient(stack);
    await client.auth.signInWithPassword({ email, password: PASSWORD });
    expect((await client.rpc("current_user_roles")).data).toEqual([]);

    expect((await client.rpc("register_practitioner" as never, { p_user_id: created.data.user!.id } as never)).error).not.toBeNull();
    expect((await admin.rpc("register_practitioner" as never, { p_user_id: created.data.user!.id } as never)).error).toBeNull();
    expect((await admin.rpc("register_practitioner" as never, { p_user_id: created.data.user!.id } as never)).error).toBeNull();
    expect((await client.rpc("current_user_roles")).data).toEqual(["practitioner"]);
  });

  it("is refused for an engine", async () => {
    const engine = await newEngine(stack, "made-engine");
    expect((await adminClient(stack).rpc("register_practitioner" as never, { p_user_id: engine.id } as never)).error).not.toBeNull();
  });
});
