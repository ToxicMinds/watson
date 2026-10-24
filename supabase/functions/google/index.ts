// Google Calendar (owner, 16 October): a practitioner connects their Google account once. Watson
// then reads when they are busy (never what), and writes bookings into a calendar of its own there.
// After Google's guides: https://developers.google.com/identity/protocols/oauth2/web-server and
// https://developers.google.com/workspace/calendar/api/v3/reference/freebusy/query
//
// POST from the web app, as the signed-in practitioner: {action: "connect" | "refresh" | "disconnect"}.
// POST from the database's schedule, with the x-watson-cron secret: reads every connected calendar.
// GET: Google sends the practitioner back here from its consent screen.
import { authUrl, busyTimes, eventFor, readState, redirectFor, SCOPES, signState } from "../_shared/google.ts";
import { admin, env, reply, sameSecret, SITE, SITES } from "../_shared/server.ts";

const CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const REDIRECT = redirectFor({ SUPABASE_URL: env("SUPABASE_URL"), WATSON_PUBLIC_URL: env("WATSON_PUBLIC_URL") });
const LOOKAHEAD_MS = 35 * 86_400_000; // as far ahead as patients can see times
const configured = () => Boolean(env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET"));

type Connection = { practitioner_id: string; refresh_token: string; calendar_id: string };
type Due = { consultation_id: string; starts_at: string; minutes: number; who: string };

/** Google's token endpoint: a code for keys, or a refresh token for a fresh access key. */
async function token(fields: Record<string, string>): Promise<Record<string, string>> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env("GOOGLE_CLIENT_ID"), client_secret: env("GOOGLE_CLIENT_SECRET"), ...fields }),
  });
  return await response.json();
}

async function accessToken(connection: Connection): Promise<string> {
  const answer = await token({ grant_type: "refresh_token", refresh_token: connection.refresh_token });
  if (answer.access_token) return answer.access_token;
  throw new Error(answer.error === "invalid_grant" ? "GOOGLE_REVOKED" : "GOOGLE_UNAVAILABLE");
}

/** One Calendar API call. 409 (that event exists already) is an answer, not a failure. */
async function calendar(path: string, access: string, body: unknown): Promise<{ status: number; data: Record<string, unknown> }> {
  const response = await fetch(`${CALENDAR_API}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (response.status === 401) throw new Error("GOOGLE_REVOKED");
  if (!response.ok && response.status !== 409) throw new Error("GOOGLE_UNAVAILABLE");
  return { status: response.status, data: await response.json() };
}

/** Reads the practitioner's busy times and writes their due bookings. A failure is recorded, not thrown. */
async function sync(connection: Connection): Promise<boolean> {
  const who = connection.practitioner_id;
  try {
    const access = await accessToken(connection);
    const now = Date.now();
    const { data: freeBusy } = await calendar("/freeBusy", access, {
      timeMin: new Date(now).toISOString(), timeMax: new Date(now + LOOKAHEAD_MS).toISOString(), items: [{ id: "primary" }],
    });
    await admin.rpc("google_replace_busy", { p_practitioner: who, p_busy: busyTimes(freeBusy) });
    const { data: due } = await admin.rpc("google_events_due", { p_practitioner: who });
    for (const booking of (due?.events ?? []) as Due[]) {
      const event = eventFor(booking, SITE);
      await calendar(`/calendars/${encodeURIComponent(connection.calendar_id)}/events`, access, event);
      await admin.rpc("google_event_written", { p_consultation: booking.consultation_id, p_event_id: event.id });
    }
    return true;
  } catch (error) {
    const problem = error instanceof Error && error.message === "GOOGLE_REVOKED" ? "GOOGLE_REVOKED" : "GOOGLE_UNAVAILABLE";
    console.error("google sync failed", problem);
    await admin.rpc("google_problem", { p_practitioner: who, p_problem: problem });
    return false;
  }
}

async function connection(practitioner: string): Promise<Connection | null> {
  const { data } = await admin.from("google_calendars").select("practitioner_id, refresh_token, calendar_id")
    .eq("practitioner_id", practitioner).maybeSingle();
  return data;
}

/** Back from Google's consent screen: keep the keys, make Watson's calendar, read the first busy times. */
async function returning(url: URL): Promise<Response> {
  const state = await readState(url.searchParams.get("state") ?? "", env("GOOGLE_CLIENT_SECRET"));
  const site = state && SITES.includes(state.site) ? state.site : SITE;
  const back = (result: "connected" | "refused" | "failed") => Response.redirect(`${site}/calendar/?google=${result}`, 303);
  if (!state) return back("failed");
  if (url.searchParams.get("error")) return back("refused");
  try {
    const keys = await token({ grant_type: "authorization_code", code: url.searchParams.get("code") ?? "", redirect_uri: REDIRECT });
    // Google lets people untick each permission; without both calendar ones, booking cannot work.
    const granted = (keys.scope ?? "").split(" ");
    if (!SCOPES.slice(2).every((scope) => granted.includes(scope))) return back("refused");
    if (!keys.refresh_token || !keys.id_token) return back("failed");
    // The id token comes straight from Google's token endpoint over TLS, so its payload can be read as is.
    const email = String(JSON.parse(atob(keys.id_token.split(".")[1].replace(/-/g, "+").replace(/_/g, "/"))).email ?? "");

    const previous = await connection(state.practitioner);
    let calendarId = previous?.calendar_id;
    if (!calendarId) {
      const { data: page } = await admin.from("practitioner_profiles").select("time_zone").eq("practitioner_id", state.practitioner).maybeSingle();
      const { data: made } = await calendar("/calendars", keys.access_token, {
        summary: "Watson", description: "Consultations booked through Watson", timeZone: page?.time_zone ?? "Europe/Bratislava",
      });
      calendarId = String(made.id);
    }
    await admin.rpc("google_save_connection", {
      p_practitioner: state.practitioner, p_email: email, p_refresh_token: keys.refresh_token, p_calendar_id: calendarId,
    });
    await sync({ practitioner_id: state.practitioner, refresh_token: keys.refresh_token, calendar_id: calendarId });
    return back("connected");
  } catch (error) {
    console.error("google connect failed", error instanceof Error ? error.message : "unknown");
    return back("failed");
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return reply(origin, 204, null);
  if (request.method === "GET") return await returning(new URL(request.url));
  if (request.method !== "POST") return reply(origin, 405, { error: "METHOD" });
  if (!configured()) return reply(origin, 503, { error: "NOT_CONFIGURED" });

  // The database's schedule: read every connected calendar.
  const cron = request.headers.get("x-watson-cron");
  if (cron !== null) {
    if (!sameSecret(cron, env("CRON_SECRET"))) return reply(origin, 403, { error: "FORBIDDEN" });
    const { data: all } = await admin.from("google_calendars").select("practitioner_id, refresh_token, calendar_id");
    const results = await Promise.all(((all ?? []) as Connection[]).map(sync));
    return reply(origin, 200, { ok: true, read: results.filter(Boolean).length, failed: results.filter((r) => !r).length });
  }

  // The web app, as the signed-in practitioner.
  if (!origin || !SITES.includes(origin)) return reply(origin, 403, { error: "FORBIDDEN" });
  const jwt = (request.headers.get("Authorization") ?? "").replace(/^Bearer /, "");
  const { data: { user } } = await admin.auth.getUser(jwt);
  if (!user) return reply(origin, 401, { error: "NOT_SIGNED_IN" });
  let action: unknown;
  try {
    action = (await request.json())?.action;
  } catch {
    return reply(origin, 400, { error: "VALIDATION" });
  }

  if (action === "connect") {
    const state = await signState({ practitioner: user.id, site: origin }, env("GOOGLE_CLIENT_SECRET"));
    return reply(origin, 200, { url: authUrl({ clientId: env("GOOGLE_CLIENT_ID"), redirect: REDIRECT, state }) });
  }
  const linked = await connection(user.id);
  if (!linked) return reply(origin, 404, { error: "NOT_CONNECTED" });
  if (action === "refresh") return reply(origin, 200, { ok: await sync(linked) });
  if (action === "disconnect") {
    // Tell Google first (best effort), so the key stops working there too.
    await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(linked.refresh_token)}`, { method: "POST" }).catch(() => null);
    await admin.rpc("google_disconnect", { p_practitioner: user.id });
    return reply(origin, 200, { ok: true });
  }
  return reply(origin, 400, { error: "VALIDATION" });
});
