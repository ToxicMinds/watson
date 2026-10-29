// The practitioner's "Is this your patient?" (owner, 28 Oct: build it before SEC-02 goes live). What a
// patient types when booking or on their link stays a claim until someone checks it. When nobody among
// the practitioner's patients has that phone or email, the practitioner adds them as a new patient with
// one press; when somebody does, the practitioner answers "same person?" (patient_review_association).
import { randomUUID } from "node:crypto";
import { beforeAll, describe, expect, it } from "vitest";
import { browserClient, localStack, newPractitioner, rpc, sqlAsOwner, type Practitioner } from "./local-stack";

const stack = localStack();
let eva: Practitioner;
let finn: Practitioner;
beforeAll(async () => {
  [eva, finn] = await Promise.all([newPractitioner(stack, "confirm-eva"), newPractitioner(stack, "confirm-finn")]);
});

const phone = () => `+42190${Date.now().toString().slice(-7)}`;

/** A consultation whose patient typed their own name and contact on the link. */
async function claimed(name: string, contact: string) {
  const made = await rpc(eva.client, "create_consultation", {
    p_scheduled_at: "2026-11-02T09:00:00Z", p_language: "sk", p_consent_recorded: true,
  });
  const { data } = await eva.client.from("consultations").select("invite_token").eq("id", made.consultation_id!).single();
  expect(await rpc(browserClient(stack), "patient_identify", { p_token: data!.invite_token, p_name: name, p_contact: contact }))
    .toEqual({ ok: true });
  return made.consultation_id as string;
}

const state = async (id: string) => (await eva.client.from("consultations")
  .select("patient_association_state, patients(name, phone, email)").eq("id", id).single()).data;

describe("naming the patient under Documents", () => {
  it("is a claim to check, like everything typed for a consultation (owner, 29 Oct: ask first)", async () => {
    const number = phone();
    const first = await rpc(eva.client, "create_consultation", { p_scheduled_at: "2026-11-03T09:00:00Z", p_language: "sk", p_consent_recorded: true });
    expect(await rpc(eva.client, "set_patient", { p_consultation_id: first.consultation_id, p_name: "Ján Malý", p_contact: number }))
      .toMatchObject({ ok: true });
    expect(await state(first.consultation_id!)).toEqual({ patient_association_state: "claimed", patients: null });
    const added = await rpc(eva.client, "confirm_new_patient", { p_consultation_id: first.consultation_id });
    expect((await state(first.consultation_id!))!.patients).toEqual({ name: "Ján Malý", phone: number, email: null });

    const second = await rpc(eva.client, "create_consultation", { p_scheduled_at: "2026-11-04T09:00:00Z", p_language: "sk", p_consent_recorded: true });
    await rpc(eva.client, "set_patient", { p_consultation_id: second.consultation_id, p_name: "Jan Maly", p_contact: number });
    expect(await rpc(eva.client, "patient_review_association", {
      p_consultation_id: second.consultation_id, p_patient_id: added.patient_id, p_decision: "confirm",
    })).toMatchObject({ ok: true });
    expect((await state(second.consultation_id!))!.patients).toEqual({ name: "Ján Malý", phone: number, email: null });
  });

  it("corrects the practitioner's own record once the patient is confirmed", async () => {
    const number = phone();
    const made = await rpc(eva.client, "create_consultation", {
      p_scheduled_at: "2026-11-05T09:00:00Z", p_language: "sk", p_consent_recorded: true, p_patient_name: "Zuzana Kovac", p_patient_contact: number,
    });
    expect(await rpc(eva.client, "confirm_new_patient", { p_consultation_id: made.consultation_id })).toMatchObject({ ok: true });
    expect(await rpc(eva.client, "set_patient", { p_consultation_id: made.consultation_id, p_name: "Zuzana Kováčová", p_contact: number }))
      .toMatchObject({ ok: true });
    expect((await state(made.consultation_id!))!.patients).toEqual({ name: "Zuzana Kováčová", phone: number, email: null });
  });
});

describe("adding the patient who booked as a new patient", () => {
  it("makes them the practitioner's patient, with what they typed", async () => {
    const number = phone();
    const id = await claimed("Jana Nováková", number);
    const added = await rpc(eva.client, "confirm_new_patient", { p_consultation_id: id });
    expect(added).toMatchObject({ ok: true, association_state: "practitioner_confirmed" });
    expect(await state(id)).toEqual({
      patient_association_state: "practitioner_confirmed",
      patients: { name: "Jana Nováková", phone: number, email: null },
    });
    // The next time they book with the same number, they are a returning patient to confirm, not a new one.
    const again = await claimed("Jana Novakova", number);
    expect(await rpc(eva.client, "confirm_new_patient", { p_consultation_id: again }))
      .toMatchObject({ ok: false, error_category: "PATIENT_EXISTS" });
    expect(await rpc(eva.client, "patient_review_association", {
      p_consultation_id: again, p_patient_id: added.patient_id, p_decision: "confirm",
    })).toMatchObject({ ok: true });
    expect((await state(again))!.patients).toMatchObject({ name: "Jana Nováková" });
  });

  it("is refused once the patient is confirmed, for another practitioner, and without a claim", async () => {
    const id = await claimed("Peter Adamec", `peter-${randomUUID().slice(0, 6)}@example.com`);
    expect(await rpc(finn.client, "confirm_new_patient", { p_consultation_id: id }))
      .toMatchObject({ ok: false, error_category: "NOT_FOUND" });
    expect(await rpc(eva.client, "confirm_new_patient", { p_consultation_id: id })).toMatchObject({ ok: true });
    expect(await rpc(eva.client, "confirm_new_patient", { p_consultation_id: id }))
      .toMatchObject({ ok: false, error_category: "NOT_A_CLAIM" });

    const unnamed = await rpc(eva.client, "create_consultation", {
      p_scheduled_at: "2026-11-02T10:00:00Z", p_language: "sk", p_consent_recorded: true,
    });
    expect(await rpc(eva.client, "confirm_new_patient", { p_consultation_id: unnamed.consultation_id }))
      .toMatchObject({ ok: false, error_category: "NOT_A_CLAIM" });
  });

  it("is the practitioner's alone", async () => {
    const id = await claimed("Eva Zelená", phone());
    const outsider = await browserClient(stack).rpc("confirm_new_patient" as never, { p_consultation_id: id } as never);
    expect(outsider.error).not.toBeNull();
    const events = sqlAsOwner(`select count(*) from public.audit_events where consultation_id = '${id}' and event_type = 'patient.association_confirmed';`);
    expect(events).toBe("0");
  });
});

describe("a consultation linked before the check existed", () => {
  it("is confirmed back to that patient, or let go", async () => {
    const number = phone();
    const made = await rpc(eva.client, "create_consultation", {
      p_scheduled_at: "2026-11-06T09:00:00Z", p_language: "sk", p_consent_recorded: true, p_patient_name: "Robin's patient", p_patient_contact: number,
    });
    const id = made.consultation_id!;
    expect(await rpc(eva.client, "confirm_new_patient", { p_consultation_id: id })).toMatchObject({ ok: true });
    // What the SEC-02 migration did to every linked consultation on the live database.
    sqlAsOwner(`update public.consultations set legacy_patient_id = patient_id, patient_id = null,
      patient_association_state = 'legacy_unverified' where id = '${id}';`);
    const before = (await eva.client.from("consultations").select("legacy_patient_id").eq("id", id).single()).data!.legacy_patient_id!;
    expect(await rpc(eva.client, "patient_review_association", { p_consultation_id: id, p_patient_id: before, p_decision: "confirm" }))
      .toMatchObject({ ok: true });
    expect(await state(id)).toEqual({ patient_association_state: "practitioner_confirmed", patients: { name: "Robin's patient", phone: number, email: null } });
  });
});

