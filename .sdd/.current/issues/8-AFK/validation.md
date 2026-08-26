# Issue Validation Report: [no-more-ago] Configure system format and time zone

- **Validated**: 2026-08-25
- **Model**: Codex (GPT-5; independent verification)
- **Issue**: `.sdd/.current/issues/8-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/8-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 12 | 0 | 0 | 12 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 5 | 0 | 0 | 5 |
| Contracts | 5 | 0 | 0 | 5 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

The independent complete quality gate `zsh -lic 'pnpm check'` passed ESLint, TypeScript, and all **24 test files / 427 tests**. The expanded approved focused presentation/settings/runtime/UI command, including the new real two-document integration, separately passed **17 test files / 249 tests**. Direct `zsh -lic 'pnpm dev'` and `zsh -lic 'pnpm release'` each built Chrome, Firefox, and Edge successfully; standalone `zsh -lic 'pnpm lint'` passed, and a repeat of `zsh -lic 'pnpm exec vitest run tests/build/watch.test.ts'` passed all **10 selected-target watch tests**. All seven prerequisite issues remain `Validated`; the reviewed plan remains `Approved`.

Every finding from validation attempt 1 is resolved with durable public-boundary tests: independent Intl parity now verifies explicit 12/24-hour cycles, ordered locale fallback, and New York's 01:59-to-03:01 spring-forward transition; actual settings service, background application, activation coordinator, and two real document runtimes now demonstrate persisted first paint, genuine exact-revision acknowledgements, truthful stopped-sibling partial failure, and both global/site disable-save-reenable paths with exact restoration, zero disabled fanout, one fresh hydration per document, and one retained listener.

## Task Status

- [x] **Task 1: Specify strict V3 display settings and persisted-zone structural safety** - PASS. `tests/settings/snapshot.test.ts` exercises the frozen revision-zero five-field V3 default, strict discriminants, safe single-component and slash-separated IANA names, unsafe identifier rejection, obsolete schema rejection, prototype-like own hostname keys, safe revisions, and runtime-independent historical-zone parsing.
- [x] **Task 2: Persist validated display changes without losing concurrent controls** - PASS. `tests/settings/settings-service.test.ts` and `tests/background/application.test.ts:177` exercise sole-writer validated storage, supported aliases, malformed/unavailable draft rejection, unchanged writes, failed-write preservation, and mixed global/site/display commits.
- [x] **Task 3: Format exact instants using current locales, clock preference, and selected zone** - PASS. `tests/core/format-default-date.test.ts:33` independently verifies `en-US-u-hc-h23` and `en-GB-u-hc-h12`; `:49` checks ordered locale selection plus unsupported-valid-locale fallback; `:71` checks both sides of New York's spring-forward boundary, exact 01:59/03:01 values, year and minute fields, no seconds, and browser Intl parity. Existing cases preserve System/UTC/IANA modes, runtime-default locale, and unavailable-zone fallback.
- [x] **Task 4: Reformat only proven extension-owned sources on an explicit settings change** - PASS. `tests/core/render-exact-time.test.ts`, `tests/core/document-transformation-controller.test.ts`, and `tests/integration/document-ownership.test.ts` demonstrate genuine owned-source enumeration, isolated in-place refresh, hostile-marker protection, dynamic sources, observer preservation, and exact restoration.
- [x] **Task 5: Define strict revisioned document presentation messages** - PASS. `tests/runtime/messages.test.ts` verifies exact own-field update/acknowledgement envelopes, safe revisions, malformed/inherited fields, and matching expected revisions; `tests/content/runtime.test.ts:247` additionally verifies duplicate idempotence and stale/stopped rejection.
- [x] **Task 6: Hydrate authoritative presentation before first content ownership** - PASS. `tests/content/runtime.test.ts:197`, `:215`, `:232`, and `:264` prove deferred first ownership, one read per activation generation, newer-update ordering, and obsolete-generation rejection. `:288` now starts with an already-owned New York document, restores its original source, changes saved presentation while stopped, reactivates the same runtime slot once, and proves a fresh UTC hydration plus exactly one retained listener. The real policy-specific global/site transactions are independently exercised in `tests/integration/presentation-updates.test.ts:187`.
- [x] **Task 7: Add authoritative display read/write messages and exactly-once MV3 responses** - PASS. `tests/background/messages.test.ts` and `tests/build/chrome-artifact.test.ts:305` verify exact structural envelopes, ready/unavailable models, semantic invalid-zone responses, exactly one callback, no failed-write fanout, and preserved predecessor dispatch.
- [x] **Task 8: Serialize display saves and refresh all enabled exact-host top-frame tabs** - PASS. `tests/background/application.test.ts:387` verifies both exact-host tab IDs and frame-zero requests; `:419` table-tests missing/malformed/stale/future/extra/rejected acknowledgements; `:130` and `:142` verify global/site policy gates; `:177` verifies mixed serialized writes. `tests/integration/presentation-updates.test.ts:138` additionally proves both exact acknowledgements originate from actual installed document listeners rather than manufactured success responses.
- [x] **Task 9: Expose accessible English Display controls without disturbing Sites** - PASS. `tests/options/app.test.tsx:200` verifies product-only English labels, conditional IANA entry, local drafts, supported one-component/slash identifiers, invalid-zone blocking, partial-refresh errors, unavailable saved-zone correction, ambiguous rereads, stale response handling, global-off usability, and retained Sites controls.
- [x] **Task 10: Verify end-to-end saved zone, dynamic candidates, and observer ownership** - PASS. `tests/integration/presentation-updates.test.ts:137` connects actual `SettingsService`, `BackgroundApplication`, `AdapterActivationCoordinator`, fake frame-zero WebExtension transport, and two genuine `installContentRuntime` documents. Its first scenario proves persisted New York first paint in both documents, committed UTC persistence, both live owned outputs, and two actual document-produced exact-revision acknowledgements. `:168` proves a stopped document produces an honest committed partial failure while its active sibling updates. `:187` exercises both real global/site disable branches, exact original restoration, zero disabled-save fanout, same-document reinjection, fresh saved UTC output, two total hydrations per document, and exactly one retained listener. Dynamic candidate/locale isolation, obsolete-generation safety, hostile-marker isolation, and exact teardown remain covered by `tests/content/runtime.test.ts`, `tests/core/document-transformation-controller.test.ts`, and predecessor integrations.
- [x] **Task 11: Preserve CSP-safe emitted browser artifacts, selected watch, and ZIP parity** - PASS. `tests/build/chrome-artifact.test.ts:259` exercises emitted V3 background/display persistence, strict frame-zero acknowledgement and partial failures, disabled-save fanout suppression, production content hydration, genuine content-listener acknowledgement, and real owned DOM output in every Chrome/Firefox/Edge development/release artifact. `tests/integration/presentation-updates.test.ts:138` and `:187` supply the connected real-listener/two-document and retained-generation policy evidence at their public runtime boundary; emitted popup/options/CSP, browser manifests, exact ZIP contents, and maintained-input publication remain covered by the full build suites. The standalone selected-target watch suite independently passed all 10 tests after deferred publication rearming.
- [x] **Task 12: Run complete direct-pnpm quality and six-artifact gates** - PASS. Independently executed the expanded focused 17-file/249-test command, full direct-pnpm ESLint/TypeScript/test gate with 24 files/427 tests, all three direct development builds, all three direct release builds, standalone lint, and a standalone 10-case selected-target watch rerun. No Corepack, Git, browser automation, website, network, external-utility test, or implementation-source-text test was used.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Default formatting follows localized medium date/short time and system browser settings. | MET | `src/core/format-default-date.ts` delegates to `date-fns` `intlFormat`; `tests/core/format-default-date.test.ts:6`, `:33`, `:49`, and `:71` independently prove runtime defaults, locale ordering/fallback, 12/24-hour conventions, DST conversion, year/minute fields, and no seconds. |
| 2 | Saved System, UTC, or valid IANA settings update all current and future owned dates. | MET | `tests/settings/settings-service.test.ts:28`, `tests/content/runtime.test.ts:288`, and `tests/integration/presentation-updates.test.ts:138` prove accepted persisted IANA first paint in two real documents, exact acknowledged committed UTC updates, both global/site same-document rehydration, disabled-save zero fanout, truthful partial failure, and existing dynamic-candidate behavior. |
| 3 | Invalid IANA input is blocked with actionable English feedback and prior output stays active. | MET | `tests/options/app.test.tsx:254`, `tests/settings/settings-service.test.ts:43`, and `tests/build/chrome-artifact.test.ts:312` verify malformed/unavailable values, no storage/tab work, and user-visible English validation. |
| 4 | Historically saved unavailable zones fall back to System and Options exposes correction. | MET | `tests/settings/snapshot.test.ts:61`, `tests/core/format-default-date.test.ts:97`, `tests/background/application.test.ts:166`, and `tests/options/app.test.tsx:313` preserve the saved identifier, safely format with System, and display correction guidance. |
| 5 | Newly discovered candidates observe current browser locale/system settings without polling. | MET | `tests/content/runtime.test.ts:317` changes the locale provider, proves a new candidate alone uses the new locale, and leaves existing owned output unchanged; validated predecessor observer tests preserve event-driven behavior. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Settings Snapshot V3 | Exact five fields, safe revision, preserved global/site preferences, frozen display | Sole background-owned local document | Strict parser, old-schema rejection, canonical own hostname map | PASS |
| Time Zone Selection | Exact System/UTC/IANA discriminants and optional identifier | Nested in the display setting | Safe aliases and slash names; structural saved validity separate from current Intl support | PASS |
| Display Settings and Projection | System format, selected zone, revision, correction error | Shared writer/content/options read model | Strict V3 structural guards and unavailable-state handling | PASS |
| Revisioned Document Presentation | Revision, selected display, live locale provider, activation generation | Existing single controller and listener | Pre-ownership hydration, stale-generation rejection, exact idempotent acknowledgements | PASS |
| Display Refresh Result | Accepted revision, authoritative state, hostname/tab failure metadata | Serialized background response consumed by Options | Exact committed-revision acknowledgements and truthful partial errors | PASS |

## Contract Status

| Endpoint | Method | Status | Notes |
| --- | --- | --- | --- |
| Strict unpublished settings snapshot | Local storage document | PASS | Exact V3 schema; no unpublished V1/V2 compatibility alias or silent reset. |
| Display state projection | `no-more-ago:get-display-state` | PASS | Authoritative ready/unavailable state with historical-zone correction. |
| Display settings intent | `no-more-ago:set-display-settings` | PASS | Exact structural envelope, sole-writer semantic validation, single typed response, accepted revision. |
| Document presentation update | `no-more-ago:update-presentation` | PASS | Exact revisioned request, generation-aware update, owned-only reformat, stopped/stale rejection. |
| Document acknowledgement | `no-more-ago:presentation-updated` | PASS | Exact two own fields, safe revision, expected committed revision, idempotent duplicate, truthful partial failures. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Observable behavioral verification | COMPLIANT | Existing tests exercise public parsers, storage, messages, DOM, user-visible UI, emitted artifacts, ZIPs, and watch outputs. |
| Direct Node/pnpm without Corepack or Git | COMPLIANT | Focused and complete gates use `zsh -lic` and direct `pnpm`; no Corepack or Git invocation. |
| No browser automation, website access, or network | COMPLIANT | Verification uses offline fake runtimes, jsdom, disabled-code-generation VMs, and local build artifacts. |
| Preserve generic adapter/privacy architecture | COMPLIANT | Exact-host generic adapter fanout, one event-driven controller, extension-local UI, unchanged permissions, and no page-data persistence. |
| Non-destructive verification | COMPLIANT | Only this issue validation report and its resulting issue-status metadata are updated; no implementation, test, approved plan, or predecessor file is changed. |

## Issues Found

None. All three prior coverage findings are resolved by observable formatter, actual-content-runtime, and real two-document integration tests.

## Recommendations

- Mark issue `8-AFK` as `Validated`; preserve its reviewed plan status `Approved`.
- Continue to the next issue without adding speculative compatibility layers, browser automation, or out-of-scope functionality.
