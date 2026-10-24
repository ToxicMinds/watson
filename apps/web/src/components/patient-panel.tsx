"use client";

import { Check, MessageCircle } from "lucide-react";
import { useState } from "react";
import { CopyButton } from "@/components/copy-button";
import { Notice } from "@/components/status";
import { call, explain } from "@/lib/api";
import { patientLink } from "@/lib/call";
import type { Tables } from "@/lib/database.types";
import { euros } from "@/lib/fee";
import { dateTime } from "@/lib/status";
import { patientMessage, whatsappLink } from "@/lib/whatsapp";

/** The patient's link, a way to send it on WhatsApp, and whether they have paid (or that it is free). */
export function PatientPanel({ consultation, patient, onChanged }: {
  consultation: Tables<"consultations">;
  patient: { name: string; phone: string | null } | null;
  onChanged: () => void;
}) {
  const link = patientLink(consultation.short_code);
  const fee = consultation.fee_cents;
  const [freeing, setFreeing] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);

  // Owner, 24 Oct: a "Make it free" button for consultations not paid yet.
  async function makeFree() {
    setFreeing(true);
    setProblem(null);
    const outcome = await call("make_consultation_free", { p_consultation_id: consultation.id });
    setFreeing(false);
    if (!outcome.ok) return setProblem(explain(outcome.error_category));
    onChanged();
  }

  return (
    <section className="wa-panel" aria-labelledby="patient-title">
      <div className="wa-panel__head">
        <h2 className="wa-heading" id="patient-title">Patient</h2>
        {fee !== null && (consultation.paid_at ? (
          <span className="wa-chip wa-chip--done"><Check aria-hidden className="wa-icon wa-icon--sm" />
            Paid {euros(consultation.paid_amount_cents ?? fee)} · {dateTime(consultation.paid_at)}</span>
        ) : (
          <div className="wa-actions">
            <span className="wa-chip wa-chip--attention">Not paid yet</span>
            <button type="button" className="wa-button wa-button--quiet wa-button--small" disabled={freeing}
              aria-busy={freeing || undefined} onClick={makeFree}>Make it free</button>
          </div>
        ))}
      </div>
      {problem && <Notice tone="failed" title="The consultation was not made free">{problem}</Notice>}
      <div className="wa-field">
        <label className="wa-label" htmlFor="patient-link">Link for the patient</label>
        <div className="wa-invite">
          <input id="patient-link" className="wa-input" readOnly value={link} onFocus={(event) => event.target.select()} />
          {patient?.phone && (
            <a className="wa-button wa-button--primary" target="_blank" rel="noopener noreferrer"
              href={whatsappLink(patient.phone, patientMessage({
                name: patient.name, scheduledAt: consultation.scheduled_at, language: consultation.language,
                link, mustPay: fee !== null && !consultation.paid_at,
              }))}>
              <MessageCircle aria-hidden className="wa-icon" />Send on WhatsApp
            </a>
          )}
          <CopyButton text={link} />
        </div>
        <p className="wa-hint">
          {fee === null ? "The patient opens the link and waits for you to start the call."
            : `The patient pays ${euros(fee)} when they open the link, then waits for you to start the call.`}
          {patient?.phone ? " Send on WhatsApp opens your WhatsApp with a message ready, in the patient\u2019s language."
            : " Add the patient\u2019s phone number under Documents to send the link on WhatsApp."}
        </p>
      </div>
    </section>
  );
}
