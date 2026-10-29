// Watson's sign-in codes by WhatsApp (owner, 28 Oct: "through my number"): Watson hands the gateway one
// message to send at once, instead of waiting for the minute's poll. Only Watson, with the gateway's
// secret, may ask, and only for a short text to one phone number.
import assert from "node:assert/strict";
import { test } from "node:test";
import { sendRequest } from "./send.mjs";

const SECRET = "s3cret-from-watson";

test("Watson's request with the secret is a message to send", () => {
  assert.deepEqual(sendRequest(SECRET, SECRET, { to: "+421905111222", text: "Your Watson code: 12345678" }),
    { to: "421905111222@s.whatsapp.net", text: "Your Watson code: 12345678" });
});

test("without the secret, or with a wrong one, nothing is sent", () => {
  const body = { to: "+421905111222", text: "Hi" };
  assert.equal(sendRequest(undefined, SECRET, body), null);
  assert.equal(sendRequest("s3cret-from-watsoN", SECRET, body), null);
  assert.equal(sendRequest("", "", body), null);
});

test("only one phone number with its country code, and a short text", () => {
  for (const to of ["421905111222", "+0905111222", "+42190511122233344", "+421 905 111 222", "x@s.whatsapp.net", undefined]) {
    assert.equal(sendRequest(SECRET, SECRET, { to, text: "Hi" }), null, String(to));
  }
  assert.equal(sendRequest(SECRET, SECRET, { to: "+421905111222", text: "" }), null);
  assert.equal(sendRequest(SECRET, SECRET, { to: "+421905111222", text: "x".repeat(501) }), null);
  assert.equal(sendRequest(SECRET, SECRET, null), null);
});
