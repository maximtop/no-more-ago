# Issue Validation Report: [no-more-ago] Reset all extension state

- **Validated**: 2026-08-25
- **Model**: Codex GPT-5.6 independent verifier
- **Issue**: `.sdd/.current/issues/13-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/13-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 5 | 0 | 0 | 5 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 2 | 0 | 0 | 2 |
| Contracts | 6 | 0 | 0 | 6 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

One healthy/recovery action commits the exact default V5 current/backup pair, removes managed hosts, disables/deletes diagnostics after commit, reactivates existing documents with System presentation, refreshes projections, and preserves healthy/recovery persistence failures. Independent attempt-2 verification passed **7 focused files / 351 tests**; the orchestrator independently passed `zsh -lic 'pnpm check'`, including ESLint, strict TypeScript checking, and **30 files / 787 tests** across all six actual emitted browser artifacts. The prior committed-but-interrupted finding is fixed: healthy ambiguous outcomes now say only `Could not confirm whether settings were reset. Reopen Settings to check their current state.`, explicitly assert neither old settings remain active nor processing is disabled, and preserve exact typed rejected-save and recovery wording across all six emitted browser artifacts.

## Task Status

- [x] **Task 1: Lock down complete atomic defaults and safe background ordering** - PASS: one atomic V5 current/backup write, post-commit journal deletion, enabled policy, retained-site removal, typed ready/unavailable failures, and rejected-write preservation are exercised at public Settings Service/background boundaries.
- [x] **Task 2: Make one reset action visible and effective in healthy and recovery Options** - PASS: one shared accessible button accepts both states, commits immediately without confirmation, suppresses duplicate mutations, restores System drafts/default-off Diagnostics, and consumes authoritative revision zero.
- [x] **Task 3: Preserve truthful healthy/recovery failures and fresh popup consistency** - PASS: typed healthy save failure truthfully preserves current settings; healthy interrupted outcomes report only uncertainty without retry; recovery retains its processing-disabled wording; fresh popup reads observe revision-zero active defaults.
- [x] **Task 4: Prove immediate System presentation in both real GitHub documents** - PASS: global- and site-disabled real documents reactivate immediately, existing/future timestamps use System presentation, managed hosts disappear, debug/logs are cleared, and rejected persistence preserves previous document/settings/journal state.
- [x] **Task 5: Validate one real Options click across all six emitted browser artifacts** - PASS: the actual emitted matrix covers healthy/recovery actions, strict defaults, open documents, rejected writes, and a real committed-but-interrupted reset; it now requires the exact uncertainty-only notice and explicitly rejects both unsupported active/disabled claims.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | One action restores every documented default and deletes diagnostics without confirmation. | MET | Settings Service/background/Options tests prove the exact strict V5 default pair, debug off, post-commit-only journal deletion, one mutation, and no confirmation. |
| 2 | Global- or GitHub-disabled existing tabs are registered and processed immediately after reset. | MET | `tests/background/application.test.ts` and `tests/integration/presentation-updates.test.ts` cover both policies and two already-open documents. |
| 3 | System format and System time zone apply to existing and future owned dates. | MET | Live connected-document tests verify actual existing and subsequently inserted localized System output after reset. |
| 4 | Dual-corruption recovery creates valid defaults and resumes normal activation. | MET | Settings/background/integration/Options recovery tests replace both invalid documents atomically and reactivate both real documents. |
| 5 | Explicit managed site rows disappear and only built-in adapter hosts remain. | MET | Healthy Settings Service/Options/background/integration cases remove retained enabled/disabled no-adapter preferences and retain only adapter-derived `github.com`. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Complete default settings pair | Exact strict V5 defaults under current and previous keys | Existing Settings Service -> background -> Sites/Display/Debug/popup/documents | Atomic success, rejected-write preservation, recovery, empty preferences, enabled policy, System display, and debug-off pass | PASS |
| Single reset action and outcome | Existing exact request and typed/ambiguous outcomes | One Options click -> guarded client -> serialized background reset -> projections | Exactly one healthy/recovery action, success, truthful typed rejection, uncertainty-only committed/interrupted outcome, recovery failure, and no replay pass | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| Persistence | PASS | One existing atomic default current/backup pair; diagnostics cleared only after successful commit. |
| Runtime | PASS | Existing exact reset listener/typed guards, registration reconciliation, active-document sweep, and one response are reused. |
| Projection synchronization | PASS | Sites, Display, Debug, and fresh popup observe revision-zero authoritative defaults; Display/Debug rereads occur once. |
| Healthy UI | PASS | Healthy typed save failure says current settings remain active; interrupted/malformed outcomes state only uncertainty and preserve controls without retry. |
| Failure ordering | PASS | The actual six-artifact committed-before-response-loss scenario proves one committed default pair, deleted diagnostics, active System dates, and the exact truthful uncertainty-only notice. |
| Scope | PASS | No new service, permission, schema, background route, confirmation, network, browser workflow, or mutation retry. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Test observable public/runtime behavior | COMPLIANT | Reviewed public Settings Service, message, UI, live-document, and actual emitted-artifact behavior; no source-text assertion was added. |
| Use login-shell Node 24 and direct pnpm | COMPLIANT | Node `v24.18.1` and direct pnpm `10.34.5`; Corepack was not used. |
| Avoid Git, browser automation, network, and external process tools | COMPLIANT | Only local source inspection and focused in-process Vitest suites were used. |
| Avoid conflicting emitted builds | COMPLIANT | Six-artifact behavior was independently inspected while the orchestrator ran the full gate; no simultaneous emitted build was started. |
| Keep verification scoped and non-destructive | COMPLIANT | No implementation, package, test, approved plan, or concurrent Issue 14 helper was modified; only this report and validated issue status were updated. |

## Verification Evidence

- Independent focused gate: `zsh -lic 'node --version && pnpm --version && pnpm exec vitest run tests/settings/settings-service.test.ts tests/background/application.test.ts tests/background/messages.test.ts tests/options/app.test.tsx tests/popup/app.test.tsx tests/integration/presentation-updates.test.ts tests/diagnostics/journal.test.ts'` passed **7 files / 351 tests**.
- `tests/settings/settings-service.test.ts` verifies complete default-pair writes, rejected healthy/recovery persistence, and serialization; `tests/background/application.test.ts` verifies policy activation, diagnostics cleanup, and non-destructive failures.
- `tests/integration/presentation-updates.test.ts` exercises two global-/site-disabled live GitHub documents, real System rendering, post-reset future timestamps, dual corruption, managed-host cleanup, and rejected healthy writes.
- `tests/popup/app.test.tsx` mounts a fresh popup and observes authoritative enabled/active revision-zero defaults.
- `tests/options/app.test.tsx:128` preserves `current settings remain active` exclusively for explicitly rejected healthy `save-failed`; the interrupted healthy scenario at line 154 requires the exact uncertainty-only message and forbids both `current settings remain active` and `Processing remains disabled`.
- `tests/build/chrome-artifact.test.ts:926` seeds a managed hostname and interrupts a real committed reset response across all six artifacts; the existing boundary proves exactly one additional atomic write, current/backup revision-zero defaults, deleted journal, continued System-formatted live output, and the exact uncertainty-only notice while rejecting both false active/disabled claims.
- Recovery Options still display `Processing remains disabled` exclusively for unavailable reset failures; healthy typed rejections preserve the current/backup pair, diagnostics, custom draft, active documents, and truthful active-settings notice.
- Independent root complete gate: `zsh -lic 'pnpm check'` passed ESLint, strict `tsc`, and **30 files / 787 tests** in **38.01 seconds**, including all six actual emitted Chrome/Edge/Firefox development/release bundles; this independent validation avoided a competing emitted rebuild.
- Concurrent Issue 14's isolated reporter/helper tests are outside this issue's scope and are not treated as regressions.

## Issues Found

None — every approved task, acceptance criterion, entity, contract, and applicable guideline passes.

## Prior Validation Attempt History

1. **Attempt 1: a committed-but-interrupted healthy reset falsely claimed prior settings remained active — resolved.** The actual six-artifact case had already committed both revision-zero settings snapshots when the lost response produced `Your current settings remain active`. Attempt 2 instead requires exactly `Could not confirm whether settings were reset. Reopen Settings to check their current state.`, explicitly rejects claims that old settings remain active or processing is disabled, and verifies one committed atomic write, deleted diagnostics, continued System-formatted active documents, and no mutation retry. The truthful current-settings-remain-active message remains exclusive to confirmed rejected healthy `save-failed`; unavailable recovery wording remains unchanged.

## Recommendations

- None. Issue `13-AFK` satisfies its approved reset plan and acceptance criteria and may proceed to the next Oneshot workflow stage.
