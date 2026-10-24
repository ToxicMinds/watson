import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { test } from "node:test";
import { buildCatalogs, flatten } from "./standardize-messages.mjs";

const inventory = JSON.parse(readFileSync(new URL("../docs/localization/ui-copy.json", import.meta.url)));
const built = buildCatalogs(inventory);
const readCatalogs = () => Object.fromEntries(["en", "sk", "de"].map((locale) => [locale,
  JSON.parse(readFileSync(new URL(`../apps/web/messages/${locale}.json`, import.meta.url))),
]));

test("standard catalogs have matching semantic keys, strings only, and complete source coverage", () => {
  const flat = Object.fromEntries(Object.entries(built.catalogs).map(([locale, data]) => [locale, flatten(data)]));
  for (const locale of ["en", "sk", "de"]) {
    assert.deepEqual(Object.keys(flat[locale]), Object.keys(flat.en));
    for (const [key, text] of Object.entries(flat[locale])) {
      assert.match(key, /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/);
      assert.doesNotMatch(key, /_[a-f0-9]{8}|__/);
      assert.equal(typeof text, "string");
      assert.ok(text.trim(), `${locale}:${key}`);
      assert.doesNotMatch(text, /\{value\d+\}|%s/, `${locale}:${key}`);
    }
  }
  assert.deepEqual(Object.keys(built.mapping.sources).sort(), Object.keys(inventory.messages).sort());
  assert.equal(built.mapping.sources.lib_call__answer_0db52f40.status, "excluded");
  for (const [id, entry] of Object.entries(built.mapping.sources)) {
    for (const key of entry.targets) assert.ok(flat.en[key], `${id}: unknown target ${key}`);
    if (entry.status !== "excluded") assert.ok(entry.targets.length, `${id}: silently lost`);
  }
});

test("whole messages replace privacy fragments and distinguish title from protocol", () => {
  assert.equal(built.catalogs.sk.googleCalendar.privacy, "Watson vidí iba, <emphasis>kedy</emphasis> máte obsadený čas, nie obsah vašich udalostí.");
  assert.ok(!Object.keys(built.catalogs.sk.googleCalendar).includes("when"));
  assert.equal(built.catalogs.sk.formReview.answerLabel, "Vaša odpoveď");
  assert.ok(!built.catalogs.en.callSignaling);
});

test("catalog generation is deterministic, non-mutating, and rejects missing translations", () => {
  const original = JSON.stringify(inventory);
  assert.deepEqual(buildCatalogs(inventory), built);
  assert.equal(JSON.stringify(inventory), original);
  const invalid = structuredClone(inventory);
  invalid.messages.app_book_page__opening_the_times_2b3589dc.sk = "";
  assert.throws(() => buildCatalogs(invalid), /Missing sk/);
  // Once files exist, rerunning the CLI must not overwrite a translator's changes.
  const paths = ["apps/web/messages/en.json", "apps/web/messages/sk.json", "apps/web/messages/de.json", "docs/localization/catalog-map.json"];
  const previous = paths.map((path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8"));
  assert.throws(() => execFileSync(process.execPath, [fileURLToPath(new URL("./standardize-messages.mjs", import.meta.url))], { stdio: "pipe" }),
    (error) => /Refusing to overwrite/.test(String(error.stderr)));
  paths.forEach((path, index) => assert.equal(readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), previous[index]));
});

test("translator-owned locale files retain matching keys and source traceability", () => {
  const actualCatalogs = readCatalogs();
  const englishKeys = Object.keys(flatten(actualCatalogs.en)).sort();
  for (const locale of ["en", "sk", "de"]) {
    assert.deepEqual(Object.keys(flatten(actualCatalogs[locale])).sort(), englishKeys);
    for (const [key, text] of Object.entries(flatten(actualCatalogs[locale]))) {
      assert.match(key, /^[a-zA-Z][a-zA-Z0-9]*(\.[a-zA-Z][a-zA-Z0-9]*)+$/);
      assert.ok(typeof text === "string" && text.trim(), `${locale}:${key}`);
      assert.doesNotMatch(text, /\{value\d+\}|%s/);
    }
  }
  const mapping = JSON.parse(readFileSync(new URL("../docs/localization/catalog-map.json", import.meta.url)));
  assert.deepEqual(Object.keys(mapping.messages).sort(), englishKeys);
  assert.deepEqual(Object.keys(mapping.sources).sort(), Object.keys(inventory.messages).sort());
  for (const [key, message] of Object.entries(mapping.messages)) {
    assert.ok(message.sourceIds.length, key);
    for (const id of message.sourceIds) assert.ok(mapping.sources[id].targets.includes(key));
  }
  for (const [id, source] of Object.entries(mapping.sources)) {
    if (source.status !== "excluded") assert.ok(source.targets.length, id);
    for (const key of source.targets) assert.ok(mapping.messages[key].sourceIds.includes(id));
  }
});

// Use the real ICU parser/formatter, not a home-grown brace parser. See messages/README.md.
test("all ICU syntax, named arguments, selects and rich-text tags match across languages", { skip: !process.env.UI_COPY_ICU }, () => {
  const require = createRequire(`${process.env.UI_COPY_ICU}/package.json`);
  const { parse } = require("@formatjs/icu-messageformat-parser");
  const { IntlMessageFormat } = require("intl-messageformat");
  const signature = (nodes, found = new Set()) => {
    for (const node of nodes) {
      if ([1, 2, 3, 4, 5, 6].includes(node.type)) found.add(`argument:${node.value}:${node.type}`);
      if (node.type === 5) for (const option of Object.keys(node.options)) found.add(`select:${node.value}:${option}`);
      if (node.type === 8) { found.add(`tag:${node.value}`); signature(node.children, found); }
      if (node.options) for (const option of Object.values(node.options)) signature(option.value, found);
    }
    return [...found].sort();
  };
  const catalogs = readCatalogs();
  const mapping = JSON.parse(readFileSync(new URL("../docs/localization/catalog-map.json", import.meta.url)));
  const english = flatten(catalogs.en);
  for (const locale of ["en", "sk", "de"]) {
    for (const [key, text] of Object.entries(flatten(catalogs[locale]))) {
      assert.ok(text.trim(), `${locale}:${key}`);
      assert.doesNotMatch(text, /\{value\d+\}|%s/);
      const ast = parse(text);
      const expected = signature(parse(english[key]));
      assert.deepEqual(signature(ast), expected, `${locale}:${key}`);
      const argumentNames = [...new Set(expected.filter((value) => value.startsWith("argument:")).map((value) => value.split(":")[1]))].sort();
      assert.deepEqual(Object.keys(mapping.messages[key].arguments).sort(), argumentNames, `${key}: argument contract`);
      const samples = {};
      const selectors = [];
      const sample = (nodes) => {
        for (const node of nodes) {
          if (node.type === 1) samples[node.value] ??= "Example";
          if ([2, 3, 4, 6].includes(node.type)) samples[node.value] = node.type === 3 || node.type === 4 ? new Date("2026-10-20T09:30:00Z") : 2;
          if (node.type === 5) { samples[node.value] = "other"; selectors.push([node.value, Object.keys(node.options)]); }
          if (node.type === 8) { samples[node.value] = (chunks) => chunks.join(""); sample(node.children); }
          if (node.options) for (const option of Object.values(node.options)) sample(option.value);
        }
      };
      sample(ast);
      const message = new IntlMessageFormat(text, locale);
      assert.doesNotThrow(() => message.format(samples), `${locale}:${key}`);
      for (const [name, options] of selectors) for (const option of options) {
        assert.doesNotThrow(() => message.format({ ...samples, [name]: option }), `${locale}:${key}:${name}=${option}`);
      }
    }
  }
});

test("Slovak counts and optional text format correctly at boundaries", { skip: !process.env.UI_COPY_ICU }, () => {
  const require = createRequire(`${process.env.UI_COPY_ICU}/package.json`);
  const { IntlMessageFormat } = require("intl-messageformat");
  const catalogs = readCatalogs();
  const format = (key, args, locale = "sk") => new IntlMessageFormat(flatten(catalogs[locale])[key], locale).format(args);
  for (const [count, noun] of [[0, "odpovedí"], [1, "odpoveď"], [2, "odpovede"], [4, "odpovede"], [5, "odpovedí"], [21, "odpovedí"]]) {
    assert.equal(format("formReview.answersRemaining", { count }), `Na kontrolu: ${count} ${noun}`);
  }
  assert.match(format("transcript.turnCount", { count: 2 }), /2 repliky/);
  assert.match(format("transcript.overlapCount", { count: 5 }), /5 prekrytí/);
  assert.equal(format("documents.pageCount", { count: 2 }), "2 strany");
  assert.match(format("booking.noAvailableTimes", { weeks: 1 }), /najbližšom týždni/);
  assert.match(format("booking.noAvailableTimes", { weeks: 4 }), /najbližších 4 týždňoch/);
  assert.match(format("booking.noAvailableTimes", { weeks: 1 }, "de"), /nächsten Woche/);
  assert.equal(format("formPanel.approvedAt", { hasDate: "no", date: "" }), "Schválené.");
  assert.equal(format("patientJoin.receipt", { amount: "40,00 €", hasDate: "no", date: "" }), "40,00 €. Stripe vám pošle potvrdenie o platbe e-mailom.");
});
