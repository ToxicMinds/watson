// What every Watson edge function shares: its settings, the server's database client, and how it
// answers the web app.
import { createClient } from "./deps.ts";

export const env = (name: string) => Deno.env.get(name) ?? "";

/** The web app's own addresses. Only these may call a function from a browser; the first is where links point. */
export const SITES = env("SITE_URLS").split(",").map((site) => site.trim()).filter(Boolean);
export const SITE = SITES[0] ?? "https://watson-assists.onrender.com";

// The service key reaches the server-only database functions. Nothing it reads goes to a browser unchecked.
export const admin = createClient(env("SUPABASE_URL"), env("SUPABASE_SERVICE_ROLE_KEY"), { auth: { persistSession: false } });

/** A JSON answer to the web app; cross-origin access only for the web app's own addresses. */
export function reply(origin: string | null, status: number, body: unknown): Response {
  const headers: Record<string, string> = { "Content-Type": "application/json", Vary: "Origin" };
  if (origin && SITES.includes(origin)) {
    headers["Access-Control-Allow-Origin"] = origin;
    headers["Access-Control-Allow-Headers"] = "authorization, x-client-info, apikey, content-type";
    headers["Access-Control-Allow-Methods"] = "POST, OPTIONS";
  }
  return new Response(body === null ? null : JSON.stringify(body), { status, headers });
}

/** Compares two secrets in time that does not depend on where they differ. */
export function sameSecret(given: string, expected: string): boolean {
  let difference = given.length ^ expected.length;
  for (let i = 0; i < expected.length; i++) difference |= (given.charCodeAt(i) || 0) ^ expected.charCodeAt(i);
  return expected.length > 0 && difference === 0;
}
