// What a practitioner takes out of Watson (owner, 24 Oct: PDF or Excel, one patient or all of them).
// The form in its own order with the answers as the practitioner left them, and the conversation.
import { describe, expect, it } from "vitest";
import { allPatientsRows, conversationRows, formRows, type ConsultationRecord } from "./export";

const template = { title: "Ayurvedic consultation", sections: [
  { title: "About the patient", fields: [{ key: "age", label: "Age" }, { key: "work", label: "Work" }] },
  { title: "Assessment", fields: [{ key: "assessment", label: "Assessment", mode: "suggest" as const }] },
  { title: "For you only", fields: [{ key: "private_notes", label: "Private notes", mode: "manual" as const }] },
] };
const jana: ConsultationRecord = {
  patient: "Jana Nováková", contact: "+421905111222", scheduledAt: new Date(2026, 9, 27, 10, 0).toISOString(),
  practitioner: "Dr. Robin Raju", approvedAt: new Date(2026, 9, 27, 11, 30).toISOString(), template,
  answers: [
    { field_key: "age", machine_text: "42", practitioner_text: null, review: "accepted" },
    { field_key: "work", machine_text: "Teacher", practitioner_text: "Teacher, evening classes", review: "edited" },
    { field_key: "assessment", machine_text: "Vata imbalance", practitioner_text: null, review: "rejected" },
    { field_key: "private_notes", machine_text: null, practitioner_text: "Call back in a week", review: "edited" },
  ],
  turns: [
    { start_seconds: 13.4, speaker: "patient", machine_text: "I wake at tree", reviewed_text: "I wake at three" },
    { start_seconds: 75, speaker: "practitioner", machine_text: "Try warm milk.", reviewed_text: null },
  ],
};

describe("a consultation, taken out", () => {
  it("gives the form in its own order, as the practitioner left it, after who, when and how far it got", () => {
    expect(formRows(jana)).toEqual([
      ["Section", "Question", "Answer"],
      ["Consultation", "Patient", "Jana Nováková"],
      ["Consultation", "Phone or email", "+421905111222"],
      ["Consultation", "Date", "27/10/2026 10:00"],
      ["Consultation", "Practitioner", "Dr. Robin Raju"],
      ["Consultation", "Form", "Approved 27/10/2026 11:30"],
      ["About the patient", "Age", "42"],
      ["About the patient", "Work", "Teacher, evening classes"],
      ["Assessment", "Assessment", ""],
      ["For you only", "Private notes", "Call back in a week"],
    ]);
  });

  it("gives the conversation with each line as corrected", () => {
    expect(conversationRows(jana)).toEqual([
      ["Time", "Who", "Words"],
      ["0:13", "Patient", "I wake at three"],
      ["1:15", "Practitioner", "Try warm milk."],
    ]);
  });
});

describe("all patients, taken out at once", () => {
  it("is one row per consultation, one column per question, and says where a form is missing", () => {
    const ema: ConsultationRecord = { patient: "Ema Mráz", contact: "ema@example.com", scheduledAt: new Date(2026, 9, 20, 9, 0).toISOString(),
      practitioner: "Dr. Robin Raju", approvedAt: null, template: null, answers: [], turns: [] };
    expect(allPatientsRows([jana, ema])).toEqual([
      ["Patient", "Phone or email", "Date", "Practitioner", "Form", "Age", "Work", "Assessment", "Private notes"],
      ["Jana Nováková", "+421905111222", "27/10/2026 10:00", "Dr. Robin Raju", "Approved 27/10/2026 11:30", "42", "Teacher, evening classes", "", "Call back in a week"],
      ["Ema Mráz", "ema@example.com", "20/10/2026 09:00", "Dr. Robin Raju", "No form yet", "", "", "", ""],
    ]);
  });
});
