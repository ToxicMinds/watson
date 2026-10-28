import { createClient } from "../_shared/deps.ts";
import { admin, env, reply } from "../_shared/server.ts";
import {
  isPatientEmail, normalizePatientEmail, otpCodeHash, otpContactHash, otpIpHash, randomOtpCode,
} from "../_shared/patient-otp.ts";

type ChallengeReply = { ok: boolean; error_category?: string };

const configured = () => Boolean(
  env("PATIENT_OTP_PEPPER") && env("GOOGLE_CLIENT_ID") && env("GOOGLE_CLIENT_SECRET")
  && env("GOOGLE_REFRESH_TOKEN") && env("PATIENT_OTP_FROM")
  && (env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY")),
);

function clientIp(request: Request): string {
  // Supabase's edge proxy sets this header. Ignore user-controlled alternate IP headers.
  return request.headers.get("x-forwarded-for")?.split(",", 1)[0]?.trim() || "unknown";
}

function base64Url(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64Lines(bytes: Uint8Array): string {
  let binary = "";
  for (let start = 0; start < bytes.length; start += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(start, start + 0x8000));
  }
  const encoded = btoa(binary);
  return encoded.match(/.{1,76}/g)?.join("\r\n") ?? "";
}

async function gmailAccessToken(): Promise<string> {
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: env("GOOGLE_CLIENT_ID"),
      client_secret: env("GOOGLE_CLIENT_SECRET"),
      refresh_token: env("GOOGLE_REFRESH_TOKEN"),
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({})) as { access_token?: string };
  if (!response.ok || !body.access_token) throw new Error("MAIL_UNAVAILABLE");
  return body.access_token;
}

async function sendCode(email: string, code: string): Promise<void> {
  const from = env("PATIENT_OTP_FROM");
  const html = `<!doctype html><html lang="en"><body style="font-family:Arial,sans-serif;color:#161b26"><h1>Your Watson sign-in code</h1><p>Enter this one-time code to sign in. It expires in 10 minutes.</p><p style="font-family:monospace;font-size:32px;letter-spacing:.2em"><strong>${code}</strong></p><p>If you did not request this code, ignore this email. Never share it.</p></body></html>`;
  const mime = [
    `From: Watson <${from}>`,
    `To: ${email}`,
    "Subject: Your Watson sign-in code",
    "MIME-Version: 1.0",
    'Content-Type: text/html; charset="UTF-8"',
    "Content-Transfer-Encoding: base64",
    "",
    base64Lines(new TextEncoder().encode(html)),
  ].join("\r\n");

  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${await gmailAccessToken()}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: base64Url(new TextEncoder().encode(mime)) }),
  });
  if (!response.ok) throw new Error("MAIL_UNAVAILABLE");
}

async function rpcChallenge(
  name: "issue_patient_otp_challenge" | "verify_patient_otp_challenge",
  args: { p_contact_hash: string; p_code_hash: string; p_ip_hash: string },
): Promise<ChallengeReply> {
  const { data, error } = await admin.rpc(name, args);
  if (error) throw new Error("CHALLENGE_UNAVAILABLE");
  return data as ChallengeReply;
}

async function issue(email: string, ip: string): Promise<{ status: number; body: unknown }> {
  const pepper = env("PATIENT_OTP_PEPPER");
  const contactHash = await otpContactHash(pepper, email);
  const code = randomOtpCode();
  const ipHash = await otpIpHash(pepper, ip);
  const codeHash = await otpCodeHash(pepper, contactHash, code);
  const result = await rpcChallenge("issue_patient_otp_challenge", {
    p_contact_hash: contactHash, p_code_hash: codeHash, p_ip_hash: ipHash,
  });
  if (!result.ok) {
    const status = result.error_category === "RATE_LIMITED" || result.error_category === "LOCKED" ? 429 : 503;
    return { status, body: { ok: false, error: result.error_category ?? "UNAVAILABLE" } };
  }

  try {
    await sendCode(email, code);
  } catch {
    // Revoke the unsent challenge by locking it. Do not expose mail-provider details.
    try {
      await admin.rpc("cancel_patient_otp_challenge", {
        p_contact_hash: contactHash, p_code_hash: codeHash,
      });
    } catch {
      // Keep the mail failure generic if challenge cancellation is also unavailable.
    }
    return { status: 503, body: { ok: false, error: "MAIL_UNAVAILABLE" } };
  }
  return { status: 200, body: { ok: true } };
}

async function existingUser(email: string) {
  // Avoid a second identity store: Auth Admin is canonical. Bounded pages prevent
  // unbounded work; ordinary accounts are found in the first page in this project.
  for (let page = 1; page <= 10; page++) {
    const { data, error } = await admin.auth.admin.listUsers({ page, perPage: 1000 });
    if (error) throw new Error("AUTH_UNAVAILABLE");
    const user = data.users.find((candidate) => candidate.email?.toLowerCase() === email);
    if (user) return user;
    if (data.users.length < 1000) return null;
  }
  throw new Error("AUTH_UNAVAILABLE");
}

function jwtSessionId(accessToken: string): string | null {
  try {
    const payload = accessToken.split(".")[1];
    if (!payload) return null;
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const decoded = JSON.parse(atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="))) as {
      session_id?: unknown;
    };
    return typeof decoded.session_id === "string"
      && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(decoded.session_id)
      ? decoded.session_id
      : null;
  } catch {
    return null;
  }
}

async function makeSession(email: string): Promise<{ access_token: string; refresh_token: string }> {
  let user = await existingUser(email);
  if (!user) {
    const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true });
    if (error || !data.user) throw new Error("AUTH_UNAVAILABLE");
    user = data.user;
  } else if (!user.email_confirmed_at) {
    const { data, error } = await admin.auth.admin.updateUserById(user.id, { email_confirm: true });
    if (error || !data.user) throw new Error("AUTH_UNAVAILABLE");
    user = data.user;
  }

  const { data: provisioned, error: provisionError } = await admin.rpc("provision_patient_role_after_otp", {
    p_user_id: user.id,
  });
  if (provisionError || !(provisioned as ChallengeReply | null)?.ok) throw new Error("ROLE_UNAVAILABLE");

  const { data: link, error: linkError } = await admin.auth.admin.generateLink({ type: "magiclink", email });
  const tokenHash = link.properties?.hashed_token;
  if (linkError || !tokenHash) throw new Error("AUTH_UNAVAILABLE");

  const publicKey = env("SUPABASE_ANON_KEY") || env("SUPABASE_PUBLISHABLE_KEY");
  if (!publicKey) throw new Error("AUTH_UNAVAILABLE");
  const sessionClient = createClient(env("SUPABASE_URL"), publicKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await sessionClient.auth.verifyOtp({ token_hash: tokenHash, type: "email" });
  if (error || !data.session?.access_token || !data.session.refresh_token) throw new Error("AUTH_UNAVAILABLE");
  const { data: verifiedUser, error: userError } = await admin.auth.getUser(data.session.access_token);
  const sessionId = jwtSessionId(data.session.access_token);
  if (userError || verifiedUser.user?.id !== user.id || !sessionId) throw new Error("AUTH_UNAVAILABLE");
  const { data: registered, error: registrationError } = await admin.rpc("register_patient_otp_session", {
    p_user_id: user.id,
    p_session_id: sessionId,
  });
  if (registrationError || !(registered as ChallengeReply | null)?.ok) throw new Error("AUTH_UNAVAILABLE");
  return { access_token: data.session.access_token, refresh_token: data.session.refresh_token };
}

async function verify(email: string, code: string, ip: string): Promise<{ status: number; body: unknown }> {
  const pepper = env("PATIENT_OTP_PEPPER");
  const contactHash = await otpContactHash(pepper, email);
  const [codeHash, ipHash] = await Promise.all([
    otpCodeHash(pepper, contactHash, code), otpIpHash(pepper, ip),
  ]);
  const result = await rpcChallenge("verify_patient_otp_challenge", {
    p_contact_hash: contactHash, p_code_hash: codeHash, p_ip_hash: ipHash,
  });
  if (!result.ok) {
    const status = result.error_category === "RATE_LIMITED" || result.error_category === "LOCKED" ? 429 : 400;
    return { status, body: { ok: false, error: result.error_category ?? "INVALID_CODE" } };
  }
  const session = await makeSession(email);
  return { status: 200, body: { ok: true, session } };
}

Deno.serve(async (request) => {
  const origin = request.headers.get("Origin");
  if (request.method === "OPTIONS") return reply(origin, 204, null);
  if (request.method !== "POST") return reply(origin, 405, { error: "METHOD" });
  if (!configured()) return reply(origin, 503, { error: "NOT_CONFIGURED" });

  let payload: { action?: unknown; email?: unknown; code?: unknown };
  try {
    payload = await request.json();
  } catch {
    return reply(origin, 400, { error: "VALIDATION" });
  }
  const email = typeof payload.email === "string" ? normalizePatientEmail(payload.email) : "";
  if (!isPatientEmail(email)) return reply(origin, 400, { error: "VALIDATION" });

  try {
    const outcome = payload.action === "send"
      ? await issue(email, clientIp(request))
      : payload.action === "verify" && typeof payload.code === "string" && /^\d{8}$/.test(payload.code)
        ? await verify(email, payload.code, clientIp(request))
        : { status: 400, body: { error: "VALIDATION" } };
    return reply(origin, outcome.status, outcome.body);
  } catch (error) {
    console.error("patient OTP request failed", error instanceof Error ? error.message : "unknown");
    return reply(origin, 503, { ok: false, error: "UNAVAILABLE" });
  }
});
