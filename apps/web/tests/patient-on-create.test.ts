// Patient details entered while creating a consultation remain claims until an
// OTP session or explicit practitioner review establishes an association.
import { beforeAll, describe, expect, it } from "vitest";
import { localStack, newPractitioner, rpc, type Practitioner } from "./local-stack";

const stack = localStack();
let eva: Practitioner;
beforeAll(async () => {
  eva = await newPractitioner(stack, "named");
});

const create = (patient: { name?: string; contact?: string } = {}) => rpc(eva.client, "create_consultation", {
  p_scheduled_at: "2026-10-27T09:00:00Z", p_language: "sk", p_consent_recorded: true,
  p_patient_name: patient.name, p_patient_contact: patient.contact,
});
const patientOf = async (id: string) =>
  (await eva.client.from("consultations")
    .select("patient_id, patient_claim_name, patient_claim_phone, patient_claim_email, patient_association_state")
    .eq("id", id).single()).data!;
const consultations = async () => (await eva.client.from("consultations").select("id")).data!.length;

describe("a consultation created with patient details", () => {
  it("stores a normalized consultation claim without creating a patient", async () => {
    const made = await create({ name: "Jana Nováková", contact: "+421 905 111 222" });
    expect(made).toMatchObject({ ok: true });
    expect(await patientOf(made.consultation_id!)).toEqual({
      patient_id: null, patient_claim_name: "Jana Nováková", patient_claim_phone: "+421905111222",
      patient_claim_email: null, patient_association_state: "claimed",
    });
  });

  it("does not join two claims merely because their submitted email matches", async () => {
    const first = await create({ name: "Peter Adamec", contact: "peter@example.com" });
    const again = await create({ name: "Peter Adamec", contact: "PETER@example.com" });
    const rows = await eva.client.from("consultations").select("patient_id, patient_claim_email")
      .in("id", [first.consultation_id!, again.consultation_id!]);
    expect(rows.data).toEqual([
      { patient_id: null, patient_claim_email: "peter@example.com" },
      { patient_id: null, patient_claim_email: "peter@example.com" },
    ]);
    expect((await eva.client.from("patients").select("id")).data).toEqual([]);
  });

  it("is not created at all when the patient's details are refused", async () => {
    const before = await consultations();
    expect(await create({ name: "Eva Zelená", contact: "not a number" })).toMatchObject({ ok: false, error_category: "VALIDATION", field: "contact" });
    expect(await create({ name: "Eva Zelená" })).toMatchObject({ ok: false, error_category: "VALIDATION", field: "patient" });
    expect(await create({ contact: "+421 905 333 444" })).toMatchObject({ ok: false, error_category: "VALIDATION", field: "patient" });
    expect(await consultations()).toBe(before);
  });

  it("can still leave the patient to fill in their own details from the link", async () => {
    const made = await create();
    expect(made).toMatchObject({ ok: true });
    expect(await patientOf(made.consultation_id!)).toEqual({
      patient_id: null, patient_claim_name: null, patient_claim_phone: null,
      patient_claim_email: null, patient_association_state: "unclaimed",
    });
  });
});
