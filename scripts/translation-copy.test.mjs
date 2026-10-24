import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

const catalog = JSON.parse(readFileSync(new URL("../docs/localization/ui-copy.json", import.meta.url), "utf8"));
const tokens = (text) => [...text.matchAll(/\{value\d+\}|%s/g)].map(([token]) => token).sort();

test("reviewed Slovak wording clarifies dates, payment, account and scheduling", () => {
  const expected = {
    app_consultation_page__withdrawn_62c2a9c2: "Súhlas odvolaný dňa {value1}",
    app_consultation_page__recorded_96386967: "Súhlas zaznamenaný dňa {value1}",
    app_book_page__paid_now_02404d34: "{value1}, na úhradu teraz",
    components_booking_settings__each_day_needs_a_start_before_its_c1c8c5b7: "Čas začiatku musí byť každý deň skorší ako čas konca.",
    components_app_shell__signed_in_as_abc50e33: "Aktívny účet:",
    app_book_page__times_on_6fbf945d: "Dostupné termíny: {value1}",
    app_consultation_page__any_transcription_stops_and_both_audio_tracks_f4a36960: "Prepisovanie sa zastaví. Obe zvukové stopy aj prepis sa vymažú. Tento krok sa nedá vrátiť späť.",
  };
  for (const [key, text] of Object.entries(expected)) assert.equal(catalog.messages[key].sk, text, key);
  assert.equal(catalog.messages.app_book_page__times_on_6fbf945d.de, "Verfügbare Termine: {value1}");
});

test("review does not translate protocol values or collapse recording-state distinctions", () => {
  const protocol = catalog.messages.lib_call__answer_0db52f40;
  assert.equal(protocol.review, "not_ui");
  assert.equal(protocol.sk, "answer");
  assert.equal(protocol.de, "answer");
  assert.equal(catalog.messages.app_join_page__recorded_c7175fa7.sk, "Nahrávanie");
  assert.equal(catalog.messages.app_consultation_page__recorded_c7175fa7.sk, "Nahrané");
  assert.equal(catalog.messages.app_book_page__free_054a6bb9.sk, "Voľné termíny: {value1}");
});

test("every UI candidate has both draft translations, without changing placeholder tokens", () => {
  for (const [key, entry] of Object.entries(catalog.messages)) {
    if (entry.review === "not_ui") continue;
    for (const locale of ["sk", "de"]) {
      assert.ok(entry[locale]?.trim(), `${key}: missing ${locale}`);
      assert.deepEqual(tokens(entry[locale]), tokens(entry.en), `${key}: ${locale} placeholders`);
    }
  }
});

test("drafts are not marked approved and have review guidance", () => {
  for (const [key, entry] of Object.entries(catalog.messages)) {
    assert.ok(["needs_review", "not_ui"].includes(entry.review), `${key}: premature approval`);
    assert.ok(entry.notes.trim(), `${key}: missing review guidance`);
  }
});

test("brands and literal application URL paths survive translation", () => {
  for (const [key, entry] of Object.entries(catalog.messages)) {
    if (entry.review === "not_ui") continue;
    for (const locale of ["sk", "de"]) {
      for (const brand of ["Watson", "WhatsApp", "Stripe"]) {
        if (entry.en.includes(brand)) assert.ok(entry[locale].includes(brand), `${key}: ${locale} brand ${brand}`);
      }
      if (entry.en.includes("/consultation/?id=")) assert.ok(entry[locale].includes("/consultation/?id="));
    }
  }
});
