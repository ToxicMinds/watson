// Google Calendar for the `google` edge function: the rules that need no network, so they are
// tested on their own (apps/web/tests/google.test.ts). Plain Web APIs only: runs in Deno and Node.

/** Only what booking needs: who the account is, when they are busy, and Watson's own calendar. */
export const SCOPES = [
  "openid",
  "email",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/calendar.app.created",
];
const STATE_LIFETIME_MS = 10 * 60_000;

type State = { practitioner: string; site: string };
const encoder = new TextEncoder();
const base64url = (text: string) => btoa(text).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const unbase64url = (text: string) => atob(text.replace(/-/g, "+").replace(/_/g, "/"));
const key = (secret: string) =>
  crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);

/** A signed note of who started connecting and where to send them back, good for ten minutes. */
/** Where Google sends the practitioner back: the project's public address. On one computer the
 * server knows itself as http://kong:8000, so scripts/local.sh gives it WATSON_PUBLIC_URL. */
export const redirectFor = (env: Record<string, string | undefined>) =>
  `${env.WATSON_PUBLIC_URL || env.SUPABASE_URL}/functions/v1/google`;

export async function signState(state: State, secret: string, now = Date.now()): Promise<string> {
  const body = base64url(JSON.stringify({ ...state, until: now + STATE_LIFETIME_MS }));
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", await key(secret), encoder.encode(body)));
  return `${body}.${base64url(String.fromCharCode(...signature))}`;
}

/** The state, if it is ours, unchanged and not expired; otherwise null. */
export async function readState(state: string, secret: string): Promise<State | null> {
  const [body, signature, extra] = state.split(".");
  if (!body || !signature || extra !== undefined) return null;
  try {
    const bytes = Uint8Array.from(unbase64url(signature), (c) => c.charCodeAt(0));
    if (!(await crypto.subtle.verify("HMAC", await key(secret), bytes, encoder.encode(body)))) return null;
    const { practitioner, site, until } = JSON.parse(unbase64url(body));
    return typeof practitioner === "string" && typeof site === "string" && until > Date.now() ? { practitioner, site } : null;
  } catch {
    return null;
  }
}

/** Google's consent screen. Offline and consent: Google then always returns a refresh token. */
export function authUrl({ clientId, redirect, state }: { clientId: string; redirect: string; state: string }): string {
  const query = new URLSearchParams({
    client_id: clientId, redirect_uri: redirect, response_type: "code", scope: SCOPES.join(" "),
    access_type: "offline", prompt: "consent", state,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${query}`;
}

type FreeBusy = { calendars?: { primary?: { busy?: { start: string; end: string }[]; errors?: unknown[] } } };

/** The busy times in Google's freeBusy answer for the primary calendar. Throws if Google reports a problem. */
export function busyTimes(answer: FreeBusy): { starts_at: string; ends_at: string }[] {
  const primary = answer.calendars?.primary;
  if (!primary?.busy || primary.errors?.length) throw new Error("GOOGLE_UNAVAILABLE");
  return primary.busy.map(({ start, end }) => ({ starts_at: start, ends_at: end }));
}

type Due = { consultation_id: string; starts_at: string; minutes: number; who: string };

/**
 * The event a booking becomes in the practitioner's Watson calendar. Its id is the consultation's
 * (Google accepts lowercase hex), so a second write of the same booking is refused, not doubled.
 */
export function eventFor(due: Due, site: string) {
  const start = new Date(due.starts_at);
  return {
    id: due.consultation_id.replace(/-/g, ""),
    summary: `Watson: ${due.who}`,
    description: `Video consultation. Open it in Watson: ${site}/consultation/?id=${due.consultation_id}`,
    start: { dateTime: start.toISOString() },
    end: { dateTime: new Date(start.getTime() + due.minutes * 60_000).toISOString() },
  };
}
