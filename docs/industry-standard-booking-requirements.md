# Industry-standard booking capability requirements

**Baseline reviewed:** 21 October 2026 against repository source, migrations, tests and current product documentation.  
**Scope:** 58 supplied booking, clinic-management, communication, data, commercial, integration and security capabilities.  
**Purpose:** durable target requirements plus a source-backed gap analysis. This is not a claim that every item belongs in the next MVP release.

Watson currently has a narrow, implementation-backed single-practitioner booking path. It is not yet an industry-complete clinic-management system. Repository evidence supports **10 covered**, **14 partial**, **33 not covered** and **1 blocked** requirement. “Covered” means source exists for the stated capability; it does not prove current hosted availability or real-patient readiness.

## Status definitions

- **Covered:** the required user outcome has an implementation-backed path in this repository. Provider connectivity may still need live verification.
- **Partial:** adjacent or constrained behavior exists, but the complete requirement or production acceptance condition does not.
- **Not covered:** no implementation-backed path matching the requirement was found.
- **Blocked:** implementation or a claim of readiness is prohibited until named security, legal or policy gates close.

## Section status

| Section | Covered | Partial | Not covered | Blocked | Assessment |
|---|---:|---:|---:|---:|---|
| A. Patient appointment booking | 3 | 3 | 7 | 0 | Core public booking works; advanced scheduling, channels and embedding do not. |
| B. Doctor and clinic management | 4 | 5 | 3 | 0 | Good single-practitioner calendar; no clinic hierarchy, staff roles or rooms. |
| C. Notifications and communication | 0 | 0 | 10 | 0 | WhatsApp reminders exist, but none of the supplied email/SMS/feedback requirements are covered. |
| D. Patient database and reporting | 1 | 2 | 5 | 0 | Contact records exist; patient operations, exports and analytics are immature. |
| E. Payments and commercial features | 1 | 2 | 4 | 0 | Stripe matching exists; production payments and broader commerce remain incomplete. |
| F. Integrations and security | 1 | 2 | 4 | 1 | Google integration exists; public API, embedding, GTM and ADAM do not; GDPR readiness is blocked. |
| **Total** | **10** | **14** | **33** | **1** | **24 of 58 have at least partial source coverage.** |

## A. Patient appointment booking

| ID | Industry requirement | Status | Watson evidence or gap |
|---|---|---|---|
| ISB-A01 | The system shall expose public booking continuously, without requiring a patient account. | Covered | `/book/` is public and `booking_times`/`book_time` are granted to anonymous callers. Runtime uptime is not verified. |
| ISB-A02 | The system shall show only currently available slots and atomically recheck availability when a patient books. | Covered | `private.open_times` removes consultations and Google busy intervals; `book_time` locks the profile and rechecks the selected time. |
| ISB-A03 | The system shall confirm a valid free booking immediately and automatically confirm a paid booking after verified payment. | Covered | `book_time` creates the consultation and token; paid bookings use a hold and idempotent Stripe fulfilment. No separate confirmation message exists. |
| ISB-A04 | The system shall optionally hold a booking for staff approval before patient confirmation. | Not covered | No requested/pending/approved appointment lifecycle or approval queue exists. |
| ISB-A05 | The system shall support multiple appointment or service types with independent rules. | Not covered | Each practitioner has one offer, duration, gap and fee; consultations have no service-type entity. |
| ISB-A06 | The system shall let staff configure service duration and buffer time. | Partial | One duration and gap are configurable per practitioner, limited to 30/45/60/90 minutes and 0/15/30-minute gaps. Per-service rules do not exist. |
| ISB-A07 | The system shall create and manage recurring appointment series. | Not covered | No recurrence model, series identifier or repeat-booking flow exists. |
| ISB-A08 | The system shall support group appointments with capacity and attendee management. | Not covered | A consultation links to one patient and has no capacity or attendee collection. |
| ISB-A09 | The system shall provide a supported website embed, including iframe security and responsive behavior. | Not covered | Watson provides a shareable booking link, not an embed contract, iframe mode or frame-security configuration. |
| ISB-A10 | The system shall support booking entry points from Facebook. | Not covered | No Facebook booking integration exists; WhatsApp Graph API code is unrelated. |
| ISB-A11 | The system shall let a clinic customize booking branding, colours and patient questions. | Partial | Practitioners configure name, offer, about text and languages. Branding, colours and custom booking questions are fixed. |
| ISB-A12 | The system shall render the complete booking workflow in supported patient languages. | Partial | Patients choose EN/DE/SK consultation language and WhatsApp wording supports them. The web UI remains English; draft catalogs are not runtime-integrated or approved. |
| ISB-A13 | The system shall maintain a waitlist and offer cancelled slots under controlled rules. | Not covered | No waitlist, cancellation-offer or acceptance-expiry model exists. |

## B. Doctor and clinic management

| ID | Industry requirement | Status | Watson evidence or gap |
|---|---|---|---|
| ISB-B01 | The system shall provide a centralized calendar of availability, holds, bookings and external busy time. | Covered | `/calendar/`, `calendar_week`, `WeekGrid` and `DayAgenda` show open, held, booked and Google-busy periods. |
| ISB-B02 | The system shall manage multiple doctors under one clinic account and schedule. | Not covered | Each authenticated practitioner is isolated; no clinic, membership or shared-schedule model exists. |
| ISB-B03 | The calendar shall visually distinguish appointments by service and staff. | Partial | Colours distinguish booked, unpaid hold, open and Google busy states, not service types or staff. |
| ISB-B04 | Clinic administrators shall configure individual staff working hours and shifts. | Partial | Each practitioner configures their own weekly hours. No administrator or multi-staff shift management exists. |
| ISB-B05 | Staff shall block breaks, holidays and exceptional closures. | Partial | Weekly days can be closed and Google busy intervals block slots. Watson has no native break, holiday or exception editor. |
| ISB-B06 | The scheduler shall allocate shared rooms/resources and prevent overlapping use. | Not covered | No room/resource model or cross-practitioner conflict check exists. |
| ISB-B07 | The system shall provide clinic roles and least-privilege staff permissions. | Not covered | Authentication has practitioner and engine boundaries, but no receptionist, clinician, manager or clinic-admin role model. |
| ISB-B08 | Staff shall connect Google Calendar for free/busy synchronization and booking export. | Covered | OAuth/API code reads primary-calendar free/busy and writes Watson bookings to a dedicated calendar. Live connection is unverified; SEC-05 remains open. |
| ISB-B09 | Core booking and calendar operations shall be usable on mobile-width devices. | Covered | Dedicated narrow layouts include `DayAgenda`; current report and prior UI tests confirm responsive structures, not every production device. |
| ISB-B10 | Staff shall review previous appointments for a patient. | Partial | Consultations persist and appear in practitioner lists, but there is no dedicated patient-history view or patient-level timeline. |
| ISB-B11 | Authorized staff shall manually enter an appointment. | Covered | `/consultations/new/` creates a scheduled consultation with language, fee, notes and consent state. It is practitioner-only, not receptionist-role aware. |
| ISB-B12 | Staff shall filter appointments by staff, date, service and operational state. | Partial | The dashboard filters workflow state, today and recent approvals. It lacks staff/service selection and general date-range filtering. |

## C. Patient notifications and communication

Current WhatsApp invitation and one-hour reminder behavior is useful adjacent capability, but it does not satisfy requirements that explicitly call for email or SMS.

| ID | Industry requirement | Status | Watson evidence or gap |
|---|---|---|---|
| ISB-C01 | The system shall send an automatic patient booking confirmation by email. | Not covered | No Watson booking-confirmation email exists. Stripe may send a payment receipt, which is not appointment confirmation. |
| ISB-C02 | The system shall send booking confirmation by SMS when selected. | Not covered | No SMS provider or SMS delivery path exists. |
| ISB-C03 | The system shall send configurable patient appointment reminders by email. | Not covered | No patient reminder email exists. Resend is used only for owner operational alerts. |
| ISB-C04 | The system shall send configurable patient appointment reminders by SMS. | Not covered | The implemented reminder is WhatsApp, not SMS. |
| ISB-C05 | The system shall notify assigned clinic staff about appointment creation, changes and cancellation. | Not covered | Owner outage alerts exist, but staff appointment notifications do not. |
| ISB-C06 | Authorized staff shall customize SMS templates with controlled variables and consent rules. | Not covered | No SMS templates, provider or consent model exists. |
| ISB-C07 | Patients shall download or receive standards-based calendar invitations. | Not covered | No ICS/iCalendar patient invitation exists; Google export is practitioner-side only. |
| ISB-C08 | The system shall request and collect patient satisfaction feedback. | Not covered | No survey, rating or feedback entity exists. |
| ISB-C09 | The system shall request public Google reviews only under approved clinic policy. | Not covered | No review-request workflow or Google Business integration exists. |
| ISB-C10 | The system shall send consented marketing messages with opt-out and audit controls. | Not covered | No marketing campaign, consent, preference or unsubscribe model exists. |

## D. Patient database and reporting

| ID | Industry requirement | Status | Watson evidence or gap |
|---|---|---|---|
| ISB-D01 | The system shall maintain practitioner-scoped patient contact records linked to appointments. | Covered | `patients` stores normalized name, phone/email and links to consultations/documents under RLS. SEC-02 blocks safe real-patient use until identity linking is fixed. |
| ISB-D02 | Staff shall view a patient’s appointment history. | Partial | The data relationship exists, but no patient profile/history screen or history-specific query is exposed. |
| ISB-D03 | Staff shall categorize patients with clinic-defined labels. | Not covered | No tag, label or category model exists. |
| ISB-D04 | Authorized staff shall import customers with validation, deduplication and an audit report. | Not covered | No import format, mapping UI, batch API or import audit exists. |
| ISB-D05 | Authorized staff shall blacklist or restrict selected customers with reason and review controls. | Not covered | No restriction/blacklist state exists. The three-upcoming-booking limit is not a blacklist. |
| ISB-D06 | The system shall report booking volume, completion, cancellation and service utilization. | Partial | Dashboard counts operational consultation groups and open slots. No durable analytics model or booking/utilization reports exist. |
| ISB-D07 | The system shall report staff utilization without exposing unnecessary clinical data. | Not covered | No clinic staff model or utilization report exists. |
| ISB-D08 | Authorized users shall export appointment and patient data in documented formats with audit and privacy controls. | Not covered | No appointment/customer export exists; clinical report/export work is also unfinished. |

## E. Payments and commercial features

| ID | Industry requirement | Status | Watson evidence or gap |
|---|---|---|---|
| ISB-E01 | The system shall collect appointment fees online through a hosted payment provider. | Partial | Stripe Checkout and webhook/return fulfilment are implemented in test mode. Production onboarding, refunds and operational controls are absent. |
| ISB-E02 | The system shall support required prepayment or deposits before confirmation/admission. | Partial | Full-fee bookings use a 35-minute hold and payment-gated UI. Partial deposits do not exist, and SEC-03 allows signaling-layer payment bypass. |
| ISB-E03 | The system shall accept and reconcile venue QR payments where enabled. | Not covered | No QR payment method or venue-payment workflow exists. WhatsApp gateway QR pairing is unrelated. |
| ISB-E04 | The system shall match verified provider payments to the correct reservation idempotently. | Covered | Stripe metadata identifies the consultation; `record_payment` verifies amount, stores session ID and is idempotent. |
| ISB-E05 | The system shall validate and apply discount codes under clinic-defined rules. | Not covered | No promotion or discount entity exists. |
| ISB-E06 | The system shall issue, redeem and account for gift vouchers. | Not covered | No voucher balance, purchase or redemption model exists. |
| ISB-E07 | The system shall offer optional add-on services during booking and price them explicitly. | Not covered | No service catalog, add-on selection or line-item pricing exists. |

## F. Integrations and security

| ID | Industry requirement | Status | Watson evidence or gap |
|---|---|---|---|
| ISB-F01 | The system shall provide a reviewed ADAM integration contract where required by target clinics. | Not covered | No ADAM connector, data map or interface contract exists. The intended ADAM product/API remains an open clarification. |
| ISB-F02 | The system shall expose a documented, versioned and authenticated external API for approved integrations. | Not covered | Supabase RPCs and Edge Functions are internal application interfaces, not a supported partner API with versioning, scopes, quotas and lifecycle policy. |
| ISB-F03 | The system shall synchronize staff availability and Watson bookings with Google Calendar. | Covered | Free/busy reads and dedicated-calendar writes exist. Live credentials/connectivity are unverified and SEC-05 must be fixed. |
| ISB-F04 | The system shall support approved Google Tag Manager tracking on non-clinical surfaces only, with consent controls. | Not covered | No GTM integration exists. The current specification prohibits analytics and third-party scripts on clinical pages. |
| ISB-F05 | The system shall provide a supported, secure website booking embed. | Not covered | A shareable URL exists; iframe behavior, origin policy, CSP/frame controls and embed versioning do not. |
| ISB-F06 | The product shall not claim GDPR readiness until legal basis, processor contracts, rights workflows, retention, deletion, security and evidence are approved. | Blocked | Six open application findings include patient identity and document authorization failures. Gate R legal/vendor/retention decisions remain open; technical controls alone cannot establish compliance. |
| ISB-F07 | The system shall provide tested backup, restoration, retention and secure archival controls. | Partial | Supabase stores records/files and Watson has append-style audit events, but backup restoration, retention enforcement, immutable approved records and secure deletion are not demonstrated. |
| ISB-F08 | The system shall enforce clinic staff access by explicit role and least privilege. | Partial | RLS isolates practitioners and a dedicated engine identity has job-scoped access. There is no clinic/staff RBAC, MFA, offboarding or privileged-access review. |

## Cross-cutting implementation contract

Any work that closes these requirements shall preserve the following invariants:

1. **Booking consistency:** availability is rechecked inside the same transaction that creates or changes a reservation; retries are idempotent.
2. **Identity safety:** unverified contact data never merges, discloses or mutates an existing patient record. SEC-02 must close before real-patient use.
3. **Admission enforcement:** payment, consent, cancellation and authorization are enforced server-side at every join/signaling boundary, not only in UI.
4. **Clinic tenancy:** clinic, location, staff, room and service ownership are explicit before multi-doctor or role features ship.
5. **Communications:** every message has purpose, recipient, locale, consent/legal basis, template version, delivery state, retry policy and opt-out behavior where applicable.
6. **Payments:** amounts, currency, reservation identity, refunds and provider events are verified and auditable; card data remains with the provider.
7. **Exports and analytics:** access is authorized and audited; exports have documented schemas; analytics exclude clinical content unless separately approved.
8. **Integrations:** external APIs use scoped credentials, rotation, replay protection, rate limits, idempotency and observable failure recovery.
9. **Compliance claims:** GDPR, backup, secure archive and similar claims require technical evidence plus legal, organizational and vendor approval.

## Product decisions required before implementation

- Is the target tenant a solo practitioner, clinic, or multi-location organization?
- Which supplied capabilities are launch requirements versus later parity goals?
- What product named “ADAM” and which interface/version must Watson support?
- Are email and SMS now in scope despite their explicit exclusion from the current MVP specification?
- Is GTM permitted only on public acquisition/booking pages, with all clinical routes excluded?
- Which countries, currencies, payment methods, languages and data-retention rules define the first commercial release?

## Primary repository evidence

- Booking and availability: `supabase/migrations/20261016100000_booking.sql`
- Booking UI and settings: `apps/web/src/app/book/page.tsx`, `apps/web/src/components/booking-settings.tsx`
- Calendar UI: `apps/web/src/app/calendar/page.tsx`, `apps/web/src/components/week-grid.tsx`
- Manual entry and dashboard: `apps/web/src/app/consultations/new/page.tsx`, `apps/web/src/app/consultations/page.tsx`
- Patients/documents: `supabase/migrations/20261014150000_documents.sql`
- Payments: `supabase/migrations/20261014130000_payments.sql`, `supabase/functions/payment`, `supabase/functions/stripe-webhook`
- Google synchronization: `supabase/functions/google`, `supabase/functions/_shared/google.ts`
- WhatsApp reminders: `supabase/migrations/20261016110000_schedule.sql`, `supabase/functions/whatsapp`
- Security/compliance limits: `docs/security-review-2026-10-18.md`, `MASTER_BUILD_SPEC.md`
- Localization status: `docs/localization/README.md`, `apps/web/messages/`
