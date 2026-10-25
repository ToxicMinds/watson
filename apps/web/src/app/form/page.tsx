"use client";

import { Check, ChevronLeft, Download, FileText, Pencil, Printer, RefreshCw, X } from "lucide-react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState, type CSSProperties } from "react";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/status";
import { call, explain, isId } from "@/lib/api";
import { clock } from "@/lib/audio";
import { openDocument } from "@/lib/documents";
import { downloadConsultation } from "@/lib/download";
import type { Tables } from "@/lib/database.types";
import { loadRecords } from "@/lib/records";
import { RequireSession } from "@/lib/session";
import { dateTime } from "@/lib/status";
import { supabase } from "@/lib/supabase";

type Answer = Tables<"form_answers">;
type Segment = Pick<Tables<"transcript_segments">, "position" | "speaker" | "start_seconds" | "machine_text" | "reviewed_text">;
type Field = { key: string; label: string; mode?: "extract" | "suggest" | "manual" };
type Template = { title: string; sections: { title: string; fields: Field[] }[] };
type DocumentQuote = { document_id: string; page: number; text: string };
type Loaded = {
  consultation: Tables<"consultations">;
  patientName: string | null;
  form: Tables<"forms">;
  answers: Answer[];
  segments: Map<number, Segment>;
  // The patient's documents the answers quote: name and where to open it.
  documents: Map<string, { file_name: string; storage_path: string }>;
  // Documents Watson did not have when it filled the form in (read after the engine took the job,
  // and not quoted): reason to fill it in again.
  late: { file_name: string; source: string; uploaded_at: string }[];
};

/** Who sent a document, in the practitioner's words. */
const SENT_BY: Record<string, string> = {
  whatsapp: "sent by the patient on WhatsApp",
  patient: "sent by the patient from their link",
  practitioner: "added by you",
};
const documentQuotes = (answer: Answer) => (answer.document_quotes ?? []) as unknown as DocumentQuote[];

export default function FormPage() {
  return (
    <RequireSession>
      {(user) => (
        <AppShell user={user}>
          <Suspense fallback={<p className="wa-meta" role="status">Loading the form…</p>}>
            <FormView />
          </Suspense>
        </AppShell>
      )}
    </RequireSession>
  );
}

async function fetchForm(id: string): Promise<Loaded | "missing" | "failed"> {
  const [consultation, form] = await Promise.all([
    supabase.from("consultations").select("*").eq("id", id).maybeSingle(),
    supabase.from("forms").select("*, form_jobs(claimed_at)").eq("consultation_id", id).neq("status", "superseded").maybeSingle(),
  ]);
  if (consultation.error || form.error) return "failed";
  if (!consultation.data || !form.data) return "missing";
  const [answers, segments] = await Promise.all([
    supabase.from("form_answers").select("*").eq("form_id", form.data.id).order("position"),
    supabase.from("transcript_segments").select("position, speaker, start_seconds, machine_text, reviewed_text")
      .eq("transcript_id", form.data.transcript_id).order("position"),
  ]);
  if (answers.error || segments.error) return "failed";
  const quoted = [...new Set(answers.data.flatMap((answer) => documentQuotes(answer).map((quote) => quote.document_id)))];
  const [patient, documents, late] = await Promise.all([
    consultation.data.patient_id
      ? supabase.from("patients").select("name").eq("id", consultation.data.patient_id).maybeSingle()
      : Promise.resolve({ data: null }),
    quoted.length > 0
      ? supabase.from("patient_documents").select("id, file_name, storage_path").in("id", quoted)
      : Promise.resolve({ data: [] }),
    supabase.from("patient_documents").select("id, file_name, source, uploaded_at").eq("consultation_id", id)
      .eq("reading", "read").gt("read_at", form.data.form_jobs?.claimed_at ?? form.data.created_at).order("uploaded_at"),
  ]);
  return {
    consultation: consultation.data,
    patientName: patient.data?.name ?? null,
    form: form.data,
    answers: answers.data,
    segments: new Map(segments.data.map((segment) => [segment.position, segment])),
    documents: new Map((documents.data ?? []).map((document) => [document.id, document])),
    late: (late.data ?? []).filter((document) => document.uploaded_at !== null && !quoted.includes(document.id)) as Loaded["late"],
  };
}

const CHIP: Record<Answer["review"], [string, string]> = {
  unreviewed: ["wa-chip--attention", "To check"],
  accepted: ["wa-chip--done", "Accepted"],
  edited: ["wa-chip--current", "Edited by you"],
  rejected: ["wa-chip--failed", "Rejected"],
};

function FormView() {
  const id = useSearchParams().get("id") ?? "";
  const [loaded, setLoaded] = useState<Loaded | "missing" | "failed" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const [active, setActive] = useState<string | null>(null);
  const aside = useRef<HTMLElement>(null);
  const router = useRouter();

  const load = useCallback(() => {
    fetchForm(id).then(setLoaded);
  }, [id]);
  useEffect(() => {
    if (!isId(id)) return;
    let current = true;
    fetchForm(id).then((result) => current && setLoaded(result));
    return () => {
      current = false;
    };
  }, [id]);

  // Bring the first lit line of the conversation into view, inside its own panel only.
  useEffect(() => {
    const panel = aside.current;
    const lit = panel?.querySelector<HTMLElement>(".wa-turn--lit");
    if (panel && lit) panel.scrollTo({ top: lit.offsetTop - 80, behavior: "smooth" });
  }, [active, loaded]);

  const back = (
    <Link href={`/consultation/?id=${id}`} className="wa-crumb"><ChevronLeft aria-hidden className="wa-icon wa-icon--sm" />Consultation</Link>
  );
  if (!isId(id) || loaded === "missing") return <>{back}<p className="wa-text">There is no form for this consultation yet.</p></>;
  if (loaded === "failed") return <>{back}<Notice tone="failed" title="The form could not be loaded">Check your connection and reload the page.</Notice></>;
  if (loaded === null) return <p className="wa-meta" role="status">Loading the form…</p>;

  const { consultation, patientName, form, answers, segments, documents, late } = loaded;
  const template = form.template as unknown as Template;
  const fields = new Map(template.sections.flatMap((section) => section.fields).map((field) => [field.key, field]));
  const byKey = new Map(answers.map((answer) => [answer.field_key, answer]));
  const approved = form.status === "approved";
  const answered = answers.filter((answer) => answer.machine_text !== null).length;
  const toCheck = answers.filter((answer) => answer.machine_text !== null && answer.review === "unreviewed").length;
  // A field only the practitioner fills in, such as private notes (owner, 24 Oct): never "not discussed".
  const manual = (answer: Answer) => fields.get(answer.field_key)?.mode === "manual";
  const asked = answers.filter((answer) => !manual(answer)).length;
  const isEmpty = (answer: Answer) => !manual(answer) && answer.machine_text === null && answer.review !== "edited";
  const suggested = answers.filter((answer) => fields.get(answer.field_key)?.mode === "suggest" && !isEmpty(answer) && answer.review !== "rejected");
  const checked = answered - toCheck;
  // The answer whose quotes are lit: the one picked, else the first still to check.
  const focus = active ?? answers.find((answer) => !isEmpty(answer) && answer.review === "unreviewed")?.field_key ?? null;
  const lit = new Set(byKey.get(focus ?? "")?.evidence ?? []);

  async function decide(key: string, decision: "accept" | "reject" | "edit" | "undo", text?: string) {
    setBusy(true);
    setProblem(null);
    const outcome = await call("review_form_answer", {
      p_form_id: form.id, p_field_key: key, p_decision: decision, p_text: text,
    });
    setBusy(false);
    if (!outcome.ok) return setProblem(explain(outcome.error_category));
    setEditing(null);
    load();
  }
  async function approve() {
    setBusy(true);
    setProblem(null);
    const outcome = await call("approve_form", { p_form_id: form.id });
    setBusy(false);
    if (!outcome.ok) return setProblem(explain(outcome.error_category));
    load();
  }
  async function fillAgain() {
    setBusy(true);
    setProblem(null);
    const outcome = await call("fill_form_again", { p_consultation_id: consultation.id });
    if (outcome.ok) return router.push(`/consultation/?id=${consultation.id}`);
    setBusy(false);
    setProblem(explain(outcome.error_category));
  }
  async function downloadExcel() {
    setBusy(true);
    setProblem(null);
    const records = await loadRecords(consultation.id);
    setBusy(false);
    if (!records?.length) return setProblem("The form could not be loaded. Check your connection and try again.");
    downloadConsultation(records[0]);
  }
  function edit(answer: Answer) {
    setEditing(answer.field_key);
    setDraft(answer.practitioner_text ?? answer.machine_text ?? "");
  }

  function card(answer: Answer) {
    const field = fields.get(answer.field_key);
    const label = field?.label ?? answer.field_key;
    const empty = isEmpty(answer);
    const text = answer.review === "edited" ? answer.practitioner_text : answer.machine_text;
    const own = manual(answer);
    const [chipClass, chipText] = own ? ["wa-chip--done", "Only for you"] : empty ? ["wa-chip--done", "Not discussed"] : CHIP[answer.review];
    const settled = answer.review !== "unreviewed";
    const modifier = empty ? " wa-answer--empty" : answer.review === "rejected" ? " wa-answer--rejected wa-answer--settled" : settled ? " wa-answer--settled" : "";
    const quotes = answer.evidence.map((position) => segments.get(position)).filter((segment) => segment !== undefined);
    return (
      <article key={answer.field_key} className={`wa-answer${modifier}${focus === answer.field_key ? " wa-answer--active" : ""}`}
        aria-labelledby={`f-${answer.field_key}`} onClick={() => setActive(answer.field_key)} onFocus={() => setActive(answer.field_key)}>
        <div className="wa-answer__head">
          <h3 className="wa-answer__label" id={`f-${answer.field_key}`}>
            {label}{field?.mode === "suggest" && <> <span className="wa-tag wa-tag--attention">Suggestion</span></>}
          </h3>
          <span className={`wa-chip ${chipClass}`}>
            {answer.review === "accepted" && <Check aria-hidden className="wa-icon wa-icon--sm" />}
            {answer.review === "edited" && <Pencil aria-hidden className="wa-icon wa-icon--sm" />}
            {answer.review === "rejected" && <X aria-hidden className="wa-icon wa-icon--sm" />}
            {chipText}
          </span>
        </div>
        {editing === answer.field_key ? (
          <form className="wa-field" onSubmit={(event) => { event.preventDefault(); decide(answer.field_key, "edit", draft); }}>
            <label className="wa-label" htmlFor={`e-${answer.field_key}`}>Your answer</label>
            <textarea id={`e-${answer.field_key}`} className="wa-input wa-textarea" value={draft} maxLength={4000}
              onChange={(event) => setDraft(event.target.value)} autoFocus />
            <div className="wa-actions">
              <button type="submit" className="wa-button wa-button--secondary wa-button--small" disabled={busy || !draft.trim()}>Save</button>
              <button type="button" className="wa-button wa-button--quiet wa-button--small" onClick={() => setEditing(null)}>Cancel</button>
            </div>
          </form>
        ) : (
          <>
            {(!own || text) && <p className="wa-answer__text">{empty ? "Not discussed in the conversation." : text}</p>}
            {own && <p className="wa-hint">Only you see this. Watson does not fill it in, and it is never shared.</p>}
          </>
        )}
        {field?.mode === "suggest" && !empty && answer.review === "unreviewed" && (
          <p className="wa-hint">Watson&apos;s reading of the conversation, not a diagnosis. Accept it only if it is your assessment.</p>
        )}
        {(quotes.length > 0 || documentQuotes(answer).length > 0) && (
          <ul className="wa-quotes" aria-label="Where this comes from">
            {quotes.map((segment) => (
              <li key={segment.position} className={`wa-quote wa-quote--${segment.speaker}`}>
                <div>
                  <span className="wa-quote__who">{segment.speaker === "patient" ? "Patient" : "Practitioner"} · {clock(Number(segment.start_seconds))}</span>
                  <p className="wa-quote__text">{segment.reviewed_text ?? segment.machine_text}</p>
                </div>
              </li>
            ))}
            {documentQuotes(answer).map((quote, index) => {
              const document = documents.get(quote.document_id);
              return (
                <li key={`d${index}`} className="wa-quote wa-quote--document">
                  <div>
                    <span className="wa-quote__who" style={{ display: "inline-flex", gap: 6, alignItems: "center" }}>
                      <FileText aria-hidden className="wa-icon wa-icon--sm" />
                      {document ? (
                        <button type="button" className="wa-link" onClick={() => void openDocument(document.storage_path)}>{document.file_name}</button>
                      ) : "A removed document"} · page {quote.page}
                    </span>
                    <p className="wa-quote__text">{quote.text}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {own && !approved && editing !== answer.field_key && (
          <div className="wa-actions">
            <button type="button" className="wa-button wa-button--secondary" disabled={busy} onClick={() => edit(answer)}>
              <Pencil aria-hidden className="wa-icon wa-icon--sm" />{text ? "Edit" : "Write"}
            </button>
          </div>
        )}
        {!own && !approved && editing !== answer.field_key && (
          <div className="wa-actions">
            {settled ? (
              <button type="button" className="wa-button wa-button--quiet wa-button--small" disabled={busy}
                onClick={() => decide(answer.field_key, "undo")}>Change</button>
            ) : (
              <>
                <button type="button" className="wa-button wa-button--secondary wa-button--small" disabled={busy}
                  onClick={() => decide(answer.field_key, "accept")}><Check aria-hidden className="wa-icon wa-icon--sm" />Accept</button>
                <button type="button" className="wa-button wa-button--secondary wa-button--small" disabled={busy}
                  onClick={() => edit(answer)}><Pencil aria-hidden className="wa-icon wa-icon--sm" />Edit</button>
                <button type="button" className="wa-button wa-button--quiet wa-button--small" disabled={busy}
                  onClick={() => decide(answer.field_key, "reject")}>Reject</button>
              </>
            )}
          </div>
        )}
      </article>
    );
  }

  return (
    <>
      {back}
      <section className="wa-hero" aria-labelledby="form-title">
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: 24 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <p className="wa-hero__eyebrow">{template.title}</p>
            <h1 className="wa-hero__title" id="form-title">{patientName ?? consultation.synthetic_patient_ref}</h1>
            <p className="wa-hero__meta">
              Filled in by Watson from the call of {dateTime(consultation.scheduled_at)}
              {documents.size > 0 && ` and ${documents.size === 1 ? "one document" : `${documents.size} documents`}`} · {answered} of {asked} answered
              {asked > answered && ` · ${asked - answered} not discussed`}
            </p>
            <div className="wa-actions" style={{ marginTop: 8 }}>
              <button type="button" className="wa-button wa-button--secondary" disabled={busy} onClick={() => void downloadExcel()}>
                <Download aria-hidden className="wa-icon" />Download as Excel
              </button>
              <Link href={`/print/?id=${consultation.id}`} className="wa-button wa-button--secondary">
                <Printer aria-hidden className="wa-icon" />Print or save as PDF
              </Link>
            </div>
          </div>
          {!approved && answered > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 16 }}>
              <div className="wa-ring" style={{ "--p": checked / answered } as CSSProperties}>
                <span>{checked}/{answered}<small>checked</small></span>
              </div>
            </div>
          )}
        </div>
        {suggested.length > 0 && (
          <div className="wa-suggests">
            <p className="wa-suggests__title">Watson suggests · decide yourself</p>
            {suggested.map((answer) => (
              <p key={answer.field_key} className="wa-suggests__text">{answer.review === "edited" ? answer.practitioner_text : answer.machine_text}</p>
            ))}
          </div>
        )}
      </section>
      {approved && (
        <Notice title={`Approved ${form.approved_at ? dateTime(form.approved_at) : ""}`}>This form is final. It is the record of the consultation.</Notice>
      )}
      {!approved && late.length > 0 && ["draft_ready", "under_review"].includes(consultation.status) && (
        <Notice tone="attention" title={late.length === 1 ? "A document arrived after Watson filled this in" : `${late.length} documents arrived after Watson filled this in`}
          actions={<button type="button" className="wa-button wa-button--secondary wa-button--small" disabled={busy} onClick={fillAgain}>
            <RefreshCw aria-hidden className="wa-icon wa-icon--sm" />Fill in again</button>}>
          {late.map((document) => `${document.file_name}, ${SENT_BY[document.source] ?? "sent"} on ${dateTime(document.uploaded_at)}`).join("; ")}.
          {" "}Watson can fill in the form again with {late.length === 1 ? "it" : "them"}, in about 5 minutes. Answers you have already checked stay as you left them.
        </Notice>
      )}
      {problem && <Notice tone="failed" title="That did not work">{problem}</Notice>}
      <div className="wa-review">
        <div className="wa-sheet">
          {template.sections.map((section, index) => {
            const members = section.fields.map((field) => byKey.get(field.key)).filter((answer) => answer !== undefined);
            const tucked = members.filter((answer) => isEmpty(answer) && editing !== answer.field_key);
            return (
              <section key={section.title} className="wa-sheet__section" aria-labelledby={`s-${index}`}>
                <h2 className="wa-sheet__title" id={`s-${index}`}>{section.title}</h2>
                {members.filter((answer) => !tucked.includes(answer)).map(card)}
                {tucked.length > 0 && (
                  <p className="wa-tucked">
                    Not discussed:
                    {tucked.map((answer) => approved ? (
                      <strong key={answer.field_key}>{fields.get(answer.field_key)?.label ?? answer.field_key}</strong>
                    ) : (
                      <button key={answer.field_key} type="button" className="wa-button wa-button--quiet wa-button--small"
                        aria-label={`Add an answer: ${fields.get(answer.field_key)?.label ?? answer.field_key}`}
                        disabled={busy} onClick={() => edit(answer)}>
                        {fields.get(answer.field_key)?.label ?? answer.field_key}
                      </button>
                    ))}
                  </p>
                )}
              </section>
            );
          })}
        </div>
        <aside className="wa-review__aside" aria-label="The conversation" ref={aside}>
          <h2 className="wa-heading">The conversation</h2>
          <p className="wa-hint">Lines the selected answer comes from are lit.</p>
          <ol className="wa-turns">
            {[...segments.values()].map((segment) => (
              <li key={segment.position} className={`wa-turn wa-turn--${segment.speaker}${lit.has(segment.position) ? " wa-turn--lit" : ""}`}>
                <div className="wa-turn__body">
                  <p className="wa-turn__head" style={{ margin: 0 }}>
                    <span className="wa-turn__who">{segment.speaker === "patient" ? "Patient" : "Practitioner"}</span>
                    <span className="wa-turn__time">{clock(Number(segment.start_seconds))}</span>
                  </p>
                  <p className="wa-turn__text">{segment.reviewed_text ?? segment.machine_text}</p>
                </div>
              </li>
            ))}
          </ol>
        </aside>
      </div>
      {!approved && (
        <div className="wa-approve">
          <p className="wa-meta" role="status">
            {toCheck === 0 ? "Every answer is checked." : `${toCheck} ${toCheck === 1 ? "answer" : "answers"} still to check`}
          </p>
          <button type="button" className="wa-button wa-button--primary" disabled={busy || toCheck > 0} onClick={approve}>
            Approve form
          </button>
        </div>
      )}
    </>
  );
}
