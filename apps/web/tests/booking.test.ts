// Booking (owner, 16 October): a practitioner opens hours on their page; patients see the open
// times (minus consultations and Google Calendar busy times) and book one; an unpaid booking holds
// its time for a while, then lets it go. Times are counted in the practitioner's time zone.
import { beforeAll, describe, expect, it } from "vitest";
import { adminClient, browserClient, localStack, newPractitioner, rpc, sqlAsOwner, type Practitioner } from "./local-stack";

const stack = localStack();
const server = adminClient(stack);
const patient = browserClient(stack); // no account: the public key only


const ZONE = "Europe/Bratislava";
/** "2026-10-26 09:00": an instant as the practitioner's wall clock shows it. */
const local = (iso: string) => new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, dateStyle: "short", timeStyle: "short" }).format(new Date(iso));
const day = (date: Date) => new Intl.DateTimeFormat("sv-SE", { timeZone: ZONE, dateStyle: "short" }).format(date);

// A Monday at least three days ahead, and a window around it wide enough for any time zone.
const monday = new Date(Date.now() + 3 * 86_400_000);
monday.setUTCDate(monday.getUTCDate() + ((8 - monday.getUTCDay()) % 7));
const MONDAY = day(monday);
const from = new Date(monday.getTime() - 86_400_000).toISOString();
const to = new Date(monday.getTime() + 2 * 86_400_000).toISOString();

const MONDAY_MORNING = { "1": ["09:00", "12:00"] };
const page = (overrides: object = {}) => ({
  p_display_name: "Dr. Eva Test", p_offer: "Ayurveda · sleep", p_about: "Since 2014.",
  p_languages: ["en", "sk"], p_hours: MONDAY_MORNING, p_length_minutes: 45, p_gap_minutes: 15, p_fee_cents: 4000,
  ...overrides,
});
const booking = (slug: string, startsAt: string, overrides: object = {}) => ({
  p_slug: slug, p_starts_at: startsAt, p_name: "Jana Nováková", p_contact: "+421 905 111 222",
  p_language: "sk", p_remind_whatsapp: true, ...overrides,
});

async function openPage(who: Practitioner, overrides: object = {}) {
  const saved = await rpc(who.client, "save_booking_page", page(overrides));
  expect(saved).toMatchObject({ ok: true });
  return saved.slug as string;
}
const times = async (slug: string) => {
  const answer = await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to });
  expect(answer.ok).toBe(true);
  return (answer.times as string[]).map(local);
};

let eva: Practitioner;
let evaSlug: string;
beforeAll(async () => {
  eva = await newPractitioner(stack, "eva");
  evaSlug = await openPage(eva);
});

describe("a practitioner's booking page", () => {
  it("takes its address from the practitioner's login name", () => {
    expect(evaSlug).toBe(eva.email.split("@")[0]);
  });

  it("refuses hours that are not a weekday with a start before its end, and a page without a language", async () => {
    const who = await newPractitioner(stack, "hours");
    for (const hours of [{ "8": ["09:00", "12:00"] }, { "1": ["12:00", "09:00"] }, { "1": ["9am", "noon"] }, { "1": ["09:00"] }]) {
      expect(await rpc(who.client, "save_booking_page", page({ p_hours: hours }))).toEqual({ ok: false, error_category: "VALIDATION", field: "hours" });
    }
    expect(await rpc(who.client, "save_booking_page", page({ p_languages: ["auto"] }))).toEqual({ ok: false, error_category: "VALIDATION", field: "languages" });
    expect(await rpc(who.client, "save_booking_page", page({ p_languages: [] }))).toEqual({ ok: false, error_category: "VALIDATION", field: "languages" });
    expect(await rpc(who.client, "save_booking_page", page({ p_display_name: " " }))).toEqual({ ok: false, error_category: "VALIDATION", field: "display_name" });
  });

  it("can be changed, and keeps its address", async () => {
    const who = await newPractitioner(stack, "change");
    const first = await openPage(who);
    expect(await openPage(who, { p_display_name: "Dr. Changed", p_fee_cents: null })).toBe(first);
    const answer = await rpc(patient, "booking_times", { p_slug: first, p_from: from, p_to: to });
    expect(answer.practitioner).toMatchObject({ display_name: "Dr. Changed", fee_cents: null });
  });

  it("is not readable as a table by patients; they see it only through booking_times", async () => {
    expect((await patient.from("practitioner_profiles" as never).select("*")).data ?? []).toEqual([]);
  });
});

describe("open times", () => {
  it("offers no times and rejects stale slots after the doctor closes all days", async () => {
    const who = await newPractitioner(stack, "closed-direct");
    const slug = await openPage(who);
    const previouslyOpen = await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to });
    const staleSlot = (previouslyOpen.times as string[])[0];
    expect(staleSlot).toBeDefined();

    await openPage(who, { p_hours: {} });
    const closed = await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to });
    expect(closed).toMatchObject({ ok: true, times: [] });
    expect(await rpc(patient, "book_time", booking(slug, staleSlot)))
      .toEqual({ ok: false, error_category: "TIME_TAKEN" });
  });

  it("fall on a grid of consultation length plus the time between, inside the hours, on the practitioner's clock", async () => {
    expect(await times(evaSlug)).toEqual([`${MONDAY} 09:00`, `${MONDAY} 10:00`, `${MONDAY} 11:00`]);
  });

  it("leave out consultations and Google Calendar busy times", async () => {
    const who = await newPractitioner(stack, "busy");
    const slug = await openPage(who);
    const [nine, ten, eleven] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const made = await rpc(who.client, "create_consultation", {
      p_synthetic_patient_ref: "SYN-0101", p_scheduled_at: nine, p_language: "en", p_consent_recorded: true,
    });
    expect(made.ok).toBe(true);
    // Busy from 10:30 to 10:40 overlaps the 10:00 time (until 10:45); the 11:00 time stays open.
    const busyStart = new Date(Date.parse(ten) + 30 * 60_000).toISOString();
    const busyEnd = new Date(Date.parse(ten) + 40 * 60_000).toISOString();
    expect(await rpc(server, "google_replace_busy", { p_practitioner: who.id, p_busy: [{ starts_at: busyStart, ends_at: busyEnd }] })).toEqual({ ok: true });
    expect(await times(slug)).toEqual([local(eleven)]);

    // A fresh read from Google replaces the old busy times, all at once.
    expect(await rpc(server, "google_replace_busy", { p_practitioner: who.id, p_busy: [] })).toEqual({ ok: true });
    expect(await times(slug)).toEqual([local(ten), local(eleven)]);
  });

  it("start at least two hours from now", async () => {
    const who = await newPractitioner(stack, "soon");
    const always = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((d) => [d, ["00:00", "24:00"]]));
    const slug = await openPage(who, { p_hours: always, p_length_minutes: 30, p_gap_minutes: 0 });
    const answer = await rpc(patient, "booking_times", { p_slug: slug, p_from: new Date().toISOString(), p_to: new Date(Date.now() + 4 * 3_600_000).toISOString() });
    const first = Date.parse((answer.times as string[])[0]);
    expect(first).toBeGreaterThanOrEqual(Date.now() + 2 * 3_600_000 - 60_000);
    expect(first).toBeLessThan(Date.now() + 2 * 3_600_000 + 30 * 60_000);
  });

  it("are asked for at most five weeks at a time, for a page that exists", async () => {
    expect(await rpc(patient, "booking_times", { p_slug: evaSlug, p_from: from, p_to: new Date(Date.parse(from) + 36 * 86_400_000).toISOString() }))
      .toEqual({ ok: false, error_category: "VALIDATION", field: "range" });
    expect(await rpc(patient, "booking_times", { p_slug: "nobody-here", p_from: from, p_to: to })).toEqual({ ok: false, error_category: "NOT_FOUND" });
  });
});

describe("booking a time", () => {
  it("creates the consultation for the patient, holds the time while they pay, and gives them their link", async () => {
    const who = await newPractitioner(stack, "book");
    const slug = await openPage(who);
    const [nine] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const booked = await rpc(patient, "book_time", booking(slug, nine));
    expect(booked).toMatchObject({ ok: true });
    expect(booked.token).toMatch(/^[0-9a-f]{64}$/);

    const { data: made } = await who.client.from("consultations")
      .select("scheduled_at, duration_minutes, fee_cents, language, status, booked_at, hold_until, remind_whatsapp, invite_token, patients(name, phone)").single();
    expect(made).toMatchObject({
      duration_minutes: 45, fee_cents: 4000, language: "sk", status: "consent_pending", remind_whatsapp: true,
      invite_token: booked.token, patients: { name: "Jana Nováková", phone: "+421905111222" },
    });
    expect(Date.parse(made!.scheduled_at)).toBe(Date.parse(nine));
    expect(Date.parse(made!.hold_until!) - Date.parse(made!.booked_at!)).toBe(35 * 60_000);
    expect(await times(slug)).toEqual([`${MONDAY} 10:00`, `${MONDAY} 11:00`]);
    expect(await rpc(patient, "invite_details", { p_token: booked.token })).toMatchObject({ ok: true, fee_cents: 4000, paid: false, booked_from: slug });
  });

  it("gives a time to one patient only, even when two book it at the same moment", async () => {
    const who = await newPractitioner(stack, "race");
    const slug = await openPage(who);
    const [nine] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const answers = await Promise.all([
      rpc(patient, "book_time", booking(slug, nine)),
      rpc(browserClient(stack), "book_time", booking(slug, nine, { p_contact: "+421 905 333 444", p_name: "Peter Kováč" })),
    ]);
    expect(answers.map((a) => a.ok).sort()).toEqual([false, true]);
    expect(answers.find((a) => !a.ok)).toEqual({ ok: false, error_category: "TIME_TAKEN" });
    expect((await who.client.from("consultations").select("id")).data).toHaveLength(1);
  });

  it("refuses a time that is not on offer, and incomplete details", async () => {
    const [nine] = (await rpc(patient, "booking_times", { p_slug: evaSlug, p_from: from, p_to: to })).times as string[];
    const offGrid = new Date(Date.parse(nine) + 15 * 60_000).toISOString();
    expect(await rpc(patient, "book_time", booking(evaSlug, offGrid))).toEqual({ ok: false, error_category: "TIME_TAKEN" });
    expect(await rpc(patient, "book_time", booking(evaSlug, nine, { p_name: "" }))).toEqual({ ok: false, error_category: "VALIDATION", field: "name" });
    expect(await rpc(patient, "book_time", booking(evaSlug, nine, { p_contact: "call me" }))).toEqual({ ok: false, error_category: "VALIDATION", field: "contact" });
    expect(await rpc(patient, "book_time", booking(evaSlug, nine, { p_language: "de" }))).toEqual({ ok: false, error_category: "VALIDATION", field: "language" });
    expect((await eva.client.from("consultations").select("id")).data).toEqual([]);
  });

  it("lets an unpaid time go when the hold runs out; paying again renews the hold only while the time is free", async () => {
    const who = await newPractitioner(stack, "hold");
    const slug = await openPage(who);
    const [nine] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const first = await rpc(patient, "book_time", booking(slug, nine));
    expect(await rpc(server, "renew_hold", { p_token: first.token })).toMatchObject({ ok: true });

    sqlAsOwner(`update public.consultations set hold_until = now() - interval '1 minute' where invite_token = '${first.token}';`);
    expect(await times(slug)).toContain(local(nine));
    expect(await rpc(server, "renew_hold", { p_token: first.token })).toMatchObject({ ok: true });
    expect(await times(slug)).not.toContain(local(nine));

    sqlAsOwner(`update public.consultations set hold_until = now() - interval '1 minute' where invite_token = '${first.token}';`);
    const second = await rpc(patient, "book_time", booking(slug, nine, { p_contact: "+421 905 555 666", p_name: "Peter Kováč" }));
    expect(second.ok).toBe(true);
    expect(await rpc(server, "renew_hold", { p_token: first.token })).toEqual({ ok: false, error_category: "TIME_TAKEN" });
  });

  it("that was let go leaves the practitioner's list; a paid or free one stays", async () => {
    const who = await newPractitioner(stack, "gone");
    const slug = await openPage(who);
    const [nine, ten] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const unpaid = await rpc(patient, "book_time", booking(slug, nine));
    await rpc(patient, "book_time", booking(slug, ten, { p_contact: "+421 905 777 888" }));
    sqlAsOwner(`update public.consultations set hold_until = now() - interval '1 minute' where invite_token = '${unpaid.token}';`);
    const { data } = await who.client.from("consultations").select("scheduled_at, released").eq("released" as never, false as never);
    expect((data as unknown as { scheduled_at: string }[]).map((row) => Date.parse(row.scheduled_at))).toEqual([Date.parse(ten)]);
  });

  it("is limited to three upcoming times per patient, so one number cannot fill a practitioner's week", async () => {
    const who = await newPractitioner(stack, "limit");
    const always = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((d) => [d, ["08:00", "18:00"]]));
    const slug = await openPage(who, { p_hours: always, p_fee_cents: null });
    const open = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    for (const time of open.slice(0, 3)) expect((await rpc(patient, "book_time", booking(slug, time))).ok).toBe(true);
    expect(await rpc(patient, "book_time", booking(slug, open[3]))).toEqual({ ok: false, error_category: "TOO_MANY_BOOKINGS" });
    expect((await rpc(patient, "book_time", booking(slug, open[3], { p_contact: "+421 905 444 555" }))).ok).toBe(true);
  });

  it("of a free consultation holds nothing: the time is simply booked", async () => {
    const who = await newPractitioner(stack, "free");
    const slug = await openPage(who, { p_fee_cents: null });
    const [nine] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    expect((await rpc(patient, "book_time", booking(slug, nine))).ok).toBe(true);
    const { data } = await who.client.from("consultations").select("fee_cents, hold_until").single();
    expect(data).toEqual({ fee_cents: null, hold_until: null });
  });

  it("made by the practitioner is not from a booking page, so the patient's link offers no page to book again", async () => {
    const made = await rpc(eva.client, "create_consultation", { p_synthetic_patient_ref: "SYN-0102", p_scheduled_at: from, p_language: "en", p_consent_recorded: true });
    const { data } = await eva.client.from("consultations").select("invite_token").eq("id", made.consultation_id!).single();
    expect(await rpc(patient, "invite_details", { p_token: data!.invite_token })).toMatchObject({ ok: true, booked_from: null });
  });
});

describe("finding a practitioner", () => {
  it("lists every page, with the next free time when one is available", async () => {
    const closed = await newPractitioner(stack, "closed");
    const closedSlug = await openPage(closed, { p_hours: {} });
    const answer = await rpc(patient, "find_practitioners", {});
    const listed = answer.practitioners as { slug: string; next_free: string | null }[];
    expect(listed.find((p) => p.slug === closedSlug)).toMatchObject({ slug: closedSlug, next_free: null });
    const mine = listed.find((p) => p.slug === evaSlug)!;
    expect(mine).toMatchObject({ display_name: "Dr. Eva Test", offer: "Ayurveda · sleep", languages: ["en", "sk"], length_minutes: 45, fee_cents: 4000 });
    expect(local(mine.next_free!)).toMatch(/ 09:00$/);
  });
});

describe("the practitioner's week", () => {
  it("shows their open times, their Google busy times and the state of their Google connection", async () => {
    const who = await newPractitioner(stack, "week");
    await openPage(who);
    expect(await rpc(server, "google_save_connection", { p_practitioner: who.id, p_email: "eva@gmail.example", p_refresh_token: "secret-refresh", p_calendar_id: "watson-calendar" })).toEqual({ ok: true });
    const [nine] = (await rpc(who.client, "calendar_week", { p_from: from, p_to: to })).open as string[];
    await rpc(server, "google_replace_busy", { p_practitioner: who.id, p_busy: [{ starts_at: nine, ends_at: new Date(Date.parse(nine) + 90 * 60_000).toISOString() }] });

    const week = await rpc(who.client, "calendar_week", { p_from: from, p_to: to });
    expect((week.open as string[]).map(local)).toEqual([`${MONDAY} 11:00`]);
    expect(week.busy).toEqual([{ starts_at: expect.any(String), ends_at: expect.any(String) }]);
    expect(week.google).toMatchObject({ email: "eva@gmail.example", problem: null });
    expect(JSON.stringify(week)).not.toContain("secret-refresh");
    expect(week.page).toMatchObject({ display_name: "Dr. Eva Test", hours: MONDAY_MORNING });
    expect(week.bookings).toEqual([]);
  });

  it("lists the bookings that still take their time, with the patient's name and whether they paid", async () => {
    const who = await newPractitioner(stack, "agenda");
    const slug = await openPage(who);
    const [nine, ten, eleven] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    await rpc(patient, "book_time", booking(slug, nine));
    const gone = await rpc(patient, "book_time", booking(slug, ten, { p_contact: "+421 905 999 000", p_name: "Peter Kováč" }));
    sqlAsOwner(`update public.consultations set hold_until = now() - interval '1 minute' where invite_token = '${gone.token}';`);
    const made = await rpc(who.client, "create_consultation", { p_synthetic_patient_ref: "SYN-0103", p_scheduled_at: eleven, p_language: "en", p_consent_recorded: true });

    const week = await rpc(who.client, "calendar_week", { p_from: from, p_to: to });
    expect(week.bookings).toEqual([
      { consultation_id: expect.any(String), starts_at: expect.any(String), minutes: 45, who: "Jana Nováková", paid: false, held: true },
      { consultation_id: made.consultation_id, starts_at: expect.any(String), minutes: 45, who: "SYN-0103", paid: null, held: false },
    ]);
  });

  it("keeps Google's keys out of every browser's reach", async () => {
    expect((await eva.client.from("google_calendars" as never).select("*")).error).not.toBeNull();
    expect((await patient.rpc("google_replace_busy" as never, { p_practitioner: eva.id, p_busy: [] } as never)).error).not.toBeNull();
  });
});

describe("bookings written into the practitioner's Google Calendar", () => {
  it("are the upcoming paid or free ones without an event yet; an unpaid hold waits", async () => {
    const who = await newPractitioner(stack, "events");
    const slug = await openPage(who);
    const [nine, ten, eleven] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const paid = await rpc(patient, "book_time", booking(slug, nine));
    await rpc(patient, "book_time", booking(slug, ten, { p_contact: "+421 905 222 333", p_name: "Held Patient" }));
    sqlAsOwner(`update public.consultations set paid_at = now() where invite_token = '${paid.token}';`);
    const free = await rpc(who.client, "create_consultation", { p_synthetic_patient_ref: "SYN-0104", p_scheduled_at: eleven, p_language: "en", p_consent_recorded: true });

    const due = await rpc(server, "google_events_due", { p_practitioner: who.id });
    expect(due.events).toEqual([
      { consultation_id: expect.any(String), starts_at: expect.any(String), minutes: 45, who: "Jana Nováková" },
      { consultation_id: free.consultation_id, starts_at: expect.any(String), minutes: 45, who: "SYN-0104" },
    ]);
    const [first] = due.events as { consultation_id: string }[];
    expect(await rpc(server, "google_event_written", { p_consultation: first.consultation_id, p_event_id: "event-1" })).toEqual({ ok: true });
    expect(((await rpc(server, "google_events_due", { p_practitioner: who.id })).events as unknown[]).length).toBe(1);
    expect((await patient.rpc("google_events_due" as never, { p_practitioner: who.id } as never)).error).not.toBeNull();
  });

  it("are written again into a new calendar when the practitioner connects another one", async () => {
    const who = await newPractitioner(stack, "again");
    const slug = await openPage(who, { p_fee_cents: null });
    const [nine] = (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    await rpc(patient, "book_time", booking(slug, nine));
    await rpc(server, "google_save_connection", { p_practitioner: who.id, p_email: "a@gmail.example", p_refresh_token: "r1", p_calendar_id: "calendar-1" });
    const [due] = (await rpc(server, "google_events_due", { p_practitioner: who.id })).events as { consultation_id: string }[];
    await rpc(server, "google_event_written", { p_consultation: due.consultation_id, p_event_id: "event-1" });
    // The same calendar again (a new key): nothing to write. Another calendar: everything again.
    await rpc(server, "google_save_connection", { p_practitioner: who.id, p_email: "a@gmail.example", p_refresh_token: "r2", p_calendar_id: "calendar-1" });
    expect((await rpc(server, "google_events_due", { p_practitioner: who.id })).events).toEqual([]);
    await rpc(server, "google_save_connection", { p_practitioner: who.id, p_email: "b@gmail.example", p_refresh_token: "r3", p_calendar_id: "calendar-2" });
    expect((await rpc(server, "google_events_due", { p_practitioner: who.id })).events).toHaveLength(1);
  });
});
