"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { PatientShell } from "@/components/patient-shell";
import { Notice } from "@/components/status";
import { useSession } from "@/lib/session";
import { supabase } from "@/lib/supabase";

export default function PatientHome() {
  const session = useSession();
  const router = useRouter();
  const [signingOut, setSigningOut] = useState(false);

  useEffect(() => {
    if (session.status === "signed-out") router.replace("/patient/sign-in/");
  }, [session.status, router]);

  async function signOut() {
    setSigningOut(true);
    await supabase.auth.signOut();
    router.replace("/patient/sign-in/");
  }

  return (
    <PatientShell>
      {session.status !== "signed-in" || session.roles === null ? (
        <p role="status" className="wa-meta">Checking your verified sign-in…</p>
      ) : !session.roles.includes("patient") ? (
        <Notice tone="failed" title="Patient access is unavailable">
          This account does not have patient access. Sign in with the email used for your patient account.
        </Notice>
      ) : (
        <>
          <div className="wa-pagehead">
            <div className="wa-pagehead__text">
              <p className="wa-hero__eyebrow wa-voice--patient">Patient account</p>
              <h1 className="wa-title">You’re signed in</h1>
              <p className="wa-meta">Verified email: <strong>{session.user.email}</strong></p>
            </div>
            <button type="button" className="wa-button wa-button--secondary" disabled={signingOut} onClick={() => void signOut()}>
              {signingOut ? "Signing out…" : "Sign out"}
            </button>
          </div>
          <section className="wa-panel" aria-labelledby="consultation-access-title">
            <h2 id="consultation-access-title" className="wa-heading">Your consultation</h2>
            <p className="wa-text">Open the private consultation link your practitioner sent you to view its details or send documents. Your verified sign-in does not reveal other consultations.</p>
          </section>
        </>
      )}
    </PatientShell>
  );
}
