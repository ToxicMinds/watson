#!/usr/bin/env bash
# Store Watson's patient-OTP delivery credentials in the hosted Supabase project.
# The secrets are read silently, written to a mode-600 temporary dotenv file,
# sent through the Supabase CLI's --env-file path, then removed.
set -euo pipefail

: "${SUPABASE_ACCESS_TOKEN:?set through your local .envrc}"
: "${SUPABASE_PROJECT_REF:?set through your local .envrc}"

read -r -p "Watson Gmail sender address: " sender
read -r -p "Google OAuth client ID: " client_id
read -r -s -p "Google OAuth client secret: " client_secret; printf '\n'
read -r -s -p "Gmail refresh token (gmail.send scope only): " refresh_token; printf '\n'

for value in "$sender" "$client_id" "$client_secret" "$refresh_token"; do
  if [[ -z "$value" || "$value" == *$'\n'* || "$value" == *$'\r'* ]]; then
    echo "Credential input is empty or contains a newline." >&2
    exit 1
  fi
done
if [[ ! "$sender" =~ ^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$ ]]; then
  echo "Sender must be one email address." >&2
  exit 1
fi
if [[ ! "$client_id" =~ \.apps\.googleusercontent\.com$ ]]; then
  echo "OAuth client ID does not look like a Google client ID." >&2
  exit 1
fi
if [[ ! "$refresh_token" =~ ^[A-Za-z0-9_./~=-]+$ || ! "$client_secret" =~ ^[A-Za-z0-9_./~=-]+$ ]]; then
  echo "OAuth credentials contain unexpected characters; refusing unsafe dotenv serialization." >&2
  exit 1
fi

pepper=$(openssl rand -hex 32)
temp_env=$(mktemp -t watson-patient-otp)
trap 'rm -f "$temp_env"' EXIT
chmod 600 "$temp_env"
{
  printf 'SITE_URLS=https://watson-assists.onrender.com\n'
  printf 'PATIENT_OTP_PEPPER=%s\n' "$pepper"
  printf 'GOOGLE_CLIENT_ID=%s\n' "$client_id"
  printf 'GOOGLE_CLIENT_SECRET=%s\n' "$client_secret"
  printf 'GOOGLE_REFRESH_TOKEN=%s\n' "$refresh_token"
  printf 'PATIENT_OTP_FROM=%s\n' "$sender"
} > "$temp_env"

supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" --env-file "$temp_env" >/dev/null
echo "Patient OTP secrets stored in Supabase. Values were not printed; pepper was generated locally."
