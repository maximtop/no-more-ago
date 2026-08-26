# Implementation Plan: [no-more-ago] Configure a custom date format

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/9-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Add configurable exact-date formatting with date-fns, honor browser locale and selected time zone, keep the interface English and product-oriented, preserve simple adapter-independent architecture, and delegate implementation without Corepack, Git, browser automation, network access, external-utility testing, or source-text assertions.

## Summary

Extend the validated presentation pipeline with exactly two date-format modes: existing localized `System`, and user-configurable `Custom format`. Represent them as strict discriminated display settings inside unpublished settings schema V4. Validate bounded Unicode-token patterns before loading or persisting them; reject empty, malformed, unmatched-quote, legacy `YY`/`YYYY`/`D`/`DD`, and literal-only values without allowing formatter exceptions to alter pages. Keep pattern edits and a live localized preview local to Options until explicit `Save` succeeds.

Use installed date-fns v4 `format` and `@date-fns/tz` `tz` context for custom System/UTC/IANA output, preserving the existing Intl-backed system-format branch. Resolve the nearest explicitly bundled browser locale through a small static locale map, script/region-aware BCP 47 normalization, and deterministic `en-US` fallback. Reuse the existing sole background writer, revisioned content hydration, exact-host frame-zero fanout, strict acknowledgements, disabled-policy behavior, original-source restoration, and current six-browser-artifact build pipeline. Do not add another format mode, advertise the library, bundle every date-fns locale, promise arbitrary OS-defined date patterns, or implement future recovery, diagnostics, reporting, or reset work.

## Technical Context

- **Language/Version**: TypeScript 6.0.3/TSX, ECMAScript 2022, React 19.2.8, Node `>=24 <25`, direct pnpm 10.34.5.
- **Primary Dependencies**: Installed date-fns 4.4.0, `@date-fns/tz` 1.5.0, browser `Intl.Locale`/`Intl.DateTimeFormat`, Mantine 9.5.2, Rspack 2.1.10; no new dependency.
- **Storage**: Existing sole `chrome.storage.local["settings"]` document, advanced from unpublished strict V3 to strict V4; no sync, second document, migration, browsing history, or diagnostics.
- **Testing**: Vitest 4.1.11, jsdom, React `act`, fake WebExtension transports, actual connected two-document integration, generated extension bundles/ZIPs, and selected-target watch behavior.
- **Target Platform**: Manifest V3 Chrome, Firefox, and Edge, each with distinct development/release artifacts; extension-local Options and exact-host `github.com` content runtime.

## Research

### Existing validated seams and strict unpublished schema

Issue `8-AFK` is `Validated` and independently passed 427 behavioral tests. `src/settings/snapshot.ts` currently accepts only `{ formatMode: "system", timeZone }` in a strict five-field V3 document. `SettingsService.setDisplaySettings()` is already the only serialized presentation writer, but `sameDisplay()` compares only zones and must also compare format mode and custom pattern. `BackgroundApplication` already preserves global/site policy, accepts display intents, refreshes matching top-frame tabs, requires exact committed-revision acknowledgements, and exposes historically unavailable IANA zones. Existing content generations hydrate once per activation and reformat only proven owned elements. `OptionsApp` already maintains an explicit-save time-zone draft alongside `Sites`.

Advance the unpublished document to exactly five top-level V4 fields while extending, not replacing, those established seams:

```ts
type DisplaySettings =
  | { readonly formatMode: "system"; readonly timeZone: TimeZoneSelection }
  | {
      readonly formatMode: "custom";
      readonly pattern: string;
      readonly timeZone: TimeZoneSelection;
    };

interface SettingsSnapshotV4 {
  readonly schemaVersion: 4;
  readonly revision: number;
  readonly globalEnabled: boolean;
  readonly sitePreferences: Readonly<Record<string, boolean>>;
  readonly display: DisplaySettings;
}
```

System has exactly two display keys and never retains a pattern; custom has exactly three, with a fully valid nonempty pattern. Preserve frozen copies, safe revisions, canonical exact own-hostname preferences, System/UTC/IANA structural rules, and historically unavailable but structurally safe saved zones. Replace old exported V3 types/guards and maintained fixture seeds with V4; explicitly reject old unpublished V1/V2/V3 and unknown future schema documents without migration, silent reset, compatibility aliases, backup, or account synchronization.

### Safe Unicode patterns and localized data without an all-locales bundle

The installed date-fns `format` accepts Unicode patterns such as `yyyy-MM-dd HH:mm`, `EEEE, d MMMM yyyy`, and `yyyy-MM-dd HH:mm XXX`; quoted literals and doubled apostrophes are valid. However, an empty pattern can throw `TypeError`, unmatched quotes are silently accepted, whitespace-only patterns return whitespace, protected `YY`/`YYYY` and `D`/`DD` warn before throwing, and 500 repeated year tokens create a 500-character output. Consequently, use one shared deterministic `validateCustomFormatPattern()` at the snapshot, background writer, and Options boundaries. Limit patterns to 256 UTF-16 code units, reject empty/whitespace-only/control-containing values, perform a linear quote-aware scan that understands `''`, reject unmatched quotes and protected legacy runs only outside quoted literals, require at least one actual unquoted formatting token, and finally safely dry-run `format` with a fixed valid instant and the explicitly imported `en-US` locale. Reject caught errors and empty/whitespace output with typed, actionable reasons; do not enable deprecated token flags, interpolate user input into dynamic regular expressions, or call the library on protected tokens before prevalidation.

Use a small explicit synchronous locale registry with direct subpath imports for `en-US`, `en-GB`, `de`, `fr`, `es`, `it`, `pt`, `pt-BR`, `ru`, `ja`, `zh-CN`, and `zh-TW`. Normalize each current preferred tag through `Intl.Locale`, remove Unicode extensions via `baseName`, prefer exact language-region matches, then appropriate script (`zh-Hant-*` -> `zh-TW`, `zh-Hans-*` -> `zh-CN`) and language fallbacks (`de-AT` -> `de`, `pt-BR` -> `pt-BR`); skip malformed/unknown tags and ultimately return `en-US`. Preserve preferred-language order. Do not import the aggregate `date-fns/locale`, use a wildcard/dynamic locale context, make a locale network request, emit independently loaded content chunks, or promise that unbundled languages are translated. Resolve locales only on actual rendering/preview events and keep existing runtime idleness.

### One zone conversion, safe fallback, and existing transaction semantics

Existing `formatDateWithPresentation()` continues using date-fns `intlFormat` unchanged for System mode, retaining medium date/short time, browser regional/hour-cycle preferences, and Issue 8 fallback. For custom mode, call `format(instant, pattern, { locale })` for System zone, or `format(instant, pattern, { locale, in: tz(identifier) })` for UTC/IANA. The installed public APIs were verified locally: New York instants surrounding DST render `01:59 -05:00` and `03:01 -04:00`, while UTC renders `06:59 Z` and `07:01 Z`. Apply the zone through `tz(...)` exactly once; do not preconvert with `TZDate` and then apply another context or Intl zone. If a historically saved IANA zone becomes unavailable, retain the selected custom pattern, format in the live system zone, report `unavailable-time-zone`, and preserve the Options correction message without rewriting settings.

Convert any unexpected custom formatter failure into a typed `invalid-format` result with no displayable output; the generic candidate pipeline must leave or restore its original GitHub host and continue safely, never render guessed/blank output or append its relative phrase. Existing `set-display-settings`, revision, response shapes, content-generation hydration, exact frame-zero acknowledgements, all-active-tab fanout, concurrent global/site writes, stopped-tab partial failure, and save-while-disabled/re-enable behavior remain the transport and activation contracts. Return typed `invalid-format` through the existing background response guard with exactly one callback; semantic invalid patterns in valid envelopes must not be dropped as transport failures or trigger storage reads/writes, tab work, or revision changes.

### Product-facing draft, preview, and scope

Replace fixed `Date format: System` with an accessible English `Date format` choice containing exactly `System` and `Custom format`. Only custom mode reveals a labeled `Format pattern` field, concise examples such as `yyyy-MM-dd HH:mm` and `EEEE, d MMMM yyyy`, field-local actionable validation, and a `Preview` computed from one stable in-memory example instant, current browser locales, draft pattern, and draft time zone. Recompute on actual user edits without timers, persistence, content messages, or background requests. Initialize a new custom draft to a valid example; keep the saved format active until explicit successful `Save`. A valid save submits one complete display value through the existing client; failures preserve saved output, known committed partial refreshes remain truthful, and switching back to System removes the persisted pattern. Retain existing IANA validation, correction notices, Sites/global behavior, locale privacy, popup, no page UI, and all prior CSP/artifact contracts. Never show `date-fns`, a combined exact-plus-relative choice, or an arbitrary-OS-pattern promise in rendered UI.

No project-local `AGENTS.md`, `DEVELOPMENT.md`, or `README.md` exists; supplied workspace rules and approved predecessor contracts apply.

## Entities

### Settings Snapshot V4 and Display Settings

- **Fields**: Exact `schemaVersion: 4`, safe nonnegative `revision`, `globalEnabled`, exact-own-host `sitePreferences`, and discriminated `display`; `system` has only `formatMode`/`timeZone`, while `custom` additionally has one validated `pattern`.
- **Relationships**: Sole background-owned document shared by policy, Options, content hydration, and current revisioned updates.
- **Validation**: Exact keys, deep-frozen copies, existing safe timezone/hostname rules, a bounded fully validated custom pattern, runtime-independent acceptance of historical IANA identifiers, and rejection of all old unpublished schemas.
- **States**: Missing/default System; committed System or valid Custom; invalid proposed/stored snapshot fails closed; unchanged equal mode/pattern/zone performs no write.

### Custom Pattern and Locale Resolution

- **Fields**: UTF-16-bounded Unicode pattern, typed validation error, preferred BCP 47 tags, selected explicitly bundled date-fns locale, and deterministic `en-US` fallback.
- **Relationships**: Shared validator guards stored drafts; locale resolver feeds both content presentation and Options preview without persisting browser language.
- **Validation**: Balanced quoted literals/doubled apostrophes, real date token, rejected unquoted protected legacy tokens, safe caught formatter errors, exact/script/region/language nearest match, no aggregate locale loading.
- **States**: Local valid/invalid draft; valid preview; accepted custom pattern; missing/malformed/unbundled locale safely falls back.

### Presentation Result and Options Draft

- **Fields**: Source instant; system/custom mode; optional pattern; System/UTC/IANA selection; resulting exact text; optional `unavailable-time-zone` or `invalid-format`; local stable preview instant and inline error.
- **Relationships**: Existing controller consumes only successful text; Options builds a local complete draft and submits only the existing `set-display-settings` intent.
- **Validation**: Exactly one zone conversion, DST-correct civil time, no blank/guessed output or appended relative text, no saved-page mutation before commit, and preserved last good snapshot after failures.
- **States**: Saved System; unsaved custom edit/preview; blocked invalid draft; committed custom refreshed across active tabs; corrected System after explicit save.

## Contracts

No HTTP, remote API, extra browser permission, second runtime message, or issue-local contract file is needed. Extend existing TypeScript/WebExtension contracts only:

```ts
type DisplaySettings =
  | { readonly formatMode: "system"; readonly timeZone: TimeZoneSelection }
  | {
      readonly formatMode: "custom";
      readonly pattern: string;
      readonly timeZone: TimeZoneSelection;
    };

interface SettingsSnapshotV4 {
  readonly schemaVersion: 4;
  readonly revision: number;
  readonly globalEnabled: boolean;
  readonly sitePreferences: Readonly<Record<string, boolean>>;
  readonly display: DisplaySettings;
}

type CustomPatternValidation =
  | { readonly ok: true; readonly pattern: string }
  | {
      readonly ok: false;
      readonly error:
        | "empty"
        | "too-long"
        | "control-character"
        | "unclosed-quote"
        | "missing-date-token"
        | "legacy-token"
        | "invalid-token"
        | "empty-output";
    };

interface DatePresentationResult {
  readonly text: string;
  readonly error?: "unavailable-time-zone" | "invalid-format";
}

type SetDisplaySettingsResponse =
  | {
      readonly ok: true;
      readonly acceptedRevision: number;
      readonly state: DisplayState;
      readonly refreshFailures: readonly DisplayRefreshFailure[];
    }
  | {
      readonly ok: false;
      readonly error:
        | "invalid-format"
        | "invalid-time-zone"
        | "invalid-display-settings"
        | "save-failed"
        | "settings-unavailable";
      readonly state: DisplayState;
    };
```

The existing save envelope remains structural-only, while `SettingsService` checks custom-pattern semantics and returns one authoritative `invalid-format` without touching storage or tabs. A strict V4 document parser also rejects invalid stored custom patterns; valid structurally safe historical IANA zones remain loadable independently of current ICU support. `GET_DISPLAY_STATE_MESSAGE`, `UPDATE_PRESENTATION_MESSAGE`, exact committed-revision acknowledgement, unavailable-zone projection, own-host policy, and response barriers retain their names and semantics. No direct content/options storage access or locale preference persistence is introduced.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/settings/custom-format.ts` | Create | One bounded quote-aware Unicode-pattern validator, typed errors, and valid default custom example. |
| `src/settings/snapshot.ts` | Modify | Exact unpublished V4 snapshot, discriminated validated display shapes, deep-frozen defaults, strict V3 rejection. |
| `src/settings/settings-service.ts` | Modify | Typed semantic `invalid-format`, mode/pattern/zone equality, serialized full-snapshot preservation. |
| `src/core/date-locale.ts` | Create | Small explicitly imported synchronous locale registry and nearest-tag/script/region `en-US`-fallback resolver. |
| `src/core/format-default-date.ts` | Modify | Existing Intl-backed System formatting plus safe date-fns custom formatting with exactly one `tz` context. |
| `src/core/process-document.ts` | Modify | Preserve or restore original source after a typed custom formatting failure; never render empty output. |
| `src/background/application.ts` | Modify | Replace V3 type with V4 and propagate typed custom-format validation without changing existing fanout/policy. |
| `src/background/messages.ts` | Modify | Accept strict System/Custom projections and `invalid-format` responses while preserving envelope ownership. |
| `src/runtime/messages.ts` | Modify | Existing document update guards accept only valid discriminated display shapes. |
| `src/options/app.tsx` | Modify | English System/Custom selector, local pattern draft/examples/live preview/inline errors, unchanged explicit Save/Sites/time-zone controls. |
| `src/options/styles.css` | Modify if needed | Existing local layout for accessible custom-format controls without inline executable content. |
| `tests/settings/custom-format.test.ts` | Create | Public bounded validator, quote/escape, Unicode, protected-token, and formatter-error behavior. |
| `tests/core/date-locale.test.ts` | Create | Exact/region/script/language matching, preferred order, malformed/missing locale, and `en-US` fallback. |
| `tests/settings/snapshot.test.ts` | Modify | Strict V4/default/discriminated pattern shape, deep validation, old-V3 rejection, and historical-zone safety. |
| `tests/settings/settings-service.test.ts` | Modify | Valid custom save, invalid-format no work, exact equality, failure preservation, and mixed policy writes. |
| `tests/core/format-default-date.test.ts` | Modify | Numeric/localized tokens, escaped literals, System/UTC/IANA, single conversion, DST, fallback, formatter failures. |
| `tests/integration/process-document.test.ts` | Modify | Valid custom output and safe visible original after formatter failure. |
| `tests/runtime/messages.test.ts` | Modify | Strict valid custom update acceptance and malformed/legacy-pattern rejection. |
| `tests/content/runtime.test.ts` | Modify | Saved custom first paint, revisioned changes, same-generation idempotence, disabled/reactivated hydration. |
| `tests/background/messages.test.ts` | Modify | Strict custom states, valid envelope/invalid-pattern typed response, existing acknowledgements. |
| `tests/background/application.test.ts` | Modify | Atomic custom commits, two exact-host tabs, format changes with unchanged zone, no-work invalid saves, concurrent policy. |
| `tests/options/app.test.tsx` | Modify | Product labels, local preview-only edits, examples, inline errors, explicit Save, fallback, failure, no combined mode. |
| `tests/integration/presentation-updates.test.ts` | Modify | Actual V4 writer/application plus two genuine document listeners, custom first paint, acknowledged saves, disabled/re-enable, restoration. |
| `tests/build/chrome-artifact.test.ts` | Modify | All emitted V4 background/content/options behavior, custom formatting/locale/fallback, typed validation, CSP, ZIP parity. |
| `tests/build/watch.test.ts` | Modify if needed | Existing selected-target watch publication for changed settings/core/options dependency inputs. |

## Tasks

### [x] Task 1: Add one bounded Unicode-pattern validator

**Files:** Create `tests/settings/custom-format.test.ts`; create `src/settings/custom-format.ts`.

- [x] **Step 1: Write failing public validator cases.** Accept `yyyy-MM-dd HH:mm`, `EEEE, d MMMM yyyy`, timezone `XXX`, valid quoted literal `'at'`, doubled apostrophe `''`, and quoted literal `'YYYY DD'`. Reject empty/whitespace/non-string, more than 256 UTF-16 code units, controls, unmatched apostrophe, literal-only output, unsupported unescaped alphabetic tokens, and unquoted `YY`/`YYYY`/`D`/`DD`. Assert each rejected protected token yields a typed error without leaking formatter throws or warnings; assert a valid default example.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/custom-format.test.ts'`; expect the absent public validator module to fail.
- [x] **Step 3: Implement the bounded shared validator.** Export typed result/default pattern, perform capped linear quote-aware scanning with doubled-apostrophe handling and protected-token prechecks, require a genuine unquoted date token, dry-run installed date-fns `format` on a fixed valid instant using explicit `en-US`, catch errors, and reject blank output without dynamic regex construction or compatibility-token flags.
- [x] **Step 4: Re-run the focused gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/custom-format.test.ts'`; expect all accepted Unicode/escape cases and safe typed failures to pass.

**Verification**: One bounded public validator safely distinguishes supported Unicode patterns from malformed, protected, empty, and unquoted-literal drafts before formatting can warn or throw.

### [x] Task 2: Advance to exact discriminated unpublished settings V4

**Files:** Modify `tests/settings/snapshot.test.ts`; modify `src/settings/snapshot.ts`; update existing V3 imports/seeds in `src/settings/settings-service.ts`, `src/background/application.ts`, `tests/settings/settings-service.test.ts`, `tests/background/application.test.ts`, `tests/integration/presentation-updates.test.ts`, and `tests/build/chrome-artifact.test.ts` as required.

- [x] **Step 1: Write failing parser/default behavior.** Require the exact five-field V4 frozen default, a two-key System display, a three-key valid Custom display, preserved canonical own-site preferences and all safe zone variants. Reject absent/extra/inherited pattern, wrong discriminant, empty/oversized/legacy/malformed custom pattern, a pattern on System, old exact V3 and unknown schemas, and invalid revisions; still accept a structurally safe previously saved IANA identifier after runtime availability disappears.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/custom-format.test.ts'`; expect current V3/System-only parsing to reject the new document or retain obsolete schema.
- [x] **Step 3: Implement strict V4 without migration.** Rename exported version-specific type/guard, preserve all five fields and frozen copies, parse exact System/Custom discriminants, apply the single shared custom validator, keep structural zone validation independent of runtime support, and update maintained predecessor fixtures to V4. Remove old unpublished compatibility rather than adding aliases, backups, reset, or migration.
- [x] **Step 4: Re-run snapshot and predecessor gates.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/background/application.test.ts tests/integration/presentation-updates.test.ts'`; expect all accepted policy/zone defaults and explicit old-schema rejection to pass.

**Verification**: Every accepted stored snapshot has one complete V4 document and an exactly validated System or Custom display without weakening unavailable-zone or hostname semantics.

### [x] Task 3: Persist custom changes atomically through the existing writer

**Files:** Modify `tests/settings/settings-service.test.ts`; modify `src/settings/settings-service.ts`; modify `tests/background/application.test.ts`; modify `src/background/application.ts`.

- [x] **Step 1: Write failing service/application cases.** Save custom numeric and localized patterns with the same previously saved zone, change one pattern while retaining zone, switch back to System with no pattern, and avoid writing identical mode/pattern/zone. Send malformed/legacy/empty patterns in otherwise valid custom shapes and require typed `invalid-format`, zero storage reads/writes/tab messages, unchanged revision/output; preserve malformed-shape `invalid-display-settings`, unsupported-zone errors, failed-write state, historical-zone warnings, concurrent global/site/display fields, and no fanout when disabled.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/settings-service.test.ts tests/background/application.test.ts'`; expect same-zone custom changes to be ignored or invalid patterns to lack their typed response.
- [x] **Step 3: Extend the existing one-writer transaction.** Check custom pattern semantics before full parsing/storage work, preserve existing zone validation, compare format mode plus exact pattern and zone, propagate `invalid-format` through the application response, and reuse the established latest-snapshot merge, exact-tab fanout, acknowledgement, failure metadata, and response barrier unchanged.
- [x] **Step 4: Re-run settings/application gates.** Run `zsh -lic 'pnpm exec vitest run tests/settings/custom-format.test.ts tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/background/application.test.ts'`; expect atomic valid revisions, no invalid work, preserved policy, and unchanged partial-failure handling.

**Verification**: A format-only edit is a real revisioned whole-document commit; bad drafts never touch storage or tabs, and simultaneous site/global controls remain intact.

### [x] Task 4: Resolve the nearest bounded packaged browser locale

**Files:** Create `tests/core/date-locale.test.ts`; create `src/core/date-locale.ts`.

- [x] **Step 1: Write failing public locale-resolution cases.** Require exact `en-US`, `en-GB`, `pt-BR`, `zh-CN`, and `zh-TW`; region fallback `de-AT` -> `de`; extension normalization `en-GB-u-hc-h12` -> `en-GB`; script matching `zh-Hant-HK` -> `zh-TW` and `zh-Hans-SG` -> `zh-CN`; ordered unsupported-then-supported preferences; and malformed, missing, empty, or unbundled tag fallback to `en-US`. Verify localized month/weekday output differs across actual English, German, French, and Russian locales.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/core/date-locale.test.ts'`; expect the nearest-locale resolver to be absent.
- [x] **Step 3: Implement a small direct-import registry.** Explicitly import only `en-US`, `en-GB`, `de`, `fr`, `es`, `it`, `pt`, `pt-BR`, `ru`, `ja`, `zh-CN`, and `zh-TW` subpaths; normalize safely with `Intl.Locale`; prefer exact, appropriate script/region, then language in browser preference order; deterministically fall back to `en-US` without aggregate/wildcard/dynamic imports or locale persistence.
- [x] **Step 4: Re-run locale gates.** Run `zsh -lic 'pnpm exec vitest run tests/core/date-locale.test.ts tests/core/format-default-date.test.ts'`; expect region/script selection and deterministic missing-data fallback to pass while predecessor defaults remain unchanged.

**Verification**: Custom month/weekday names use the closest explicitly packaged browser locale while unsupported data reliably produces English and the build avoids an all-locales context.

### [x] Task 5: Format custom exact instants with one DST-aware zone conversion

**Files:** Modify `tests/core/format-default-date.test.ts`; modify `src/core/format-default-date.ts`; modify `tests/integration/process-document.test.ts`; modify `src/core/process-document.ts`.

- [x] **Step 1: Write failing observable formatter/DOM cases.** Check numeric and localized month/weekday patterns, quoted literals, each packaged/fallback locale, System/UTC/New York zones, and `XXX` offsets against independent Intl date parts. For `2026-03-08T06:59:00Z` and `2026-03-08T07:01:00Z`, require New York `01:59 -05:00` then `03:01 -04:00` and corresponding UTC values, proving no double conversion. Require existing medium/short System-format behavior unchanged. Simulate an unavailable historical IANA zone and retain the custom pattern in System-zone fallback plus typed correction; force a hostile invalid custom pattern at the public document boundary and require typed `invalid-format`, visible restored original, no blank/guessed replacement, and no appended relative text.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/core/format-default-date.test.ts tests/core/date-locale.test.ts tests/integration/process-document.test.ts'`; expect current formatter to ignore custom patterns or throw through document processing.
- [x] **Step 3: Extend the current presentation boundary.** Keep existing date-fns `intlFormat` for System mode. For Custom, call date-fns `format` with the bounded selected locale; omit zone context for System and apply `in: tz("UTC" | identifier)` once for explicit zones. Preserve unavailable-zone fallback using the same custom pattern, safely catch formatting failures as empty `invalid-format` results, and restore/skip only the affected adapter candidate without touching unrelated DOM.
- [x] **Step 4: Re-run formatter/ownership gates.** Run `zsh -lic 'pnpm exec vitest run tests/core/format-default-date.test.ts tests/core/date-locale.test.ts tests/integration/process-document.test.ts tests/integration/github-fixtures.test.ts tests/integration/document-ownership.test.ts'`; expect exact custom localized DST-safe output and unchanged trusted-source ownership/restoration.

**Verification**: Each custom date uses its selected locale and civil timezone exactly once; formatter failures preserve GitHub's original and System-format defaults remain untouched.

### [x] Task 6: Preserve strict revisioned custom presentation transport

**Files:** Modify `tests/runtime/messages.test.ts`; modify `src/runtime/messages.ts`; modify `tests/background/messages.test.ts`; modify `src/background/messages.ts`; modify `tests/content/runtime.test.ts`; modify `tests/build/chrome-artifact.test.ts` if needed for actual emitted dispatch.

- [x] **Step 1: Write failing public transport cases.** Accept exact ready/custom states and revisioned custom updates with valid System/UTC/IANA zones; reject extra/missing pattern, legacy/malformed pattern, invalid revision, and System-with-pattern. Through the real background listener, dispatch an otherwise exact custom envelope containing a bad pattern and require one typed `invalid-format` callback, authoritative unchanged display, no storage/tab work, and no ambiguous reread. Hydrate a saved custom first paint, apply newer updates, keep same-revision acknowledgement idempotent, reject stale/stopped updates, preserve one read per fresh activation generation, and retain unavailable-zone correction.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/runtime/messages.test.ts tests/background/messages.test.ts tests/content/runtime.test.ts'`; expect Custom display guards and typed invalid-format transport to fail.
- [x] **Step 3: Extend only existing guards/types.** Accept validated V4 discriminants in presentation/read-model guards and allow `invalid-format` in strict save responses, while leaving the outer save envelope structural-only and background listener exactly-once. Reuse existing content revisions, generations, exact acknowledgements, frame-zero targeting, no-polling controller, and unavailable-zone projection; add no extra message or page listener.
- [x] **Step 4: Re-run runtime and messaging gates.** Run `zsh -lic 'pnpm exec vitest run tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/settings/settings-service.test.ts'`; expect safe valid custom updates, typed rejection, revision ordering, and preserved predecessor contracts.

**Verification**: Only validated revisioned custom settings enter active documents; malformed user intents receive exactly one truthful typed response without persistence or tab side effects.

### [x] Task 7: Add local custom draft, examples, preview, and actionable English errors

**Files:** Modify `tests/options/app.test.tsx`; modify `src/options/app.tsx`; modify `src/options/styles.css` only if needed.

- [x] **Step 1: Write failing rendered Options behavior.** Require accessible `Date format` choices exactly `System` and `Custom format`; conditional `Format pattern`, examples, and `Preview`; no user-facing `date-fns` or combined mode. Enter two valid numeric/localized drafts and change the draft zone; preview must update immediately with the chosen locale/zone while browser message counts, storage, saved state, and current page output stay unchanged. Reject empty, whitespace, oversize, unmatched quote, unsupported token, and legacy pattern with actionable adjacent English field error and no Save intent. Require one valid complete custom Save; persisted custom load/edit; switch back to pattern-free System; save failure preserving old output; truthful partial warning; stale/ambiguous response behavior; historically unavailable-zone correction; global/site-disabled usability; unchanged Sites switches.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/options/app.test.tsx'`; expect absent format selector, pattern field, live preview, and custom validation.
- [x] **Step 3: Extend the existing local draft/view.** Add discriminated format mode, remembered editable custom text, a stable in-memory preview instant, examples, current browser locales, existing timezone draft, shared validator, and user-facing error mapping. Recompute preview only during user-triggered renders; call the unchanged client solely from explicit valid Save; preserve all predecessor response, revision, Sites, unavailable-zone, CSP, and partial-refresh behavior.
- [x] **Step 4: Re-run Options/policy gates.** Run `zsh -lic 'pnpm exec vitest run tests/options/app.test.tsx tests/popup/app.test.tsx tests/settings/custom-format.test.ts tests/background/messages.test.ts tests/background/application.test.ts'`; expect local previews, blocked invalid saves, product-only English labels, and unchanged global/site controls.

**Verification**: Every draft edit changes only the local preview; only explicit valid Save commits one complete presentation, and all errors remain understandable without exposing implementation branding.

### [x] Task 8: Prove actual two-document custom saves, failures, and policy reactivation

**Files:** Modify `tests/integration/presentation-updates.test.ts`; modify `tests/content/runtime.test.ts`, `tests/background/application.test.ts`, or existing implementation only for integration defects exposed at public boundaries.

- [x] **Step 1: Write failing connected runtime scenarios.** Use the existing actual V4 `SettingsService`, `BackgroundApplication`, coordinator, two genuine jsdom document runtimes, and real installed listeners. Start with persisted custom New York output; save a different pattern with the same zone and then custom UTC, assert both live owned nodes update in place, both strict actual acknowledgements carry each committed revision, and newly added candidates use the latest custom setting. Return one stopped-document failure while its sibling updates and verify accepted persistence plus truthful per-tab warning. For both global and exact-site disable paths, restore untouched relative originals, save custom while off with zero fanout, re-enable the same documents, require exactly one fresh hydration per generation and the latest custom output, and retain one listener/controller. Cover concurrent global/site/display commits and historical unavailable-zone custom fallback.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/integration/presentation-updates.test.ts tests/content/runtime.test.ts tests/background/application.test.ts'`; expect any disconnected custom schema/equality/format/fanout seam to fail through actual rendered DOM or acknowledgements.
- [x] **Step 3: Correct only exposed integration seams.** Preserve trusted source extraction, owned-only updates, exact-host policy, atomic revisions, custom fallback, no disabled fanout, strict genuine acknowledgements, safe generation hydration, and exact restoration; introduce no second adapter, polling, registration change, backup, or parallel business logic.
- [x] **Step 4: Re-run integrated public-boundary gates.** Run `zsh -lic 'pnpm exec vitest run tests/integration/presentation-updates.test.ts tests/integration/process-document.test.ts tests/integration/document-ownership.test.ts tests/content/runtime.test.ts tests/background/application.test.ts tests/options/app.test.tsx'`; expect persisted first paint, genuine two-tab updates, partial failure, disabled reactivation, and safe restoration to pass.

**Verification**: Real background and real content listeners demonstrate that only a committed custom setting changes both live GitHub documents and that all predecessor policy/failure guarantees survive.

### [x] Task 9: Preserve emitted cross-browser CSP, bounded locales, watch, and ZIPs

**Files:** Modify `tests/build/chrome-artifact.test.ts`; modify `tests/build/watch.test.ts` only if a changed maintained dependency input is not already exercised; adjust existing build/runtime code only if generated observable behavior fails.

- [x] **Step 1: Write failing emitted-artifact scenarios.** For all Chrome/Firefox/Edge development and release builds, seed strict V4 storage, initialize emitted background and content bundles in disabled-code-generation VM contexts, hydrate saved numeric/localized custom output, save a different valid custom pattern through the actual emitted listener, and require one exact committed-revision frame-zero update. Dispatch invalid legacy/empty patterns and require exactly one typed rejection with zero write/tab work. Confirm at least German localized names and unsupported-tag `en-US` fallback, corrected unavailable historical zone, working Options controls, existing CSP/no remote resources, unchanged browser permissions, exact-host registration, unpacked/ZIP inventory equality, and selected-target watch for touched graph inputs. Reject obsolete stored V3 through runtime behavior, not source inspection.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/watch.test.ts'`; expect obsolete V3 seeds, missing emitted custom dispatch, or absent localized behavior to fail observably.
- [x] **Step 3: Correct maintained public build seams only.** Update generated-runtime fixtures and dependency graph as needed, preserve static explicitly bundled locale code without aggregate wildcard chunks, external extension scripts, disabled dynamic code generation, current Rspack entries, browser manifests, source-map behavior, deterministic ZIP publication, and selected-target watch; do not add a size threshold, permissions, runtime network fetch, browser launch, or source-text assertion.
- [x] **Step 4: Re-run artifact/watch gates.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/watch.test.ts tests/build/commands.test.ts'`; expect all six target/mode artifacts, custom runtime behavior, selected watch, and exact ZIP contents to pass.

**Verification**: Every installable browser bundle contains the bounded-locale custom formatting feature while retaining CSP, privacy, existing permissions, deterministic packaging, and reliable selected watch.

### [x] Task 10: Run complete direct-pnpm quality and six-artifact gates

**Files:** No planned production changes.

- [x] **Step 1: Run focused presentation/settings/runtime/UI regressions.** Run `zsh -lic 'pnpm exec vitest run tests/settings/custom-format.test.ts tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/core/date-locale.test.ts tests/core/format-default-date.test.ts tests/core/render-exact-time.test.ts tests/core/document-transformation-controller.test.ts tests/core/document-mutation-scheduler.test.ts tests/integration/process-document.test.ts tests/integration/document-ownership.test.ts tests/integration/presentation-updates.test.ts tests/runtime/messages.test.ts tests/runtime/adapter-activation.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/popup/app.test.tsx tests/options/app.test.tsx'`; expect every custom/default locale, pattern, timezone, DST, transaction, policy, ownership, generation, and predecessor control case to pass.
- [x] **Step 2: Run the complete quality gate.** Run `zsh -lic 'pnpm check'`; expect ESLint, strict TypeScript, and all offline unit/integration/build/watch observable-behavior tests to pass.
- [x] **Step 3: Build every development target.** Run `zsh -lic 'pnpm dev'`; expect separate valid Chrome, Firefox, and Edge development directories and ZIPs.
- [x] **Step 4: Build every release target.** Run `zsh -lic 'pnpm release'`; expect separate valid Chrome, Firefox, and Edge release directories and ZIPs.
- [x] **Step 5: Run the final standalone lint gate.** Run `zsh -lic 'pnpm lint'`; expect no implementation, test, or configuration lint violations.

**Verification**: Full validation uses the existing direct Node/pnpm environment without Corepack, Git, browser automation/UI, website/network access, external-utility checks, implementation-source-text tests, or future-slice features.

## Acceptance Coverage

| Acceptance criterion | Planned observable evidence |
| --- | --- |
| 1. Custom draft edits update preview immediately but never alter saved GitHub output before Save | Tasks 5, 7, and 8 test stable local preview, selected locale/zone, zero background/storage/tab work during edits, unchanged actual two-document output, and explicit commit-only refresh. |
| 2. Saved custom pattern controls current/future exact dates in the selected zone with no relative suffix | Tasks 2, 3, and 5-9 verify V4 persistence, mode/pattern equality, exactly one `@date-fns/tz` conversion, UTC/IANA DST, same-zone pattern changes, genuine two-document acknowledgements, dynamic candidates, disabled rehydration, ownership, and emitted artifacts. |
| 3. Empty, malformed, or legacy-token patterns are blocked with actionable English field errors | Tasks 1-3, 6, 7, and 9 reject blank/oversized/control/unclosed/unsupported/protected patterns in snapshot, sole writer, actual emitted messages, and rendered Options; assert exact typed response, unchanged revision, zero writes/fanout, and adjacent user-readable feedback. |
| 4. Month/weekday names use the nearest bundled browser locale with `en-US` fallback | Tasks 4, 5, 7, and 9 test exact/region/script/language locale matching, preferred order, German/French/Russian localized month/weekday output, Unicode-extension normalization, invalid/unbundled locale fallback, localized preview, and generated browser artifacts. |
| 5. UI uses product terms, exposes only System/Custom modes, and never offers combined output | Tasks 5, 7, and 9 inspect rendered accessible `Date format`, `Custom format`, `Format pattern`, `Preview`, examples, exactly two choices, no implementation-library branding, and replacement-only DOM output. |

## Constraint Coverage

| Constraint | Planned enforcement |
| --- | --- |
| Preserve validated Issue 8 behavior and simple architecture | Tasks 2, 3, 5, 6, and 8 reuse the same writer, read model, display intent, controller, activation generation, frame-zero acknowledgement, exact hostname, System formatter, unavailable-zone warning, observer, and Sites controls. |
| Strict pre-publication schema with no compatibility promise | Task 2 replaces V3 with exact V4, rejects every older unpublished document, and adds no migration, backup, silent reset, or recovery work reserved for later issues. |
| Safe bounded formatting without excessive locale payload | Tasks 1, 4, 5, and 9 cap and prevalidate quote-aware patterns, isolate runtime formatter errors, import only named locale subpaths, avoid aggregate/dynamic loading, and test deterministic missing-locale fallback without an arbitrary page-performance benchmark. |
| Accurate zones and browser preferences | Tasks 4, 5, 7, and 8 resolve current locale tags and apply one `@date-fns/tz` context for custom UTC/IANA while keeping Intl system presentation, DST, unavailable-zone custom fallback, dynamic candidate resolution, and no polling. |
| Privacy, CSP, failure handling, and policy precedence | Tasks 3, 6-9 preserve atomic serialized local-only settings, no visited-host/locale/page data persistence, typed exactly-once failures, policy-disabled zero fanout, real committed partial failures, extension-local UI, no extra permission, and six safe browser artifacts. |
| User-requested tool and testing restrictions | Every task uses direct pnpm behavioral public/module/DOM/UI/browser-fake/emitted-artifact tests; no Corepack, Git, external browser/UI, website/network, source-text assertion, external-process/utility test, diagnostics, reset, report, backup, or future adapter is introduced. |

## Self-Review

- Direct prerequisite `8-AFK` is `Validated`; its approved generation-scoped hydration, strict acknowledgements, timezone safety, locale defaults, exact ownership, and genuine two-document contracts remain explicit.
- All five issue acceptance criteria map to concrete failing observable tests and subsequent minimal production changes.
- `SettingsSnapshotV4`, discriminated `DisplaySettings`, bounded `pattern`, `CustomPatternValidation`, `DatePresentationResult`, typed `invalid-format`, exact revision messages, and unchanged zone/site/global fields are consistent across entities, contracts, tasks, and evidence.
- Every system display rejects a retained custom pattern; every accepted custom display includes one shared fully valid bounded pattern; old unpublished V3 is rejected without migration or silent default recovery.
- Protected legacy tokens are rejected before date-fns can warn, while quoted protected text and doubled apostrophes remain valid; unmatched quotes, literal-only output, controls, excessive patterns, and unexpected formatter exceptions are handled safely.
- Locale resolution explicitly bundles only selected direct locale imports, honors preferred order plus region/script fallbacks, and deterministically uses `en-US` when a requested language is unavailable.
- Custom UTC/IANA formatting uses one date-fns v4 timezone context and proves DST offsets; historical unavailable-zone fallback keeps the custom pattern and visible correction state.
- Pattern drafts and preview never persist or alter documents before explicit Save; failed saves preserve prior pages, and real two-document acknowledgements, stopped-tab partial failures, policy-disabled saves, reactivation hydration, and original-source restoration remain covered.
- UI remains English and product-facing with exactly System/Custom choices, examples, preview, accessible inline errors, unchanged Sites controls, no page UI, no relative suffix, and no arbitrary operating-system-pattern promise.
- All planned tests exercise observable parser, formatter, storage, messaging, DOM, React controls, generated resources, ZIPs, watch, or public commands; no implementation file is read as test text.
- No placeholder, unapproved browser operation, network, Corepack, Git, new dependency/permission, locale account persistence, all-locales bundle, backup/recovery, reset, diagnostics, reporting, or performance-threshold promise is included.
