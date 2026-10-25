import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync } from "node:fs";
import { extractCopy } from "./extract-ui-copy.mjs";

test("captures JSX, accessibility copy, validation and dynamic sentences", () => {
  const entries = extractCopy("fixture.tsx", `
    const schema = z.string().min(1, "Enter a name.");
    const label = "Patient";
    const machine = "queued";
    const view = <section className="wa-panel" aria-label="Consultation details">
      <h1>Patient&apos;s form</h1><p>{count} of {total} answered</p>
      <button>{busy ? "Saving…" : "Save"}</button>
      <p>{\`Approved \${date}.\`}</p>
    </section>;
  `);
  const texts = entries.map((entry) => entry.text);
  for (const text of ["Enter a name.", "Patient", "Consultation details", "Patient's form", "{value1} of {value2} answered", "Saving…", "Save", "Approved {value1}."]) {
    assert.ok(texts.includes(text), text);
  }
  assert.ok(!texts.includes("wa-panel"));
  assert.ok(!texts.includes("queued"));
  const dynamic = entries.find((entry) => entry.text.includes("answered"));
  assert.deepEqual(dynamic.placeholders, { value1: "count", value2: "total" });
});

test("ignores imports, type strings, comparisons, routes and existing non-English branches", () => {
  const entries = extractCopy("fixture.tsx", `
    import Link from "next/link";
    type Status = "Needs you";
    const x = status === "Done";
    const copy = { en: "Hello patient", sk: "Dobrý deň", de: "Guten Tag" };
    const view = <Link href="/form/" id="form-title">Open form</Link>;
  `);
  assert.deepEqual(entries.map((entry) => entry.text).sort(), ["Hello patient", "Open form"]);
});

test("keeps separate contexts and decodes JSX without corrupting literal strings", () => {
  const entries = extractCopy("fixture.tsx", `const a = "Rock &amp; roll"; const b = <><p>Rock &amp; roll</p><b>Save</b><i>Save</i></>;`);
  assert.equal(entries.filter((entry) => entry.text === "Save").length, 2);
  assert.ok(entries.some((entry) => entry.text === "Rock & roll"));
  assert.ok(entries.some((entry) => entry.text === "Rock &amp; roll"));
  assert.ok(entries.every((entry) => entry.line > 0));
});

test("keeps language labels and lower-case fragments but rejects machine literals", () => {
  const entries = extractCopy("fixture.tsx", `
    "use client";
    const labels = { en: "English", sk: "Slovak", de: "German" };
    const hash = crypto.digest("SHA-256");
    const url = \`\${site}/book/?p=\${slug}\`;
    const css = " wa-answer--rejected wa-answer--settled";
    const view = <p>{count === 1 ? "answer" : "answers"} {count === 1 ? "it" : "them"}</p>;
  `);
  assert.deepEqual(entries.map((entry) => entry.text).sort(), ["English", "German", "Slovak", "answer", "answers", "it", "them"]);
});

test("rejects invalid source rather than silently producing a partial inventory", () => {
  assert.throws(() => extractCopy("invalid.tsx", "const x = <p>Unclosed"), /Cannot parse/);
});

test("keeps copy around inline markup and nested conditional templates", () => {
  const entries = extractCopy("fixture.tsx", `const view = <p>Read <strong>carefully</strong> before continuing. {count > 1 && \`\${count} documents\`}</p>;`);
  for (const text of ["Read", "carefully", "before continuing. {value1}", "{value1} documents"]) {
    assert.ok(entries.some((entry) => entry.text === text), text);
  }
});

test("handoff has consistent source locations, string targets, and complete placeholder context", () => {
  const catalog = JSON.parse(readFileSync(new URL("../docs/localization/ui-copy.json", import.meta.url), "utf8"));
  assert.equal(catalog.messageCount, Object.keys(catalog.messages).length);
  assert.ok(catalog.messageCount > 600);
  const source = new Map(catalog.scannedFiles.map((file) => [file, readFileSync(new URL(`../${file}`, import.meta.url), "utf8").split("\n")]));
  for (const entry of Object.values(catalog.messages)) {
    assert.equal(typeof entry.en, "string");
    assert.equal(typeof entry.sk, "string");
    assert.equal(typeof entry.de, "string");
    assert.ok(entry.occurrences.length > 0);
    const tokens = [...entry.en.matchAll(/\{(value\d+)\}/g)].map((match) => match[1]).sort();
    for (const occurrence of entry.occurrences) {
      assert.ok(source.has(occurrence.file));
      assert.ok(occurrence.line > 0 && occurrence.line <= source.get(occurrence.file).length);
      assert.deepEqual(Object.keys(occurrence.placeholders).sort(), [...new Set(tokens)]);
    }
  }
  const texts = Object.values(catalog.messages).map((entry) => entry.en);
  for (const text of ["English", "Slovak", "German", "Consultation", "Consultations booked through Watson", "answer", "answers"]) assert.ok(texts.includes(text), text);
  for (const text of ["use client", "SHA-256", "wa-answer--rejected wa-answer--settled"]) assert.ok(!texts.includes(text), text);
});
