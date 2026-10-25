# Slovak and German translation handoff

## Start here

For ongoing translation work, use **[the standard locale catalogs](../../apps/web/messages/README.md)**: separate `en.json`, `sk.json` and `de.json` files, each with 625 namespaced messages. They include named arguments and whole-message ICU plurals/selects. Source context and draft approval status live separately in **[catalog-map.json](catalog-map.json)**. Application integration has not been performed.

The original **[ui-copy.json](ui-copy.json)** remains a preserved review inventory, not the editing master for the new catalogs. Each inventory message contains:

- `en`: English source. Do not edit during translation.
- `sk` and `de`: Slovak and German translation drafts, ready for native-speaker review.
- `occurrences`: source file, line, column, extraction kind, and dynamic value expressions.
- `review`: initially `needs_review`; use `translated` after translation and `approved` after contextual/native-speaker review.
- `notes`: translator questions, terminology decisions, or developer instructions.

## Draft translation status

The catalog now contains **666 bilingual UI/message drafts** and **one `not_ui` entry**, out of 667 inventory entries. The excluded entry is `lib_call__answer_0db52f40`: a WebRTC signaling value, not a displayed answer label. Its targets deliberately retain `answer` unchanged. Actual answer labels elsewhere are translated.

All drafts remain **`needs_review`**, not `approved`. No native-speaker, legal, clinical, or rendered-screen approval has been performed. Entry notes identify count-sensitive wording, composed sentences, sensitive claims, and context-dependent placeholders. Do not bulk-import this inventory as a production-ready runtime catalog.

Draft terminology and style:

- Formal address: Slovak *vykanie*, German **Sie**. Buttons use short action labels; prose uses polite instructions.
- **practitioner** → **odborník / Fachperson**. This deliberately does not imply medical licensure. Confirm with the product owner whether the actual role is physician, therapist, or another care professional. Explicit source **doctor** remains **lekár / Arzt or Ärztin**.
- **consultation** → **konzultácia / Konsultation**; bookable **time** → **termín / Termin**.
- **free** (price) → **bezplatne / kostenlos**; **free/open** (availability) → **voľné / verfügbar**. The calendar's standalone `Open` is an availability label; document/navigation `Open` is an action.
- **fee** → **poplatok / Honorar**; **transcript** → **prepis / Transkript**; **approve** → **schváliť / freigeben**; accepting an answer is **prijať / übernehmen**, not final form approval.
- **engine** describes the processing service, not a literal motor. Drafts use processing/service wording; hardware references remain hardware references.
- Watson, WhatsApp, Stripe, URLs, patient data and placeholder tokens remain unchanged. Google Calendar is localized as **Kalendár Google / Google Kalender**. Decimal/currency examples are localized without changing their value.

Review blockers before release:

1. The standard catalogs now consolidate the identified split sentences and number-dependent fragments into whole ICU messages. Application integration must pass numeric counts and semantic states rather than reusing the old English concatenation. Translating inventory `answer`/`answers` independently cannot supply all Slovak cases or German agreement; review the new assembled messages in context.
2. Localize values inside placeholders too: dates, language labels, conditional labels and speaker names. Keep underlying machine enums unchanged. Optional text may need spaces or grammatical restructuring that cannot be solved by changing this inventory alone.
3. Review consent, privacy, payment and deletion statements against actual behavior. Translation does not establish legal compliance or validate the English claims.
4. Confirm provider-role terminology and German audience/region; review all translations with native Slovak/German speakers in context.
5. Compare WhatsApp drafts with existing localized source. The Meta `watson_today` reminder and the plain-text linked reminder reuse existing source wording with normalized placeholder tokens. Live Meta approval was not checked; preserve exact approved wording for that channel.

The English validation message “Keep the notes under 500 characters” conflicts with `z.max(500)`, which permits exactly 500. The English source remains unchanged; this needs a separate source-copy decision. Similarly, “the 1st” is interpreted as the next monthly allowance reset and is flagged for confirmation.

### Follow-up wording review

Applied catalog-only refinements to seven entries: explicit consent dates, payment due now, scheduling validation, a gender-neutral active-account label, date-based appointment headings, and clearer deletion wording. The appointment heading uses a label-and-date structure in both languages rather than a preposition that may not fit the formatted date. English sources, keys, placeholders, source locations and review status remain unchanged.

The inventory preserves its old composed fragments. The standard catalogs now contain reconstructed whole-message plurals and rich-text messages; runtime integration and review remain release blockers. In particular, `googleCalendar.privacy` includes the formerly separate `when` / `kedy` / `wann` fragment and preserves “your events” rather than referring to Watson's own events.

Before integrating the date heading, replace `dateTime(...).split(",")[0]` with a locale-aware date-only formatter. Splitting on a comma can truncate a localized date after its weekday. No runtime formatting changes were made in this wording pass.

Protocol `answer`, active versus completed recording labels, and the count-safe `Voľné termíny: {value1}` remain intentionally unchanged. Do not replace the latter with `{value1} voľných` without plural handling. These refinements do not constitute native-speaker or release approval.

Translation integrity checks (no workspace dependency installation required):

```sh
node --test scripts/translation-copy.test.mjs
```

These checks verify target completeness, preserved placeholders/brands/URL paths, and the current draft-review status. They do **not** measure linguistic accuracy. Update the draft-status assertion as part of an explicit human approval process, not to bypass review.

Keys are deterministic, file-scoped inventory IDs. Same wording in different files stays separate because its meaning may differ. Repeated wording within a file shares an entry, with all locations listed. IDs survive line changes, but changing English or moving files creates a new ID. Freeze/rename them to intentional semantic keys during runtime integration; these are not a claim of permanent semantic identity.

Translate only `sk` and `de`, preserving `{value1}`, `{value2}`, etc. exactly. The corresponding expression under `occurrences.placeholders` explains each value; never translate the expression itself. Values may include dates, counts, names, or other translated copy. Do not translate `Watson`, URLs, identifiers, file extensions, or patient names. Brand and third-party product names appear for completeness; usually retain them.

This is a **source inventory, not runtime localization**. No application copy, dependencies, routes, or language behavior has been changed. No patient data was accessed.

## Coverage and review limits

The `scannedFiles` list in JSON is the precise scan scope: production web TypeScript/TSX (excluding tests and generated database types), English WhatsApp service messages, and product/event presentation fields in Stripe/Google service code. Includes headings, navigation, buttons, labels, hints, validation, error/status messages, loading/empty states, accessibility attributes, document metadata, and composed JSX/template messages.

Static extraction is deliberately conservative and is **not proof that every rendered string is captured**. Every entry starts as a review candidate. Check source context before translating technical-looking entries. Existing Slovak/German WhatsApp branches are excluded from this English inventory; they remain in source and should be reviewed/reused rather than overwritten.

Important developer review points:

1. **Fragments and composition:** inline elements, conditional expressions, and nested templates can split sentences into several entries. A placeholder can itself contain English branches. Translate the branch entries too, but merge the complete sentence into one runtime message before integration. Some code-only strings may appear as candidates; mark them `not_ui` instead of translating them.
2. **Pluralization:** existing `answer`/`answers`, `document`/`documents`, and `it`/`them` branches need complete ICU plural/select messages, not word substitution. Slovak has `one`, `few`, `many` (fractional), and `other` cardinal categories; German has `one` and `other`. Use locale rules rather than custom English count checks.
3. **Database-authored content:** `forms.template` titles, section titles and field labels come from practitioner definitions in `supabase/migrations/20261014120000_forms.sql`; web rendering is in `apps/web/src/app/form/page.tsx`. They cannot be exhaustively inventoried from repository source. The repository's example definition is `packages/test-fixtures/templates/ayurveda-intake.json`; it is test data, not evidence of deployed templates, and is excluded. Establish whether templates are clinical records in their original language or localizable product templates, then export approved definitions separately with stable template/field IDs. Do not modify historical form snapshots as part of UI translation.
4. **User/clinical content:** practitioner profiles, offers, names, notes, filenames, WhatsApp chat history, transcripts, model answers and quoted documents are dynamic content, not UI messages. Do not silently translate or send them to a translation platform. Any clinical translation requires a separate, reviewed workflow preserving the original and provenance.
5. **Third-party/browser UI:** Google OAuth, Stripe Checkout, browser media permissions, native date controls and browser validation are not fully controlled by this repository. Configure provider locales and test browser language behavior separately.
6. **Generated formatting:** weekday/month/time-zone names come from `Intl`; translate them through locale-aware formatting, not this dictionary. Audit `en-GB` in `lib/status.ts`, `lib/booking.ts`, consultation list/calendar pages, and `lib/fee.ts`'s hand-built euro formatting. Preserve machine-oriented ISO formatting (`sv-SE`) used for date keys; not every fixed locale is visible copy.
7. **Other channels:** WhatsApp is included as adjacent patient-visible copy, not just web UI. `_shared/wording.ts` already formats `en-GB`, `sk-SK`, and `de-DE`. Meta-approved reminder wording in `supabase/functions/whatsapp/messages.ts` must remain aligned with approved templates. Provider emails and deployed database content need separate review.

After source review, walk every patient and practitioner screen in each locale, including errors, empty states, loading, permissions, payment and accessibility labels. This handoff has not been browser-verified.

## Recommended industry approach

Use **next-intl**, namespaced JSON messages, ICU MessageFormat, and semantic keys such as `consultation.create.submit` and `errors.audioTooLarge`. It fits the existing Next.js App Router/React application. Keep English as canonical source, use English fallback for missing translations, and never display the empty draft targets directly. Keep UI locale independent from consultation/transcription language: changing interface language must not change clinical processing language.

The app uses `output: "export"` in `apps/web/next.config.ts`. Do not add middleware-dependent locale negotiation. For localized public/SEO pages, pre-render `/en/`, `/sk/`, and `/de/` routes with locale parameters generated at build time; localized routing needs static rendering and locale prefixes. This changes existing patient invitation/book/join URLs, so plan compatibility before implementing. A client-side locale provider and persisted language selector can localize existing URLs without a routing migration, but public metadata then remains build-time English unless separately localized. Decide that tradeoff first.

Implementation checklist:

1. Review inventory; combine fragments and select meaningful semantic keys. Create `en.json`, `sk.json`, `de.json` runtime catalogs containing just key-to-message data, not source metadata.
   **Catalog preparation is complete** in `apps/web/messages/`; review those files and their source map rather than importing the old inventory directly.
2. Adopt full-sentence ICU messages with named placeholders (`{patientName}`, `{count}`) and rich-text tags for inline links/emphasis. Do not concatenate translated sentence fragments or inject translated HTML.
3. Add locale selection/persistence, set document `lang`, and localize title/description/Open Graph metadata. Format numbers, currency and visible dates using the chosen locale and intended time zone.
4. Map stable server error codes to localized messages in the client. Keep database enums, RPC names and machine state values unchanged. Move schema validation messages into the same localization flow.
5. Use a shared terminology glossary and choose formal/informal address consistently. Have native Slovak/German speakers review consent, privacy, payments and medical wording. A translation management system (e.g. Weblate, Crowdin or Lokalise) can manage approvals and JSON round trips; upload product copy only, not clinical data.
6. CI should check matching key sets, nonempty approved translations, ICU syntax and matching placeholders. Add locale smoke tests, plural tests (0/1/2/5 and relevant fractions), and checks for hard-coded new copy.
7. Test longer German labels, Slovak diacritics, screen-reader output, small screens, date/currency conventions, and English fallback. Keep URLs, tokens, query strings and patient join links working.

References: [next-intl messages and ICU](https://next-intl.dev/docs/usage/translations), [static export constraints](https://next-intl.dev/docs/routing/middleware#usage-without-proxy--middleware-static-export), [Unicode plural rules](https://cldr.unicode.org/index/cldr-spec/plural-rules).

## Regeneration

With workspace dependencies installed (the extractor uses the existing web `typescript` dependency):

```sh
node --test scripts/extract-ui-copy.test.mjs
node scripts/extract-ui-copy.mjs
```

Run from repository root. No Next.js build or database is needed. For an isolated TypeScript 5 installation, set `UI_COPY_TYPESCRIPT` to its absolute package directory. Regeneration preserves `sk`, `de`, `notes`, and `review` for matching IDs; missing old IDs are retained with `obsolete_check_before_removing`. Review moves/edits manually so translations are not lost. Do not regenerate concurrently with translator edits.
