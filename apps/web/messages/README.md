# Standard translation catalogs

- [`en.json`](en.json): canonical English messages.
- [`sk.json`](sk.json): Slovak drafts.
- [`de.json`](de.json): German drafts.

Each file contains the same **625 namespaced message keys**, with string values only. These are standard nested JSON / ICU MessageFormat catalogs compatible with next-intl. No translation library, language switcher, routes, or application call sites have been added or changed.

**Format-ready does not mean release-approved.** Native-speaker, legal/clinical where appropriate, accessibility and rendered-screen review are still required. The original 667-entry inventory remains unchanged at [`docs/localization/ui-copy.json`](../../../docs/localization/ui-copy.json). Fragments were consolidated, a mixed-context price/name entry was split, and the non-UI WebRTC `answer` value was excluded. These transformations explain the lower key count.

## Editing translations

Edit these locale files directly from now on. Keep the same keys across all languages. Use stable semantic keys such as `booking.loading`, `formReview.answersRemaining`, and `googleCalendar.privacy`; do not use source-line numbers, English text, or content hashes as runtime IDs. Keys are now fixed identifiers: changing English wording does not require changing its key.

Preserve named arguments (`{count}`, `{firstName}`, `{amount}`), ICU syntax and rich-text tags. Values are not source-code expressions. Never insert patient data into the catalog or translate names, URLs, tokens, RPC names or database enums.

Example message in the catalogs:

```json
{
  "formReview": {
    "answersRemaining": "{count, plural, one {Na kontrolu: # odpoveď} few {Na kontrolu: # odpovede} other {Na kontrolu: # odpovedí}}"
  }
}
```

Pass the raw numeric count—not an English word or a preformatted string. These plural messages cover **integer counts**, the domain used by the application. If a future feature accepts fractions, add and test the appropriate fractional forms before reusing them.

Use selects for semantic states (`payment: free/paid/unpaid`, `role: patient/practitioner`, `hasDate: yes/no`), rather than passing English sentence fragments. All selects include `other` fallbacks. For optional arguments, supply empty strings when absent and set the matching presence selector explicitly.

Rich-text messages use tags such as `<emphasis>`, `<appointment>`, `<document>` and `<fields>`. At integration time use `t.rich` with safe component callbacks, not translated HTML or `dangerouslySetInnerHTML`. Decorative icons remain outside messages. Preserve existing links, buttons, focus behavior and accessibility labels.

## Source context and review metadata

[`docs/localization/catalog-map.json`](../../../docs/localization/catalog-map.json) keeps metadata **out of runtime messages**:

- `sources`: every inventory ID, its new catalog target(s), or an explicit exclusion reason.
- `messages`: source IDs, `needs_review` status, named argument contracts, source bindings and integration notes.

Follow source IDs back to the original inventory for file locations and translator notes. The mapping intentionally supports many-to-one (merged sentences) and one-to-many (separated contexts) relationships. Update review status in this sidecar after actual review, not in locale JSON.

Known reconstructed messages include the Google Calendar privacy promise, week summary, consultation work summary, form provenance, remaining answers, late documents, page/turn/overlap counts, role-specific audio failures, optional approval/payment dates, and complete WhatsApp invitation/welcome messages. The English catalog normalizes these messages without changing the original source inventory or application code.

The Meta-approved reminder wording is reused, with parameter names normalized. Verify the actual live Meta template before channel deployment; this file conversion is not approval to change it. Review provider-role terminology and all consent/privacy/payment claims against the inventory notes.

## Future integration contracts

- Keep interface locale independent of consultation/transcription language.
- Format visible dates, times, numbers, amounts and time-zone names for the selected locale before supplying string arguments. Monetary `amount` arguments are formatted strings; count/plural arguments are numbers.
- Keep intended appointment time zones unchanged. A locale change is not a time-zone change.
- Do not use `dateTime(...).split(",")[0]`; use a proper date-only formatter.
- Slovak WhatsApp `day` comes from the existing locale-aware `dayAndTime`; it already includes a weekday preposition such as `v utorok`. Do not add another preposition.
- For `metadata.titleTemplate`, supply a localized `pageTitle`. If generating Next.js's `%s` metadata template, pass the literal `%s` as the argument when building that template.
- The application is a static export. Choose a client-only locale provider or planned pre-rendered locale routes before wiring these files into the UI; middleware-dependent negotiation will not run on the static host.
- Use English fallback deliberately and report missing keys. Do not silently treat a draft as approved.

## Validation

Structural checks need only Node:

```sh
node --test scripts/message-catalogs.test.mjs
```

Without `UI_COPY_ICU`, two ICU-specific tests are explicitly skipped. To run **all six tests**, install the real parser/formatter in an isolated temporary directory (no application dependency changes):

```sh
TOOLS="$(mktemp -d)"
npm install --prefix "$TOOLS" --ignore-scripts --no-audit --no-fund --package-lock=false intl-messageformat@10.7.18 @formatjs/icu-messageformat-parser@2.11.4
UI_COPY_ICU="$TOOLS/node_modules" node --test scripts/message-catalogs.test.mjs
```

Full checks parse every message, compare argument types/select branches/rich-text tags across locales, validate source coverage and test Slovak count boundaries and optional text. They do not prove linguistic accuracy.

## Migration safety

`scripts/standardize-messages.mjs` and `scripts/message-catalog-recipes.mjs` record the initial migration. The migration **refuses to overwrite existing catalogs or the mapping**, protecting translator edits. Do not delete translated files merely to rerun it. After migration these locale files are the editing surface; the original inventory is historical context, not a synchronization master.

For new messages, add a semantic key in all three files and extend the mapping/review record. No runtime rollout is included in this task.
