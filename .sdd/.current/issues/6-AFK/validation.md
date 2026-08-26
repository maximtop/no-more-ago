# Issue Validation Report: [no-more-ago] Toggle global activation from the popup

- **Validated**: 2026-08-25
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Issue**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/6-AFK/issue.md`
- **Plan**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/6-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 9 | 0 | 0 | 9 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 4 | 0 | 0 | 4 |
| Contracts | 5 | 0 | 0 | 5 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

All nine approved tasks, five acceptance criteria, four entities, five internal contracts, and applicable guidelines pass. Every durable behavioral regression missing in validation attempt 1 now exists in a maintained repository test and passes: delayed off/on convergence across multiple matching tabs with a failing sibling and mutable phases; matching-sibling failure isolation; visible related-failure recovery at the same revision; deferred emitted get/set message delivery with exactly one response each; and popup TSX, CSS, and HTML watch generations with exact unpacked/ZIP parity. Full quality gates, all six fresh browser/mode artifacts, independent CSP-constrained popup boots, and predecessor guarantees also pass.

## Task Status

- [x] **Task 1: Specify settings and concurrent full-transaction behavior** - PASS: `tests/background/application.test.ts:73` runs the real coordinator against matching tabs `7` and `8`, a rejected initial sibling injection, a filtered `gist.github.com` tab, mutable active/stopped phases, and deferred revision-1 reconciliation. It verifies sibling success despite failure, no early revision-2 reconcile, final persisted enabled revision `2`, exact registration, both matching tabs `active`, accepted revisions `1`/`2`, and both authoritative response models at revision `2`. V1 defaults, exact validation, no-op writes, and persistence failures also pass.
- [x] **Task 2: Implement V1 persistence and the revisioned control queue** - PASS: exact whole-object V1 validation, safe nonnegative revisions, missing-only defaults, local background-owned writes, persist-before-publish, typed save failure, transaction serialization, accepted revisions, and latest-state response barriers pass source and emitted-runtime checks.
- [x] **Task 3: Specify activation modes, exact frame, and attributed failures** - PASS: `tests/runtime/adapter-activation.test.ts:94` supplies two genuinely matching synthetic tabs plus nonmatching/malformed returned URLs, rejects tab `3` injection, proves tab `4` independently completes, verifies both exact top-frame executions and both frame-zero teardowns, and clears failures on later recovery. Registration get/register/update/unregister, matching-query, status, teardown, all activation modes, and generic adapter selection pass.
- [x] **Task 4: Implement mode-aware activation and top-frame messaging** - PASS: exact persistent registration comparison, generic synthetic adapter selection, cold-worker no-op, startup/install sweep, immediate enable injection, disable/fail-closed cleanup, exact URL re-selection, `{ allFrames: false }`, and `{ frameId: 0 }` pass.
- [x] **Task 5: Specify the single-flight MV3 and failed-closed state machine** - PASS: `tests/background/application.test.ts:241` first observes the selected GitHub tab as `runtime-failed` / `current-tab-inject`, then removes that actual related failure and repeats unchanged enabled policy. The response becomes `active` at unchanged revision `0`, performs no persistence write, and records a successful same-revision reconciliation. Deferred initialization, startup/install coalescing, persistent cold restarts, invalid-storage cleanup, failure precedence, and lifecycle retry remain covered.
- [x] **Task 6: Implement lifecycle gating, fail-closed cleanup, and truthful status** - PASS: one readiness flight, lifecycle coalescing, exact document status phases, persistent registration cleanup, unavailable/unknown states, current-tab precedence, frame-zero responses, and single-response emitted message wiring pass independent probes.
- [x] **Task 7: Implement popup behavior for revision, save failure, and response loss** - PASS: the English hostname/global switch, active/off/restricted/runtime/no-rules/unavailable states, typed save-error notice, lower-revision rejection, successful ambiguous reread, and disabled native-indeterminate/ARIA-mixed unknown state pass rendered-DOM tests.
- [x] **Task 8: Emit and behaviorally validate a CSP-safe popup** - PASS: `tests/build/chrome-artifact.test.ts:85` actually fires early emitted `get-popup-state` and `set-global-enabled` messages while storage initialization is deferred and startup/install events are coalesced, then asserts one deferred load, exactly one response per request, revision `3`, disabled status, unregister, and teardown for all six browser/mode bundles. `tests/build/watch.test.ts:72` mutates maintained popup TSX, CSS, and HTML inputs, waits for strictly later successful generations, verifies the corresponding emitted marker, and validates exact unpacked/ZIP bytes for each generation. Six real CSP-constrained popup boots and six semantic artifact-pair checks pass independently.
- [x] **Task 9: Run full local gates and preserve HITL scope** - PASS: login-shell Node 24/direct pnpm, focused tests, full lint/typecheck/test gate, all-target development/release builds, six artifact semantic/parity checks, and standalone lint pass without a browser, network, Git, Corepack, or external process-tree utility.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A fresh GitHub popup shows the enabled global switch, exact hostname, `Active on github.com`, and no replacement counter. | MET | `tests/background/application.test.ts` and `tests/popup/app.test.tsx` pass; all six emitted popup bundles render the switch, hostname, and exact active wording in a CSP-constrained VM. |
| 2 | Committed disable removes future registration and immediately restores every reachable active GitHub tab. | MET | Maintained real-coordinator tests disable both matching tabs, exclude nonmatching returned URLs, unregister the persistent script, send status/teardown only to frame `0`, and exercise predecessor DOM restoration. Emitted get/set tests assert unregister plus teardown in all six browser/mode bundles. |
| 3 | Re-enabling restores early registration and immediately injects already-open GitHub tabs without reload. | MET | The maintained deferred two-tab off/on regression finishes with persisted enabled revision `2`, exact registration, both tab phases `active`, eligible-tab injections, rejected nonmatching tab `9`, accepted revisions `1`/`2`, and both response models at the final authoritative revision. |
| 4 | Restricted pages and relevant runtime failures show the appropriate popup status without injecting page UI. | MET | The status-precedence matrix and rendered popup assert `Cannot run on this page` and `Could not process this page`; predecessor content ownership/no-page-UI tests remain green. |
| 5 | A rejected persistence write shows a save error and preserves prior settings/runtime behavior. | MET | Settings/background tests prove unchanged prior snapshot, no coordinator call, and typed `save-failed`; the rendered popup retains the authoritative setting and displays `Could not save this change. Try again.` |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Settings Snapshot V1 | Exact `schemaVersion`, safe nonnegative `revision`, and boolean `globalEnabled` | Background Settings Service owns the sole local persistence path | Missing-only default, whole-object rejection, unchanged no-write, revision increment, read failure, and persist-before-publish pass | PASS |
| Background Control State | Phase, single readiness flight, lifecycle set, transaction tail, snapshot, and reconcile result | Shared by startup/install/messages/settings commands | Deferred cold/startup/install/early-message single flight, fail-closed cleanup, command barriers, and revision gating pass | PASS |
| Activation Reconcile Result | Revision/mode/policy, scoped failures, registration results, and tab action records | Published after the serialized coordinator transaction and consumed by popup derivation | Registration/query/tab attribution, exact top-frame actions, real matching-sibling continuation, and maintained current-failure recovery pass | PASS |
| Popup Model | Availability, revision, boolean/null policy, hostname, status, and typed failure | Authoritative background model reaches the revision-gated popup transport/UI | Visible statuses, lower-revision rejection, typed save failure, ambiguous reread, and mixed unavailable state pass | PASS |

## Contract Status

| Endpoint | Method | Status | Notes |
| --- | --- | --- | --- |
| `SettingsService.load` / `setGlobalEnabled` | Internal async service | PASS | Exact V1 validation, missing default, typed read/write failures, unchanged-write suppression, and committed revision semantics pass. |
| `ScriptingRuntime` / `TabsRuntime` | Browser API adapters | PASS | Persistent registration diff/unregister, top-level injection, exact GitHub URL filtering, and `sendMessage(..., { frameId: 0 })` pass source and emitted bundles. |
| `AdapterActivationCoordinator.reconcile` | Internal async coordinator | PASS | Enabled/disabled/cold/sweep/failed-closed modes, sanitized registration/query/tab failures, actual matching-sibling isolation, and mutable multi-tab convergence pass maintained behavioral tests. |
| Popup state / set-enabled messages and responses | `chrome.runtime.onMessage` | PASS | Strict request guards, revisioned authoritative responses, typed save failures, ambiguous transport handling, deferred emitted early-message readiness, and exactly one response per fired get/set pass. |
| Document status / teardown messages | Top-frame content runtime | PASS | Exact request/response guards, waiting/active/stopped/failed phases, singular listener/controller, frame-zero status, and idempotent teardown/reactivation pass. |

No issue-local OpenAPI, GraphQL, remote API, or `contracts/` directory exists; these are the approved internal contracts.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Validate observable behavior at public/runtime boundaries | COMPLIANT | Maintained regression tests exercise mutable runtime phases, public WebExtension message callbacks, rendered DOM, public build/watch commands, emitted popup artifacts, and exact ZIP bytes; they do not assert implementation-source text. |
| Use login-shell Node 24 and direct pnpm | COMPLIANT | Node `v24.18.1` and direct pnpm `10.34.5`; Corepack was not invoked. |
| Respect browser/network/Git/process-utility boundaries | COMPLIANT | No browser automation, website UI, network request, Git operation, external process-tree utility, or external utility provenance test was used. |
| Keep issue validation non-destructive | COMPLIANT | Only this validation report and the authorized issue-status transition were changed; no implementation, checked-in test, plan, review, configuration, or package was edited. Watch mutations occurred only in isolated helper-managed workspaces. |
| Preserve validated predecessor behavior and defer live-browser HITL work | COMPLIANT | Both blockers remain `Validated`; the complete 290-test suite includes Issue 2 ownership/teardown and Issue 5 build/watch guarantees. Real-browser verification remains `16-HITL`. |

## Verification Evidence

- Preconditions: Issue `6-AFK` started `Implemented`; approved plan remained `Approved`; predecessor issues `2-AFK` and `5-AFK` remained `Validated`; the previous report was validation attempt `1`; no issue-local contracts directory exists.
- Toolchain: login-shell Node `v24.18.1` resolved through the user's `fnm` Node 24 prefix; direct pnpm `10.34.5` resolved to `/Users/maximtop/Library/pnpm/pnpm`.
- Focused control gate: `zsh -lic 'pnpm exec vitest run tests/settings/settings-service.test.ts tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/background/application.test.ts tests/popup/app.test.tsx'` passed **8 files / 69 tests**.
- Focused artifact/watch gate: `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/commands.test.ts tests/build/watch.test.ts'` passed **3 files / 62 tests**, including maintained popup-input watch generations, emitted deferred message callbacks, CSP popup boots, public command matrices, safe publication, ZIP parity, and predecessor watch lifecycle guarantees.
- Full gate: `zsh -lic 'pnpm check'` passed ESLint, strict TypeScript checking, and **20 files / 290 tests**. A pre-existing non-failing jsdom `Not implemented: navigation to another Document` diagnostic appeared; the command exited successfully.
- Build gate: `zsh -lic 'pnpm dev && pnpm release'` built Chrome, Firefox, and Edge in both modes successfully.
- Actual artifact validation: all six freshly built `dist/{dev,release}/{chrome,firefox,edge}` unpacked/ZIP pairs independently passed `createArtifactServices().validatePair`; every manifest had version `0.1.0`, `action.default_popup = popup.html`, exactly `scripting`/`storage` API permissions, and `<all_urls>` host permission. Each dev pair contained **14 files**; each release pair contained **10 files**; full archive inventories and bytes exactly matched unpacked artifacts.
- Independent actual-popup/CSP boundary: each of those six real emitted popup HTML/JS/CSS artifacts was parsed for extension-local external resources and no inline executable markup, then booted in an isolated jsdom/VM context with both string and WebAssembly code generation disabled. All six rendered `github.com`, `Active on github.com`, and the global switch; an attempted VM `eval` was rejected.
- Durable prior-finding closure: `tests/background/application.test.ts:73` proves delayed mutable multi-tab convergence, one actual sibling failure, filtered nonmatching tabs, exact registration, and both latest-state response barriers; `tests/runtime/adapter-activation.test.ts:94` proves an actual matching sibling succeeds after another matching tab fails; `tests/background/application.test.ts:241` proves selected-tab `runtime-failed -> active` recovery at the same revision without a write; `tests/build/chrome-artifact.test.ts:85` fires deferred emitted get/set callbacks and asserts `{ get: 1, set: 1 }`; `tests/build/watch.test.ts:72` mutates popup TSX/CSS/HTML and checks later generations plus exact artifact/ZIP parity.
- Final standalone gate: `zsh -lic 'pnpm lint'` passed.

## Issues Found

None. All validation-attempt-1 findings are closed by maintained behavioral regressions and independently passing verification gates; no new issue-scoped finding was identified.

## Recommendations

- Set issue `6-AFK` to `Validated` and leave its implementation plan `Approved`.
- Preserve the maintained concurrency, matching-sibling, same-revision recovery, emitted-message, and popup watch regressions in future changes.
- Keep real-browser/live-GitHub verification deferred to the separately permissioned `16-HITL` issue.
