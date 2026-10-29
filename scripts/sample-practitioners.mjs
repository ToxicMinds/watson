// Sample practitioners for the front page (owner, 16 Oct 2026): invented people, so the page shows
// how it looks with a few to choose from. Each gets an account nobody can sign in to (its password
// is random and thrown away) and a booking page saved the way a practitioner saves theirs.
// Remove them before launch; see apps/web/src/lib/site.ts.
//
// usage: set -a; . ~/.config/watson/supabase.env; set +a
//        node scripts/sample-practitioners.mjs add|remove
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";

const { createClient } = createRequire(new URL("../apps/web/package.json", import.meta.url))("@supabase/supabase-js");

const weekdays = (from, to) => Object.fromEntries(["1", "2", "3", "4", "5"].map((day) => [day, [from, to]]));
const SAMPLES = [
  {
    email: "meera.nair@watson.test", p_display_name: "Dr. Meera Nair", p_offer: "Ayurveda · digestion, sleep and stress",
    p_about: "Ayurvedic physician with twelve years in practice. In the first consultation we go through your history, diet and daily routine, and you leave with a plan you can start the same week.",
    p_languages: ["en", "de"], p_hours: { "1": ["09:00", "13:00"], "2": ["14:00", "18:00"], "4": ["09:00", "13:00"] },
    p_length_minutes: 60, p_gap_minutes: 15, p_fee_cents: 6500,
  },
  {
    email: "jana.kovacova@watson.test", p_display_name: "Jana Kováčová", p_offer: "Nutrition and gut health",
    p_about: "Nutritional therapist. I help with bloating, food intolerances and energy dips, food first. Send your recent blood tests before the call and we go through them together.",
    p_languages: ["sk", "en"], p_hours: weekdays("16:00", "20:00"), p_length_minutes: 45, p_gap_minutes: 15, p_fee_cents: 4000,
  },
  {
    email: "lukas.brandt@watson.test", p_display_name: "Dr. Lukas Brandt", p_offer: "Integrative medicine · long-term conditions",
    p_about: "General practitioner with training in integrative medicine, for people living with a long-term condition who want their treatment, lab results and daily habits looked at together.",
    p_languages: ["de", "en"], p_hours: { "2": ["08:00", "12:00"], "4": ["08:00", "12:00"], "5": ["08:00", "11:00"] },
    p_length_minutes: 30, p_gap_minutes: 15, p_fee_cents: 5500,
  },
  {
    email: "zuzana.hruskova@watson.test", p_display_name: "Zuzana Hrušková", p_offer: "Yoga therapy for back and neck pain",
    p_about: "Yoga therapist. One to one by video: we look at how you sit, stand and breathe, and build a short daily practice that fits your day.",
    p_languages: ["sk"], p_hours: { "1": ["07:00", "10:00"], "3": ["07:00", "10:00"], "6": ["08:00", "12:00"] },
    p_length_minutes: 45, p_gap_minutes: 15, p_fee_cents: 3000,
  },
  {
    email: "arjun.menon@watson.test", p_display_name: "Arjun Menon", p_offer: "Ayurveda · joint pain and low energy",
    p_about: "Ayurveda practitioner. The first conversation is free: half an hour to talk about what brings you here and whether Ayurveda can help.",
    p_languages: ["en"], p_hours: weekdays("18:00", "20:00"), p_length_minutes: 30, p_gap_minutes: 0, p_fee_cents: null,
  },
];

const { SUPABASE_URL: url, SUPABASE_PUBLISHABLE_KEY: publicKey, SUPABASE_SECRET_KEY: secretKey } = process.env;
if (!url || !publicKey || !secretKey) throw new Error("Load ~/.config/watson/supabase.env first.");
const NO_SESSION = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(url, secretKey, NO_SESSION);

const { data: listed, error: listError } = await admin.auth.admin.listUsers({ perPage: 1000 });
if (listError) throw listError;
const existing = new Map(listed.users.map((user) => [user.email, user.id]));

async function add({ email, ...page }) {
  const password = randomBytes(24).toString("base64url");
  let id = existing.get(email);
  const made = id
    ? await admin.auth.admin.updateUserById(id, { password })
    : await admin.auth.admin.createUser({ email, password, email_confirm: true });
  if (made.error) throw made.error;
  id = made.data.user.id;
  const role = await admin.rpc("register_practitioner", { p_user_id: id }); // since SEC-02, a role or nothing
  if (role.error) throw role.error;
  const client = createClient(url, publicKey, NO_SESSION);
  const signedIn = await client.auth.signInWithPassword({ email, password });
  if (signedIn.error) throw signedIn.error;
  const { data, error } = await client.rpc("save_booking_page", page);
  if (error || !data.ok) throw new Error(`${email}: ${error?.message ?? JSON.stringify(data)}`);
  await client.auth.signOut();
  return `${page.p_display_name}: /book/?p=${data.slug}`;
}

async function remove({ email, p_display_name: name }) {
  const id = existing.get(email);
  if (!id) return `${name}: not there`;
  const { error } = await admin.from("practitioner_profiles").delete().eq("practitioner_id", id);
  if (error) throw error;
  // A visitor may have booked a sample; then the account stays (bookings keep their practitioner), page gone.
  const deleted = await admin.auth.admin.deleteUser(id);
  return `${name}: removed${deleted.error ? " (account kept: it has bookings)" : ""}`;
}

const action = { add, remove }[process.argv[2]];
if (!action) throw new Error("usage: node scripts/sample-practitioners.mjs add|remove");
for (const sample of SAMPLES) console.log(await action(sample));
