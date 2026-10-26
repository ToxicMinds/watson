# SEC-02 — Patient sign-in and verified identity

## Objective

Close SEC-02 from `docs/security-review-2026-10-18.md`: a supplied phone/email must not be treated as proof of patient identity. A patient must sign in with a one-time code sent to the claimed email or WhatsApp number, or the consultation's practitioner must explicitly confirm the association. Until then, the submitted identity remains a consultation-scoped claim. No consultation link may reveal or mutate another patient's canonical identity or history.

The required acceptance scenario is preserved verbatim in the test plan below. SEC-04 remains separate; this work may expose a verified-contact primitive for SEC-04 to reuse, but does not claim to solve booking abuse/quota bypass.

## Required invariants

1. Only an explicit, authoritative role grants practitioner, patient, or engine authority. A patient session can never call practitioner functions or satisfy practitioner RLS.
2. Typing a phone/email never finds, attaches, updates, or reveals a canonical patient record.
3. OTP verification proves control of that contact only. Linking a consultation to an existing patient requires that verification to match the consultation claim, or explicit confirmation by that consultation's practitioner.
4. Consultation bearer links expose only that consultation's submitted claims and data; never canonical patient contacts, another consultation, or patient-wide documents.
5. Documents remain scoped to their consultation until a patient association is verified or practitioner-confirmed. Any patient-wide reassignment is authorized and audited.
6. OTPs are generated, stored/verified, expired, and single-used by Supabase Auth; the application never stores or logs plaintext codes. Set 10-minute expiry, six-digit code minimum (prefer eight digits if supported and usable), send cooldown, and low attempt/rate limits including a per-contact guard.
7. No new package unless necessary; do not add an unmaintained dependency. Preferred implementation uses the already-installed `@supabase/supabase-js`, Supabase Auth hooks, existing Deno Edge Functions, Web Crypto, and `fetch`.

## Current implementation map

- Roles today: authenticated non-engine accounts are generally treated as practitioners. Engines are `public.engines` and `private.is_engine()` (`supabase/migrations/20261013220000_transcription.sql`). No patient accounts exist.
- Practitioner UI/session: `apps/web/src/lib/session.tsx`, `apps/web/src/app/sign-in/page.tsx`, and `RequireSession` treat any signed-in user as a practitioner.
- Identity matcher: `private.identify_patient` and `public.patient_identify` in `supabase/migrations/20261014150000_documents.sql` match by practitioner plus phone/email, mutate canonical patient identity, attach consultations, and assign documents.
- Booking calls that matcher in `public.book_time` (`20261016100000_booking.sql`).
- Public consultation-link data is returned by the latest `public.invite_details` definition in `20261026130000_add_removed_at_to_patient_documents.sql`; its history is replaced in multiple migrations. Change the latest behavior through a new migration; do not edit migration history.
- Upload flow: `apps/web/src/components/patient-documents.tsx`; document RPCs and storage RLS are in the documents migrations. Current `private.add_document` requires a linked `patient_id`.
- Form engine selects documents by shared patient in `engine_claim_form_job` and validates them in `engine_complete_form_job` (`20261014150000_documents.sql`); both must honor consultation ownership until association.
- WhatsApp inbound/outbound is in `supabase/functions/whatsapp/index.ts`; it currently has one Watson gateway / provider sender. It must not infer patient identity from the old consultation code alone.
- Tests: `apps/web/tests/access.test.ts`, `documents.test.ts`, `booking.test.ts`, `forms-and-payments.test.ts`, `whatsapp-gateway.test.ts`; browser tests under `apps/web/e2e/`; harness helpers in `apps/web/tests/local-stack.ts` and `apps/web/e2e/account.ts`.

## Recommended architecture

### Roles

- Add a private role-membership registry keyed by `auth.users.id` and constrained role (`practitioner`, `patient`, `engine`). Treat it—not `user_metadata` or client fields—as authorization source. Practitioner and patient membership may coexist only through explicit trusted provisioning; `engine` is exclusive.
- Before migration, produce a dry-run classification of every Auth user: engine registry, practitioner profile, historical practitioner-owned records, known admin-provisioned account, or unresolved. Backfill only deterministically classified accounts. Abort while unresolved users remain; never blanket-classify all non-engine users as practitioners.
- Newly created public OTP accounts default to `patient`. Practitioner provisioning remains admin-only and explicitly grants `practitioner`; engine registration assigns exclusive `engine` membership.
- Add private role helpers. Every practitioner RPC and RLS policy enforces practitioner membership plus existing owner predicate. Patient RPCs enforce patient membership and explicit patient/consultation association. Read authoritative roles on each DB authorization check, not stale JWT claims. Keep helpers private, schema-qualified, pinned `search_path = ''`, and minimally executable.

### OTP and sessions

- Use Supabase Auth email/phone OTP so Auth owns the hashed OTP, expiry and verification and returns normal access/refresh tokens. Do not mint custom JWTs or build a parallel password/session system.
- Configure Auth email OTP expiry to 600 seconds and use an Auth `send_email` hook routed through Watson's Gmail sender. Configure the `send_sms` Auth hook to deliver the Auth-generated phone OTP through Watson's existing WhatsApp gateway. Verify both hook signatures, never log hook payloads/codes, and use constant-time verification primitives supplied by Auth.
- Apply Auth's IP-based limits plus send cooldowns and a durable atomic per-contact send guard (keyed HMAC of normalized email/phone, never raw contact in the rate table). Context7 docs show Auth's `/verify` limiter is IP-based. W0 must confirm deployed Auth's failed-attempt behavior per OTP. If Auth has no per-OTP attempt cap, do not ship six-digit OTP relying only on IP limits: prove an Auth-supported cap or redesign around a server-enforced challenge verifier that still yields a normal Supabase session. Define budgets, expiry, cooldown, and lockout before release.
- Auth-created accounts receive `patient` role from trusted DB-side provisioning. Existing practitioner accounts retain their role and their current password login. Changing roles must invalidate or re-check active sessions so stale tokens cannot preserve prior authority.
- The email sender is Watson's Gmail, not Resend and not a doctor-supplied address. Store Gmail OAuth refresh credentials in Supabase Vault/secrets, request only Gmail send scope, and use Gmail API over `fetch`; do not add a Gmail SDK package. WhatsApp sender stays Watson's existing gateway number for this work.

### Claims, association and document ownership

- Add consultation-scoped claim fields for the name and phone/email entered at booking or on a consultation link, with explicit verification/association state. They must not be populated from canonical patient fields when migrating legacy rows; that could reproduce the disclosure being fixed.
- Replace identity-matcher behavior: `book_time` records claims and starts with no patient association. `patient_identify` may update only that consultation's claim. It must never search/mutate canonical patients or return a match result.
- Add a verified patient-to-patient-record association table (auth user ↔ practitioner-scoped `patients` row), plus claim/association state linking verified contact to consultation. Exact linking predicate: current Auth user has a freshly confirmed normalized email or phone equal to the same field claimed on that consultation. A single matching field may establish a link, but a differing claim field must not update or be exposed as canonical; contact changes require fresh verification. Conflicting claims or duplicate canonical rows stay unlinked for practitioner review. Never merge Auth identities automatically.
- Add a patient-authenticated verification/link function and a practitioner-owned confirm/reject function. Practitioner review is scoped by `auth.uid()` ownership and emits an audit event. An accepted association updates canonical patient fields only with an explicit authorized change; never overwrite canonical data just because a consultation claim differs.
- `invite_details` returns only that consultation's claims and consultation-scoped documents. For every legacy consultation, including rows with non-null `patient_id`, it must not return canonical identity or patient-wide documents until re-verified or practitioner-confirmed. Legacy associations are quarantined. Practitioner review of old rows with no safe claim requires explicit authenticated selection/confirmation and an audit event.
- Permit consultation-scoped uploads while `patient_id` is null: make `patient_documents.patient_id` nullable, keep `consultation_id` required, and update constraints, indexes, inserts, reads, cleanup, and Storage policies. Form jobs use that consultation's documents before association. Authorized document ownership moves require audit and must preserve tombstones.
- Inventory every consumer of `consultations.patient_id` and `patient_documents.patient_id` (RPCs, policies, triggers, edge functions, reminders, form jobs, fill-again, transcript hints, WhatsApp, and UI). Classify each as practitioner-only, consultation-scoped, or verified-association-only and test it. No consumer may use a legacy unverified link to expose/process patient-wide data.
- Remove the old WhatsApp consultation-code path as proof of identity. It may identify a consultation for message routing, but only Auth OTP verification or practitioner confirmation establishes a patient association.

## Work units and dependency graph

### W0 — Contract lock and security baseline (serial, no production edits)

**Tasks:** Confirm boundaries: OTP control may link an exact matching consultation claim; practitioner confirmation is alternative; SEC-04 stays separate. Enumerate every public RPC, private identity function, policy, and `patient_id`/document consumer. Produce account-classification dry-run and unresolved account list. Verify installed CLI/Auth versions, exact send-email/send-SMS hook contracts, local support, response/timeout/error behavior, hosted config/deployment surface, and per-OTP failed-attempt limit. Confirm Gmail OAuth scope and gateway ability to deliver Auth OTP under WhatsApp rules/templates. Document legacy review behavior.

**Exit:** threat model, complete consumer inventory, no unresolved role classifications (or explicit human resolution), OTP limits confirmed, provider routes proven with synthetic sends, and local/hosted configuration procedure documented. No ambiguous account gets practitioner authority by default. If gateway cannot reliably/lawfully deliver WhatsApp OTP, that channel remains blocked, not silently replaced.

### W1 — Red tests and role/RLS foundation (serial; owns protected role policies)

**Files:** new migration(s), `apps/web/tests/access.test.ts`, `apps/web/tests/local-stack.ts`, account fixtures/provisioning scripts, `apps/web/src/lib/session.tsx`.

**Tasks:** Add tests showing patient cannot call practitioner RPCs, read practitioner rows, use engine RPCs, or access another patient's data; existing practitioner and engine behavior remains valid. Add a private role registry and safe backfill/provisioning policy. Change the session/route model to distinguish practitioner and patient experiences. Audit and update every practitioner function/policy, not just the explicitly named identity RPCs. Explicitly assign roles in tests and admin provisioning.

**Exit:** tests pass for anon/patient/practitioner/engine matrix; unclassified role is denied; practitioner APIs cannot be accessed by a patient JWT; migration output lists no unassigned production account before enforcement.

### W2 — Auth OTP delivery and verified session (depends on W0 and W1; isolated adapter tests may start earlier)

**Files:** `supabase/config.toml`, new focused auth hook Edge Function(s) or reviewed existing function extension, `apps/web/src/app/sign-in/**`, `apps/web/src/lib/session.tsx`, auth UI E2E/tests, generated types only if DB hook/function interfaces require them.

**Tasks:** Implement email/phone OTP through Supabase Auth; configure 600-second expiry and low rates. Email hook uses Watson Gmail API; WhatsApp hook uses verified Watson gateway route. Verify each documented hook signature; add atomic HMAC contact throttles, generic responses, cooldown, lockout UX, and session expiry behavior. New users become patient members; existing practitioner accounts keep explicitly provisioned roles and login. Test official signed fixtures/mock providers and separately prove local Auth invokes configured hooks. Production credentials stay in secrets/Vault; shared session UI waits for W1 role contract.

**Exit:** Email and WhatsApp OTP create only patient roles for newly created users; a verified code gives a normal Supabase session; invalid/expired/replayed/over-limit codes fail; no real provider calls in tests; no code, raw contact, or credentials in logs.

### W3 — Consultation-scoped claims and association functions (serial, protected RPCs)

**Files:** new migration replacing `private.identify_patient`, `public.patient_identify`, `public.book_time`, latest `public.invite_details`, plus `apps/web/tests/booking.test.ts`, `documents.test.ts`, `forms-and-payments.test.ts`.

**Tasks:** Add safe claim/association schema and audit events. Change booking and invite flows to store/read only consultation claims. Add patient verification/link and practitioner confirm/reject functions with role, ownership, normalized-contact, conflict, concurrency, and idempotency checks. Remove all direct association side effects from unverified `patient_identify`. Preserve booking token, payment, patient-page, and reminder compatibility.

**Exit:** the known-contact attacker cannot read canonical details, alter canonical patient data, attach the consultation to a patient, or affect a second consultation; verified claim matching and practitioner confirmation link only under explicit authorization; duplicate/concurrent operations are safe.

### W4 — Consultation-owned documents and downstream processing (depends on W3; parallelizable by independent flow after schema contract)

**Files:** latest document/storage migrations, `apps/web/src/components/patient-documents.tsx`, document RPCs, `engine_claim_form_job`/`engine_complete_form_job`, WhatsApp document intake, `apps/web/tests/documents.test.ts` and form tests.

**Tasks:** Allow document upload to an unlinked consultation (`patient_id` nullable, `consultation_id` required). Restrict public link document list/upload/confirm/remove by consultation token and keep files isolated by `consultation_id`. Ensure form jobs only read that consultation's documents before verified/confirmed association. Audit ownership moves; review WhatsApp inbound-document assumptions. Preserve removed-document tombstones and cleanup behavior.

**Exit:** attacker-created material cannot enter a victim's later form job; valid patient/practitioner association enables only intended access; storage read/delete policy cannot bypass the SQL association check; document movement has a non-sensitive audit record.

### W5 — Practitioner review UX and patient portal boundary (depends on W1 + W3; may be built in parallel with W4 only after RPC contracts freeze)

**Files:** consultation UI, new patient sign-in/portal pages, shared session guards, E2E suites.

**Tasks:** Add a practitioner-only review control for ambiguous/unverified claim-to-record matches (“same patient?”) with safe, minimally disclosed context, confirm/reject actions, and audit result. Add the minimum patient signed-in surface required to see their verified/linked consultations and their own consultation data; do not expose unlinked legacy history. UI is not the security boundary: functions and RLS must enforce all access.

**Exit:** patient cannot open practitioner screens/API; practitioner can only review their own consultations; patient sees only verified associations; unsigned link holder sees only their consultation's submitted claims.

### W6 — Adversarial verification and staged release (serial gate)

**Tasks:** Run SQL/RPC tests as `anon`, patient, practitioner, engine, and service role; run relevant web lint/typecheck/tests and browser tests; inspect migration grants and every `SECURITY DEFINER` signature/search path; run Supabase advisors. Use local Auth test OTPs/mocked hooks only. Review current CI and deploy pipeline; apply additive DB migrations before app code requiring them, then enable patient sign-in behind a feature flag. Backfill legacy identity associations as unverified, never expose their canonical fields to bearer-link holders, and provide practitioner re-confirmation or re-verification. Roll back by disabling patient sign-in/link completion, not by deleting audit/history.

**Exit:** exact adversarial acceptance test passes; no unrelated document/form/booking regressions; migration and role backfill are verified against production account counts; no secrets or `.agent.local/` changes; release and rollback steps documented.

## Required adversarial test (exact acceptance behavior)

“With only a victim’s contact and their own consultation link, an attacker cannot obtain another contact, change the victim’s name or contact, join their patient record or add documents to it; verified returning-patient linking still works.”

Implement as a database-backed integration test that creates victim and attacker consultations under the same practitioner, uses the attacker's valid invite token and the victim's phone/email, then verifies all of the following: no canonical contact/name is returned; victim row unchanged; attacker consultation remains unlinked; documents uploaded by attacker stay consultation-scoped and never appear in victim form-job input; victim consultation and documents unchanged. Add positive cases for a verified email claim, a verified WhatsApp claim, and practitioner confirmation, plus cross-practitioner and engine-role denials.

## Concurrency and parallel-agent plan

- Keep W0, W1, W3, W6 serial and under one integration owner; these define/change shared role and database trust boundaries.
- After W0 freezes contracts, delegate isolated W2 hook fixtures/provider mocks and W5 UI test scaffolding. Do not let parallel agents edit role/session UI or role/identity migrations before W1/W3 contracts merge.
- After W3 migration contract lands, delegate W4 downstream document/form consumers as a separate branch. Merge only after its DB tests pass against W3's contract.
- Each agent gets a named task/branch and reports changed paths, tests run, and unresolved security assumptions. Review each branch before merge; never push without fetching and merging latest remote state. Never force-push.

## Package and current-doc research

- No new package is part of the proposed design. Reuse `@supabase/supabase-js` and native Deno/Web APIs. W0 must choose hook signature verification: maintained, pinned Standard Webhooks verifier passing dependency review, or reviewed Web Crypto verified against official test vectors with timestamp/replay checks. No ad hoc unreviewed signature parser.
- Context7 `/supabase/auth` confirms Supabase Auth has email/phone OTP, Send Email and Send SMS hooks, and supports custom delivery. It also shows verification endpoint limits are IP-based; the plan therefore adds a hashed per-contact send guard and requires an explicit attempt-limit check.
- Context7 Supabase Database guidance requires explicit role/owner checks, RLS plus least-privilege grants, and pinned empty `search_path` on `SECURITY DEFINER` functions; do not trust mutable `user_metadata` for roles.
- Context7 Gmail API docs confirm `users.messages.send` accepts RFC 2822 MIME encoded as base64url and is OAuth-authorized. Use a minimal `gmail.send` scope, server-side refresh credential, and native `fetch` rather than adding a Gmail SDK.
- No installed skill named “ponytail” was found. Relevant installed workflows used for this plan: `blueprint`, `security-review`, `supabase`, and `tdd-workflow`.
- Independent repository/security/test-planning reviews were performed with multiple agents. Their key cautions are incorporated: legacy associations are unverified, contact verification must not merge unrelated rows silently, and form jobs/document access are part of the same data boundary.
