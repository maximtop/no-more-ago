# Issue Validation Report: [no-more-ago] Collect bounded opt-in debug logs

- **Validated**: 2026-08-25
- **Model**: Codex GPT-5.6 independent verifier
- **Issue**: `.sdd/.current/issues/11-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/11-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 7 | 0 | 0 | 7 |
| Acceptance Criteria | 6 | 0 | 0 | 6 |
| Entities | 2 | 0 | 0 | 2 |
| Contracts | 8 | 0 | 0 | 8 |
| Guidelines | 4 | 0 | 0 | 4 |

**Overall Status**: COMPLETE

Independent verification passed **14 files / 431 tests** using `pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/diagnostics/events.test.ts tests/diagnostics/journal.test.ts tests/runtime/messages.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/content/main.test.ts tests/content/runtime.test.ts tests/core/document-transformation-controller.test.ts tests/integration/document-ownership.test.ts tests/integration/process-document.test.ts tests/integration/presentation-updates.test.ts tests/options/app.test.tsx`. The orchestrator independently passed **7 files / 364 targeted tests**. Final login-shell `pnpm check` passed lint, type checking, and **28 files / 695 tests**; all-target `pnpm dev`, all-target `pnpm release`, and final `pnpm lint` passed.

## Task Status

- [x] **Task 1**: Advance the atomic settings pair to strict default-off V5 — PASS. Exact six own fields, V4 rejection, atomic pairs, preserved global/site/display policies, concurrency, recovery, failures, and default-off reset pass.
- [x] **Task 2**: Define a strict privacy-preserving diagnostic event contract — PASS. Trusted context, exact event/policy/acknowledgement envelopes, hostile fields, stack scrubbing, finite environment values, and spoof rejection pass.
- [x] **Task 3**: Build an isolated, serialized, exactly bounded local journal — PASS. Separate local key, zero disabled work, exact 5,000,000-byte envelope, oldest-first eviction, oversize discard, ordering, deletion races, and failure isolation pass.
- [x] **Task 4**: Wire trusted background toggles and document activity — PASS. Real events, policy broadcasts, acknowledgements, single listeners/observers, trusted manifest/browser metadata, incognito, failure isolation, ordered disable, and active-document reset pass.
- [x] **Task 5**: Expose one accessible English Debug logs opt-in switch — PASS. Default-off hydration, single-dispatch toggles, persistence, failures, interrupted responses, duplicate-click prevention, and recovery pass.
- [x] **Task 6**: Prove privacy and non-interference through actual GitHub documents — PASS. Two actual documents verify trusted metadata, privacy, incognito, failures, custom-active reset to System output, one listener, and zero post-reset callbacks/writes.
- [x] **Task 7**: Validate strict V5 diagnostics in all six emitted browser artifacts — PASS. Chrome, Edge, and Firefox dev/release bundles enforce CSP, trusted browser/version fields, privacy, live policy, and custom-active reset without stale diagnostics.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Fresh install or reset keeps logging off and creates no persistent entry. | MET | Strict V5 defaults; opted-in active reset rehydrates both documents with revision zero, stops sinks, restores System dates, and creates no further entries. |
| 2 | Enabled logging records useful lifecycle, counts, durations, reasons, environment, and sanitized errors. | MET | Actual background/document events include trusted manifest extension version and finite Chromium/Firefox browser family plus safe technical metrics; spoofed page metadata is discarded. |
| 3 | Persisted events contain no full URL, query/hash, DOM, visible text, secrets, or source datetime. | MET | Sanitizer, hostile-input, connected-document, and all-six emitted tests inspect durable records and reject forbidden/inherited fields. |
| 4 | Permitted private events follow the same local sanitized policy. | MET | Trusted `incognito: true` sender events pass through actual background, both documents, and generated runtimes without URL/page leakage. |
| 5 | The complete journal never exceeds 5 MB. | MET | Exactly 5,000,000 UTF-8 bytes including the JSON envelope; oldest-first eviction and oversized-event rejection are covered. |
| 6 | Disabling deletes logs, prevents resurrection, and storage failure never stops dates. | MET | Existing-document stop-before-delete, queued disable races, no late writes, and continued semantic date replacement under storage failure pass. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Settings snapshot V5 | Six exact fields; strict default-false debug flag | Sole serialized writer; atomic current/previous pair | Existing whole-state, backup, fail-closed, reset, and policy checks pass | PASS |
| Diagnostic event and journal | Safe technical context plus trusted extension version/browser family | Separate background-owned local journal; optional shared processing hooks | Sanitization, spoof rejection, exact cap, eviction, deletion, and failures pass | PASS |

## Contract Status

| Contract | Method | Status | Notes |
| --- | --- | --- | --- |
| Strict V5 settings | Atomic `setDebugEnabled` and parser | PASS | Prior global/site/custom/recovery semantics preserved. |
| Diagnostic journal | Serialized append and delete | PASS | Exact bounded, isolated local persistence. |
| Options transport | Strict debug read/toggle envelopes | PASS | Authoritative single dispatch and actionable errors. |
| Document hydration | Existing Display state plus revision/debug flag | PASS | Initial and revision-zero reset hydration verified. |
| Document policy updates | Revisioned update/acknowledgement | PASS | Both top-frame documents updated; stale messages rejected. |
| Document events/disable | Trusted sender gate, stop, delete | PASS | Privacy, trusted metadata, incognito, and no resurrection verified. |
| Processing hooks | Existing scheduler/candidate optional sink | PASS | Genuine metrics, one observer, zero disabled payload creation. |
| Existing reset | Defaults, delete, active-document restart | PASS | Both active documents regain System dates, one listener, and zero post-reset events. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Observable public/runtime behavior | COMPLIANT | Service, message, Options, two-document, and six emitted-runtime boundaries exercised. |
| Local and sanitized browsing data | COMPLIANT | No browser automation, network, sync, remote code, or page-data persistence. |
| Simple adapter-independent architecture | COMPLIANT | Existing shared controller/scheduler with one optional sink and one listener/observer. |
| Non-destructive issue verification | COMPLIANT | Implementation, tests, and approved plan were not modified. |

## Issues Found

None. Both attempt-1 findings are repaired:

1. Successful reset now tears down formerly active documents before clearing diagnostics and reactivating revision-zero System presentation. Independent emitted-content probe: `{"reads":2,"listeners":1,"reportsBeforeReset":2,"reportsAfterReset":2,"reportsAfterResetDelta":0,"outputTexts":["Aug 23, 2026, 1:15 PM","Aug 24, 2026, 1:15 PM"]}`. Durable two-document and all-six emitted tests assert the same behavior.
2. Production background reads its own manifest version and safely classifies its own user agent; trusted fields overwrite page-supplied version/family while untrusted adapter version is removed. Actual background/document journal entries and all six emitted artifacts assert the real browser/extension context.

## Recommendations

- No further changes required; preserve the strict V5, privacy, bounded-storage, trusted-environment, and active-document reset regressions in subsequent diagnostics issues.
