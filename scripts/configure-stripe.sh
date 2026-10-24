#!/usr/bin/env bash
# Connects the hosted project to Stripe (decision 0007); Watson's own Stripe account since 24 Oct 2026. Run once the test secret key is in
# ~/.config/watson/stripe-secret-key. Registers the webhook endpoint (once), keeps its signing
# secret in ~/.config/watson/stripe-webhook-secret, and sets both as function secrets.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set by .envrc}" "${SUPABASE_PROJECT_REF:?set by .envrc}"
dir="$HOME/.config/watson"
key=$(cat "$dir/stripe-secret-key")
case "$key" in sk_test_*|rk_test_*) ;; *) echo "expected a test key (sk_test_... or restricted rk_test_...)"; exit 1 ;; esac
endpoint="https://$SUPABASE_PROJECT_REF.supabase.co/functions/v1/stripe-webhook"
if [ ! -s "$dir/stripe-webhook-secret" ]; then
  curl -fsS https://api.stripe.com/v1/webhook_endpoints -u "$key:" \
    -d url="$endpoint" -d "enabled_events[]=checkout.session.completed" \
    -d "enabled_events[]=checkout.session.async_payment_succeeded" -d description="Watson patient payments" |
    python3 -c "import json,sys; print(json.load(sys.stdin)['secret'], end='')" > "$dir/stripe-webhook-secret"
  chmod 600 "$dir/stripe-webhook-secret"
fi
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" \
  STRIPE_SECRET_KEY="$key" STRIPE_WEBHOOK_SECRET="$(cat "$dir/stripe-webhook-secret")" >/dev/null
echo "Stripe connected: webhook $endpoint"
