// A consultation made free (owner, 24 Oct: "when its 0 the payment needs to be bypassed"; unpaid
// consultations get a "Make it free" button). The fee goes, a booked time stops waiting for the
// payment, and the patient's page asks for nothing.
import { beforeAll, describe, expect, it } from "vitest";
import { browserClient, localStack, newPractitioner, rpc, sqlAsOwner, type Practitioner } from "./local-stack";

const stack = localStack();
const patient = browserClient(stack); // no account: the public key only
let eva: Practitioner;
beforeAll(async () => {
  eva = await newPractitioner(stack, "free");
});

const withFee = async (who = eva) => (await rpc(who.client, "create_consultation", {
  p_scheduled_at: "2026-10-28T09:00:00Z", p_language: "en", p_consent_recorded: true, p_fee_cents: 4000,
})).consultation_id as string;
const makeFree = (id: string, who = eva) => rpc(who.client, "make_consultation_free", { p_consultation_id: id });

describe("making a consultation free", () => {
  it("drops the fee, so the patient's page asks for nothing, and the audit log says who did it", async () => {
    const id = await withFee();
    expect(await makeFree(id)).toEqual({ ok: true });
    expect(await makeFree(id)).toEqual({ ok: true }); // pressed twice: done once
    const { data } = await eva.client.from("consultations").select("fee_cents, invite_token").eq("id", id).single();
    expect(data!.fee_cents).toBeNull();
    expect(await rpc(patient, "invite_details", { p_token: data!.invite_token })).toMatchObject({ ok: true, fee_cents: null });
    expect(sqlAsOwner(`select string_agg(actor_role, ',') from public.audit_events where consultation_id = '${id}' and event_type = 'fee.waived';`)).toBe("practitioner");
  });

  it("is refused once the patient has paid, and for another practitioner's consultation", async () => {
    const id = await withFee();
    sqlAsOwner(`update public.consultations set paid_at = now(), paid_amount_cents = 4000 where id = '${id}';`);
    expect(await makeFree(id)).toEqual({ ok: false, error_category: "INVALID_STATE_TRANSITION" });
    const other = await newPractitioner(stack, "free-other");
    expect(await makeFree(await withFee(), other)).toEqual({ ok: false, error_category: "NOT_FOUND" });
  });
});

describe("making a booked consultation free", () => {
  const from = new Date(Date.now() + 2 * 86_400_000).toISOString();
  const to = new Date(Date.now() + 4 * 86_400_000).toISOString();
  const every = Object.fromEntries(["1", "2", "3", "4", "5", "6", "7"].map((day) => [day, ["09:00", "12:00"]]));
  async function bookedUnpaid(label: string) {
    const who = await newPractitioner(stack, label);
    const { slug } = await rpc(who.client, "save_booking_page", {
      p_display_name: "Dr. Eva Test", p_offer: "", p_about: "", p_languages: ["en"], p_hours: every,
      p_length_minutes: 45, p_gap_minutes: 15, p_fee_cents: 4000,
    });
    const times = async () => (await rpc(patient, "booking_times", { p_slug: slug, p_from: from, p_to: to })).times as string[];
    const [first] = await times();
    const book = (name: string) => rpc(patient, "book_time", {
      p_slug: slug, p_starts_at: first, p_name: name, p_contact: `+421 905 ${Math.floor(Math.random() * 9e5 + 1e5)}`, p_language: "en", p_remind_whatsapp: false,
    });
    expect(await book("Jana Nováková")).toMatchObject({ ok: true });
    const { data } = await who.client.from("consultations").select("id").single();
    return { who, id: data!.id, first, times, book };
  }
  const waitRanOut = (id: string) => sqlAsOwner(`update public.consultations set hold_until = now() - interval '1 minute' where id = '${id}';`);

  it("keeps its time for good: it no longer waits for the payment", async () => {
    const { who, id, first, times } = await bookedUnpaid("free-booked");
    expect(await makeFree(id, who)).toEqual({ ok: true });
    expect(sqlAsOwner(`select hold_until is null from public.consultations where id = '${id}';`)).toBe("t");
    expect(await times()).not.toContain(first);
  });

  it("whose wait ran out takes its time back, unless another patient has booked it since", async () => {
    const back = await bookedUnpaid("free-back");
    await waitRanOut(back.id);
    expect(await makeFree(back.id, back.who)).toEqual({ ok: true });
    expect(await back.times()).not.toContain(back.first);

    const taken = await bookedUnpaid("free-taken");
    await waitRanOut(taken.id);
    expect(await taken.book("Peter Adamec")).toMatchObject({ ok: true });
    expect(await makeFree(taken.id, taken.who)).toEqual({ ok: false, error_category: "TIME_TAKEN" });
  });
});
