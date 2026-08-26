# Issue Validation Report: [no-more-ago] Process dynamic GitHub updates incrementally

- **Validated**: 2026-08-24
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Issue**: `.sdd/.current/issues/4-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/4-AFK/plan.md`
- **Validation attempt**: 1

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 6 | 0 | 0 | 6 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 5 | 0 | 0 | 5 |
| Contracts | 4 | 0 | 0 | 4 |
| Guidelines | 6 | 0 | 0 | 6 |

**Overall Status**: COMPLETE

The post-cap gaps are closed with permanent public regressions and independent runtime evidence. A non-`Document` scoped restore now handles a disconnected source scope whose exact output remains connected elsewhere, emits provenance synchronously while exact identity, record, and markers remain valid, removes/restores only that pair, and preserves an unrelated pair. Altered, forged, and cross-pair output evidence produces zero provenance callbacks and is not adopted or removed. Dynamic reconciliation coalesces repeated changes of an already-owned source to one visit and its final `datetime` while preserving output identity/token. Combined-batch instrumentation records only delivered element regions and affected candidates, with zero outside-source visits and zero document rescans.

## Task Status

- [x] **Task 1: Extend exact ownership lookup and scoped restoration** - PASS: `src/core/render-exact-time.ts` keeps the renderer registry as the only pair authority and implements exact output lookup, single-source restore, source-scoped restore, and pre-removal provenance. Permanent public regressions at `tests/core/render-exact-time.test.ts:253` and `:295` cover the post-cap connected-output/sink-ordering case and altered/forged/cross-pair negatives. An independent Node 24/jsdom source probe reproduced both cases: the valid scoped restore emitted one callback before release and preserved the unrelated pair; the hostile matrix emitted zero callbacks and preserved all three hostile outputs.
- [x] **Task 2: Add a type-safe bounded reconcile boundary** - PASS: `ProcessInput.root` and the controller constructor remain `Document`-specific, while `ReconcileInput.root` is `ParentNode`. GitHub discovery includes an eligible element root once, and bounded valid update plus missing/zone-less invalidation tests pass without disturbing an unrelated owned pair.
- [x] **Task 3: Implement one coalescing scheduler with displacement and provenance handling** - PASS: `DocumentMutationScheduler` owns one observer per lifecycle with the exact `childList`/`subtree`/`datetime` options; normalizes additions, removals, targets, and displaced outputs; suppresses renderer-originated removal delivery by identity/generation; ignores stopped/stale callbacks; and has no polling or element observer. Scheduler public tests pass displacement, final-adjacent, forged-marker, raw-suppressed-delivery, nonrecursive invalidation, stop/restart, and idle matrices.
- [x] **Task 4: Integrate ordered dynamic reconciliation and transactional controller start** - PASS: the controller restores disconnected removals before bounded added, changed, and displaced work; repairs the immutable output/token; and disconnects before rollback/teardown restoration. Public tests pass moves, true removals/reinsertion, altered `datetime`, output displacement, forged output, combined ordering, no recursive invalidation, observer-setup rollback, partial-pass rollback, and retry. The emitted-runtime probe recorded roots `region`, `added-root`, visits `moved`, `added`, zero document/outside visits, final third `datetime`, same output/token, and complete removed ownership cleanup.
- [x] **Task 5: Make content-runtime start failures stopped and explicitly retryable** - PASS: loading and ready failures invalidate readiness, remove pending callbacks, tear down partial work, transition to stopped, rethrow the original error, and later reuse one slot/handle/listener. Source and production-entrypoint tests cover stale callback rejection, fresh loading generation, ready retry, partial cleanup, later dynamic processing, and singular listener behavior. The emitted runtime retained one listener across teardown/reactivation and created only one active observer in each lifecycle.
- [x] **Task 6: Prove offline dynamic regression and run direct-pnpm gates** - PASS: the offline GitHub eligibility matrix passes dynamic add, final update, immutable-output repair, removal, and zero-orphan cleanup. Under Node v24.18.1 and direct pnpm 10.34.5, the focused 9-file/87-test gate and complete lint, typecheck, 14-file/173-test, Chrome build, and post-build lint gate all pass.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | An eligible element added after initial load receives exactly one replacement without a whole-document rescan. | MET | Bounded-addition/coalescing tests pass. `tests/core/document-transformation-controller.test.ts:301` records one wrapper discovery and one visit per contained candidate. The emitted-runtime probe recorded only `region` and `added-root`, created one output for the added candidate, and observed zero document rescans. |
| 2 | An owned source's changed `datetime` updates its exact output in place. | MET | The permanent controller regression at `tests/core/document-transformation-controller.test.ts:301` applies three changes in one delivery, records exactly one visit, and asserts the same output/token with the third value and exact formatted text. The emitted artifact independently produced the same identity/token and final `2026-08-26T10:15:00Z`. |
| 3 | A removed or replaced processed subtree leaves no orphan output or per-element observer. | MET | Controller move/removal/reinsertion and fixture-matrix lifecycle tests pass; retained references lose both markers and disconnected output. The emitted probe cleaned the removed source/output exactly and observed one active document observer, never an element observer. |
| 4 | Unrelated and extension-owned mutations cause no recursion or global reformat. | MET | Scheduler tests ignore text/unrelated attributes and owned-output targets, consume renderer removal delivery without a public batch, and reject forged authority. The invalidation test at `tests/core/document-transformation-controller.test.ts:393` records one visit after all deliveries. The emitted probe observed two raw deliveries but only the two intended bounded discoveries, with zero outside visits or document scans. |
| 5 | An idle active document performs no polling/refresh and owns at most one document observer. | MET | The public fake-timer idle test observes no batch after 60 seconds; duplicate start constructs one observer and stop/restart generations are isolated. Emitted-runtime instrumentation observed zero timeout/interval/animation-frame scheduling and a maximum of one active observer across teardown/reactivation. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Affected Mutation Batch | Added roots, final `datetime` targets, removed roots, displaced sources | Produced once per nonempty native delivery and consumed by the controller | Identity deduplication, containment collapse, coverage filtering, stable bounded roots, and no document fallback pass | PASS |
| Document Mutation Scheduler | Document, observer, generation, callback, output resolver, ephemeral suppression, phase | Controller-owned; structurally implements the output-removal sink without pair ownership | Single observer, exact options, idempotent lifecycle, stale callback/suppression rejection, no timers or selector knowledge pass | PASS |
| Owned Pair Record | Exact source/output, token, original hidden state | Remains solely in the renderer registry and supports update, repair, lookup, scoped restore, and teardown | Exact identity/marker checks, connected-output provenance order, hostile evidence, immutable repair, and independent per-side restoration pass | PASS |
| Bounded Reconcile Input | URL, `ParentNode` root, locales, registry, optional sink | Reuses the adapter/resolver/formatter/renderer pipeline only for delivered regions | Element-inclusive discovery, same-pair update, exact invalidation, unrelated-pair preservation, and strict typecheck pass | PASS |
| Content Runtime Slot | Controller, handle, document, messages, phase, generation, pending callback | One document slot and listener own a retryable controller lifecycle | Loading/ready failures, stale readiness, one slot/listener, explicit retry, dynamic work, and teardown pass | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| `ProcessInput` / `processDocument` / `DocumentTransformationController` | PASS | Document-specific public types remain unchanged and strict typecheck passes; initial activation, duplicate start, transactional failure, retry, and teardown are verified. |
| `ReconcileInput` / `reconcileDocumentRegion` | PASS | Accepts bounded `ParentNode` roots, updates/restores the exact source only, forwards provenance, and never substitutes a document during mutation work. |
| Ownership lookup and restore APIs | PASS | Exact output-to-source lookup, single/root/full restore, sink ordering, disconnected scopes, retained references, and forged/altered/cross-pair controls pass. |
| `AffectedMutationBatch` / `DocumentMutationScheduler` | PASS | Public behavior proves normalized bounded batches, final-state displacement, generation-scoped suppression, idempotent observer lifecycle, and zero idle polling. |

No HTTP endpoint, browser-message shape, persistence schema, external API, OpenAPI, GraphQL, or issue contract directory is added by `4-AFK`.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Test observable behavior through public/runtime boundaries | COMPLIANT | Evidence comes from public Vitest boundaries, DOM identity/markers/text, controllable native observers, a source-module probe, and the emitted content runtime. No test reads implementation files as text. |
| Use direct pnpm under Node 24; do not invoke Corepack | COMPLIANT | Login-shell Node v24.18.1 resolved `/Users/maximtop/Library/pnpm/pnpm` v10.34.5; every project command used direct `pnpm`. |
| Do not use Git, browser automation, website UI, network, or live-site claims | COMPLIANT | Validation used local files, offline jsdom, local commands, and the generated artifact only. The manual live-site scenario remains with `16-HITL`. |
| Keep validation non-destructive | COMPLIANT | No implementation, test, fixture, plan, package, or configuration file changed. The combined `src/` and `tests/` SHA-256 digest remained `836c05aa8ca61744e0b2a11cfa71e47282dae49cb84fcf065d056260f6e0f4ab` before and after gates/probes. Only this report and the issue status were updated. |
| Preserve one observer/controller and renderer-only ownership | COMPLIANT | Runtime instrumentation observed a maximum of one active observer; scheduler state contains no source/token/hidden-state relationship; all hostile ownership probes fail closed. |
| Stay within the issue slice | COMPLIANT | No settings, diagnostics persistence, background fan-out, cross-browser release, live fixture refresh, second adapter, page UI, or numeric elapsed-time promise was introduced or claimed. |

## Verification Evidence

- Toolchain: Node `v24.18.1`; direct pnpm `10.34.5` at `/Users/maximtop/Library/pnpm/pnpm`.
- Focused issue gate: 9 files, 87 tests passed.
- Full gate: initial lint passed; strict typecheck passed; 14 files and 173 tests passed; `pnpm dev chrome` compiled successfully; post-build lint passed.
- Artifact checks: `background.js` and `content.js` pass `node --check`; the manifest is MV3, `No More Ago`, version `0.1.0`, with the expected `<all_urls>`, `scripting`, and `storage` values.
- Independent renderer probe: valid disconnected-scope/connected-output restoration emitted exactly one correctly ordered sink call, removed/restored only that pair, and preserved an unrelated pair; altered/forged/cross-pair evidence emitted zero calls and remained connected.
- Independent emitted-runtime probe: roots `[region, added-root]`; visits `[moved, added]`; zero document rescans; zero outside visits; same output/token at the final third `datetime`; precise removal cleanup; two observer constructions across two lifecycles but maximum one active; zero scheduled timers; one listener; complete teardown/reactivation restoration.
- Predecessor matrices remain green: strict timestamp acceptance/rejection, exact-host adapter selection, semantic/link/shadow ownership, hostile-marker fail-closed restoration, teardown-message guard, immediate/deferred content lifecycle, exact `document_start` registration, and Chrome artifact smoke are included in the 173-test pass.

## Issues Found

None.

## Recommendations

- No implementation changes are required for issue `4-AFK`.
- Keep the permissioned current-GitHub/manual navigation scenario with `16-HITL`; it is release confidence work, not an unmet criterion of this offline AFK slice.
