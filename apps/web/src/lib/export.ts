// What a practitioner takes out of Watson (owner, 24 Oct: "the doctor and/or patient can pull data
// out via both pdf and excel … for a doctor they can export all info of their patients at once").
// The same rows feed the Excel sheets and the printed page.
import { asClock, asDayMonthYear } from "./dates";

export type FormField = { key: string; label: string; mode?: "extract" | "suggest" | "manual" };
export type FormTemplate = { title: string; sections: { title: string; fields: FormField[] }[] };
export type FormAnswer = { field_key: string; machine_text: string | null; practitioner_text: string | null; review: string };
export type Turn = { start_seconds: number; speaker: "practitioner" | "patient"; machine_text: string; reviewed_text: string | null };
export type ConsultationRecord = {
  patient: string; contact: string; scheduledAt: string; practitioner: string;
  /** When the form was approved; null for a draft, or when there is no form. */
  approvedAt: string | null;
  /** The form as it was filled in; null when Watson has not filled one in yet. */
  template: FormTemplate | null;
  answers: FormAnswer[];
  turns: Turn[];
};

const when = (iso: string) => `${asDayMonthYear(new Date(iso))} ${asClock(new Date(iso))}`;

/** The answer as the practitioner left it: their own words, else Watson's, unless they rejected it. */
export const answerText = (answer: FormAnswer | undefined) =>
  !answer || answer.review === "rejected" ? "" : answer.practitioner_text ?? answer.machine_text ?? "";

/** "Approved 27/10/2026 11:30", "Draft, not yet approved" or "No form yet". */
export const formState = (record: ConsultationRecord) =>
  !record.template ? "No form yet" : record.approvedAt ? `Approved ${when(record.approvedAt)}` : "Draft, not yet approved";

/** One consultation: who, when and how far the form got, then every question in the form's own order. */
export function formRows(record: ConsultationRecord): string[][] {
  const answers = new Map(record.answers.map((answer) => [answer.field_key, answer]));
  return [
    ["Section", "Question", "Answer"],
    ["Consultation", "Patient", record.patient],
    ["Consultation", "Phone or email", record.contact],
    ["Consultation", "Date", when(record.scheduledAt)],
    ["Consultation", "Practitioner", record.practitioner],
    ["Consultation", "Form", formState(record)],
    ...(record.template?.sections ?? []).flatMap((section) =>
      section.fields.map((field) => [section.title, field.label, answerText(answers.get(field.key))])),
  ];
}

/** 75 -> "1:15". */
const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`;

/** The conversation, each line as corrected. */
export function conversationRows(record: ConsultationRecord): string[][] {
  return [
    ["Time", "Who", "Words"],
    ...record.turns.map((turn) => [clock(turn.start_seconds), turn.speaker === "patient" ? "Patient" : "Practitioner",
      turn.reviewed_text ?? turn.machine_text]),
  ];
}

/** Every consultation, one row each; a column for every question asked in any of their forms. */
export function allPatientsRows(records: ConsultationRecord[]): string[][] {
  const questions = new Map<string, string>(); // field key -> label, in the order first met
  for (const record of records) {
    for (const field of record.template?.sections.flatMap((section) => section.fields) ?? []) {
      if (!questions.has(field.key)) questions.set(field.key, field.label);
    }
  }
  return [
    ["Patient", "Phone or email", "Date", "Practitioner", "Form", ...questions.values()],
    ...records.map((record) => {
      const answers = new Map(record.answers.map((answer) => [answer.field_key, answer]));
      return [record.patient, record.contact, when(record.scheduledAt), record.practitioner, formState(record),
        ...[...questions.keys()].map((key) => answerText(answers.get(key)))];
    }),
  ];
}
