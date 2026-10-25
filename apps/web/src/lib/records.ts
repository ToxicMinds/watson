// The practitioner's consultations as they are taken out of Watson (owner, 24 Oct): one, with its
// conversation, or all of them. Row-level security keeps every query to the practitioner's own.
import type { ConsultationRecord, FormAnswer, FormTemplate, Turn } from "./export";
import { loginName } from "./session";
import { supabase } from "./supabase";

type Row = { id: string; scheduled_at: string; synthetic_patient_ref: string; patients: { name: string; phone: string | null; email: string | null } | null };
type Form = { consultation_id: string; template: unknown; approved_at: string | null; form_answers: FormAnswer[] };

/** One consultation (with its conversation), or every one the practitioner has, newest first. */
export async function loadRecords(consultationId?: string): Promise<ConsultationRecord[] | null> {
  let consultations = supabase.from("consultations").select("id, scheduled_at, synthetic_patient_ref, patients(name, phone, email)")
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
  return ((rows.data ?? []) as unknown as Row[]).map((row) => {
    const form = byConsultation.get(row.id);
    return {
      patient: row.patients?.name ?? row.synthetic_patient_ref,
      contact: row.patients?.phone ?? row.patients?.email ?? "",
      scheduledAt: row.scheduled_at, practitioner,
      approvedAt: form?.approved_at ?? null,
      template: (form?.template as FormTemplate | undefined) ?? null,
      answers: form?.form_answers ?? [],
      turns,
    };
  });
}

async function conversation(consultationId: string): Promise<Turn[]> {
  const { data: transcript } = await supabase.from("transcripts").select("id").eq("consultation_id", consultationId)
    .neq("review_status", "superseded").maybeSingle();
  if (!transcript) return [];
  const { data } = await supabase.from("transcript_segments").select("start_seconds, speaker, machine_text, reviewed_text")
    .eq("transcript_id", transcript.id).order("position");
  return (data ?? []) as Turn[];
}
