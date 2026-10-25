"use client";

import { ChevronLeft, Printer } from "lucide-react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { Notice } from "@/components/status";
import { isId } from "@/lib/api";
import { asClock, asDayMonthYear } from "@/lib/dates";
import { answerText, conversationRows, formState, type ConsultationRecord } from "@/lib/export";
import { loadRecords } from "@/lib/records";
import { RequireSession } from "@/lib/session";

// One consultation, or all of them, laid out to print or save as PDF (owner, 24 Oct: "Pdf to print
// would make sense"). The browser's own print window prints it, or saves it as a PDF.
export default function PrintPage() {
  return (
    <RequireSession>
      {(user) => (
        <AppShell user={user}>
          <Suspense fallback={<p className="wa-meta" role="status">Getting it ready to print…</p>}>
            <PrintView />
          </Suspense>
        </AppShell>
      )}
    </RequireSession>
  );
}

function PrintView() {
  const params = useSearchParams();
  const id = params.get("id") ?? "";
  const all = params.get("all") === "1";
  const [records, setRecords] = useState<ConsultationRecord[] | "failed" | null>(null);

  useEffect(() => {
    if (!all && !isId(id)) return;
    let alive = true;
    loadRecords(all ? undefined : id).then((result) => alive && setRecords(result ?? "failed"));
    return () => {
      alive = false;
    };
  }, [id, all]);

  const back = all
    ? <Link href="/consultations/" className="wa-crumb wa-noprint"><ChevronLeft aria-hidden className="wa-icon wa-icon--sm" />Home</Link>
    : <Link href={`/form/?id=${id}`} className="wa-crumb wa-noprint"><ChevronLeft aria-hidden className="wa-icon wa-icon--sm" />The form</Link>;
  if (!all && !isId(id)) return <>{back}<p className="wa-text">This consultation does not exist, or it is not yours.</p></>;
  if (records === "failed") return <>{back}<Notice tone="failed" title="This could not be loaded">Check your connection and reload the page.</Notice></>;
  if (records === null) return <p className="wa-meta" role="status">Getting it ready to print…</p>;

  return (
    <>
      {back}
      <div className="wa-printbar wa-noprint">
        <button type="button" className="wa-button wa-button--primary" onClick={() => window.print()}>
          <Printer aria-hidden className="wa-icon" />Print or save as PDF
        </button>
        <p className="wa-hint">In the window that opens, choose your printer, or choose &ldquo;Save as PDF&rdquo; to keep a copy.</p>
      </div>
      {records.length === 0 && <p className="wa-text">No consultations yet.</p>}
      {records.map((record, index) => <Printed key={index} record={record} withConversation={!all} />)}
    </>
  );
}

function Printed({ record, withConversation }: { record: ConsultationRecord; withConversation: boolean }) {
  const at = new Date(record.scheduledAt);
  const answers = new Map(record.answers.map((answer) => [answer.field_key, answer]));
  const conversation = conversationRows(record).slice(1);
  return (
    <article className="wa-printed">
      <header className="wa-printed__head">
        <p className="wa-hero__eyebrow">{record.template?.title ?? "Consultation"}</p>
        <h1 className="wa-title">{record.patient}</h1>
        <p className="wa-printed__meta">
          {asDayMonthYear(at)} {asClock(at)} · {record.practitioner}{record.contact && ` · ${record.contact}`}
        </p>
        <p className="wa-printed__meta">{formState(record)}</p>
      </header>
      {record.template ? record.template.sections.map((section) => (
        <section key={section.title} className="wa-printed__section">
          <h2 className="wa-heading">{section.title}</h2>
          <dl className="wa-printed__answers">
            {section.fields.map((field) => (
              <div key={field.key}>
                <dt>{field.label}{field.mode === "manual" && <span className="wa-printed__only"> · only for you</span>}</dt>
                <dd>{answerText(answers.get(field.key)) || "—"}</dd>
              </div>
            ))}
          </dl>
        </section>
      )) : <p className="wa-text">Watson has not filled in a form for this consultation yet.</p>}
      <footer className="wa-printed__sign">
        <span>Signature</span><span className="wa-printed__line" /><span>{record.practitioner}</span>
      </footer>
      {withConversation && conversation.length > 0 && (
        <section className="wa-printed__section wa-printed__conversation">
          <h2 className="wa-heading">The conversation</h2>
          <ol>
            {conversation.map(([time, who, words], index) => (
              <li key={index}><span className="wa-printed__who">{time} · {who}</span> {words}</li>
            ))}
          </ol>
        </section>
      )}
    </article>
  );
}
