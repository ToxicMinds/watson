// Correcting the transcript (owner, 24 Oct: "this transcription should be editable … the doctor having
// the ability to correct anything that he sees real time"). Watson keeps what it heard next to the
// correction, and learns the spelling for this patient: later lines, the full transcript and the
// next consultation are written that way, and the engine is told the names to listen for.
import { beforeAll, describe, expect, it } from "vitest";
import { localStack, newEngine, newPractitioner, rpc, sqlAsOwner, type Practitioner } from "./local-stack";

const stack = localStack();
let eva: Practitioner;
let engine: Practitioner;
beforeAll(async () => {
  [eva, engine] = await Promise.all([newPractitioner(stack, "fix"), newEngine(stack, "fix-engine")]);
});

const contact = () => `+421 905 ${Math.floor(Math.random() * 9e5 + 1e5)}`;
async function consultationWith(patient: { name: string; contact: string }) {
  const made = await rpc(eva.client, "create_consultation", {
    p_scheduled_at: "2026-10-27T09:00:00Z", p_language: "en", p_consent_recorded: true,
    p_patient_name: patient.name, p_patient_contact: patient.contact,
  });
  return made.consultation_id as string;
}

/** A live piece the engine has read, with the text it heard. */
async function heardLive(consultationId: string, seq: number, text: string) {
  const path = `${eva.id}/${consultationId}/live/patient-${seq}`;
  await eva.client.storage.from("audio").upload(path, Buffer.from("OggS piece"), { contentType: "audio/ogg" });
  await rpc(eva.client, "add_live_piece", { p_consultation_id: consultationId, p_speaker: "patient", p_seq: seq, p_offset_seconds: seq * 10 });
  for (let i = 0; i < 50; i++) {
    const piece = (await rpc(engine.client, "engine_claim_live_piece")).piece as { id: string; storage_path: string; consultation_id: string } | null;
    if (!piece) break;
    const ours = piece.storage_path === path;
    await rpc(engine.client, "engine_live_piece_done", { p_id: piece.id, p_text: ours ? text : "" });
    if (ours) return piece;
  }
  throw new Error("the piece was never claimed");
}
const live = async (consultationId: string) =>
  (await eva.client.from("live_pieces").select("id, seq, text, heard_text").eq("consultation_id", consultationId).order("seq")).data!;

/** A finished transcript with these patient lines, as transcription would leave it. */
function transcriptOf(consultationId: string, lines: string[]) {
  sqlAsOwner(`
    with j as (insert into public.transcription_jobs (consultation_id, requested_by, status, finished_at)
               select id, practitioner_id, 'completed', now() from public.consultations where id = '${consultationId}' returning id),
    t as (insert into public.transcripts (consultation_id, job_id, schema_version, ordering, low_confidence_threshold, tracks)
          select '${consultationId}', id, '2.0.0', 'exact', 0.5, '[]' from j returning id)
    insert into public.transcript_segments (id, transcript_id, position, speaker, start_seconds, end_seconds, machine_text)
      select gen_random_uuid(), t.id, n - 1, 'patient', n, n + 1, line
      from t, unnest(array[${lines.map((l) => `'${l.replace(/'/g, "''")}'`).join(", ")}]) with ordinality as l(line, n);
    update public.consultations set status = 'transcript_ready' where id = '${consultationId}';`);
}
const segments = async (consultationId: string) =>
  (await eva.client.from("transcript_segments").select("id, position, machine_text, reviewed_text, transcripts!inner(consultation_id)")
    .eq("transcripts.consultation_id", consultationId).order("position")).data!;

describe("a line of the live transcript", () => {
  it("is corrected by the practitioner, keeps what Watson heard, and later lines are spelled that way", async () => {
    const id = await consultationWith({ name: "Jana Nováková", contact: contact() });
    const first = await heardLive(id, 0, "My name is Yana Novakova.");
    expect(first.consultation_id).toBe(id);
    expect(await rpc(eva.client, "correct_live_line", {
      p_piece_id: first.id, p_text: "My name is Jana Nováková.", p_spellings: [{ heard: "Yana Novakova", written: "Jana Nováková" }],
    })).toEqual({ ok: true });
    await heardLive(id, 1, "yana novakova lives in Bratislava.");
    expect(await live(id)).toEqual([
      expect.objectContaining({ seq: 0, text: "My name is Jana Nováková.", heard_text: "My name is Yana Novakova." }),
      expect.objectContaining({ seq: 1, text: "Jana Nováková lives in Bratislava.", heard_text: "yana novakova lives in Bratislava." }),
    ]);
  });

  it("is refused to anyone but the consultation's practitioner, and spellings must be short pairs", async () => {
    const id = await consultationWith({ name: "Ema Mráz", contact: contact() });
    const piece = await heardLive(id, 0, "I am Emma Mraz.");
    const other = await newPractitioner(stack, "fix-other");
    expect(await rpc(other.client, "correct_live_line", { p_piece_id: piece.id, p_text: "x", p_spellings: [] }))
      .toEqual({ ok: false, error_category: "NOT_FOUND" });
    expect(await rpc(eva.client, "correct_live_line", { p_piece_id: piece.id, p_text: "I am Ema Mráz.", p_spellings: [{ heard: "Emma", written: "x".repeat(81) }] }))
      .toMatchObject({ ok: false, error_category: "VALIDATION" });
    expect(await rpc(eva.client, "correct_live_line", { p_piece_id: piece.id, p_text: "", p_spellings: [] }))
      .toMatchObject({ ok: false, error_category: "VALIDATION" });
  });

  it("tells the engine the names and spellings to listen for", async () => {
    const id = await consultationWith({ name: "Peter Adamec", contact: contact() });
    const piece = await heardLive(id, 0, "I take a sugar Gandhi.");
    await rpc(eva.client, "correct_live_line", { p_piece_id: piece.id, p_text: "I take ashwagandha.", p_spellings: [{ heard: "a sugar Gandhi", written: "ashwagandha" }] });
    const hints = await rpc(engine.client, "engine_hints", { p_consultation_id: id });
    expect(hints.ok).toBe(true);
    expect(hints.hints).toEqual(expect.arrayContaining(["Peter Adamec", "ashwagandha"]));
    expect(await rpc(eva.client, "engine_hints", { p_consultation_id: id })).toMatchObject({ ok: false });
  });
});

describe("a line of the full transcript", () => {
  it("is corrected, keeps what Watson heard, and the spelling reaches the rest of it and this patient's next consultation", async () => {
    const patient = { name: "Zuzana Kováčová", contact: contact() };
    const id = await consultationWith(patient);
    transcriptOf(id, ["I am Susana Kovacova.", "Susana Kovacova, yes, from Nitra."]);
    const [first] = await segments(id);
    expect(await rpc(eva.client, "correct_transcript_line", {
      p_segment_id: first.id, p_text: "I am Zuzana Kováčová.", p_spellings: [{ heard: "Susana Kovacova", written: "Zuzana Kováčová" }],
    })).toEqual({ ok: true });
    expect((await segments(id)).map((s) => [s.machine_text, s.reviewed_text])).toEqual([
      ["I am Susana Kovacova.", "I am Zuzana Kováčová."],
      ["Susana Kovacova, yes, from Nitra.", "Zuzana Kováčová, yes, from Nitra."],
    ]);

    const next = await consultationWith(patient);
    transcriptOf(next, ["Hello, Susana Kovacova here."]);
    expect((await segments(next)).map((s) => s.reviewed_text)).toEqual(["Hello, Zuzana Kováčová here."]);
  });

  it("can no longer be corrected once the form is approved", async () => {
    const id = await consultationWith({ name: "Ján Malý", contact: contact() });
    transcriptOf(id, ["I am Jan Maly."]);
    sqlAsOwner(`update public.consultations set status = 'approved' where id = '${id}';`);
    const [line] = await segments(id);
    expect(await rpc(eva.client, "correct_transcript_line", { p_segment_id: line.id, p_text: "I am Ján Malý.", p_spellings: [] }))
      .toEqual({ ok: false, error_category: "INVALID_STATE_TRANSITION" });
  });
});
