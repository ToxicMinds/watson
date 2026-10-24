// The Google Calendar edge function's own rules, run here without Google: the signed state that
// carries the practitioner through Google's consent screen, the consent address, how busy times
// are read from Google's answer, and the event a booking becomes in the practitioner's calendar.
import { describe, expect, it } from "vitest";
import { authUrl, busyTimes, eventFor, readState, redirectFor, signState, SCOPES } from "../../../supabase/functions/_shared/google";

const SECRET = "test-secret";

describe("the state sent through Google's consent screen", () => {
  it("comes back as the practitioner and site it was made for", async () => {
    const state = await signState({ practitioner: "p-1", site: "https://watson.example" }, SECRET);
    expect(await readState(state, SECRET)).toEqual({ practitioner: "p-1", site: "https://watson.example" });
  });

  it("is refused when changed, signed with another key, or older than ten minutes", async () => {
    const state = await signState({ practitioner: "p-1", site: "https://watson.example" }, SECRET);
    const [body, signature] = state.split(".");
    const forged = `${btoa(JSON.stringify({ practitioner: "p-2", site: "https://watson.example", until: Date.now() + 60_000 }))}.${signature}`;
    expect(await readState(forged, SECRET)).toBeNull();
    expect(await readState(`${body}.${signature}x`, SECRET)).toBeNull();
    expect(await readState(state, "another-secret")).toBeNull();
    expect(await readState("nonsense", SECRET)).toBeNull();
    const old = await signState({ practitioner: "p-1", site: "https://watson.example" }, SECRET, Date.now() - 11 * 60_000);
    expect(await readState(old, SECRET)).toBeNull();
  });
});

describe("Google's consent screen", () => {
  it("asks only to see when the practitioner is free and to keep Watson's own calendar, offline", () => {
    expect(SCOPES).toEqual(["openid", "email", "https://www.googleapis.com/auth/calendar.freebusy", "https://www.googleapis.com/auth/calendar.app.created"]);
    const url = new URL(authUrl({ clientId: "client-1", redirect: "https://fn.example/google", state: "s.t" }));
    expect(url.origin + url.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: "client-1", redirect_uri: "https://fn.example/google", response_type: "code", scope: SCOPES.join(" "),
      access_type: "offline", prompt: "consent", state: "s.t",
    });
  });
});

describe("busy times from Google", () => {
  it("are read from the primary calendar's answer", () => {
    const answer = { calendars: { primary: { busy: [{ start: "2026-10-26T08:00:00Z", end: "2026-10-26T09:30:00Z" }] } } };
    expect(busyTimes(answer)).toEqual([{ starts_at: "2026-10-26T08:00:00Z", ends_at: "2026-10-26T09:30:00Z" }]);
    expect(busyTimes({ calendars: { primary: { busy: [] } } })).toEqual([]);
  });

  it("are not trusted when Google reports an error for the calendar", () => {
    expect(() => busyTimes({ calendars: { primary: { errors: [{ reason: "notFound" }] } } })).toThrow("GOOGLE_UNAVAILABLE");
    expect(() => busyTimes({})).toThrow("GOOGLE_UNAVAILABLE");
  });
});

describe("a booking in the practitioner's Google Calendar", () => {
  it("names the patient, lasts the consultation's length and links back to Watson", () => {
    const id = "6a0d1c6d-1ea9-445c-bedc-8a55a43538ca";
    const event = eventFor({ consultation_id: id, starts_at: "2026-10-26T08:00:00+00:00", minutes: 45, who: "Jana Nováková" }, "https://watson.example");
    expect(event).toEqual({
      // Google keeps one event per id, so writing the same booking twice cannot make two events.
      id: "6a0d1c6d1ea9445cbedc8a55a43538ca",
      summary: "Watson: Jana Nováková",
      description: `Video consultation. Open it in Watson: https://watson.example/consultation/?id=${id}`,
      start: { dateTime: "2026-10-26T08:00:00.000Z" },
      end: { dateTime: "2026-10-26T08:45:00.000Z" },
    });
  });
});

describe("the address Google sends the practitioner back to", () => {
  it("is the project's public address, also on one computer, where the server knows itself by an inner name", () => {
    expect(redirectFor({ SUPABASE_URL: "https://ref.supabase.co" })).toBe("https://ref.supabase.co/functions/v1/google");
    expect(redirectFor({ SUPABASE_URL: "http://kong:8000", WATSON_PUBLIC_URL: "http://127.0.0.1:54321" }))
      .toBe("http://127.0.0.1:54321/functions/v1/google");
  });
});
