// The practitioner's consultations as they are taken out of Watson (owner, 24 Oct): one, with its
// conversation, or all of them. Row-level security keeps every query to the practitioner's own.
import type { ConsultationRecord, FormAnswer, FormTemplate, Turn } from "./export";
import { PATIENT_COLUMNS, shownPatient, type PatientColumns, type Person } from "./patient";
import { loginName } from "./session";
import { supabase } from "./supabase";

type Row = PatientColumns & { id: string; scheduled_at: string; synthetic_patient_ref: string };
type Form = { consultation_id: string; template: unknown; approved_at: string | null; form_answers: FormAnswer[] };

/** One consultation (with its conversation), or every one the practitioner has, newest first. */
export async function loadRecords(consultationId?: string): Promise<ConsultationRecord[] | null> {
  let consultations = supabase.from("consultations").select(`id, scheduled_at, synthetic_patient_ref, ${PATIENT_COLUMNS}`)
    .filter("released", "eq", false).order("scheduled_at", { ascending: false });
  if (consultationId) consultations = consultations.eq("id", consultationId);
  let forms = supabase.from("forms").select("consultation_id, template, approved_at, form_answers(field_key, machine_text, practitioner_text, review)")
    .neq("status", "superseded");
  if (consultationId) forms = forms.eq("consultation_id", consultationId);
  const [rows, filled, profile, user] = await Promise.all([
    consultations, forms, supabase.from("practitioner_profiles").select("display_name").maybeSingle(), supabase.auth.getUser(),
  ]);
  if (rows.error || filled.error) return null;
  const practitioner = profile.data?.display_name ?? loginName(user.data.user?.email);
  const byConsultation = new Map(((filled.data ?? []) as Form[]).map((form) => [form.consultation_id, form]));
  const turns = consultationId ? await conversation(consultationId) : [];
  const rowsOf = (rows.data ?? []) as unknown as Row[];
  const earlier = await earlierPatients(rowsOf);
  return rowsOf.map((row) => {
    const form = byConsultation.get(row.id);
    const person = shownPatient(row, earlier);
    return {
      patient: person?.name ?? row.synthetic_patient_ref,
      contact: person?.phone ?? person?.email ?? "",
      scheduledAt: row.scheduled_at, practitioner,
      approvedAt: form?.approved_at ?? null,
      template: (form?.template as FormTemplate | undefined) ?? null,
      answers: form?.form_answers ?? [],
      turns,
    };
  });
}

/** The practitioner's own patients that consultations from before the patient check were linked to, by id. */
export async function earlierPatients(rows: PatientColumns[]): Promise<Map<string, Person>> {
  const ids = [...new Set(rows.flatMap((row) =>
    row.patient_association_state === "legacy_unverified" && row.legacy_patient_id ? [row.legacy_patient_id] : []))];
  if (ids.length === 0) return new Map();
  const { data } = await supabase.from("patients").select("id, name, phone, email").in("id", ids);
  return new Map((data ?? []).map(({ id, ...person }) => [id, person]));
}

async function conversation(consultationId: string): Promise<Turn[]> {
  const { data: transcript } = await supabase.from("transcripts").select("id").eq("consultation_id", consultationId)
    .neq("review_status", "superseded").maybeSingle();
  if (!transcript) return [];
  const { data } = await supabase.from("transcript_segments").select("start_seconds, speaker, machine_text, reviewed_text")
    .eq("transcript_id", transcript.id).order("position");
  return (data ?? []) as Turn[];
}
