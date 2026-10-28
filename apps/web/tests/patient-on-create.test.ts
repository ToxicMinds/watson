// The patient, named when the consultation is created (owner, 24 Oct: "we see only the random number
// generated for that record"). The consultation and its patient are saved together or not at all,
// and a patient the practitioner has seen before is recognised by their phone or email.
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
  (await eva.client.from("consultations").select("patients(name, phone, email)").eq("id", id).single()).data!.patients;
const consultations = async () => (await eva.client.from("consultations").select("id")).data!.length;

describe("a consultation created with its patient", () => {
  it("names the patient at once", async () => {
    const made = await create({ name: "Jana Nováková", contact: "+421 905 111 222" });
    expect(made).toMatchObject({ ok: true });
    expect(await patientOf(made.consultation_id!)).toEqual({ name: "Jana Nováková", phone: "+421905111222", email: null });
  });

  it("recognises a patient seen before by their phone or email", async () => {
    const first = await create({ name: "Peter Adamec", contact: "peter@example.com" });
    const again = await create({ name: "Peter Adamec", contact: "PETER@example.com" });
    const ids = await eva.client.from("consultations").select("patient_id").in("id", [first.consultation_id!, again.consultation_id!]);
    const [a, b] = ids.data!.map((row) => row.patient_id);
    expect(a).not.toBeNull();
    expect(a).toBe(b);
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
    expect(await patientOf(made.consultation_id!)).toBeNull();
  });
});
