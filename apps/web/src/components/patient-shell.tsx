"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { useSession } from "@/lib/session";

/** Frame for the pages patients use without an account: the front page, booking and privacy. */
export function PatientShell({ children }: { children: ReactNode }) {
  const session = useSession();
  return (
    <>
      <header className="wa-header">
        <div className="wa-header__inner">
          <Link href="/" className="wa-wordmark" aria-label="Watson, find a practitioner">Watson</Link>
          {session.status === "signed-in"
            ? <Link href={session.roles?.includes("patient") ? "/patient/" : "/consultations/"} className="wa-crumb">
              {session.roles?.includes("patient") ? "Your account" : "Your consultations"}
            </Link>
            : <nav className="wa-public-signin" aria-label="Sign in">
              <Link href="/patient/sign-in/" className="wa-crumb">Patient sign-in</Link>
              <Link href="/sign-in/" className="wa-crumb">Practitioner sign-in</Link>
            </nav>}
        </div>
      </header>
      <main className="wa-page">{children}</main>
      <footer className="wa-page" style={{ paddingTop: 0 }}>
        <p className="wa-meta"><Link href="/privacy/">Privacy</Link></p>
      </footer>
    </>
  );
}
