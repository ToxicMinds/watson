// Who a consultation is with, as its practitioner sees it (SEC-02; owner, 28 Oct: show the name and ask
// "Is this your patient?"). Once confirmed, the practitioner's patient record. Before that, what the patient
// typed when booking or on their link, or, for a consultation from before the check existed, the patient it
// was linked to then: shown, and marked to be checked.
export type Person = { name: string; phone: string | null; email: string | null };
/** "typed": the patient's own words, not checked; "earlier": linked before the check existed; null: settled. */
export type Shown = Person & { check: "typed" | "earlier" | null };
export type PatientColumns = {
  patients: Person | null;
  patient_claim_name: string | null;
  patient_claim_phone: string | null;
  patient_claim_email: string | null;
  patient_association_state: string;
  legacy_patient_id: string | null;
};
/** The consultation columns shownPatient reads, for a select. */
export const PATIENT_COLUMNS = "patients(name, phone, email), patient_claim_name, patient_claim_phone, patient_claim_email, patient_association_state, legacy_patient_id";

export function shownPatient(row: PatientColumns, earlier: ReadonlyMap<string, Person> = new Map()): Shown | null {
  if (row.patients) return { ...row.patients, check: null };
  if (row.patient_claim_name) {
    return {
      name: row.patient_claim_name, phone: row.patient_claim_phone, email: row.patient_claim_email,
      check: row.patient_association_state === "claimed" ? "typed" : null,
    };
  }
  const before = row.patient_association_state === "legacy_unverified" && row.legacy_patient_id
    ? earlier.get(row.legacy_patient_id) : undefined;
  return before ? { ...before, check: "earlier" } : null;
}
