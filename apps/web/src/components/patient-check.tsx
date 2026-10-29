"use client";

import { useState } from "react";
import { Notice } from "@/components/status";
import { call, explain } from "@/lib/api";
import type { Person, Shown } from "@/lib/patient";

/** One of the practitioner's patients, as the question offers it. */
export type Candidate = Person & { id: string };

const contactOf = (person: Person) => person.phone ?? person.email ?? "";
const kindOf = (person: Person) => (person.phone ? "phone number" : "email");

/**
 * "Is this your patient?" (owner, 28 Oct). Anyone with a consultation's link can type a name and number,
 * so Watson asks the practitioner before joining a visit to a patient's history: the patient it was linked
 * to before the check existed, the patient of theirs with the same phone or email, or a new patient.
 */
export function PatientCheck({ consultationId, shown, candidate, onChanged }: {
  consultationId: string;
  shown: Shown;
  candidate: Candidate | null;
  onChanged: () => void;
}) {
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  async function answer(name: "patient_review_association" | "confirm_new_patient", args: Record<string, unknown>) {
    setBusy(true);
    setProblem(null);
    const outcome = await call(name, { p_consultation_id: consultationId, ...args });
    setBusy(false);
    if (!outcome.ok) return setProblem(explain(outcome.error_category));
    onChanged();
  }
  const same = () => answer("patient_review_association", { p_patient_id: candidate!.id, p_decision: "confirm" });
  const other = () => answer("patient_review_association", { p_patient_id: null, p_decision: "reject" });
  const add = () => answer("confirm_new_patient", {});

  return (
    <section className="wa-panel" aria-labelledby="patient-check-title">
      <div className="wa-panel__head">
        <h2 className="wa-heading" id="patient-check-title">Is this your patient?</h2>
      </div>
      {shown.check === "earlier" ? (
        <p className="wa-text">
          Watson now asks you who each patient is. This consultation was linked
          to <strong>{shown.name}</strong> ({contactOf(shown)}). Is that right?
        </p>
      ) : candidate ? (
        <p className="wa-text">
          The patient wrote <strong>{shown.name}</strong>, {contactOf(shown)}. You already have
          {" "}<strong>{candidate.name}</strong> with this {kindOf(shown)}. Is it the same person?
        </p>
      ) : (
        <p className="wa-text">
          The patient wrote <strong>{shown.name}</strong>, {contactOf(shown)}. They are not among your patients yet.
        </p>
      )}
      <div className="wa-actions">
        {candidate ? (
          <>
            <button type="button" className="wa-button wa-button--primary" disabled={busy} onClick={same}>
              {shown.check === "earlier" ? "Yes, that’s right" : "Yes, same person"}
            </button>
            <button type="button" className="wa-button wa-button--secondary" disabled={busy} onClick={other}>
              No, someone else
            </button>
          </>
        ) : (
          <button type="button" className="wa-button wa-button--primary" disabled={busy} onClick={add}>
            Add as a new patient
          </button>
        )}
      </div>
      <p className="wa-hint">Anyone with the link can type a name, so Watson asks you before it keeps visits together.</p>
      {problem && <Notice tone="failed" title="That did not work">{problem}</Notice>}
    </section>
  );
}
