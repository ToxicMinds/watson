# SEC-02 patient OTP — DevOps handoff

## Status, 29 October 2026: live

Every step below has been done on the hosted Watson (project `mconctpleszerqhgaarj`, site
https://watson-assists.onrender.com), main at `36efb71`, CI green. What happened, and what differs:

1. **Gmail sender.** Gmail API was already enabled in Watson's Google Cloud project `watson-512616`.
   The refresh token is for the **same OAuth client as Google Calendar** ("Watson web"): the function
   reads `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, which Calendar already uses, so a separate client
   would have broken Calendar. Scope: only `gmail.send`, signed in as watson.assists@gmail.com.
   **Open:** the consent screen is still in Testing, so this token expires on **5 November**. Publishing
   needs a privacy page on Watson's site and its link on the Branding page (owner approved publishing;
   the privacy text awaits the owner). Until then, re-issue the token weekly.
2. **Migrations.** Dry run reviewed, then all 11 applied: your 8 (with your 28 Oct edit of
   `20261028090000`: the practitioner's own typing stays a claim, the owner's decision of 29 Oct) and 3 new:
   `20261029090000_confirm_new_patient` (the practitioner's "Is this your patient?": add as a new patient;
   `set_patient` stores a claim and corrects only an already confirmed patient's own record),
   `20261029100000_whatsapp_sign_in_numbers` (Auth keeps phones without "+"; `register_patient_otp_session`
   refused WhatsApp sessions), `20261029110000_register_practitioner` (service-key-only role grant: a new
   account had no way to become a practitioner; `scripts/local-accounts.mjs` and `sample-practitioners.mjs`
   use it). Role backfill: all 12 hosted accounts classified (10 practitioners, 2 engines), none unresolved.
   A data-only dump was taken first (kept privately by the owner).
3. **Secrets.** `scripts/configure-patient-otp-secrets.sh` was changed: it no longer asks for or overwrites
   `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` or `SITE_URLS` (shared with Calendar and other functions),
   keeps an existing `PATIENT_OTP_PEPPER` (a new one voids codes already sent), checks Calendar is set up
   first, reads `PATIENT_OTP_FROM` / `GMAIL_REFRESH_TOKEN` from the environment when given, and its
   `mktemp` works on Linux too.
4. **Functions deployed:** `patient-otp`, `document-cleanup` (SEC-01; it was missing from this runbook) and
   `ice` (the call relay, below).
5. **Smoke test passed** (by hand, as the script does): a code to watson.assists+test@gmail.com came from the
   Watson sender, verified once, returned a normal session with roles exactly `["patient"]`, global sign-out
   204. A WhatsApp code to the owner's own number was delivered.
6. **Web deployed** from main.

Added on the way, by the owner's decisions:
- **WhatsApp codes** (owner, 28 Oct: "through my number", accepting the ban risk you pointed out):
  `patient-otp` takes `{phone}` as well as `{email}` (same hashed challenge, budgets and lockout); the code
  goes to the gateway's new `POST /send` (shared secret, one E.164 number, 500 characters, nothing logged).
  A WhatsApp account is an Auth user with the confirmed phone and the address
  `whatsapp-<digits>@patients.watson.invalid` to mint sessions. The sign-in page asks Email or WhatsApp.
- **"Is this your patient?"** on the consultation page (W5's practitioner review): typed details, and the
  quarantined legacy links, are shown at once, marked "Check who this is", and confirmed by the
  practitioner. Your overnight screen change overlapped; the owner kept this version.
- **Calls from mobile networks:** a Cloudflare TURN relay (`ice` function, `TURN_KEY_ID`,
  `TURN_KEY_API_TOKEN`); a Watson on one computer asks for none.

Your runbook, as written, follows.

---

**Status:** pending external Google OAuth and hosted Supabase setup. No hosted secrets, migrations, or function have been changed by this session.

## Critical ordering note

The current remote `main` predates the server-challenge/session-gating commits. Do not deploy or enable patient sign-in from that older version. Merge the complete `feat/sec-02-patient-signin` branch through `70c1435` (including the five commits ahead of the branch's remote base), then run CI and review the resulting migration list. Do not cherry-pick only the last setup commit. No force-push.

The new route only becomes usable after the database migrations and `patient-otp` function are deployed and secrets are set. Until then, the endpoint must fail closed; no patient role or patient data may be granted through native Auth OTP.

## Prerequisites

- Access to the Watson-owned Google Cloud project and the Watson Gmail sender account.
- A Supabase CLI token with project/database and Edge Function secret/deploy permissions. Export `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` locally (for example through the developer's private `.envrc`); never put either in git, a ticket, or chat.
- The app's public Supabase URL and publishable key from the hosting configuration for the final smoke test. These are public identifiers, not service-role credentials.
- A synthetic inbox controlled by the operator. Never test using a real patient's address.

## Ordered runbook

### 1. Prepare Watson's Gmail OAuth sender

1. Create/select a Google Cloud project owned by Watson and enable **Gmail API**.
2. Configure Google Auth Platform consent/branding and audience for the actual sender account. If Workspace offers **Internal**, use that for a same-domain Workspace sender. If using an external audience, add the sender as a test user while testing and resolve Google's consent/verification requirements before production operation.
3. Create a server-side OAuth client. Authorize the Watson sender account for offline access and request exactly `https://www.googleapis.com/auth/gmail.send`; do not request Calendar scopes, Gmail read/modify scopes, or reuse Watson Calendar's refresh token.
4. Obtain a refresh token using the approved OAuth flow with `access_type=offline` and explicit consent. Confirm the granted scope is only `gmail.send`. Keep the client secret and refresh token local; do not send either to the DevOps ticket/chat.

`gmail.send` is a sensitive Gmail scope. Google may require consent-screen verification depending on audience and publishing status. Resolve that with the Google project owner; do not work around a consent warning or use an unverified test-only refresh token as a production credential.

### 2. Confirm the target Supabase project and migration plan

From the merged checkout, with private Supabase CLI credentials loaded:

```sh
supabase projects list
supabase migration list --project-ref "$SUPABASE_PROJECT_REF"
supabase db push --dry-run --skip-vault --project-ref "$SUPABASE_PROJECT_REF"
```

Confirm the project ref is Watson production. Review **every** pending migration in the dry-run output, not just SEC-02. Stop if migration history is unexpected, there is drift, or the target project is unclear. Do not use `--include-all`, `--include-seed`, or `--include-roles` to silence a mismatch without a reviewed recovery plan.

The required SEC-02 migrations, in timestamp order, are:

1. `20261027063501_sec02_patient_role_bootstrap.sql`
2. `20261027065618_sec02_patient_otp_challenges.sql`
3. `20261027070131_sec02_patient_role_service_provision.sql`

The final migration revokes public patient-role self-provisioning and gates patient authorization on the exact Auth `session_id` registered by the server challenge. Apply migrations only after reviewing all pending work:

```sh
supabase db push --skip-vault --project-ref "$SUPABASE_PROJECT_REF"
supabase migration list --project-ref "$SUPABASE_PROJECT_REF"
```

Verify all three migrations are recorded as applied. Do not manually edit hosted tables or bypass migration history.

### 3. Store Edge Function secrets

Run interactively on a trusted workstation:

```sh
scripts/configure-patient-otp-secrets.sh
```

The script prompts without echo for sender, Google OAuth client ID/secret, and refresh token; generates a fresh 256-bit HMAC pepper; uploads the values through `supabase secrets set --env-file`; and removes its mode-600 temporary file. It does not print secret values. Required secrets:

- `SITE_URLS=https://watson-assists.onrender.com`
- `PATIENT_OTP_PEPPER` (generated by the script; 32 random bytes)
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN` (Watson sender; only `gmail.send`)
- `PATIENT_OTP_FROM` (same authorized Watson sender)

Do not reuse the Calendar OAuth refresh token. Re-running the setup script generates a new pepper and invalidates outstanding OTP challenges; plan credential rotation accordingly.

### 4. Deploy the single Edge Function

After migrations and secrets succeed:

```sh
supabase functions deploy patient-otp \
  --project-ref "$SUPABASE_PROJECT_REF" \
  --no-verify-jwt
```

`verify_jwt` is deliberately disabled for this endpoint because send/verify starts before a user session exists. The function validates request shape, applies server-side contact/IP budgets, and uses its service credential internally; never expose that service credential to the browser. Do not use `--prune`.

### 5. Prove delivery and normal session with synthetic identity

Export the hosted **public** Supabase URL/key from the app's hosting configuration, then run:

```sh
scripts/smoke-patient-otp.py
```

Enter a synthetic inbox address controlled by the operator. The script sends one code, prompts for it without echo, verifies through the deployed function, checks `current_user_roles()` returns exactly `patient`, and globally signs out the synthetic test session. It never prints/stores the session token or HTTP response bodies. The Auth user/role created for the synthetic identity remains as a test account with its session revoked; clean up only under a separately reviewed test-account cleanup process.

**Pass criteria:** delivered message comes from the configured Watson sender; code verifies once; normal Supabase access/refresh session is returned to the caller; role check is exactly `['patient']`; sign-out succeeds; replay/invalid/expired/lockout tests continue passing; logs contain no code, token, raw contact, or OAuth credential.

If smoke fails, do not retry against patient addresses. Check only redacted provider/function status, the OAuth sender/scope, Supabase secret names (not values), and migration status. The function intentionally returns generic failures.

### 6. Deploy web app only after the gate passes

Merge the reviewed branch to `main` normally. After CI passes and Steps 1–5 pass, deploy the static site using the repository's existing manual Render procedure:

```sh
scripts/deploy-web.sh
```

Run the patient UI smoke check with the synthetic account only. Confirm practitioner password sign-in still works. Do not represent this as completion of all SEC-02: consultation-claim linking, consultation-scoped documents, and practitioner confirmation remain separate work.

## Failure and rollback

- Leave patient OTP unavailable if Gmail OAuth, secret upload, migration, function deploy, or synthetic smoke proof fails. Do not enable or announce patient sign-in.
- The function returns `NOT_CONFIGURED` when required secrets are absent. Never substitute a public SMTP/API key or the Calendar token.
- Roll back the web deployment to the prior static release if its UI is faulty; retain additive database protections and the deployed function. Do not restore public `bootstrap_patient_role` execution, drop the session allow-list, delete OTP/audit rows, or reset migration history.
- If an OAuth refresh token is exposed or revoked, revoke it in Google, issue a replacement with the same least-privilege scope, rerun secret setup, and repeat the synthetic test.

## Evidence to attach to the DevOps change

- Merged commit SHA and CI result.
- Redacted migration dry-run/review and post-apply migration status.
- Names of deployed secrets only (never values), function deployment result, and function version/commit.
- Synthetic smoke result, provider sender, and confirmation that test-session sign-out succeeded.
- Confirmation that practitioner sign-in remains healthy and that no real patient address was used.
