"use client";

import { ArrowRight, Download, Plus, Printer } from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { AppShell } from "@/components/app-shell";
import { euros } from "@/lib/fee";
import { EngineStatus } from "@/components/engine-status";
import { Notice, StatusChip } from "@/components/status";
import type { ConsultationStatus } from "@/lib/status";
import { call } from "@/lib/api";
import { clockTime, viewerZone, type Week } from "@/lib/booking";
import { downloadAll } from "@/lib/download";
import { engineStatus, type Engine } from "@/lib/engine";
import { dateTime, LANGUAGE_LABEL, summarise } from "@/lib/status";
import { loadRecords } from "@/lib/records";
import { RequireSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

type Row = {
  id: string; synthetic_patient_ref: string; scheduled_at: string; updated_at: string;
  language: keyof typeof LANGUAGE_LABEL; status: ConsultationStatus;
  fee_cents: number | null; paid_at: string | null;
  forms: { form_answers: { machine_text: string | null }[] }[];
  patients: { name: string; phone: string | null; email: string | null } | null;
};
/** The patient's name once known, else the consultation's reference. */
const who = (row: Row) => row.patients?.name ?? row.synthetic_patient_ref;

// Finding and ordering patients (owner, 24 Oct: "the ability to search ... sorted by patient last name").
type Sort = "name" | "date";
const plain = (text: string) => text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
/** A row matches by the patient's name, email or phone, or by the consultation's number; accents optional. */
function matches(row: Row, query: string): boolean {
  const wanted = plain(query.trim());
  if (!wanted) return true;
  const digits = wanted.replace(/\D/g, "");
  return [row.patients?.name, row.patients?.email, row.synthetic_patient_ref].some((text) => text && plain(text).includes(wanted))
    || (digits.length >= 3 && (row.patients?.phone ?? "").replace(/\D/g, "").includes(digits));
}
const collator = new Intl.Collator("sk", { sensitivity: "base" });
const lastName = (name: string) => name.trim().split(/\s+/).at(-1) ?? "";
const newestFirst = (a: Row, b: Row) => Date.parse(b.scheduled_at) - Date.parse(a.scheduled_at);
/** By last name, then first name; consultations without a named patient last, newest first. */
function byLastName(a: Row, b: Row): number {
  if (!a.patients || !b.patients) return a.patients ? -1 : b.patients ? 1 : newestFirst(a, b);
  return collator.compare(lastName(a.patients.name), lastName(b.patients.name)) || collator.compare(a.patients.name, b.patients.name);
}

export default function ConsultationsPage() {
  return <RequireSession>{(user) => <AppShell user={user}><Dashboard /></AppShell>}</RequireSession>;
}

/** What the practitioner does next, on the card. */
const NEXT: Partial<Record<ConsultationStatus, string>> = {
  consent_pending: "Record the patient's consent",
  ready_for_audio: "Start the call",
  audio_imported: "The call is recorded: start the transcript",
  transcription_processing: "Watson is writing the transcript",
  transcription_failed: "The transcript stopped. Try again.",
  transcript_ready: "Fill in the form",
  transcript_under_review: "Finish checking the transcript",
  transcript_reviewed: "Fill in the form",
  extraction_processing: "Watson is reading the conversation",
  extraction_failed: "The form stopped. Try again.",
};

const DAY = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long" });
const greeting = (hour: number) => (hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening");
const plural = (n: number, one: string, many: string) => `${n === 1 ? "One" : n} ${n === 1 ? one : many}`;

function Dashboard() {
  const [rows, setRows] = useState<Row[] | null>(null);
  const [engine, setEngine] = useState<Engine | null>(null);
  const [failed, setFailed] = useState(false);
  const [openToday, setOpenToday] = useState<number | null>(null);
  const [filter, setFilter] = useState<Filter | null>(null);
  const [search, setSearch] = useState("");
  const [exporting, setExporting] = useState<"idle" | "busy" | "failed">("idle");

  // Every patient's consultations at once, to keep (owner, 24 Oct).
  async function exportAll() {
    setExporting("busy");
    const records = await loadRecords();
    if (!records) return setExporting("failed");
    downloadAll(records);
    setExporting("idle");
  }
  const [sort, setSort] = useState<Sort>("name");

  useEffect(() => {
    // Row-level security returns only the signed-in practitioner's consultations.
    supabase
      .from("consultations")
      .select("id, synthetic_patient_ref, scheduled_at, updated_at, language, status, fee_cents, paid_at, forms(form_answers(machine_text)), patients(name, phone, email)")
      .filter("released", "eq", false) // an unpaid booking whose hold ran out is not the practitioner's business
      .order("scheduled_at", { ascending: false })
      .then(({ data, error }) => (error ? setFailed(true) : setRows(data as unknown as Row[])));
    engineStatus().then(setEngine);
    const start = new Date();
    const midnight = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    call<Week>("calendar_week", { p_from: start.toISOString(), p_to: midnight.toISOString() }).then((week) => {
      if (week.ok && week.page) setOpenToday(week.open.length);
    });
  }, []);

  const now = new Date();
  const count = (key: Filter) => rows?.filter((row) => FILTER[key](row, now)).length ?? 0;
  // The numbers count every consultation; the shelves show what the pressed number picks.
  const shown = (rows ?? []).filter((row) => (!filter || FILTER[filter](row, now)) && matches(row, search))
    .sort(sort === "name" ? byLastName : newestFirst);
  const group = (name: string) => shown.filter((row) => summarise(row.status).group === name);
  const needYou = group("Needs you");
  const working = group("Watson is working");
  const done = group("Done");
  const next = rows?.filter((row) => Date.parse(row.scheduled_at) > now.getTime() && summarise(row.status).stages[1] !== "done")
    .sort((a, b) => Date.parse(a.scheduled_at) - Date.parse(b.scheduled_at))[0];

  const summary = rows === null ? " " : [
    count("needs") ? `${plural(count("needs"), "consultation needs", "consultations need")} you.` : "Nothing needs you right now.",
    count("working") ? `Watson is working on ${count("working") === 1 ? "one" : count("working")}.` : "",
  ].join(" ");

  return (
    <>
      <section className="wa-hero" aria-labelledby="greeting">
        <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "flex-end", gap: 16 }}>
          <div style={{ display: "grid", gap: 6 }}>
            <p className="wa-hero__eyebrow">{DAY.format(now)}</p>
            <h1 className="wa-hero__title" id="greeting">{greeting(now.getHours())}</h1>
            <p className="wa-hero__meta">{summary}</p>
            {(next || openToday !== null) && (
              <p className="wa-hero__next">
                {next && <>Next: <Link href={`/consultation/?id=${next.id}`}>{who(next)} {nextWhen(next.scheduled_at, now)}</Link>{next.fee_cents !== null && (next.paid_at ? ", paid" : ", not paid yet")}</>}
                {next && openToday !== null && " · "}
                {openToday !== null && <>{openToday === 1 ? "One open time" : `${openToday} open times`} left today · <Link href="/calendar/">Practice</Link></>}
              </p>
            )}
            {engine && <EngineStatus engine={engine} />}
          </div>
          <Link href="/consultations/new/" className="wa-button wa-button--primary">
            <Plus aria-hidden className="wa-icon" />New consultation
          </Link>
        </div>
        {rows && rows.length > 0 && (
          <div className="wa-stats">
            {TILES.map(([key, label]) => (
              <button key={key} type="button" className={key === "needs" ? "wa-stat wa-stat--lamp" : "wa-stat"} aria-pressed={filter === key}
                onClick={() => setFilter(filter === key ? null : key)}>
                <span className="wa-stat__value">{count(key)}</span><span className="wa-stat__label">{label}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      {failed ? (
        <Notice tone="failed" title="Your consultations could not be loaded">Check your connection and reload the page.</Notice>
      ) : rows === null ? (
        <div className="wa-cases" aria-busy="true" aria-label="Loading your consultations">
          {[0, 1].map((key) => (
            <div key={key} className="wa-case" aria-hidden>
              <span className="wa-skeleton" style={{ width: 120 }} /><span className="wa-skeleton" style={{ width: 200 }} />
            </div>
          ))}
        </div>
      ) : rows.length === 0 ? (
        <div className="wa-list">
          <div className="wa-empty">
            <h2 className="wa-heading">No consultations yet</h2>
            <p className="wa-text">Create one, send the patient their link, and meet them by video. Watson writes the transcript and fills in your form.</p>
            <Link href="/consultations/new/" className="wa-button wa-button--primary">
              <Plus aria-hidden className="wa-icon" />New consultation
            </Link>
          </div>
        </div>
      ) : (
        <>
          <div style={{ display: "flex", flexWrap: "wrap", gap: 12, alignItems: "flex-end" }}>
            <div className="wa-field" style={{ flex: "1 1 260px" }}>
              <label className="wa-label" htmlFor="find">Find a patient</label>
              <input id="find" type="search" className="wa-input" placeholder="Name, phone, email or number" autoComplete="off"
                value={search} onChange={(event) => setSearch(event.target.value)} />
            </div>
            <div className="wa-field" style={{ flex: "0 1 230px" }}>
              <label className="wa-label" htmlFor="sort">Sort</label>
              <div className="wa-select">
                <select id="sort" value={sort} onChange={(event) => setSort(event.target.value as Sort)}>
                  <option value="name">Patient&apos;s last name</option>
                  <option value="date">Date, newest first</option>
                </select>
              </div>
            </div>
          </div>
          {shown.length === 0 && (search.trim() ? (
            <Notice title="No patient found" actions={<button type="button" className="wa-button wa-button--secondary wa-button--small"
              onClick={() => setSearch("")}>Clear the search</button>}>Nobody matches &ldquo;{search.trim()}&rdquo;. Check the spelling, or try their phone or email.</Notice>
          ) : (
            <Notice title="Nothing here" actions={<button type="button" className="wa-button wa-button--secondary wa-button--small"
              onClick={() => setFilter(null)}>Show all consultations</button>}>No consultation matches this number right now.</Notice>
          ))}
          {needYou.length > 0 && (
            <section className="wa-shelf" aria-labelledby="needs">
              <div className="wa-shelf__head"><h2 className="wa-heading" id="needs">Needs you</h2></div>
              <div className="wa-cases">{needYou.map((row) => <Case key={row.id} row={row} />)}</div>
            </section>
          )}
          {working.length > 0 && (
            <section className="wa-shelf" aria-labelledby="working">
              <div className="wa-shelf__head"><h2 className="wa-heading" id="working">Watson is working</h2></div>
              <div className="wa-cases">{working.map((row) => <Case key={row.id} row={row} />)}</div>
            </section>
          )}
          {done.length > 0 && (
            <section className="wa-shelf" aria-labelledby="done">
              <div className="wa-shelf__head"><h2 className="wa-heading" id="done">Done</h2></div>
              <ul className="wa-done-list">
                {done.map((row) => (
                  <li key={row.id}>
                    <Link href={`/consultation/?id=${row.id}`} className="wa-row__ref" style={{ color: "inherit" }}>{who(row)}</Link>
                    <span className="wa-meta">{dateTime(row.scheduled_at)} · {LANGUAGE_LABEL[row.language]}</span>
                    <span style={{ marginLeft: "auto" }}><StatusChip status={row.status} /></span>
                  </li>
                ))}
              </ul>
            </section>
          )}
          <section className="wa-shelf" aria-labelledby="records">
            <div className="wa-shelf__head"><h2 className="wa-heading" id="records">Your records</h2></div>
            <p className="wa-text">Every patient&apos;s consultations and forms, to keep on your computer or to print.</p>
            <div className="wa-actions">
              <button type="button" className="wa-button wa-button--secondary" disabled={exporting === "busy"}
                aria-busy={exporting === "busy" || undefined} onClick={() => void exportAll()}>
                <Download aria-hidden className="wa-icon" />{exporting === "busy" ? "Preparing…" : "Download all as Excel"}
              </button>
              <Link href="/print/?all=1" className="wa-button wa-button--secondary">
                <Printer aria-hidden className="wa-icon" />Print all or save as PDF
              </Link>
            </div>
            {exporting === "failed" && <p className="wa-error" role="alert">Your records could not be loaded. Check your connection and try again.</p>}
          </section>
        </>
      )}
    </>
  );
}

/** The four numbers on Home, each a filter on the consultations below it. Pressed again: all. */
type Filter = "needs" | "working" | "today" | "approved";
const WEEK_MS = 7 * 86_400_000;
const FILTER: Record<Filter, (row: Row, now: Date) => boolean> = {
  needs: (row) => summarise(row.status).group === "Needs you",
  working: (row) => summarise(row.status).group === "Watson is working",
  today: (row, now) => new Date(row.scheduled_at).toDateString() === now.toDateString(),
  approved: (row, now) => ["approved", "corrected"].includes(row.status) && Date.parse(row.updated_at) > now.getTime() - WEEK_MS,
};
const TILES: [Filter, string][] = [["needs", "Need you"], ["working", "Watson is working"], ["today", "Booked today"], ["approved", "Approved this week"]];

/** "at 11:00" today, else "on Thu 22 Oct 2026, 11:00". */
const nextWhen = (iso: string, now: Date) =>
  new Date(iso).toDateString() === now.toDateString() ? `at ${clockTime(iso, viewerZone())}` : `on ${dateTime(iso)}`;

function Case({ row }: { row: Row }) {
  const { tone, stages } = summarise(row.status);
  const answers = row.forms[0]?.form_answers ?? [];
  const answered = answers.filter((answer) => answer.machine_text !== null).length;
  const formReady = row.status === "draft_ready" || row.status === "under_review";
  const next = formReady ? `${answered} of ${answers.length} answered by Watson` : NEXT[row.status] ?? "";
  const fee = row.fee_cents === null ? null : row.paid_at ? `Paid ${euros(row.fee_cents)}` : "Not paid yet";
  const edge = tone === "failed" ? "wa-case--failed" : tone === "working" ? "wa-case--working" : "wa-case--attention";
  return (
    <Link href={formReady ? `/form/?id=${row.id}` : `/consultation/?id=${row.id}`} className={`wa-case ${edge}`}>
      <div className="wa-case__top">
        <span className={row.patients ? "wa-case__name" : "wa-case__ref"}>{row.patients?.name ?? "Patient not named yet"}</span>
        <StatusChip status={row.status} />
      </div>
      <p className="wa-case__meta">{[dateTime(row.scheduled_at), LANGUAGE_LABEL[row.language], fee,
        row.patients ? row.patients.phone ?? row.patients.email : row.synthetic_patient_ref].filter(Boolean).join(" · ")}</p>
      <div className="wa-dots" aria-hidden>
        {stages.map((state, index) => <span key={index} className={state === "pending" ? undefined : `is-${state}`} />)}
      </div>
      <p className="wa-case__next">{next}</p>
      <span className="wa-button wa-button--secondary wa-button--small" style={{ justifySelf: "start" }}>
        {formReady ? "Check the form" : "Open"}<ArrowRight aria-hidden className="wa-icon wa-icon--sm" />
      </span>
    </Link>
  );
}
