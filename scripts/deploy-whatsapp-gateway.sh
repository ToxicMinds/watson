#!/usr/bin/env bash
# Watson's WhatsApp gateway on Render's free plan (owner's decisions of 16 Oct 2026: no card).
# Creates the service once (Docker, Frankfurt, free), gives it its secrets from ~/.config/watson,
# points the whatsapp function at it, and deploys the latest commit on main. Safe to run again.
# Then link the number on its pairing page: user `watson`, password in
# ~/.config/watson/whatsapp-gateway-pairing-password.
set -euo pipefail
: "${SUPABASE_ACCESS_TOKEN:?set by .envrc}" "${SUPABASE_PROJECT_REF:?set by .envrc}"
export RENDER_CLI_CONFIG_PATH="${RENDER_CLI_CONFIG_PATH:-$HOME/.render/profiles/watson-assists.yaml}"
dir="$HOME/.config/watson"
name=watson-whatsapp
render_key=$(sed -n 's/^ *key: *//p' "$RENDER_CLI_CONFIG_PATH" | head -1)
api() { curl -fsS -H "Authorization: Bearer $render_key" -H "Content-Type: application/json" "$@"; }
secret_file() { # a random secret kept in ~/.config/watson, created once
  [ -s "$dir/$1" ] || (umask 077; openssl rand -hex 32 | tr -d '\n' > "$dir/$1")
}
secret_file whatsapp-gateway-state-key
secret_file whatsapp-gateway-pairing-password

id=$(render services list -o json --confirm | python3 -c "import json,sys
for item in json.load(sys.stdin) or []:  # an empty workspace lists null
    s = item.get('service', item)
    if s['name'] == '$name': print(s['id'])")
if [ -z "$id" ]; then
  id=$(render services create --name "$name" --type web_service --runtime docker \
    --repo https://github.com/watson-assists/watson --branch main --root-directory apps/whatsapp-gateway \
    --plan free --region frankfurt --health-check-path /health -o json --confirm |
    python3 -c "import json,sys; d=json.load(sys.stdin); print(d.get('service', d)['id'])")
fi
url=$(api "https://api.render.com/v1/services/$id" | python3 -c "import json,sys; print(json.load(sys.stdin)['serviceDetails']['url'])")

# Its secrets, from files (never on a command line).
python3 - "$dir" "$SUPABASE_PROJECT_REF" <<'EOF' | api -X PUT "https://api.render.com/v1/services/$id/env-vars" -d @- >/dev/null
import json, sys
folder, ref = sys.argv[1], sys.argv[2]
read = lambda name: open(f"{folder}/{name}").read().strip()
print(json.dumps([
    {"key": "WATSON_URL", "value": f"https://{ref}.supabase.co/functions/v1/whatsapp"},
    {"key": "WATSON_GATEWAY_SECRET", "value": read("whatsapp-gateway-secret")},
    {"key": "WATSON_STATE_KEY", "value": read("whatsapp-gateway-state-key")},
    {"key": "PAIRING_PASSWORD", "value": read("whatsapp-gateway-pairing-password")},
]))
EOF
supabase secrets set --project-ref "$SUPABASE_PROJECT_REF" WHATSAPP_GATEWAY_URL="$url" >/dev/null
# The number patients message (the owner's own, in ~/.config/watson/owner-whatsapp): Vault, for
# patients' links only (public.watson_whatsapp), never the website's code.
python3 -c 'import json,sys; print(json.dumps({"query": sys.argv[1]}))' "delete from vault.secrets where name = 'watson_whatsapp_number';
select vault.create_secret('$(cat "$dir/owner-whatsapp")', 'watson_whatsapp_number');" |
  curl -fsS -X POST "https://api.supabase.com/v1/projects/$SUPABASE_PROJECT_REF/database/query" \
    -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" -H "Content-Type: application/json" -d @- >/dev/null

render deploys create "$id" --confirm -o json >/dev/null
for _ in $(seq 1 90); do
  status=$(render deploys list "$id" -o json --confirm | python3 -c "import json,sys; d=json.load(sys.stdin)[0]; print(d.get('deploy', d).get('status'))")
  case "$status" in
    live) echo "Deployed. Pairing page: $url (user watson, password in $dir/whatsapp-gateway-pairing-password)"; exit 0 ;;
    build_failed|update_failed|canceled|deactivated) echo "deploy $status"; exit 1 ;;
  esac
  sleep 10
done
echo "deploy still running after 15 minutes"; exit 1
