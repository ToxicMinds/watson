# Security review — 18 October 2026

**Baseline:** `bd9b54d3add74beee5d5ccb4414f9cc6b48a1bdc`.
**Status:** six open application findings: three high, three medium. Remediation below is proposed, not implemented.

## Summary

- **High — SEC-01:** deleting a document record makes its remaining storage object anonymously readable.
- **High — SEC-02:** an unverified contact can attach an attacker to an existing patient, disclose contact information and change that patient's shared record.
- **High — SEC-03:** call signaling accepts client-asserted participant roles and bypasses payment and revocation checks.
- **Medium — SEC-04:** anonymous bookings can exhaust availability by changing an unverified contact address.
- **Medium — SEC-05:** Google Calendar linking is not bound to the browser that initiated it.
- **Medium — SEC-06:** withdrawing consent does not stop document reading or reject its results.

Fix the document authorization and patient identity boundaries first. The three dependency advisories described later are not included in these six application findings.

## Scope and method

Reviewed all 17 database migrations, RPC grants and storage policies; payment, Stripe, Google and WhatsApp edge functions; browser authentication, patient links, uploads and call signaling; worker job claims and document processing; gateway pairing and message filtering; deployment settings and dependency lockfiles.

Verification used invented fixtures only:

- Applied the migrations to a disposable PostgreSQL **16.15** database, with minimal Supabase Auth/Storage tables and roles. `auth.uid()` read a test subject; Vault was empty; HTTP and scheduler functions were inert stubs. Only the `pg_cron` and `pg_net` extension installation statements were replaced with those adapters. Application functions, grants and RLS predicates were unchanged.
- Exercised SQL as `anon` and `authenticated`, not as the database owner. Fixture setup alone used owner privileges. Reproductions ran inside a transaction that was rolled back.
- Executed the actual `call.ts` and Google callback implementations under Node **26.12.0**, stripping TypeScript types and replacing imports with test doubles. WebRTC, Realtime transport, Google responses and callback database writes were mocked.
- Ran existing gateway tests, Gitleaks against the working tree and 86 reachable commits, and OSV dependency checks.

**Limits:** the configured deployment uses PostgreSQL 17. The SQL harness verifies PostgreSQL authorization and application behavior, not Supabase's HTTP services. No hosted project, live patient data, real payment, Google account or WhatsApp account was exercised. Docker, Deno and workspace dependencies were unavailable; the full Supabase, browser and worker test suites were not run. Hosted configuration drift, actual HTTP headers, native parser exploits and model prompt-injection behavior remain unverified. Existing untracked localization work was preserved.

## SEC-01: Orphaned document objects become anonymously readable

**Severity:** High · **Category:** missing authorization / fail-open access control · **Evidence:** SQL reproduction.

**Locations:**

- [`20261014150000_documents.sql:199–230`](../supabase/migrations/20261014150000_documents.sql#L199-L230): `private.document_access` and the Storage SELECT policy.
- [`20261014150000_documents.sql:378–397`](../supabase/migrations/20261014150000_documents.sql#L378-L397), [`450–468`](../supabase/migrations/20261014150000_documents.sql#L450-L468): record deletion precedes object deletion.
- [`patient-documents.tsx:75–80`](../apps/web/src/components/patient-documents.tsx#L75-L80), [`documents-panel.tsx:100–107`](../apps/web/src/components/documents-panel.tsx#L100-L107): browser performs the second deletion and ignores its storage error.

**Failure and impact:** the `read` branch returns true when **no** `patient_documents` row points at the object. Its SELECT policy applies to both `anon` and `authenticated`. After either removal RPC commits, the remaining PDF/photo is readable by anyone with the public project key. An interrupted browser request or failed object deletion leaves the exposure indefinitely. The SELECT policy also permits discovering orphan object metadata; UUID paths are not an authorization boundary.

**Precondition:** an object remains after its document record is removed. A patient's own removal can deliberately stop between these steps; another patient's failed deletion creates the same state without attacker access to that patient's link.

**Reproduction:**

1. Create a synthetic consultation, patient document and matching storage object.
2. As `anon`, check object visibility: **0 objects**.
3. Call `patient_remove_document` with that consultation's valid token; omit the separate Storage deletion.
4. As `anon`, check visibility again: **1 object**. `private.document_access(path, 'read')` returns **true**.

This reproduces the database authorization grant; an HTTP download was not performed.

**Fix:** fail closed when an authorization record is absent. Keep an ownership-bearing tombstone until a trusted server process deletes the object and confirms completion. Permit cleanup through a narrowly authorized operation, not through anonymous SELECT access. Retry failed deletions durably and surface failures to the practitioner.

**Acceptance test:** pause deletion after the record transition and simulate storage failure. Anonymous users, unrelated practitioners and unassigned engines must be unable to list, download or sign the object throughout cleanup; authorized cleanup must still succeed.

## SEC-02: Unverified contacts grant access to another patient's identity

**Severity:** High · **Category:** broken object authorization / record integrity · **Evidence:** SQL reproduction.

**Locations:**

- [`20261014150000_documents.sql:101–145`](../supabase/migrations/20261014150000_documents.sql#L101-L145): `private.identify_patient` matches and edits shared patient records.
- [`20261014150000_documents.sql:330–342`](../supabase/migrations/20261014150000_documents.sql#L330-L342): anonymous `patient_identify` delegates to that helper.
- [`20261016100000_booking.sql:270–294`](../supabase/migrations/20261016100000_booking.sql#L270-L294): public booking calls the same helper and returns an invite token.
- [`20261016100000_booking.sql:328–347`](../supabase/migrations/20261016100000_booking.sql#L328-L347): `invite_details` returns the matched patient's contact.
- [`20261014150000_documents.sql:654–660`](../supabase/migrations/20261014150000_documents.sql#L654-L660): form jobs collect documents by the shared `patient_id`.

**Failure and impact:** a phone number or email is treated as proof of patient identity. An attacker can supply a known patient's email while booking, or from another valid consultation link belonging to the same practitioner. The helper attaches that consultation to the existing patient and overwrites the patient's name. A subsequent correction to a new contact updates that same shared record. `invite_details` can disclose the patient's phone when the attacker knew only their email. Documents submitted through the attacker's consultation become part of the victim's shared document collection and can influence later forms.

This crosses the **patient** boundary within a practitioner. It does not establish cross-practitioner access or let the attacker download every historical document.

**Reproduction:**

1. Seed a victim with an email and a different, nonpublic phone number, plus an unrelated consultation link for the same practitioner.
2. As `anon`, call `patient_identify(attacker_token, attacker_name, victim_email)`.
3. Observe the victim's `patient_id` returned and the victim's phone disclosed by `invite_details(attacker_token)`.
4. Call `patient_identify` again with a new phone number. The original victim consultation now shows the attacker's name and phone.
5. `patient_add_document(attacker_token, ...)` succeeds and attaches the document to that shared patient.

**Fix:** treat public contact input as an unverified claim. Verify control before linking to an existing patient, or require practitioner approval of that link. Separate consultation-submitted details from the canonical patient record. A patient-link operation must not mutate shared identity or move documents between patients without stronger authorization and an audit event.

**Acceptance test:** an attacker with only a victim's contact and their own consultation token cannot obtain another contact, change the victim's name/contact, join their patient record or add documents to it. Verified returning-patient linking must still work.

## SEC-03: Public signaling trusts participant roles and skips admission checks

**Severity:** High · **Category:** missing server-side authentication and authorization · **Evidence:** source tracing and mocked execution.

**Locations:**

- [`call.ts:24–39`](../apps/web/src/lib/call.ts#L24-L39): public `call-${token}` channel, caller-selected role.
- [`call.ts:65–98`](../apps/web/src/lib/call.ts#L65-L98): trusts `payload.from`; accepts offers, session changes and hangups.
- [`join/page.tsx:83–118`](../apps/web/src/app/join/page.tsx#L83-L118), [`141–186`](../apps/web/src/app/join/page.tsx#L141-L186): payment check is UI gating.
- [`room/page.tsx:121–137`](../apps/web/src/app/room/page.tsx#L121-L137): practitioner connects on that same channel.

**Failure and impact:** anyone holding a consultation token can join its public signaling topic and assert either `doctor` or `patient`. No admission service establishes practitioner ownership, payment, consultation status or current consent. The recipient trusts a string in the message rather than authenticated sender identity. A third holder of the link can impersonate a participant or disrupt an active call; a patient can bypass the payment UI using a custom client. A stale token is not rechecked against withdrawal at the signaling boundary.

Knowledge of the token is required; this is not evidence of guessing arbitrary consultations. WebRTC media is encrypted, but the signaling code does not authenticate which peer receives it.

**Reproduction:** executed the existing `connect` function with mocked transport and peer connections. A patient accepted an unverified `from: 'doctor'` offer and produced an answer; a `bye` from a different session ended that call. A doctor produced an offer for a client-asserted patient `hello` without any payment or authorization lookup. The channel configuration contained no `private: true`.

**Fix:** authorize admission server-side and issue short-lived, role-specific call credentials. Bind practitioner identity to consultation ownership and patient credentials to the invite, payment and allowed state. Use private Realtime authorization or a trusted signaling relay; derive sender role from authenticated identity, not message content. Pin the accepted peer/session and reject unrelated offers, ICE and hangups. Define how active calls are disconnected after revocation; private-channel authorization alone is cached and does not instantly revoke existing connections.

**Acceptance test:** reject unpaid, withdrawn and expired admissions; reject patient credentials claiming the doctor role and third-session hangups. Exercise these through the actual Realtime transport, including revocation during a call.

**Related existing issue:** [`docs/roadmap.md:95`](roadmap.md#L95) already notes payment enforcement missing from the handshake. Role impersonation and session disruption expand that issue.

## SEC-04: Anonymous bookings can exhaust available appointments

**Severity:** Medium · **Category:** uncontrolled resource consumption · **Evidence:** SQL reproduction.

**Locations:**

- [`20261016100000_booking.sql:245–295`](../supabase/migrations/20261016100000_booking.sql#L245-L295): public booking and per-contact limit.
- [`20261016100000_booking.sql:298–323`](../supabase/migrations/20261016100000_booking.sql#L298-L323): renewable unpaid hold.
- [`payment/index.ts:35–54`](../supabase/functions/payment/index.ts#L35-L54): initiating checkout renews the hold before payment.
- [`20261016100000_booking.sql:479–483`](../supabase/migrations/20261016100000_booking.sql#L479-L483): direct anonymous RPC access.

**Failure and impact:** the three-booking limit is keyed to a patient selected by unverified contact input. An attacker can reserve more appointments by changing that input. Free bookings have no hold expiration; paid bookings hold availability for 35 minutes and checkout can renew them without a completed payment. No application-level rate limit or contact verification protects the direct RPC. A small series of requests can deny genuine patients the practitioner's available times. Supabase Auth sign-in limits do not govern anonymous booking RPCs.

**Reproduction:** three future bookings with one email succeeded; a fourth was refused as `TOO_MANY_BOOKINGS`. The same fourth slot succeeded with a different email. All four free bookings had `hold_until = null` and `paid_at = null`. No flooding or load test was performed.

**Fix:** use verified contact/session identity for durable quotas, bounded holds pending verification even for free bookings, and a maximum renewal lifetime. Apply per-client and per-practitioner abuse limits at a trusted boundary. If using an edge function, revoke direct anonymous mutation access so callers cannot bypass it. Preserve the existing transactional slot lock.

**Acceptance test:** changing a supplied email/phone does not reset a caller's booking budget; unverified holds expire; repeatedly opening checkout cannot reserve a slot indefinitely.

## SEC-05: Google Calendar authorization can be completed in a different browser

**Severity:** Medium · **Category:** OAuth account-linking CSRF · **Evidence:** mocked callback execution.

**Locations:**

- [`_shared/google.ts:20–47`](../supabase/functions/_shared/google.ts#L20-L47): signed state contains practitioner, site and expiry, with no browser binding or one-time transaction.
- [`google/index.ts:80–107`](../supabase/functions/google/index.ts#L80-L107): callback stores tokens under the practitioner named by state.
- [`google/index.ts:115–145`](../supabase/functions/google/index.ts#L115-L145): GET callbacks run before practitioner authentication.

**Failure and impact:** the HMAC prevents state tampering, but does not prove that the returning browser is the practitioner that initiated the link. An attacker with a legitimate Watson practitioner account can generate their own connect URL and persuade another person to open it and approve Google's consent screen. That person's Google grant is then saved under the attacker's Watson account. The attacker can see the linked email and free/busy times and cause bookings to be written into the victim's Watson calendar. The scopes do not grant access to all calendar event contents.

**Preconditions:** an attacker-controlled practitioner account, a still-valid state (ten minutes), and another Google user approving the shared authorization URL. This is not unauthenticated state forgery or proof that Google permits reuse of a redeemed authorization code.

**Reproduction:** the actual GET callback, given a valid attacker-account state and a mocked token response for a different Google identity, saved the latter's refresh token under the attacker account. No authentication lookup was made. The same state was also accepted twice with two distinct mocked authorization codes, demonstrating absent transaction consumption.

**Fix:** bind a random, one-time OAuth transaction to both the authenticated initiating practitioner and their browser, and require that binding on completion. Consume the transaction atomically and use PKCE to bind the code exchange. A valid state signature by itself is insufficient. For a static frontend, an authenticated completion step can enforce the same binding without trusting a public GET callback to finalize account linking.

**Acceptance test:** a connect URL opened in a different browser/session must not attach its Google grant; consumed state must be rejected; a matching initiating session must complete successfully. Verify with Google's test OAuth configuration after the local checks pass.

## SEC-06: Document processing continues after consent withdrawal

**Severity:** Medium · **Category:** incomplete authorization revocation · **Evidence:** SQL reproduction.

**Locations:**

- [`20261013220000_transcription.sql:305–359`](../supabase/migrations/20261013220000_transcription.sql#L305-L359): withdrawal cancels transcription and removes audio/transcripts, but does not transition documents.
- [`20261014150000_documents.sql:491–555`](../supabase/migrations/20261014150000_documents.sql#L491-L555): document claim and completion do not check consultation consent/status.
- [`20261014150000_documents.sql:208–212`](../supabase/migrations/20261014150000_documents.sql#L208-L212): claimed-document storage access lacks a withdrawal check.
- [`engine.py:225–241`](../apps/clinical-worker/src/clinical_worker/engine.py#L225-L241): document processing has no cancellation heartbeat.

**Failure and impact:** a successful `withdraw_consent` does not remove or cancel a queued/claimed document. An engine can claim it after withdrawal, read the object, and store extracted text. Retained document text can also be selected for subsequent forms through the shared patient record. This defeats the application's documented stop-processing guarantee; see [specification section 15](../MASTER_BUILD_SPEC.md#15-consent).

**Reproduction:** after withdrawal returned `{"ok":true}`, the engine successfully claimed the synthetic document, its storage row was readable under the engine identity, and `engine_complete_document` returned `{"ok":true,"readable":true}`.

**Fix:** make document processing authorization explicit and revoke it with the relevant consent scope. Cancel queued work, invalidate active leases, enforce the check at claim, storage-read and completion, and add bounded cancellation to the worker. If document retention has a separate authorization basis, model that separately from permission to keep processing it; do not infer authorization from the existence of a record.

**Acceptance test:** withdrawal before claim prevents claim; withdrawal during reading prevents subsequent access and rejects completion; withdrawn content is excluded from later form context unless separately authorized.

## Dependency and secret-scan results

### Dependency advisories

OSV Scanner **2.7.0** examined 573 pnpm, 124 gateway npm and 79 Python lockfile entries. It reported three distinct advisories; aliases for the same issue are counted once:

- **`braces@3.0.3` — [GHSA-vfj7-8cjw-p6xm](https://osv.dev/vulnerability/GHSA-vfj7-8cjw-p6xm), CVE-2026-93687.** Upstream severity: High; stack-exhaustion denial of service. Locked path: `eslint-config-next` → `@next/eslint-plugin-next` → `fast-glob` → `micromatch` → `braces`. This is lint tooling, not a reachable endpoint in the static deployment. No fixed version was supplied in the scan response; track the upstream advisory and update when a fix is available.
- **`compression@1.8.1` — [GHSA-vc2v-76pw-4v95](https://osv.dev/vulnerability/GHSA-vc2v-76pw-4v95), CVE-2026-87776.** Upstream severity: High; premature response closure can leak memory. It is brought in by the development dependency `serve`, used by [`playwright.config.ts:33`](../apps/web/playwright.config.ts#L33). Update to a dependency resolution containing **1.8.2 or newer**. The Render static deployment does not run this test server.
- **`diskcache@5.6.3` — [GHSA-w8v5-vhqr-4h9v](https://osv.dev/vulnerability/GHSA-w8v5-vhqr-4h9v), CVE-2025-69872 / PYSEC-2026-2447.** Upstream severity: Moderate; unsafe pickle deserialization. Locked through `llama-cpp-python`. No disk-cache activation or attacker-writable cache path was established in the worker; [`form.py:244–253`](../apps/clinical-worker/src/clinical_worker/form.py#L244-L253) constructs `Llama` without enabling that cache. No fixed version was supplied in the scan response. Avoid enabling a pickle-backed cache over untrusted files and track upstream remediation.

No advisories were returned for the gateway lockfile. OSV Scanner did not support this repository's Deno lock format, so its **10 npm package/version pairs** were checked separately through OSV's `querybatch` API; none returned an advisory. These are version-database results as of the review date, not exploit tests or a guarantee of vulnerability absence.

### Secrets

Gitleaks reported one match in both the working tree and reachable history: `scripts/configure-stripe.sh:12`, rule `curl-auth-user`. Inspection of the current file and commit `f300fc6e2590d0167b628f9d415b8179e0903b0c` shows `-u "$key:"`, an environment/runtime-derived variable, not a committed Stripe secret. **False positive; no confirmed credential leak found by these scans.** Reports were generated with full redaction. Unreachable Git objects and external secret stores were not scanned.

## Other observations and existing controls

- The hosted-auth setup explicitly lowers the minimum password length to **six** characters ([`configure-hosted-auth.sh:2–8`](../scripts/configure-hosted-auth.sh#L2-L8)), while the README claims twelve. This is a documented test-mode choice in the script, not evidence of a compromised account. Restore the intended stronger policy and reconcile the documentation before expanding access.
- Invite/short/WhatsApp codes have no explicit lifetime in the reviewed migrations. Revocation generally checks only `consent_withdrawn`; long-lived links and short-code guessing need a separate credential-lifecycle decision and abuse controls. No brute-force success was demonstrated.
- Document parsing limits uploaded bytes and page count, but not PDF render dimensions or per-document process time ([`documents.py:53–80`](../apps/clinical-worker/src/clinical_worker/documents.py#L53-L80)). Test bounded decoding in an isolated process before treating these limits as protection against decompression/resource-exhaustion attacks; no native-parser exploit was run.
- Every reviewed public application table enables RLS. Practitioner SELECT policies generally bind ownership to `auth.uid()`, and mutation RPCs explicitly control grants. The SQL catalog exposed ten intended anonymous security-definer RPCs; sensitive payment, Google administration and gateway-state RPCs were not anonymous.
- Stripe webhooks verify signatures and fulfillment retrieves payment status from Stripe before the amount-checked database write. Google POST actions validate the Supabase user. WhatsApp checks Meta's HMAC or gateway/cron secrets. Gateway pairing uses AES-256-GCM with the state key name as associated data, and the pairing page denies access when its password is unset. Existing gateway tests passed **8/8**.
- Browser rendering uses React text output on the reviewed untrusted-content paths. The static build injects hash-based script CSP. No confirmed SQL injection, DOM XSS or shell injection was established in this review.

## Verification record and follow-up

Executed checks:

```sh
node --test apps/whatsapp-gateway/filter.test.mjs apps/whatsapp-gateway/sealed.test.mjs
gitleaks git --redact=100 --no-banner --no-color --report-format json --report-path "$AUDIT_DIR/history-secrets.json"
gitleaks dir --redact=100 --no-banner --no-color --report-format json --report-path "$AUDIT_DIR/tree-secrets.json" .
osv-scanner scan source --lockfile pnpm-lock.yaml \
  --lockfile apps/whatsapp-gateway/package-lock.json \
  --lockfile apps/clinical-worker/uv.lock \
  --format json --output-file "$AUDIT_DIR/dependencies.json"
```

`AUDIT_DIR` denotes the temporary output directory; report filenames above are portable equivalents of the review's temporary paths. Gitleaks exited 1 for the inspected false positive; OSV exited 1 for the advisories. The first OSV invocation including `deno.lock` exited 127 because the extractor did not support it; the supported-lockfile rerun and separate Deno API check completed.

The isolated SQL checks confirmed SEC-01, SEC-02, SEC-04 and SEC-06. Mocked execution confirmed the missing application checks in SEC-03 and SEC-05; external service behavior still needs integration coverage.

Suggested remediation order:

1. Close orphan-object reads and separate unverified patient submissions from canonical identity (**SEC-01/02**).
2. Enforce role-bound call admission and consent revocation across document processing (**SEC-03/06**).
3. Add trusted booking abuse controls and browser-bound OAuth completion (**SEC-04/05**).
4. Resolve or explicitly track the dependency advisories; reconcile deployment authentication settings.
5. Add the acceptance cases above to `apps/web/tests/documents.test.ts`, `booking.test.ts`, `google.test.ts`, `transcription.test.ts` and call integration tests. Run them against the configured PostgreSQL 17 Supabase stack, then verify deployed settings with synthetic accounts.

References checked for platform behavior: [Supabase Realtime authorization](https://supabase.com/docs/guides/realtime/authorization), including cached connection authorization, and [Data API exposure changes](https://supabase.com/changelog/45329-breaking-change-tables-not-exposed-to-data-and-graphql-api-automatically), which leave existing grants and RLS behavior in force.
