// Sign-in codes by WhatsApp (owner, 28 Oct): the patient-otp function proves the number, then opens a
// session for an Auth account carrying that number (Supabase Auth keeps it without its "+"). The admitted
// session must count as that number proven, so the patient can link the consultation they booked with it.
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, browserClient, localStack, newPractitioner, PASSWORD, rpc, type Practitioner } from "./local-stack";

const stack = localStack();
let eva: Practitioner;
beforeAll(async () => {
  eva = await newPractitioner(stack, "wa-otp");
});

/** What patient-otp does once the WhatsApp code is right: account, patient role, admitted session. */
async function signedInByWhatsApp(phone: string) {
  const admin = adminClient(stack);
  const email = `whatsapp-${phone.slice(1)}@patients.watson.invalid`;
  const created = await admin.auth.admin.createUser({ email, password: PASSWORD, email_confirm: true, phone, phone_confirm: true });
  if (created.error) throw created.error;
  expect((await admin.rpc("provision_patient_role_after_otp" as never, { p_user_id: created.data.user.id } as never)).error).toBeNull();
  const client = browserClient(stack);
  const signedIn = await client.auth.signInWithPassword({ email, password: PASSWORD });
  if (signedIn.error) throw signedIn.error;
  const payload = signedIn.data.session!.access_token.split(".")[1]!.replace(/-/g, "+").replace(/_/g, "/");
  const sessionId = JSON.parse(atob(payload.padEnd(Math.ceil(payload.length / 4) * 4, "="))).session_id as string;
  const registered = await admin.rpc("register_patient_otp_session" as never, {
    p_user_id: created.data.user.id, p_session_id: sessionId, p_verified_email: null, p_verified_phone: phone,
  } as never);
  return { client, registered: registered.data as unknown as { ok: boolean; error_category?: string } };
}

describe("a patient signed in with a WhatsApp code", () => {
  it("has a patient session for that number and links the consultation booked with it", async () => {
    const phone = `+42194${Date.now().toString().slice(-7)}`;
    const made = await rpc(eva.client, "create_consultation", {
      p_scheduled_at: "2026-11-07T09:00:00Z", p_language: "sk", p_consent_recorded: true,
    });
    const { data } = await eva.client.from("consultations").select("invite_token").eq("id", made.consultation_id!).single();
    expect(await rpc(browserClient(stack), "patient_identify", { p_token: data!.invite_token, p_name: "Jana", p_contact: phone }))
      .toEqual({ ok: true });

    const patient = await signedInByWhatsApp(phone);
    expect(patient.registered).toEqual({ ok: true });
    expect((await patient.client.rpc("current_user_roles")).data).toEqual(["patient"]);
    expect(await rpc(patient.client, "patient_link_consultation", { p_token: data!.invite_token }))
      .toMatchObject({ ok: true, association_state: "verified" });
  });
});
