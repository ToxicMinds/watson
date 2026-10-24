// Short links (owner, 16 October): a link the practitioner can read out or type. Watson's own,
// not a public shortener: watson-assists.onrender.com/j/K7P4QX9M opens the patient's page. Eight
// characters without look-alikes (no 0, O, 1 or I); typed in any case, with spaces or dashes.
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, browserClient, localStack, newPractitioner, rpc, type Practitioner } from "./local-stack";

const stack = localStack();
const visitor = browserClient(stack);
const CODE = /^[2-9A-HJ-NP-Z]{8}$/;
let eva: Practitioner;
beforeAll(async () => {
  eva = await newPractitioner(stack, "short");
});

async function consultation() {
  const made = await rpc(eva.client, "create_consultation", { p_scheduled_at: "2026-10-20T07:30:00Z", p_language: "sk", p_consent_recorded: true });
  return (await eva.client.from("consultations").select("id, invite_token, short_code").eq("id", made.consultation_id!).single()).data!;
}

describe("a short link", () => {
  it("is made for every consultation, and opens the patient's page", async () => {
    const { invite_token: token, short_code: code } = await consultation();
    expect(code).toMatch(CODE);
    expect(await rpc(visitor, "open_short_link", { p_code: code })).toEqual({ ok: true, token });
  });

  it("is forgiving when typed: any case, spaces and dashes", async () => {
    const { invite_token: token, short_code: code } = await consultation();
    const typed = ` ${code!.slice(0, 4).toLowerCase()}-${code!.slice(4)} `;
    expect(await rpc(visitor, "open_short_link", { p_code: typed })).toEqual({ ok: true, token });
  });

  it("that does not exist opens nothing", async () => {
    expect(await rpc(visitor, "open_short_link", { p_code: "ZZZZZZZZ" })).toEqual({ ok: false, error_category: "NOT_FOUND" });
    expect(await rpc(visitor, "open_short_link", { p_code: "' or 1=1" })).toEqual({ ok: false, error_category: "NOT_FOUND" });
  });

  it("is what Watson sends on WhatsApp when a patient links their number", async () => {
    const { short_code: code, invite_token: token } = await consultation();
    const whatsappCode = (await eva.client.from("consultations").select("whatsapp_code").eq("invite_token", token).single()).data!.whatsapp_code;
    const linked = await rpc(adminClient(stack), "whatsapp_receive", {
      p_wa_message_id: `wamid.${randomUUID()}`, p_phone: `+4219${Math.floor(Math.random() * 9e7 + 1e7)}`, p_profile_name: "Jana", p_kind: "text", p_body: `Watson ${whatsappCode}`,
    });
    expect(linked.consultation).toMatchObject({ invite_token: token, short_code: code });
  });
});
