// Watson hands the gateway one message to send at once (a sign-in code; owner, 28 Oct), instead of
// waiting for the minute's poll. Only Watson, with the gateway's secret, may ask, and only for a short
// text to one phone number with its country code. Nothing of the message is logged or kept.
import { timingSafeEqual } from "node:crypto";

/** The WhatsApp address and text to send, or null when the request is not Watson's or not acceptable. */
export function sendRequest(header, secret, body) {
  const given = Buffer.from(header ?? "");
  const expected = Buffer.from(secret ?? "");
  if (expected.length === 0 || given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
  const { to, text } = body ?? {};
  if (typeof to !== "string" || !/^\+[1-9][0-9]{6,14}$/.test(to)) return null;
  if (typeof text !== "string" || text.length === 0 || text.length > 500) return null;
  return { to: `${to.slice(1)}@s.whatsapp.net`, text };
}
