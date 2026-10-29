import { describe, expect, it } from "vitest";
import { shownPatient, type PatientColumns } from "./patient";

const jana = { name: "Jana Nováková", phone: "+421905111222", email: null };
const row = (fields: Partial<PatientColumns>): PatientColumns => ({
  patients: null, patient_claim_name: null, patient_claim_phone: null, patient_claim_email: null,
  patient_association_state: "unclaimed", legacy_patient_id: null, ...fields,
});

describe("who a consultation is with, as the practitioner sees it", () => {
  it("is their patient record once confirmed", () => {
    expect(shownPatient(row({ patients: jana, patient_association_state: "practitioner_confirmed" })))
      .toEqual({ ...jana, check: null });
  });

  it("is what the patient typed, to be checked, before that", () => {
    expect(shownPatient(row({ patient_claim_name: "Jana Novak", patient_claim_phone: "+421905111222", patient_association_state: "claimed" })))
      .toEqual({ name: "Jana Novak", phone: "+421905111222", email: null, check: "typed" });
  });

  it("is the patient a consultation from before was linked to, to be checked", () => {
    const earlier = new Map([["p-1", jana]]);
    expect(shownPatient(row({ legacy_patient_id: "p-1", patient_association_state: "legacy_unverified" }), earlier))
      .toEqual({ ...jana, check: "earlier" });
  });

  it("keeps what was typed, unchecked no more, once the practitioner said it is someone else", () => {
    expect(shownPatient(row({ patient_claim_name: "Jana Novak", patient_claim_email: "jana@example.com", patient_association_state: "rejected" })))
      .toEqual({ name: "Jana Novak", phone: null, email: "jana@example.com", check: null });
  });

  it("is nobody yet when nothing is known", () => {
    expect(shownPatient(row({}))).toBeNull();
    expect(shownPatient(row({ legacy_patient_id: "p-2", patient_association_state: "legacy_unverified" }))).toBeNull();
  });
});
