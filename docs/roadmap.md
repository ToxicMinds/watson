# Roadmap and status

The plan is defined in [MASTER_BUILD_SPEC.md](../MASTER_BUILD_SPEC.md), section 21.
This file only tracks where we are. Update it at the end of every slice.

Last updated: 24 October 2026 (order changed by [decision 0005](decision-log/0005-call-to-form.md); payment added by [decision 0007](decision-log/0007-patient-payment.md); the engine and WhatsApp moved by [decision 0009](decision-log/0009-cloud-engine-and-whatsapp-gateway.md); prices, dates and Google Calendar on 24 October).

| Slice | When it is done, you can | Status |
|---|---|---|
| **Phase 0 — Foundations** | | Done |
| **Phase 1 — Transcription through the web app** | | In progress |
| 1.1 Sign-in and consultation list | Sign in and see your list of consultations | Done, live 13 Oct |
| 1.2 Create consultation and audio | Create an invented consultation, record consent, attach or record two tracks | Done, live 13 Oct |
| 1.3 Transcription with a status screen | Press start, watch each stage, read a merged two-speaker transcript | Done, live 14 Oct |
| 1.4 Consultation room (moved up, decision 0005) | Start a video call, send the patient a link, both voices recorded; transcription starts when the call ends | Done, live 14 Oct |
| 1.5 AI fills the doctor's form (decision 0005) | Read the doctor's questionnaire filled in from the conversation, each answer with its quote; a suggested diagnosis; check and approve | Done, live 14 Oct |
| 1.5b Patient payment (decision 0007) | Set a fee; the patient pays on Stripe Checkout from their link, then joins; see "Paid" | Live 14 Oct (Stripe test mode); a test-card payment passes against the hosted app. 24 Oct: usual fee, any fee per consultation, 0 for free, Make it free |
| 1.6 Transcript review | Search, play back, correct, mark reviewed, export, delete audio | Folded into 1.5 where the form needs it |
| 1.7 Fixtures and benchmark | Read measured accuracy and speed per language | Started 14 Oct (first measurements below) |
| 1.8 Booking and the front page (owner, 16 Oct) | Patients find a practitioner and book a time; practitioners open hours in Practice; reminders, short links, fill in again | Live 16 Oct. Google Calendar connected 24 Oct in Google's Testing mode: listed accounts only, reconnect every 7 days until a privacy page lets it be published |
| 1.9 The engine in the cloud (decision 0009) | Transcripts, documents and forms are made with the laptop off, on Modal, started by the database | Live 16 Oct |
| 1.10 Watson's own WhatsApp (decision 0009) | Patients link their number and send photos; a reminder before the call | Live 16 Oct on Render's free plan |
| **Phase 2 — Structured draft, approval and report** | | Not started |
| 2.1 Draft generation | Generate a structured draft in which every item shows its evidence | Not started |
| 2.2 Draft review | Accept, edit, reject and add items in a split view | Not started |
| 2.3 Approval and versioned record | Approve in two steps; corrections create new versions | Not started |
| 2.4 Report and audio deletion | Generate and export the patient report; delete audio | Not started |
| 2.5 Evaluation and timing trial | Read the results for H2 and H3 | Not started |
| **Phase 3 — Consultation room** | Hold a call that records separate tracks after consent | Not started |
| **Gate R — Real-patient readiness** | Owner decisions, legal work and security hardening | Not started |
| **Phase 4 — MVP with about five practitioners** | | Not started |
| **Phase 5 — Minimum marketable product** | | Not started |

## Where things run

| Piece | Where | Plan |
|---|---|---|
| Web app | Render static site | Free |
| Sign-in, database, audio files | Supabase project `watson` (ref `mconctpleszerqhgaarj`), Frankfurt | Free |
| Transcription engine | Modal, started by the database (decision 0009) | Free: 3 hours a month |
| WhatsApp gateway | Render web service `watson-whatsapp` | Free |
| Google sign-in for calendars | Google Cloud project `watson-512614`, no billing | Free |

## Slice 1.3 — done 14 October

Live at https://watson-app.onrender.com, rebuilt on the design system
(https://claude.ai/artifact/VwTRNADCcZnGHPHYK6spht). The engine runs on the owner's
computer as a user service (`apps/clinical-worker/watson-engine.service`). Measured live:
two 7.5-second tracks, start to transcript on screen in 16 seconds with the `small` model.

Left over, picked up when the work needs them:

- [ ] Word-level uncertainty marks (the engine scores whole turns today).
- [ ] Hide the "recorded together" tick box once a track was recorded in the browser.
- [ ] Upload progress as a percentage (shown as "Uploading…" today).
- [ ] A two-hour transcript fits in one database call (review 4.11).
- [ ] A dialogue fixture generator; the speed and accuracy benchmark (slice 1.7).

## Slice 1.4 — done 14 October

A doctor starts a call from a consultation (`/room/?id=`), copies the link, the patient opens
it (`/join/?t=`) with no account. Browser to browser (WebRTC, public STUN, handshake over
Supabase Realtime). The doctor's browser records two voice tracks; "End call" uploads them,
declares them recorded together and starts transcription. Tested live with two browsers.

Left over:

- [ ] No relay (TURN): calls between some strict networks may not connect. Matters now that the
      test drive is remote (16 Oct). Free option checked: Metered's Open Relay, 20 GB a month with a
      free sign-up (no card mentioned). Cloudflare's TURN is free only with its SFU, else $0.05/GB. Test laptop on
      Wi-Fi with a phone on mobile data; add a free relay if needed.
- [ ] A call that is cut off before "End call" loses its recording (kept in the browser).
- [ ] Design system: add the call room screens.
- [x] Patient payment: option A chosen, Stripe Checkout in test mode (decision 0007).

## Slice 1.5 — done 14 October

When a transcript is ready, the engine fills in the practitioner's form with a model on the
owner's laptop ([decision 0008](decision-log/0008-form-filling.md)). `/form/?id=` shows each
answer with its quote; the practitioner accepts, edits or rejects each one and approves.
Measured on invented consultations: English 18 of 21 fields, Slovak 21 of 21. Live: a recorded
call went on to a filled-in form in under two minutes after its transcript.

Left over:

- [ ] Templates are set by script (owner: Dr. Robin's form, kept outside the repository);
      a screen to set up one's own form.
- [ ] After correcting the transcript, fill the form in again from the corrected text.
- [ ] Measure the model on longer, messier conversations (slice 1.7).

## Patient payment — built 14 October

A fee per consultation; the patient's link exists from creation; Stripe Checkout through two
edge functions (`payment`, `stripe-webhook`). Left over:

- [x] Stripe test key and webhook secret set on the hosted project; live test-card payment passes (14 Oct).
- [ ] Refuse an unpaid link in the call handshake, not only on the page (before Gate R).
- [x] Usual fee in Practice; any fee per consultation, 0 for free; Make it free (24 Oct, decision 0007 rows 8 and 9).
- [ ] A patient paying at the moment the fee is waived is charged but not recorded: refund in Stripe (before Gate R).
- [ ] Paying practitioners directly (Stripe Connect), refunds, invoices.

## Raised by the owner on 14 October

Order agreed with the owner: patient documents, WhatsApp, then booking last. Booking is the
product's selling point; the transcript and form are what assist the practitioner.

- [x] **Patient documents** (live 14 Oct). Patients are known per practitioner by phone number
      (one international format) or email. The patient's link names them and sends PDFs or photos
      into a private bucket; the engine reads them (PDF text, or RapidOCR's Latin model for photos
      and scans: `clinical-worker fetch-ocr-model`) before filling forms, which quote them by page.
      The owner accepts real documents for the test drive, knowing GDPR applies before real use.
- [x] **WhatsApp, tap to send** (live 14 Oct): Send on WhatsApp opens the practitioner's own
      WhatsApp with Watson's message (invitation, or reminder on the day) in the patient's language.
- [x] **WhatsApp, Watson's own number** (live 14 Oct): Meta's official Cloud API, test number
      +1 555-662-3667 (5 verified recipients, no payment method: never add one until there are
      paying customers). Edge function `whatsapp` checks Meta's signature; a patient links by
      sending "Watson <code>" from their link; photos and PDFs in the chat become documents.
      Credentials: ~/.config/watson/meta.env and function secrets. Proposal:
      https://claude.ai/artifact/HiKzstjnEHBTq6UiBjFVjH
- [ ] WhatsApp still to do: reminders Watson sends by itself (needs an approved message template
      and a schedule), the patient's plan after approval, review due, voice notes.
- [ ] Documents that arrive after the form was filled: offer to fill it in again.
- [ ] **Booking**: patients find a practitioner and book a time. Last.
- [ ] **Sign-in**: proposal ScreenSignInNight in the design system awaits the owner's answer.

## First measurements (slice 1.7, started 14 October)

**Ayurvedic vocabulary hints (16 Oct).** The speech model now gets a list of Ayurvedic terms as
hints (`WATSON_VOCABULARY`). Invented consultations through 32 kbit/s Opus, large-v3-turbo:
English 2.4% → 2.3% word errors ("avipattikar churna" now right; the synthetic voice's
"abhyanga" still comes out as "a piano"); Slovak 27.1% → 24.1%.

**Dress rehearsal (16 Oct, live, two robot browsers):** payment, document read in 5.6 s, WhatsApp
link, a 4-minute call, transcript of 8.3 minutes of audio in 2 minutes, Dr. Robin's form 22 of 22
in 5 minutes; no browser errors. The form quoted no document: the invented call never mentions
the lab results.


Invented calls spoken by text-to-speech, two tracks squeezed through the browser's 32 kbit/s
Opus, transcribed on the owner's laptop (`bench/transcribe_bench.py`):

| Speech model | English word errors | Slovak word errors | Time per minute of call (both tracks) |
|---|---|---|---|
| small | 3.1% | 55% | 11 s |
| large-v3-turbo | 2.9% | 26% | 30 s |

The engine now uses large-v3-turbo. Slovak at 26% is still poor; the synthetic Slovak voice is
part of that, so real Slovak calls must be measured before trusting the figure.
