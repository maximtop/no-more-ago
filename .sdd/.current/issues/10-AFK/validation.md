# Issue Validation Report: [no-more-ago] Recover versioned settings safely

- **Validated**: 2026-08-25
- **Model**: Codex GPT-5.6 Sol xhigh independent verifier
- **Issue**: `.sdd/.current/issues/10-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/10-AFK/plan.md`
- **Validation attempt**: 1

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 6 | 0 | 0 | 6 |
| Acceptance Criteria | 6 | 0 | 0 | 6 |
| Entities | 2 | 0 | 0 | 2 |
| Contracts | 4 | 0 | 0 | 4 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

Independent targeted verification: `pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/background/application.test.ts tests/background/messages.test.ts tests/options/app.test.tsx tests/integration/presentation-updates.test.ts tests/build/chrome-artifact.test.ts` — **7 files, 185 tests passed**. The orchestrator independently confirmed `pnpm check` — lint, strict type checking, and **26 files, 488 tests passed**; development and release artifacts were produced for Chrome, Firefox, and Edge.

## Task Status

- [x] **Task 1: Define strict pair and pre-public schema contracts** — PASS. V4 remains the sole accepted schema; the previous key and recovered load source are public, validated contracts.
- [x] **Task 2: Implement atomic serialized current/previous replacement** — PASS. One Settings Service writer validates complete candidates, queues concurrent global/site/display/reset intents, and writes exactly one current/previous pair per accepted transaction.
- [x] **Task 3: Restore one valid backup and explicitly reset unavailable state** — PASS. Genuine empty storage uses defaults; eligible corruption restores one valid backup; invalid pairs and unknown future schemas fail closed; recovery and reset write failures preserve both persisted values.
- [x] **Task 4: Route fail-closed recovery reset through the background** — PASS. Exact own-field request/response guards, one response, typed failures, and successful activation reconciliation are verified through the public background boundary.
- [x] **Task 5: Expose one functional recovery action in unavailable Options** — PASS. Recovery appears only when unavailable, dispatches once without confirmation/retry, refreshes Sites and System display, prevents duplicate clicks, and reports actionable persistence failures.
- [x] **Task 6: Verify actual GitHub recovery and six emitted extension artifacts** — PASS. Two connected GitHub documents preserve custom/disabled policies, remain unchanged on failed saves, fail closed on future/dual corruption, and reactivate on reset; every Chrome/Firefox/Edge development/release background bundle executes recovery/reset under its actual runtime listener and CSP-constrained VM.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Concurrent popup/options changes serialize without losing accepted updates. | MET | `tests/background/application.test.ts` verifies overlapping global, hostname, and display changes; `tests/settings/settings-service.test.ts` verifies reset and hostname mutation ordering. |
| 2 | Invalid whole-state changes are rejected without changing active behavior. | MET | Strict snapshot/parser and service tests reject invalid schemas, custom patterns, hostnames, and display/time-zone values before persistence; integration coverage retains both owned document outputs. |
| 3 | Failed replacement preserves current, previous, runtime behavior, and actionable errors. | MET | Service, background, Options, connected-document, and emitted-runtime tests assert unchanged pairs, unchanged output, and typed `save-failed` recovery guidance. |
| 4 | Invalid current data restores and follows a valid previous snapshot. | MET | Service tests cover invalid and absent current values; two-document integration verifies preserved custom presentation and both global-disabled and site-disabled policies. |
| 5 | Invalid current and previous snapshots keep adapters inactive and expose reset. | MET | Background, Options, both GitHub documents, and all six emitted bundles verify failed-closed cleanup, unavailable projections, and one functional `Reset all settings` action. |
| 6 | Unpublished incompatible schemas can require reset; unknown future schemas are never silently downgraded. | MET | Strict V4 parser/service, connected-document, and six-artifact tests reject older unpublished values and preserve an unknown future current even when a valid backup exists. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Settings snapshot pair | Exactly one local current and one local previous complete V4 snapshot. | Sole Settings Service writer; existing background, runtime, Sites, and Display consumers. | Strict whole-snapshot parsing, safe revision/hostnames/presentation, atomic replacement, and future-schema protection. | PASS |
| Recovery reset request and result | Exact own-field request, safe accepted revision, typed success/failure, authoritative Sites state. | Options transport to background router, serialized service, activation coordinator, and refreshed projections. | Strict envelopes, one dispatch/response, no ambiguous retry, and persistence-first reconciliation. | PASS |

## Contract Status

| Contract | Boundary | Status | Notes |
| --- | --- | --- | --- |
| Strict V4 pair and recovered load source | Public snapshot parser and `SettingsService.load()` | PASS | Empty, stored, recovered, corrupt, unsupported, and future-schema states verified. |
| Serialized atomic snapshot replacement | Public Settings Service mutation methods | PASS | One validated two-key `storage.local.set()`; failed writes and no-ops preserve authoritative data. |
| Explicit fail-closed recovery reset | Settings Service, background application, and Options | PASS | One validated default-pair write, immediate GitHub reconciliation, actionable errors, and no automatic retry. |
| Exact reset runtime message and response | Background listener, Sites client, and six emitted bundles | PASS | Own-field/inherited-field guards, authoritative ready/unavailable projections, and exactly one response. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Verify observable public behavior instead of implementation text. | COMPLIANT | Snapshot/service contracts, genuine DOM documents, real Options transport, and emitted runtime listeners provide behavioral evidence. |
| Keep recovery simple and avoid unpublished compatibility machinery. | COMPLIANT | Exactly two strict V4 snapshots, one queued writer, and explicit reset; no legacy alias, migration framework, or third backup. |
| Preserve local-only privacy and existing extension permissions. | COMPLIANT | Settings use only `storage.local`; no account synchronization, network operation, or additional permission. |
| Preserve Chrome, Edge, Firefox, CSP, packaging, and prior functionality. | COMPLIANT | All six development/release artifacts and inherited suites pass; emitted JavaScript executes with string/wasm code generation disabled. |
| Do not use browsers, Git, Corepack, or external-utility assertions. | COMPLIANT | Validation used direct pnpm, local test runtimes, jsdom, and CSP-constrained VM execution only. |

## Issues Found

None.

## Recommendations

- Proceed to the next issue; recovery-only reset scope and strict V4 publication policy match the approved plan.
