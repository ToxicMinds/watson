import type { Database } from "./database.types";

export type ConsultationStatus = Database["public"]["Enums"]["consultation_status"];
export type ConsultationLanguage = Database["public"]["Enums"]["consultation_language"];

/** The four things that must happen to a consultation, in order. */
/**
 * Where consent can still be withdrawn: until the form is approved (spec, section 15; the database
 * function withdraw_consent holds the same list). After approval, what must be kept is a question
 * for the real-patient gate.
 */
export const WITHDRAWABLE: readonly ConsultationStatus[] = [
  "consent_pending", "ready_for_audio", "audio_imported", "transcription_processing", "transcription_failed",
  "transcript_ready", "transcript_under_review", "transcript_reviewed", "extraction_processing",
  "extraction_failed", "draft_ready", "under_review",
];

export const STAGES = ["Consent", "Call", "Transcript", "Form"] as const;
type StageState = "done" | "current" | "attention" | "failed" | "pending";
type Stages = readonly [StageState, StageState, StageState, StageState];

/** How a status chip looks: see the StatusChip component of the design system. */
export type Tone = "neutral" | "current" | "working" | "attention" | "failed" | "done";

/** Who has to act next: the groups of the consultation list. */
type Group = "Needs you" | "Watson is working" | "Done";

type Summary = { label: string; tone: Tone; group: Group; stages: Stages };
const ALL_DONE: Stages = ["done", "done", "done", "done"];
const LATER = (label: string, tone: Tone = "done"): Summary => ({ label, tone, group: "Done", stages: ALL_DONE });

const SUMMARY: Record<ConsultationStatus, Summary> = {
  consent_pending: { label: "Waiting for consent", tone: "neutral", group: "Needs you", stages: ["current", "pending", "pending", "pending"] },
  ready_for_audio: { label: "Waiting for the call", tone: "current", group: "Needs you", stages: ["done", "current", "pending", "pending"] },
  audio_imported: { label: "Ready to transcribe", tone: "current", group: "Needs you", stages: ["done", "done", "current", "pending"] },
  transcription_processing: { label: "Transcribing", tone: "working", group: "Watson is working", stages: ["done", "done", "current", "pending"] },
  transcription_failed: { label: "Transcription failed", tone: "failed", group: "Needs you", stages: ["done", "done", "failed", "pending"] },
  transcript_ready: { label: "Transcript ready", tone: "attention", group: "Needs you", stages: ["done", "done", "done", "current"] },
  transcript_under_review: { label: "Review in progress", tone: "attention", group: "Needs you", stages: ["done", "done", "done", "attention"] },
  transcript_reviewed: { label: "Transcript reviewed", tone: "attention", group: "Needs you", stages: ["done", "done", "done", "current"] },
  extraction_processing: { label: "Filling in the form", tone: "working", group: "Watson is working", stages: ["done", "done", "done", "current"] },
  extraction_failed: { label: "Form could not be filled in", tone: "failed", group: "Needs you", stages: ["done", "done", "done", "failed"] },
  draft_ready: { label: "Form ready to check", tone: "attention", group: "Needs you", stages: ["done", "done", "done", "attention"] },
  under_review: { label: "Checking the form", tone: "attention", group: "Needs you", stages: ["done", "done", "done", "attention"] },
  approved: LATER("Approved"),
  corrected: LATER("Corrected"),
  consent_withdrawn: { label: "Consent withdrawn", tone: "failed", group: "Done", stages: ["failed", "pending", "pending", "pending"] },
  archived: LATER("Archived"),
};

export function summarise(status: ConsultationStatus): Summary {
  return SUMMARY[status];
}

export const LANGUAGE_LABEL: Record<ConsultationLanguage, string> = {
  en: "English",
  de: "German",
  sk: "Slovak",
  auto: "Mixed or unsure",
};

// European order and a 24-hour clock, in the viewer's own time zone (design system README).
const DATE_TIME = new Intl.DateTimeFormat("en-GB", {
  weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});
const DAY_MONTH = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short" });

/** "Tue 13 Oct 2026, 09:30". */
export const dateTime = (iso: string) => DATE_TIME.format(new Date(iso)).replace(/^(\w+),/, "$1");
/** "13 Oct". */
export const dayMonth = (iso: string) => DAY_MONTH.format(new Date(iso));
