// One-time inventory -> standard catalog migration. Never overwrites translator work.
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { recipes } from "./message-catalog-recipes.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const locales = ["en", "sk", "de"];
const camel = (text) => text.toLowerCase().replace(/_([a-z0-9])/g, (_, char) => char.toUpperCase());
const scopes = {
  app_book_page: "booking", app_calendar_page: "calendar", app_consultation_page: "consultation",
  app_consultations_new_page: "newConsultation", app_consultations_page: "consultations", app_form_page: "formReview",
  app_j_page: "invitationRedirect", app_join_page: "patientJoin", app_layout: "metadata", app_room_page: "consultationRoom",
  app_sign_in_page: "signIn", components_app_shell: "navigation", components_booking_settings: "bookingSettings",
  components_copy_button: "clipboard", components_documents_panel: "documents", components_engine_status: "engine",
  components_find_practitioners: "practitionerSearch", components_form_panel: "formPanel", components_google_calendar: "googleCalendar",
  components_job_panel: "transcription", components_patient_documents: "patientDocuments", components_patient_panel: "patientPanel",
  components_patient_shell: "patientNavigation", components_status: "journey", components_transcript_view: "transcript",
  components_week_grid: "weekGrid", components_whatsapp_panel: "whatsappChat", lib_api: "errors", lib_audio: "audio",
  lib_booking: "bookingTime", lib_documents: "documentSize", lib_fee: "feeValidation", lib_google: "googleErrors",
  lib_session: "session", lib_status: "consultationStatus", lib_tracks: "audioUpload", lib_whatsapp: "whatsapp",
  supabase_functions_whatsapp_messages: "whatsappService", supabase_functions_payment_index: "checkout",
  supabase_functions_google_index: "googleCalendarService", supabase_functions_shared_google: "calendarEvent",
};

// English is used only to identify the original inventory record during this one-time migration.
// Emitted names are frozen by the source map, not generated dynamically at runtime.
const argumentNames = {
  "{value1} · Watson": ["pageTitle"], "Speaks {value1}": ["languages"], "{value1} min by video": ["minutes"],
  "Pay {value1} on Stripe's secure page.": ["amount"], "Times in your time zone ({value1})": ["timeZone"],
  "Times on {value1}": ["date"], "{value1}, paid now": ["amount"], "Book and pay {value1}": ["amount"],
  "Withdrawn {value1}": ["date"], "Recorded {value1}": ["date"], "· Fee {value1}": ["amount"],
  "at {value1}": ["time"], "on {value1}": ["date"], "{value1} of {value2} answered by Watson": ["answered", "total"],
  "Paid {value1}": ["amount"], "Add an answer: {value1}": ["fieldLabel"],
  "{value1} · a video call with your practitioner. The conversation is recorded.": ["date"],
  "Pay {value1}": ["amount"], "Recording {value1}": ["elapsed"], "Open {value1}": ["fileName"], "Remove {value1}": ["fileName"],
  "· last report {value1} s ago": ["seconds"], "Next free: {value1}": ["date"], "{value1} so far": ["elapsed"],
  "{value1} of {value2} answered": ["answered", "total"], "Filled in in {value1}": ["elapsed"],
  "· checked {value1}": ["date"], "Paid {value1} · {value2}": ["amount", "date"],
  "The patient pays {value1} when they open the link, then waits for you to start the call.": ["amount"],
  "{value1} to check": ["count"], "open, {value1} minutes": ["minutes"],
  "{value1}–{value2} · Google Calendar": ["startsAt", "endsAt"], "patients can book · {value1} min": ["minutes"],
  "{value1} KB": ["size"], "{value1} MB": ["size"],
  "Hello {value1}, see you today at {value2}. Join here when you are ready: {value3}": ["firstName", "time", "link"],
  "Thank you. I have passed {value1} on to your practitioner.": ["fileName"],
  "Hello {value1}, this is Watson. Your video consultation is today at {value2}. Join with the button below when you are ready.": ["firstName", "time"],
  "Hello {value1}, this is Watson. Your video consultation is today at {value2}. Join here when you are ready: {value3}": ["firstName", "time", "link"],
  "Watson: {value1}": ["patientName"], "Video consultation. Open it in Watson: {value1}/consultation/?id={value2}": ["siteUrl", "consultationId"],
};
const keyOverrides = {
  "app_book_page__watson_2ad184ea": "booking.pageTitle",
  "app_book_page__opening_the_times_2b3589dc": "booking.loading",
  "app_book_page__times_on_6fbf945d": "booking.availableOnDate",
  "app_book_page__paid_now_02404d34": "booking.amountDueNow",
  "app_consultation_page__recorded_96386967": "consultation.consentRecordedAt",
  "app_consultation_page__withdrawn_62c2a9c2": "consultation.consentWithdrawnAt",
  "app_consultation_page__recorded_c7175fa7": "consultation.audioRecorded",
  "app_consultation_page__withdraw_consent_5a1872c1": "consultation.withdrawConsent",
  "app_consultation_page__withdraw_consent_4f8dd620": "consultation.confirmWithdrawConsent",
  "app_form_page__not_discussed_bb657bb1": "formReview.notDiscussed",
  "app_layout__watson_ayurveda_and_integrative_care_by_video_bc0712c4": "metadata.defaultTitle",
  "app_layout__find_an_ayurveda_or_integrative_care_practitioner_00b921c9": "metadata.description",
  "app_layout__watson_4d7b2cc5": "metadata.applicationName",
  "components_documents_panel__read_by_watson_36ecf59e": "documents.readByWatson",
  "components_documents_panel__open_ed077f3d": "documents.open",
  "components_documents_panel__open_f5cc17a5": "documents.openFile",
  "components_documents_panel__remove_c3812fc4": "documents.remove",
  "components_documents_panel__remove_0ab4d0ce": "documents.removeFile",
  "components_patient_documents__remove_c3812fc4": "patientDocuments.remove",
  "components_patient_documents__remove_0ab4d0ce": "patientDocuments.removeFile",
  "components_week_grid__open_ed077f3d": "weekGrid.available",
  "lib_status__english_ba118bf7": "languages.english",
  "lib_status__german_a659b60d": "languages.german",
  "lib_status__slovak_e2922f67": "languages.slovak",
  "lib_status__mixed_or_unsure_6fbd6ccc": "languages.mixedOrUnsure",
  "supabase_functions_google_index__watson_4d7b2cc5": "googleCalendarService.name",
  "supabase_functions_shared_google__watson_bbd7a4f9": "calendarEvent.title",
  "supabase_functions_whatsapp_messages__hello_this_is_watson_your_video_consultation_5753679e": "whatsappService.approvedReminder",
  "supabase_functions_whatsapp_messages__hello_this_is_watson_your_video_consultation_873ea482": "whatsappService.linkedReminder",
};

export function flatten(object, prefix = "", result = {}) {
  for (const [key, value] of Object.entries(object)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "string") result[path] = value;
    else flatten(value, path, result);
  }
  return result;
}

export function buildCatalogs(inventory) {
  const catalogs = Object.fromEntries(locales.map((locale) => [locale, {}]));
  const mapping = {
    status: "Draft catalogs only. Native review and runtime integration are still required.",
    inventory: "docs/localization/ui-copy.json",
    sources: {}, messages: {},
  };
  const entries = Object.entries(inventory.messages);
  const lookup = new Map();
  for (const [id, entry] of entries) {
    if (entry.review !== "not_ui") for (const locale of locales) assert.ok(entry[locale]?.trim(), `Missing ${locale}: ${id}`);
    const scope = id.split("__")[0];
    const lookupKey = JSON.stringify([scope, entry.en]);
    assert.ok(!lookup.has(lookupKey), `Ambiguous source: ${lookupKey}`);
    lookup.set(lookupKey, id);
    mapping.sources[id] = { status: entry.review === "not_ui" ? "excluded" : "mapped", targets: [] };
    if (entry.review === "not_ui") mapping.sources[id].reason = entry.notes;
  }
  const emit = (key, messages, ids, args = {}, notes = "", bindings = []) => {
    assert.match(key, /^[a-z][a-zA-Z0-9]*\.[a-z][a-zA-Z0-9]*$/);
    assert.ok(!mapping.messages[key], `Catalog key collision: ${key}; choose an explicit semantic key`);
    const [namespace, name] = key.split(".");
    for (const locale of locales) {
      assert.ok(messages[locale]?.trim(), `Missing ${locale}: ${key}`);
      catalogs[locale][namespace] ??= {};
      catalogs[locale][namespace][name] = messages[locale];
    }
    mapping.messages[key] = { sourceIds: ids, review: "needs_review", arguments: args, bindings, notes };
    for (const id of ids) {
      assert.notEqual(mapping.sources[id].status, "excluded", `Recipe used excluded source ${id}`);
      mapping.sources[id].targets.push(key);
    }
  };
  for (const item of recipes) {
    const ids = item.sources.map((pair) => {
      const id = lookup.get(JSON.stringify(pair));
      assert.ok(id, `Missing recipe source: ${JSON.stringify(pair)}`);
      return id;
    });
    emit(item.key, item.messages, ids, item.arguments, item.notes);
  }
  for (const [id, entry] of entries) {
    if (mapping.sources[id].status === "excluded" || mapping.sources[id].targets.length) continue;
    const [scope, suffix] = id.split("__");
    assert.ok(scopes[scope], `Unknown scope ${scope}`);
    const slug = suffix.replace(/_[a-f0-9]{8}$/, "");
    // Stable server error categories are better keys than abbreviated English sentences.
    const category = entry.occurrences[0].kind.replace(/^property:/, "");
    const name = /^[A-Z][A-Z_]+$/.test(category) ? camel(category) : camel(slug);
    const key = keyOverrides[id] ?? `${scopes[scope]}.${name}`;
    const names = argumentNames[entry.en] ?? [];
    const tokens = [...new Set([...entry.en.matchAll(/\{value(\d+)\}/g)].map((match) => Number(match[1])))].sort((a, b) => a - b);
    assert.equal(tokens.length, names.length, `Missing argument plan: ${id}: ${entry.en}`);
    const renamed = {};
    for (const locale of locales) {
      renamed[locale] = entry[locale].replace(/\{value(\d+)\}/g, (_, number) => `{${names[Number(number) - 1]}}`);
      assert.ok(!/\{value\d+\}/.test(renamed[locale]), `Unconverted arguments: ${id}`);
    }
    const bindings = entry.occurrences.map((occurrence) => ({
      file: occurrence.file, line: occurrence.line,
      arguments: Object.fromEntries(tokens.map((number) => [names[number - 1], occurrence.placeholders[`value${number}`]])),
    }));
    const args = Object.fromEntries(names.map((name) => [name, "See bindings. Supply the original value; format visible dates/numbers for the selected locale."]));
    emit(key, renamed, [id], args, "Translation reused from the review inventory; consult its notes before approval.", bindings);
  }
  // Deterministic order makes key-set review and translator diffs straightforward.
  const sort = (object) => Object.fromEntries(Object.entries(object).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, value]) => [key, typeof value === "object" && value !== null && !Array.isArray(value) ? sort(value) : value]));
  for (const locale of locales) catalogs[locale] = sort(catalogs[locale]);
  return { catalogs, mapping };
}

function main() {
  const inventory = JSON.parse(readFileSync(resolve(root, "docs/localization/ui-copy.json"), "utf8"));
  const { catalogs, mapping } = buildCatalogs(inventory);
  const outputs = [...locales.map((locale) => [resolve(root, `apps/web/messages/${locale}.json`), catalogs[locale]]), [resolve(root, "docs/localization/catalog-map.json"), mapping]];
  for (const [path] of outputs) assert.ok(!existsSync(path), `Refusing to overwrite ${path}. Catalogs are now translator-owned; see messages/README.md.`);
  for (const [path, data] of outputs) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, `${JSON.stringify(data, null, 2)}\n`, { flag: "wx" });
  }
  console.log(`Created ${locales.length} locale catalogs with ${Object.keys(flatten(catalogs.en)).length} messages; mapped ${Object.keys(mapping.sources).length} inventory entries.`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
