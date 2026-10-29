// A call's ICE servers, asked for by both browsers with the consultation's link token. With Watson's
// relay set up (TURN_KEY_ID and TURN_KEY_API_TOKEN, a Cloudflare TURN key), each call gets Cloudflare STUN and relay
// credentials that expire after RELAY_SECONDS; without it, or if Cloudflare does not answer, STUN alone.
import { RELAY_SECONDS, STUN, usable, type IceServer } from "../_shared/ice.ts";
import { admin, env, reply } from "../_shared/server.ts";

const TOKEN = /^[0-9a-f]{64}$/;

async function relay(): Promise<IceServer[]> {
  const key = env("TURN_KEY_ID");
  const secret = env("TURN_KEY_API_TOKEN");
  if (!key || !secret) return [];
  try {
    const response = await fetch(`https://rtc.live.cloudflare.com/v1/turn/keys/${key}/credentials/generate-ice-servers`, {
      method: "POST",
      headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
      body: JSON.stringify({ ttl: RELAY_SECONDS }),
    });
    const body = await response.json().catch(() => ({})) as { iceServers?: IceServer[] };
    if (!response.ok || !Array.isArray(body.iceServers)) throw new Error(`HTTP ${response.status}`);
    return usable(body.iceServers);
  } catch (error) {
    console.error("relay credentials unavailable", error instanceof Error ? error.message : "unknown");
    return [];
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return reply(origin, 204, null);
  if (request.method !== "POST") return reply(origin, 405, { error: "METHOD" });
  const { token } = await request.json().catch(() => ({})) as { token?: unknown };
  if (typeof token !== "string" || !TOKEN.test(token)) return reply(origin, 400, { error: "VALIDATION" });
  // Only someone holding a real consultation's link gets relay credentials.
  const { data, error } = await admin.from("consultations").select("id").eq("invite_token", token).maybeSingle();
  if (error) return reply(origin, 503, { error: "UNAVAILABLE" });
  if (!data) return reply(origin, 404, { error: "NOT_FOUND" });
  const relayed = await relay();
  return reply(origin, 200, { iceServers: relayed.length ? relayed : STUN });
});
