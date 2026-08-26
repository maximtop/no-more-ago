# Issue Validation Report: [no-more-ago] Own and restore timestamp DOM safely

- **Validated**: 2026-08-23
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Issue**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/2-AFK/issue.md`
- **Plan**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/2-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 7 | 0 | 0 | 7 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 4 | 0 | 0 | 4 |
| Contracts | 5 | 0 | 0 | 5 |
| Guidelines | 4 | 0 | 0 | 4 |

**Overall Status**: COMPLETE

The attempt-1 ownership-record defect is fixed. Independent isolated probes prove that a failed rerender after changing only one ownership marker retains the runtime record until teardown: a valid source is restored when only the output marker is changed, and a valid output is cleared and removed when only the source marker is changed. The full Node 24/Corepack/pnpm gate, all 28 repository tests, the Chrome development build, and direct runtime checks against the emitted `dist/chrome-dev/content.js` artifact pass.

## Task Status

- [x] **Task 1: Specify owned-pair repair and hostile-marker behavior** - PASS: focused source tests cover intact identity, duplicate render, same-identity detach/reparent repair, forged/orphan safety, and separate output-marker/source-marker mismatch teardown regressions.
- [x] **Task 2: Implement correlated ownership and precise restoration** - PASS: direct source-module probes confirm failed rerender is mutation-free and preserves the record for independent per-side teardown; same-identity repair plus retained-reference reattachment leaves no valid owned output or marker after teardown.
- [x] **Task 3: Preserve interaction/accessibility and add the controller** - PASS: integration and emitted-artifact probes preserve link click/Enter behavior, expose exactly one non-hidden semantic `time`, keep the original source in place, preserve foreign DOM and shadow identity, and support idempotent teardown/reactivation.
- [x] **Task 4: Define the browser-neutral teardown contract test-first** - PASS: the exact guard matrix passes, typecheck passes, and the shared message module has no DOM, Chrome, controller, or content dependency.
- [x] **Task 5: Specify immediate installation and deferred processing** - PASS: loading, ready, duplicate-install, teardown-before-ready, and explicit-reactivation tests pass.
- [x] **Task 6: Implement immediate content lifecycle and stale-start protection** - PASS: the source and emitted artifact install one listener immediately, defer only processing, stay stopped when a captured stale readiness callback is manually invoked after teardown, and reactivate singularly on explicit reinstall.
- [x] **Task 7: Run the full quality gate and prepare manual smoke** - PASS: the exact declared gate and Chrome development build pass; the emitted artifact passes local interaction/loading-race smoke. Browser UI automation was not used, as required by this validation task.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Eligible host remains intact and hidden with exactly one owned semantic `time` sibling carrying authoritative `datetime` | MET | Renderer and pipeline tests pass. The emitted bundle produced one adjacent `time`, retained the live source, and preserved the authoritative `datetime`. |
| 2 | Repeated activation creates no duplicate output, observer, or marker | MET | Renderer/controller/content tests pass. Evaluating the emitted bundle repeatedly retained one listener, one output identity/token, one source marker, and constructed zero observers. |
| 3 | Pointer/keyboard interaction remains correct and the exact date is represented once | MET | Integration and emitted-artifact probes preserved bubbled click and Enter handlers and exposed exactly one visible semantic date inside the original link. |
| 4 | Teardown after foreign/nearby changes removes only No More Ago state | MET | Isolated per-side mismatch probes pass after failed rerender. Same-output reparent/repair/retained-reference teardown passes, while tampered sides and unrelated foreign DOM remain unchanged. |
| 5 | Shadow root is untouched and no page controls are injected | MET | Integration and emitted-artifact probes preserve the exact shadow child identity/markup and the pre-existing interactive-element set through transform and teardown. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Owned Pair Record | Exact source/output identity, token, and immutable original hidden state are present | Document-scoped registry drives render, repair, and restore | Isolated hostile-evidence probes retain the record until per-side teardown; same output identity survives repair and is removed after retained-reference reattachment | PASS |
| Document Transformation Controller | Immutable input, phase, and connected outputs behave as planned | Calls public process/restore boundaries | Idempotent start, double teardown, foreign preservation, and fresh reactivation pass | PASS |
| Content Runtime Slot | One controller/handle, phase, generation, and pending callback behave as planned | One document symbol slot and one message listener observed | Loading/ready/stopped/reactivation and manually invoked stale-callback checks pass | PASS |
| Teardown Document Message | Exact single `type` field | Shared runtime module consumed by content | Exact-object guard matrix passes and unrelated values are ignored | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| `renderExactTime` / `restoreExactTimes` | PASS | Creation, in-place update, same-identity repair, hostile-evidence safe no-op, independent per-side restoration, retained-reference cleanup, and foreign-marker preservation pass. |
| `processDocument(ProcessInput)` | PASS | Returns valid outputs, excludes renderer safe no-ops, and leaves non-GitHub markup unchanged. |
| `DocumentTransformationController` | PASS | Public start/teardown lifecycle is idempotent and supports a fresh lifecycle. |
| Teardown message constant/type/guard | PASS | Accepts only the exact one-field teardown object and remains browser-neutral. |
| `installContentRuntime` message/handle interfaces | PASS | Immediate singular listener, deferred start, stopped stale-callback protection, and explicit reactivation pass in source and emitted artifact. |

No external API, persistence, OpenAPI, GraphQL, or storage contract exists, and the approved plan intentionally defines no `contracts/` directory.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Validate observable behavior | COMPLIANT | Verification used public commands, imported runtime boundaries, DOM identity/state, message behavior, and the emitted bundle; no check asserted implementation source text. |
| Non-destructive issue validation | COMPLIANT | No implementation or test file was edited. The combined SHA-256 digest for `src/` and `tests/` remained `6411180475171bfb8eab9a519257e48cd2ae056f2b084fb222388e5f701c58d6` before and after validation. |
| Browser permission boundary | COMPLIANT | No browser automation or website UI was used. The generated artifact was exercised locally under jsdom. |
| Prefer direct/simple data access | COMPLIANT | Local source, public CLI gates, direct DOM runtime probes, and generated artifacts supplied the evidence. |

## Verification Evidence

- Toolchain: Node `v24.18.1`, Corepack `0.35.0`, pnpm `10.34.5` from a login shell.
- Focused behavior gate: 7 files, 20 tests passed, covering renderer/pipeline ownership, controller, interaction/shadow behavior, message guard, and content lifecycle.
- Independent source-module probe: isolated output-marker mismatch, isolated source-marker mismatch, retained runtime record, per-side teardown, same-identity repair, retained-reference cleanup, and unrelated-DOM preservation all passed.
- Full declared gate `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint`: passed; 12 files, 28 tests passed.
- Chrome development artifact: `corepack pnpm dev chrome` compiled successfully; emitted manifest is MV3 version `0.1.0`, with `background.js` and `content.js` present.
- Emitted-artifact runtime probe: semantic transform, one accessible date, click/Enter interaction, duplicate evaluation, zero observers, shadow/foreign preservation, message teardown, loading teardown, manually invoked captured stale callback, and singular explicit reactivation all passed.
- Scope check found no observer, page-control creation, background sender/fan-out, tab injection, registration removal, or contracts directory in this issue slice.

## Issues Found

None.

## Recommendations

- The implementation is complete for issue `2-AFK`. The separately authorized manual Chrome smoke described in the plan may still be performed as release confidence work, but no unmet issue criterion remains.
