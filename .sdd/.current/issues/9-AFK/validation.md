# Issue Validation Report: [no-more-ago] Configure a custom date format

- **Validated**: 2026-08-25
- **Model**: Codex (GPT-5.6; independent verification)
- **Issue**: `.sdd/.current/issues/9-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/9-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 10 | 0 | 0 | 10 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 3 | 0 | 0 | 3 |
| Contracts | 5 | 0 | 0 | 5 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

Independent `zsh -lic 'pnpm check'` passed ESLint, strict TypeScript, and **26 test files / 462 tests**, including all six Chrome/Firefox/Edge development/release artifact executions, ZIP packaging, and selected-target watch. Both prior findings are fixed and covered by durable public-boundary regressions: inherited custom patterns are rejected by snapshot/runtime/background guards, and formatter failures preserve or restore the GitHub original without disturbing unrelated ownership.

## Task Status

- [x] **Task 1: Add one bounded Unicode-pattern validator** - PASS. `tests/settings/custom-format.test.ts:5` proves valid numeric/localized tokens, ordinal `do`, timestamp `t`, quoted literals, doubled apostrophes, malformed quotes, controls, protected legacy tokens, and UTF-16 bounds.
- [x] **Task 2: Advance to exact discriminated unpublished settings V4** - PASS. `tests/settings/snapshot.test.ts:53` and `:61` verify exact V4/System/Custom own-field discriminants and reject inherited, absent, extra, legacy, System-with-pattern, and obsolete-schema values while preserving historical safe zones.
- [x] **Task 3: Persist custom changes atomically through the existing writer** - PASS. `tests/settings/settings-service.test.ts:28`, `tests/background/application.test.ts:166`, and `tests/integration/presentation-updates.test.ts:140` demonstrate preserved policy fields, typed invalid-format/no storage write or tab work, and revisioned same-zone custom-pattern changes.
- [x] **Task 4: Resolve the nearest bounded packaged browser locale** - PASS. `tests/core/date-locale.test.ts:5` exercises ordered language, region, script, extension normalization, malformed inputs, and deterministic `en-US` fallback; emitted bundles additionally render German and fallback English.
- [x] **Task 5: Format custom exact instants with one DST-aware zone conversion** - PASS. `tests/core/format-default-date.test.ts:108` proves DST offsets, custom fallback, and typed failures; `tests/integration/process-document.test.ts:39`, `:53`, and `:168` verify valid custom output, initially visible originals, and owned-source restoration without touching unrelated ownership.
- [x] **Task 6: Preserve strict revisioned custom presentation transport** - PASS. `tests/runtime/messages.test.ts:48` rejects inherited, missing, and legacy custom patterns and System-with-pattern; `tests/background/messages.test.ts:37` verifies valid custom projections, typed `invalid-format` responses, and rejection of inherited or malformed states.
- [x] **Task 7: Add local custom draft, examples, preview, and actionable English errors** - PASS. `tests/options/app.test.tsx:369`, `:398`, `:423`, `:446`, `:478`, `:510`, and `:540` prove English product labels, explicit-only saving, zero draft writes, live localized/timezone preview, blocked invalid patterns, pattern-free System, and typed field errors.
- [x] **Task 8: Prove actual two-document custom saves, failures, and policy reactivation** - PASS. `tests/integration/presentation-updates.test.ts:140`, `:219`, and `:254` use the actual writer, background application, coordinator, and two real installed document listeners to prove custom first paint, same-zone pattern changes, UTC, dynamic nodes, stopped-tab partial failure, and both global/site disable-save-reenable paths.
- [x] **Task 9: Preserve emitted cross-browser CSP, bounded locales, watch, and ZIPs** - PASS. `tests/build/chrome-artifact.test.ts:259` executes real background/content custom save, invalid typed response, New York hydration, German localization, and unsupported-locale fallback across all six artifacts; `:394` executes generated popup/Options under disabled-code-generation VM contexts.
- [x] **Task 10: Run complete direct-pnpm quality and six-artifact gates** - PASS. Independent `zsh -lic 'pnpm check'` passes ESLint, TypeScript, and **26 files / 462 tests**, including six emitted browser artifacts, ZIPs, constrained VMs, and selected-target watch.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Valid custom draft edits update local preview without changing saved GitHub output before explicit Save. | MET | `tests/options/app.test.tsx:369` and `:446` prove changing previews without save intents; `tests/integration/presentation-updates.test.ts:140` updates both actual documents only after committed saves. |
| 2 | Saved custom patterns render current/future exact dates in the selected timezone with no appended relative text. | MET | `tests/integration/presentation-updates.test.ts:140` proves persisted New York first paint, same-zone pattern replacement, UTC, two genuine document acknowledgements, dynamic candidates, and no `ago`; formatter DST offsets are checked in `tests/core/format-default-date.test.ts:108`. |
| 3 | Empty, malformed, and legacy-token patterns are blocked with actionable English field errors. | MET | `tests/options/app.test.tsx:398` and `:478` cover empty, oversized, control-containing, unsupported, unmatched-quote, and legacy patterns; all six emitted background bundles return exactly one typed `invalid-format` response without writes. |
| 4 | Localized month/weekday names use the nearest bundled browser locale with English fallback. | MET | `tests/core/date-locale.test.ts:5`, `tests/options/app.test.tsx:510`, and `tests/build/chrome-artifact.test.ts:382` prove region/script matching, German localized preview/output, and unsupported-tag `en-US` fallback. |
| 5 | The English interface exposes product terminology, exactly System/Custom modes, and no combined relative mode. | MET | `tests/options/app.test.tsx:201`, `:369`, and generated Options execution in `tests/build/chrome-artifact.test.ts:394` verify `Date format`, `Custom format`, `Format pattern`, examples, and preview without implementation branding or relative suffix. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Settings Snapshot V4 and Display Settings | Five snapshot fields; exact System/Custom discriminants | Sole background-owned document shared with runtime and Options | Own custom pattern required; inherited, substituted, legacy, and System-with-pattern values rejected | PASS |
| Custom Pattern and Locale Resolution | Bounded Unicode pattern, typed errors, explicit locale registry | Shared writer/snapshot/UI validator and current browser locale | Protected legacy tokens, controls, bounds, script/region matching, and fallback pass | PASS |
| Presentation Result and Options Draft | Exact text, selected zone, optional typed error, local draft/preview | Document ownership, formatter, and explicit Options save | Valid custom output and initially visible/already-owned original restoration preserve unrelated ownership | PASS |

## Contract Status

| Endpoint | Method | Status | Notes |
| --- | --- | --- | --- |
| Strict unpublished settings snapshot | Local storage parser | PASS | Exact own custom patterns accepted; inherited/substituted, missing, extra, legacy, and System-with-pattern rejected. |
| Display-state projection | `no-more-ago:get-display-state` guard | PASS | Valid custom states and typed responses accepted; inherited and malformed custom projections rejected. |
| Display settings intent | `no-more-ago:set-display-settings` | PASS | Exact structural envelope plus typed legacy/empty rejection is exercised by all six emitted listeners. |
| Revisioned presentation update | `no-more-ago:update-presentation` guard | PASS | Exact valid custom messages accepted; inherited, missing, protected, and System-with-pattern payloads rejected. |
| Document acknowledgement | `no-more-ago:presentation-updated` | PASS | Existing exact-field/revision guards and genuine two-document acknowledgements are preserved. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Observable behavioral verification | COMPLIANT | Existing suites and the independent probe execute public guards/parsers, formatter, DOM, UI, real listeners, and generated resources; findings do not depend on source-text assertions. |
| Direct Node/pnpm without Corepack or Git | COMPLIANT | Direct `zsh -lic` commands use the installed Node/pnpm; no Corepack or Git was invoked. |
| No browser automation, website access, or network | COMPLIANT | Verification remains offline with fake WebExtension APIs, jsdom, constrained VMs, and local emitted artifacts. |
| Preserve generic adapter and permission boundaries | COMPLIANT | Existing exact-host registration, unchanged six target manifests, local settings, and adapter-independent formatter remain intact. |
| Non-destructive verification | COMPLIANT | Only this validation report and issue status are updated; implementation, tests, and approved plan remain untouched. |

## Issues Found

None. Both attempt-1 findings are resolved and protected by permanent observable-behavior regressions.

## Recommendations

- Mark issue `9-AFK` as `Validated`; leave its reviewed implementation plan `Approved` and proceed to the next vertical slice.
