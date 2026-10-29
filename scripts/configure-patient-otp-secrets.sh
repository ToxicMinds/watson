#!/usr/bin/env bash
# Store Watson's patient sign-in code settings in the hosted Supabase project.
#
# Email codes go out from Watson's Gmail through the Gmail API. The OAuth client is the one Google
# Calendar already uses ("Watson web": GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, set by the Calendar
# setup); this script never changes those, nor SITE_URLS, which other functions share. Issue the Gmail
# refresh token for that same client, signed in as the Watson sender, with only the gmail.send scope.
# WhatsApp codes need no settings here: they go through Watson's gateway (WHATSAPP_GATEWAY_URL and
# WHATSAPP_GATEWAY_SECRET, set by scripts/deploy-whatsapp-gateway.sh).
#
# The values are read silently (or from PATIENT_OTP_FROM and GMAIL_REFRESH_TOKEN when set), written to a
# mode-600 temporary dotenv file, sent through the Supabase CLI's --env-file path, then removed.
# PATIENT_OTP_PEPPER is generated only when the project has none: a new one voids codes already sent.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?set through your local .envrc}"
: "${SUPABASE_PROJECT_REF:?set through your local .envrc}"

sender=${PATIENT_OTP_FROM:-}
refresh_token=${GMAIL_REFRESH_TOKEN:-}
[[ -n "$sender" ]] || read -r -p "Watson Gmail sender address: " sender
if [[ -z "$refresh_token" ]]; then read -r -s -p "Gmail refresh token (gmail.send scope only): " refresh_token; printf '\n'; fi

for value in "$sender" "$refresh_token"; do
  if [[ -z "$value" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "Credential input is empty or contains a newline." >&2
    exit 1
  fi
done
if [[ ! "$sender" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Sender must be one email address." >&2
  exit 1
fi
if [[ ! "$refresh_token" =~ ^[A-Za-z0-9_./~=-]+$ ]]; then
  echo "The refresh token contains unexpected characters; refusing unsafe dotenv serialization." >&2
  exit 1
fi

names=$(supabase secrets list --project-ref "$SUPABASE_PROJECT_REF" -o json | python3 -c \
  "import json,sys; d=json.load(sys.stdin); d=d.get('secrets', d) if isinstance(d, dict) else d; print(' '.join(s['name'] for s in d))")
for needed in GOOGLE_CLIENT_ID GOOGLE_CLIENT_SECRET SITE_URLS; do
  [[ " $names " == *" $needed "* ]] || { echo "$needed is not set: set up Google Calendar first." >&2; exit 1; }
done

temp_env=$(mktemp "${TMPDIR:-/tmp}/watson-patient-otp.XXXXXX")
trap 'rm -f "$temp_env"' EXIT
chmod 600 "$temp_env"
{
  [[ " $names " == *" PATIENT_OTP_PEPPER "* ]] || printf 'PATIENT_OTP_PEPPER=%s\n' "$(openssl rand -hex 32)"
  printf 'GOOGLE_REFRESH_TOKEN=%s\n' "$refresh_token"
  printf 'PATIENT_OTP_FROM=%s\n' "$sender"
} > "$temp_env"

supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" --env-file "$temp_env" >/dev/null
echo "Patient sign-in code settings stored in Supabase. No values were printed."
