const OTP_LENGTH = 8;
const OTP_RANGE = 10 ** OTP_LENGTH;
const UINT32_RANGE = 2 ** 32;
const ACCEPT_BELOW = Math.floor(UINT32_RANGE / OTP_RANGE) * OTP_RANGE;

export function normalizePatientEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isPatientEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** A WhatsApp number as the database's private.normal_phone reads it (+ and 7-15 digits), or null. */
export function normalizePatientPhone(phone: string): string | null {
  const digits = phone.trim().replace(/^00/, "+").replace(/[^0-9+]/g, "");
  return /^\+[1-9][0-9]{6,14}$/.test(digits) ? digits : null;
}

/** The Auth account behind a WhatsApp sign-in needs an email to open a session; this one reaches nobody. */
export function phoneSignInEmail(phone: string): string {
  return `whatsapp-${phone.replace(/^\+/, "")}@patients.watson.invalid`;
}

/** The WhatsApp message that carries a sign-in code. */
export function whatsappCodeMessage(code: string): string {
  return `Your Watson sign-in code is ${code}. It expires in 10 minutes. Never share it with anyone.`;
}

export function randomOtpCode(): string {
  const values = new Uint32Array(1);
  do crypto.getRandomValues(values);
  while (values[0] >= ACCEPT_BELOW);
  return String(values[0] % OTP_RANGE).padStart(OTP_LENGTH, "0");
}

async function hmacHex(secret: string, domain: string, value: string): Promise<string> {
  if (new TextEncoder().encode(secret).byteLength < 32) throw new Error("PATIENT_OTP_PEPPER must be at least 32 bytes");
  const key = await crypto.subtle.importKey(
    "raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"],
  );
  const signature = new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`${domain}\0${value}`)));
  return Array.from(signature, (byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function otpContactHash(secret: string, email: string): Promise<string> {
  return hmacHex(secret, "patient-otp-contact-v1", normalizePatientEmail(email));
}

export function otpIpHash(secret: string, ip: string): Promise<string> {
  return hmacHex(secret, "patient-otp-ip-v1", ip.trim());
}

export function otpCodeHash(secret: string, contactHash: string, code: string): Promise<string> {
  if (!/^[0-9a-f]{64}$/.test(contactHash) || !/^\d{8}$/.test(code)) {
    throw new Error("Invalid OTP challenge input");
  }
  return hmacHex(secret, "patient-otp-code-v1", `${contactHash}\0${code}`);
}
