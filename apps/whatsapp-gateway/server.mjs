// Watson's own WhatsApp (owner's decisions of 16 Oct 2026: no registered business for Meta to
// verify, no card anywhere): a copy of Synculariti's Baileys sidecar on Render's free plan. It links
// one WhatsApp number the way WhatsApp Web does, and calls only Watson's whatsapp function:
// - what arrives: a link-up code from anyone, photos and PDFs from Watson's patients (filter.mjs).
//   Nothing else on the number leaves this service, and nothing of a message is logged.
// - what to send: Watson's answer to each message, and every minute the reminders that are due.
// - its pairing: kept in Watson's database, sealed here (sealed.mjs), since Render wipes the disk.
// It answers three addresses: /health for Watson's five-minute knock (which also keeps the free
// service awake), /, the QR code that links the number, behind a password, and /send, a message Watson
// hands over to send at once (a sign-in code, send.mjs), behind the secret Watson and the gateway share.
import { createServer } from "node:http";
import makeWASocket, {
  Browsers, BufferJSON, DisconnectReason, downloadMediaMessage, fetchLatestBaileysVersion, initAuthCreds,
  makeCacheableSignalKeyStore, proto,
} from "@whiskeysockets/baileys";
import pino from "pino";
import QRCode from "qrcode";
import { forWatson, senderPhone } from "./filter.mjs";
import { mayPair, seal, unseal } from "./sealed.mjs";
import { sendRequest } from "./send.mjs";

const WATSON_URL = process.env.WATSON_URL ?? ""; // https://<project>.supabase.co/functions/v1/whatsapp
const SECRET = process.env.WATSON_GATEWAY_SECRET ?? "";
const STATE_KEY = Buffer.from(process.env.WATSON_STATE_KEY ?? "", "hex"); // 32 bytes, as 64 hex digits
const PAIRING_PASSWORD = process.env.PAIRING_PASSWORD ?? "";
if (!WATSON_URL || !SECRET || STATE_KEY.length !== 32) {
  console.error("[gateway] WATSON_URL, WATSON_GATEWAY_SECRET and WATSON_STATE_KEY (64 hex digits) must be set.");
  process.exit(1);
}
const MAX_BYTES = 10 * 1024 * 1024;
const READABLE = /^(image\/(jpeg|png|webp)|application\/pdf)$/;
const logger = pino({ level: "silent" });

let sock = null;
let auth = null;
let status = "STARTING";
let qr = null;
let patients = new Set(); // numbers (digits) Watson may receive photos from; Watson refreshes it with every answer

/** One call to Watson's whatsapp function. */
async function ask(body) {
  const response = await fetch(WATSON_URL, {
    method: "POST", headers: { "Content-Type": "application/json", "x-watson-gateway": SECRET }, body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`Watson answered ${response.status}`);
  return await response.json();
}

/** Tells Watson something; then sends whatever Watson answers, one message a second. */
async function tell(body) {
  const answer = await ask(body);
  patients = new Set((answer.contacts ?? []).map((phone) => phone.replace(/^\+/, "")));
  for (const { id, to, text } of answer.send ?? []) {
    try {
      if (status !== "CONNECTED") throw new Error("Not connected");
      await sock.sendMessage(`${to.replace(/^\+/, "")}@s.whatsapp.net`, { text });
    } catch (error) {
      await ask({ event: "failed", id, error: String(error).slice(0, 200) }).catch(() => {});
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

/**
 * The pairing, as Baileys' own useMultiFileAuthState keeps it, but in Watson's database: read once
 * at connection, written in small batches, each value sealed under its own name.
 */
async function useWatsonAuthState() {
  const { state: stored } = await ask({ event: "state-read" });
  const plain = new Map(Object.entries(stored ?? {}).map(([name, value]) => [name, unseal(value, STATE_KEY, name)]));
  const read = (name) => (plain.has(name) ? JSON.parse(plain.get(name), BufferJSON.reviver) : null);
  let changes = {};
  let timer = null;
  let flushing = Promise.resolve();
  const flush = () => {
    clearTimeout(timer);
    timer = null;
    const batch = changes;
    changes = {};
    if (Object.keys(batch).length === 0) return flushing;
    flushing = flushing.then(() => ask({ event: "state-write", changes: batch })).catch((error) => {
      console.log("[gateway] pairing not saved, retrying:", String(error).slice(0, 120));
      changes = { ...batch, ...changes };
      timer ??= setTimeout(flush, 5000);
    });
    return flushing;
  };
  const write = (name, value) => {
    if (value) {
      const text = JSON.stringify(value, BufferJSON.replacer);
      plain.set(name, text);
      changes[name] = seal(text, STATE_KEY, name);
    } else {
      plain.delete(name);
      changes[name] = null;
    }
    timer ??= setTimeout(flush, 100);
  };
  const creds = read("creds") ?? initAuthCreds();
  return {
    state: {
      creds,
      keys: {
        get: async (type, ids) => Object.fromEntries(ids.map((id) => {
          const value = read(`${type}-${id}`);
          return [id, type === "app-state-sync-key" && value ? proto.Message.AppStateSyncKeyData.fromObject(value) : value];
        })),
        set: async (data) => {
          for (const type in data) for (const id in data[type]) write(`${type}-${id}`, data[type][id]);
        },
      },
    },
    saveCreds: async () => write("creds", creds),
    flush,
    /** Unlinked from the phone: the old pairing goes, so a new QR code can be offered. */
    forget: async () => {
      for (const name of [...plain.keys()]) write(name, null);
      await flush();
    },
  };
}

/** A message's text, or its photo or document; null for anything else (stickers, voice, video…). */
function contentOf(message) {
  const m = message.message;
  if (!m) return null;
  const text = m.conversation ?? m.extendedTextMessage?.text;
  if (typeof text === "string") return { text };
  const media = m.imageMessage ?? m.documentMessage ?? m.documentWithCaptionMessage?.message?.documentMessage;
  if (!media) return null;
  return { media: { type: String(media.mimetype ?? "").split(";")[0], fileName: media.fileName ?? undefined, size: Number(String(media.fileLength ?? 0)) } };
}

async function passOn(message) {
  const phone = senderPhone(message.key);
  const content = contentOf(message);
  const passed = content && forWatson(phone, content, patients);
  if (!passed) return;
  const out = { id: message.key.id, from: phone, name: message.pushName ?? undefined };
  if (passed.text !== undefined) {
    out.text = passed.text;
  } else {
    const { type, fileName, size } = passed.media;
    if (!READABLE.test(type)) out.media = { type, fileName }; // Watson answers that it reads photos and PDFs
    else if (size > MAX_BYTES) out.media = { type, fileName, tooLarge: true };
    else {
      const bytes = await downloadMediaMessage(message, "buffer", {}, { logger, reuploadRequest: sock.updateMediaMessage });
      out.media = bytes.length > MAX_BYTES ? { type, fileName, tooLarge: true } : { type, fileName, data: bytes.toString("base64") };
    }
  }
  await tell({ event: "message", message: out });
}

async function connect() {
  const { version } = await fetchLatestBaileysVersion();
  auth = await useWatsonAuthState();
  sock = makeWASocket({
    version, logger,
    auth: { creds: auth.state.creds, keys: makeCacheableSignalKeyStore(auth.state.keys, logger) },
    browser: Browsers.ubuntu("Watson"),
    // The number is the owner's own: their phone keeps its notifications, and old chats are not fetched.
    markOnlineOnConnect: false, syncFullHistory: false,
  });
  sock.ev.on("creds.update", auth.saveCreds);
  sock.ev.on("messages.upsert", async ({ messages, type }) => {
    if (type !== "notify") return; // history and the number's own sends are not new messages
    for (const message of messages ?? []) {
      await passOn(message).catch((error) => console.log("[gateway] a message was not passed on:", String(error).slice(0, 200)));
    }
  });
  sock.ev.on("connection.update", async ({ connection, lastDisconnect, qr: code }) => {
    if (code) {
      qr = await QRCode.toDataURL(code);
      status = "SCAN_QR";
    }
    if (connection === "open") {
      status = "CONNECTED";
      qr = null;
      console.log("[gateway] connected");
      tell({ event: "poll" }).catch((error) => console.log("[gateway] poll failed:", String(error).slice(0, 200)));
    }
    if (connection === "close") {
      const loggedOut = lastDisconnect?.error?.output?.statusCode === DisconnectReason.loggedOut;
      status = loggedOut ? "LOGGED_OUT" : "RECONNECTING";
      qr = null; // an old code would only fail to scan
      console.log(`[gateway] ${status.toLowerCase()}`);
      if (loggedOut) await auth.forget().catch(() => {});
      setTimeout(() => connect().catch((error) => console.log("[gateway] connect failed:", String(error))), loggedOut ? 1000 : 5000);
    }
  });
}

setInterval(() => {
  if (status === "CONNECTED") tell({ event: "poll" }).catch((error) => console.log("[gateway] poll failed:", String(error).slice(0, 200)));
}, 60_000);

// Render stops the service with SIGTERM (a restart, a deploy): the last changes to the pairing go first.
process.on("SIGTERM", async () => {
  await auth?.flush().catch(() => {});
  process.exit(0);
});

/** /send: one message from Watson, sent now. Answers 200 once WhatsApp has taken it. */
async function sendNow(request, response) {
  let raw = "";
  for await (const chunk of request) {
    raw += chunk;
    if (raw.length > 4096) return response.writeHead(413).end();
  }
  let body = null;
  try {
    body = JSON.parse(raw);
  } catch {
    // an unreadable body is refused below
  }
  const message = sendRequest(request.headers["x-watson-gateway"], SECRET, body);
  if (!message) return response.writeHead(403).end();
  if (status !== "CONNECTED") return response.writeHead(503).end();
  try {
    await sock.sendMessage(message.to, { text: message.text });
    response.writeHead(200, { "Content-Type": "application/json" }).end(JSON.stringify({ ok: true }));
  } catch {
    response.writeHead(502).end();
  }
}

createServer((request, response) => {
  if (request.method === "POST" && request.url === "/send") return void sendNow(request, response);
  if (request.url === "/health") {
    response.writeHead(200, { "Content-Type": "application/json" });
    return response.end(JSON.stringify({ status }));
  }
  if (request.url !== "/") return response.writeHead(404).end();
  if (!mayPair(request.headers.authorization, PAIRING_PASSWORD)) {
    return response.writeHead(401, { "WWW-Authenticate": 'Basic realm="Watson", charset="UTF-8"' }).end();
  }
  const body = status === "CONNECTED"
    ? "<h1>Watson's WhatsApp is linked</h1><p>You can close this window.</p>"
    : `<h1>Link Watson's WhatsApp</h1><p>On the phone: WhatsApp, Settings, Linked devices, Link a device. Then scan:</p>
       ${qr ? `<img src="${qr}" width="300" height="300" alt="QR code to link the number">` : "<p>Preparing a code…</p>"}
       <p>Status: ${status}. This page refreshes every 5 seconds.</p>`;
  response.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" });
  response.end(`<!doctype html><meta http-equiv="refresh" content="5"><body style="font-family:sans-serif;text-align:center;padding:40px">${body}</body>`);
}).listen(Number(process.env.PORT ?? 8080), "0.0.0.0");

connect().catch((error) => console.log("[gateway] connect failed:", String(error)));
