#!/usr/bin/env bash
# Lets the hosted database email the owner when Watson stops doing its work by itself (migration
# 20261016160000): Resend's sending key and the owner's address go into the database's Vault.
# Resend's free plan sends from onboarding@resend.dev only to the address its account was made
# with: Watson's own, watson.assists@gmail.com, since 24 Oct 2026. Private files:
# ~/.config/watson/resend-api-key, owner-email.
# usage: scripts/configure-owner-notices.sh [--test]   (--test sends one email now)
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set by .envrc}" "${SUPABASE_PROJECT_REF:?set by .envrc}"
dir="$HOME/.config/watson"
sql() {
  python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1" |
    curl -fsS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @-
}
sql "delete from vault.secrets where name in ('resend_api_key', 'owner_email');
select vault.create_secret('$(cat "$dir/resend-api-key")', 'resend_api_key');
select vault.create_secret('$(cat "$dir/owner-email")', 'owner_email');" >/dev/null
if [ "${1:-}" = "--test" ]; then
  sql "select private.notify_owner('test-' || now()::text, 'Watson can email you now',
    'This is a test. Watson will email you here when it can no longer do its work by itself, for example when the engine has used this month''s allowance.');" >/dev/null
  echo "Test email queued."
fi
echo "Owner notices configured for $SUPABASE_PROJECT_REF"
