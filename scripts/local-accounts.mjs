// Watson on one computer (scripts/local.sh setup): this computer's own logins, made once and kept
// in .local/ (git-ignored). A doctor to sign in as ("doctor"), with the sample Ayurveda form, and the
// engine's own account. Safe to run again: the passwords in .local/ stay the same.
import { execSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const root = new URL("..", import.meta.url).pathname;
const { createClient } = createRequire(`${root}apps/web/package.json`)("@supabase/supabase-js");
const state = `${root}.local`;
mkdirSync(state, { recursive: true, mode: 0o700 });

const raw = execSync("supabase status -o json", { cwd: root, encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
const status = JSON.parse(raw.slice(raw.indexOf("{"), raw.lastIndexOf("}") + 1));
const admin = createClient(status.API_URL, status.SECRET_KEY, { auth: { persistSession: false } });
const noSession = { auth: { persistSession: false } };

/** KEY=value lines in a .local file, made with a new password the first time. */
function remembered(file, key) {
  const path = `${state}/${file}`;
  const line = existsSync(path) && readFileSync(path, "utf8").split("\n").find((l) => l.startsWith(`${key}=`));
  return line ? line.slice(key.length + 1) : randomBytes(12).toString("base64url");
}

/** The account for this email, with this password, whether it existed or not. */
async function account(email, password) {
  const { data, error } = await admin.auth.admin.listUsers({ perPage: 1000 });
  if (error) throw error;
  const found = data.users.find((user) => user.email === email);
  if (found) {
    const updated = await admin.auth.admin.updateUserById(found.id, { password });
    if (updated.error) throw updated.error;
    return found.id;
  }
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (created.error) throw created.error;
  return created.data.user.id;
}

const doctorPassword = remembered("logins.env", "LOCAL_PASSWORD");
await account("doctor@watson.test", doctorPassword);
const doctor = createClient(status.API_URL, status.PUBLISHABLE_KEY, noSession);
const signedIn = await doctor.auth.signInWithPassword({ email: "doctor@watson.test", password: doctorPassword });
if (signedIn.error) throw signedIn.error;
const template = JSON.parse(readFileSync(`${root}packages/test-fixtures/templates/ayurveda-intake.json`, "utf8"));
const set = await doctor.rpc("set_form_template", { p_definition: template });
if (set.error || !set.data?.ok) throw new Error(`the sample form was refused: ${JSON.stringify(set.error ?? set.data)}`);

const enginePassword = remembered("engine.env", "WATSON_ENGINE_PASSWORD");
const engineId = await account("engine-local@watson.test", enginePassword);
const registered = await admin.rpc("register_engine", { p_user_id: engineId, p_label: "this computer" });
if (registered.error) throw registered.error;

writeFileSync(`${state}/logins.env`, `LOCAL_LOGIN=doctor\nLOCAL_PASSWORD=${doctorPassword}\n`, { mode: 0o600 });
writeFileSync(`${state}/engine.env`, [
  `WATSON_SUPABASE_URL=${status.API_URL}`,
  `WATSON_SUPABASE_PUBLISHABLE_KEY=${status.PUBLISHABLE_KEY}`,
  "WATSON_ENGINE_EMAIL=engine-local@watson.test",
  `WATSON_ENGINE_PASSWORD=${enginePassword}`,
  "",
].join("\n"), { mode: 0o600 });
console.log("Logins ready: sign in as doctor (password in .local/logins.env).");
