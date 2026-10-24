#!/usr/bin/env bash
# Watson's engine on Modal (owner's decision of 16 Oct 2026, decision 0009). Safe to run again:
# 1. the cloud engine's own account on the hosted database, registered as an engine that runs on demand;
# 2. Modal's two secrets (that account; the wake-up key);
# 3. the deploy (apps/clinical-worker/modal_engine.py) and, the first time, the models;
# 4. the wake-up address and key in the database's Vault, so queued work wakes the engine.
# Uses the Modal profile `watson-assists` (Watson's own account since 24 Oct 2026), never Synculariti's.
# usage: scripts/configure-cloud-engine.sh [--models]   (--models fetches the models again)
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set by .envrc}" "${SUPABASE_PROJECT_REF:?set by .envrc}"
dir="$HOME/.config/watson"
set -a; . "$dir/supabase.env"; set +a
export MODAL_PROFILE="${MODAL_PROFILE:-watson-assists}"
cd "$(dirname "$0")/../apps/clinical-worker"
modal() { uv run --with modal==1.6.2 modal "$@"; }
sql() {
  python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "$1" |
    curl -fsS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
      -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @-
}
secret_file() { # a random secret kept in ~/.config/watson, created once
  [ -s "$dir/$1" ] || (umask 077; openssl rand -hex 32 | tr -d '\n' > "$dir/$1")
  cat "$dir/$1"
}

email=engine-cloud@watson.test
password=$(secret_file cloud-engine-password)
wake_key=$(secret_file cloud-engine-wake-secret)
admin=(-H "apikey: $SUPABASE_SECRET_KEY" -H "Authorization: Bearer $SUPABASE_SECRET_KEY" -H "Content-Type: application/json")

# 1. The account. Created once; its password is set again each run, from the file above.
id=$(sql "select id from auth.users where email = '$email'" | python3 -c 'import json,sys; r=json.load(sys.stdin); print(r[0]["id"] if r else "")')
if [ -z "$id" ]; then
  id=$(curl -fsS -X POST "$SUPABASE_URL/auth/v1/admin/users" "${admin[@]}" \
    -d "{\"email\": \"$email\", \"password\": \"$password\", \"email_confirm\": true}" | python3 -c 'import json,sys; print(json.load(sys.stdin)["id"])')
  curl -fsS -X POST "$SUPABASE_URL/rest/v1/rpc/register_engine" "${admin[@]}" -d "{\"p_user_id\": \"$id\", \"p_label\": \"cloud\"}" >/dev/null
else
  curl -fsS -X PUT "$SUPABASE_URL/auth/v1/admin/users/$id" "${admin[@]}" -d "{\"password\": \"$password\"}" >/dev/null
fi
sql "update public.engines set on_demand = true where user_id = '$id'" >/dev/null

# 2. Modal's secrets.
modal secret create --force watson-engine WATSON_SUPABASE_URL="$SUPABASE_URL" \
  WATSON_SUPABASE_PUBLISHABLE_KEY="$SUPABASE_PUBLISHABLE_KEY" WATSON_ENGINE_EMAIL="$email" \
  WATSON_ENGINE_PASSWORD="$password" >/dev/null
modal secret create --force watson-engine-wake WAKE_SECRET="$wake_key" >/dev/null

# 3. The deploy; the models the first time (or with --models).
url=$(modal deploy modal_engine.py | tee /dev/stderr | grep -o 'https://[^ ]*--watson-engine-wake[.a-z0-9-]*\.modal\.run' | head -1)
[ -n "$url" ] || { echo "The deploy printed no wake address." >&2; exit 1; }
if [ "${1:-}" = "--models" ] || ! modal volume ls watson-models llm >/dev/null 2>&1; then
  modal run modal_engine.py::fetch_models
fi

# 4. The database's way to wake it.
sql "delete from vault.secrets where name in ('engine_wake_url', 'engine_wake_secret');
select vault.create_secret('$url', 'engine_wake_url');
select vault.create_secret('$wake_key', 'engine_wake_secret');" >/dev/null
echo "Cloud engine ready: queued work wakes $url"
