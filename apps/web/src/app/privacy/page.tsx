import type { Metadata } from "next";
import { PatientShell } from "@/components/patient-shell";

// Watson's privacy page (Google asks for one before Watson's sign-in app is published; owner approved
// publishing, 28 Oct 2026). Plain words, facts checked against the setup on 29 Oct: the database in
// Frankfurt, the engine on Modal in Europe, calls relayed by Cloudflare, codes by Gmail or WhatsApp.
export const metadata: Metadata = {
  title: "Privacy",
  description: "What Watson keeps about patients and practitioners, where it is kept, who sees it and how to ask for it to be deleted.",
  alternates: { canonical: "/privacy/" },
};

const CONTACT = "watson.assists@gmail.com";

export default function PrivacyPage() {
  return (
    <PatientShell>
      <div className="wa-pagehead">
        <div className="wa-pagehead__text">
          <h1 className="wa-title">Privacy</h1>
          <p className="wa-meta">
            Watson helps practitioners hold consultations by video, write them up and keep their patients&rsquo; records.
            This page says what Watson keeps, where, and whom to ask. Last changed 29 October 2026.
          </p>
        </div>
      </div>

      <section className="wa-panel" aria-labelledby="keeps">
        <h2 className="wa-heading" id="keeps">What Watson keeps</h2>
        <ul className="wa-text">
          <li>When you book or open your consultation link: your name, your phone number or email, the language you speak, and the documents you send, such as lab results, letters or photos.</li>
          <li>Once you agree to it, the consultation call: each voice recorded on its own, the written transcript, and the form your practitioner fills in from it.</li>
          <li>If you sign in: your email address or WhatsApp number, proven with a one-time code. There is no password.</li>
          <li>If you write to Watson on WhatsApp: your number, and the photos and PDFs you send. Other chats on that number are never read.</li>
          <li>If you pay: Stripe takes your card. Watson only learns that you paid, and how much.</li>
          <li>Nothing for advertising, and no tracking cookies. Your browser keeps only what keeps you signed in.</li>
        </ul>
      </section>

      <section className="wa-panel" aria-labelledby="where">
        <h2 className="wa-heading" id="where">Where it is kept</h2>
        <ul className="wa-text">
          <li>Watson&rsquo;s database and files: at Supabase, in Frankfurt, Germany.</li>
          <li>Writing the transcript, reading documents and filling in the form: Watson&rsquo;s engine, on computers in Europe rented from Modal, a company in the United States. Recordings and documents stay there only while they are being worked on.</li>
          <li>The calls: straight from one browser to the other. When a phone network stands in the way, they pass through Cloudflare&rsquo;s relay, still encrypted from end to end, so Cloudflare cannot see or hear them.</li>
          <li>Sign-in codes: by email from Watson&rsquo;s Gmail, or by WhatsApp.</li>
          <li>If your practitioner connects Google Calendar: your booking appears in their calendar as &ldquo;Watson: your name&rdquo;, at its time.</li>
        </ul>
      </section>

      <section className="wa-panel" aria-labelledby="who">
        <h2 className="wa-heading" id="who">Who sees it</h2>
        <ul className="wa-text">
          <li>Your practitioner sees your consultations with them, and nobody else&rsquo;s.</li>
          <li>Watson&rsquo;s engine reads recordings and documents only to write the transcript and fill in the form.</li>
          <li>The people who run Watson look at your information only when you or your practitioner ask them to put something right.</li>
          <li>Nothing is sold, and nothing is shared for advertising.</li>
        </ul>
      </section>

      <section className="wa-panel" aria-labelledby="how-long">
        <h2 className="wa-heading" id="how-long">How long</h2>
        <ul className="wa-text">
          <li>As long as your practitioner keeps your record, or until you ask for it to be deleted.</li>
          <li>If you withdraw your consent before your practitioner approves the form, the recording is deleted.</li>
        </ul>
      </section>

      <section className="wa-panel" aria-labelledby="choices">
        <h2 className="wa-heading" id="choices">Your choices</h2>
        <p className="wa-text">
          To see, correct or delete what Watson keeps about you, ask your practitioner, or write to <strong>{CONTACT}</strong>.
          Practitioners can write there too, about their own account.
        </p>
      </section>
    </PatientShell>
  );
}
