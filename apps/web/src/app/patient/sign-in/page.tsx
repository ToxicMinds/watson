"use client";

import { CircleAlert } from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState, type FormEvent } from "react";
import { Notice } from "@/components/status";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

const RESEND_WAIT_SECONDS = 60;

export default function PatientSignIn() {
  const session = useSession();
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [sent, setSent] = useState(false);
  const [sentAt, setSentAt] = useState<number | null>(null);
  const [now, setNow] = useState(0);
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState<string | null>(null);

  useEffect(() => {
    if (session.status === "signed-in" && session.roles?.includes("patient")) router.replace("/patient/");
  }, [session, router]);

  useEffect(() => {
    if (sentAt === null) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [sentAt]);

  const resendIn = sentAt === null
    ? 0
    : Math.max(0, RESEND_WAIT_SECONDS - Math.floor((now - sentAt) / 1000));

  async function requestCode() {
    setFailure(null);
    const normalizedEmail = email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail)) {
      setFailure("Enter a valid email address.");
      return;
    }
    if (resendIn > 0) return;

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<{ ok: boolean }>("patient-otp", {
        body: { action: "send", email: normalizedEmail },
      });
      if (error || !data?.ok) throw error ?? new Error("OTP send failed");
      setEmail(normalizedEmail);
      setSent(true);
      setSentAt(Date.now());
    } catch {
      setFailure("We couldn’t send a code right now. Check the address and try again shortly.");
    } finally {
      setBusy(false);
    }
  }

  async function verifyCode(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFailure(null);
    if (!/^\d{8}$/.test(code)) {
      setFailure("Enter the eight-digit code from your email.");
      return;
    }

    setBusy(true);
    try {
      const { data, error } = await supabase.functions.invoke<{
        ok: boolean;
        session?: { access_token: string; refresh_token: string };
      }>("patient-otp", { body: { action: "verify", email, code } });
      if (error || !data?.ok || !data.session) throw error ?? new Error("OTP verification failed");
      const { error: sessionError } = await supabase.auth.setSession(data.session);
      if (sessionError) throw sessionError;
      router.replace("/patient/");
    } catch {
      setFailure("That code is invalid or has expired. Request a new code and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <main className="wa-night">
      <div className="wa-door">
        <header className="wa-door__head">
          <Link href="/" className="wa-wordmark" aria-label="Watson home">Watson</Link>
          <h1 className="wa-door__title">Your care, kept together.</h1>
          <p className="wa-door__lead">Sign in to verify your email and access your patient account.</p>
        </header>

        <section className="wa-panel wa-door__card" aria-labelledby="patient-sign-in-title">
          <h2 id="patient-sign-in-title" className="wa-heading">Patient sign-in</h2>
          {!sent ? (
            <form onSubmit={(event) => { event.preventDefault(); void requestCode(); }} noValidate className="wa-form" style={{ gap: 16 }}>
              <p className="wa-hint">We’ll email you a one-time code. No password needed.</p>
              <div className="wa-field">
                <label className="wa-label" htmlFor="patient-email">Email address</label>
                <input id="patient-email" type="email" autoComplete="email" inputMode="email"
                  autoCapitalize="none" spellCheck={false} className="wa-input" required
                  value={email} onChange={(event) => setEmail(event.target.value)} />
              </div>
              {failure && <Notice tone="failed" title="Code not sent"><CircleAlert aria-hidden className="wa-icon" />{failure}</Notice>}
              <button type="submit" className="wa-button wa-button--primary" disabled={busy} aria-busy={busy || undefined}>
                {busy ? "Sending code…" : "Email me a code"}
              </button>
            </form>
          ) : (
            <form onSubmit={verifyCode} noValidate className="wa-form" style={{ gap: 16 }}>
              <p className="wa-hint">If this email can sign in, a code is on its way to <strong>{email}</strong>. It expires in 10 minutes.</p>
              <div className="wa-field">
                <label className="wa-label" htmlFor="patient-code">Eight-digit code</label>
                <input id="patient-code" type="text" inputMode="numeric" autoComplete="one-time-code"
                  pattern="[0-9]{8}" maxLength={8} className="wa-input wa-mono" required
                  aria-describedby="patient-code-hint" value={code}
                  onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 8))} />
                <p id="patient-code-hint" className="wa-hint">Check your inbox and spam folder.</p>
              </div>
              {failure && <Notice tone="failed" title="Couldn’t sign in"><CircleAlert aria-hidden className="wa-icon" />{failure}</Notice>}
              <button type="submit" className="wa-button wa-button--primary" disabled={busy} aria-busy={busy || undefined}>
                {busy ? "Checking code…" : "Verify and sign in"}
              </button>
              <button type="button" className="wa-button wa-button--secondary" disabled={busy || resendIn > 0}
                onClick={() => { void requestCode(); }}>
                {resendIn > 0 ? `Send another code in ${resendIn}s` : "Send another code"}
              </button>
              <button type="button" className="wa-button wa-button--secondary" disabled={busy}
                onClick={() => { setSent(false); setCode(""); setSentAt(null); setFailure(null); }}>
                Use a different email
              </button>
            </form>
          )}
          <p className="wa-hint">Are you a practitioner? <Link href="/sign-in/">Sign in here</Link>.</p>
        </section>
      </div>
    </main>
  );
}
