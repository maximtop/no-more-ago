# Issue Validation Report: [no-more-ago] Build Chrome, Firefox, and Edge targets

- **Validated**: 2026-08-24
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Issue**: `.sdd/.current/issues/5-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/5-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 7 | 0 | 0 | 7 |
| Acceptance Criteria | 6 | 0 | 0 | 6 |
| Entities | 5 | 0 | 0 | 5 |
| Contracts | 3 | 0 | 0 | 3 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

The attempt-1 watch race is resolved. `scripts/build/pipeline.mjs` completes snapshotting, packaging, whole-mode publication, and cleanup synchronously in the Rspack callback, then delivers success or failure status from a native Promise microtask. Rspack's queued `process.nextTick` watcher re-arm therefore runs before consumers can react to the status event and mutate a maintained input. The focused 3-file/60-test gate passed, and five consecutive ordinary `pnpm check` runs each passed all 16 files and 232 tests. Every full run exercised immediate post-initial-success mutations for the public Chrome, Firefox, and Edge rows plus the representative Chrome package/common/variant/four-icon/TypeScript matrix without losing an invalidation.

## Task Status

- [x] **Task 1: Lock request parsing and ordinary direct-pnpm tests** - PASS: the focused and repeated full suites passed the public rejection matrix with exit code 2, actionable usage, pre-validation no-mutation behavior, fixed literal target selection, and ordinary `pnpm` processes in isolated workspaces.
- [x] **Task 2: Emit browser-specific unpacked artifacts with same-compilation metadata** - PASS: Chrome, Firefox, and Edge artifacts passed manifest, package-version, background-form, bundle, source-map, PNG dimension, ZIP-parity, and fake-runtime no-navigation checks. Maintained package/common/variant/icon files are registered in `compilation.fileDependencies` and emitted in that compilation.
- [x] **Task 3: Add deterministic ZIPs and one safe mode-root swap** - PASS: focused and full tests passed sorted ZIP inventory and byte parity, time-zone identity, real symlink rejection, guarded sentinels, selected-pair preservation, stale removal, candidate promotion, rollback, restore-failure preservation, and backup-cleanup behavior.
- [x] **Task 4: Complete release/all-target and hardened Make interfaces** - PASS: public pnpm/Make matrices passed. The explicit `make dev chrome` and `make release` commands exited 0; semantic inspection validated selected dev Chrome and all three release pairs, unpacked/ZIP version `0.1.0`, four icon references, Chrome/Edge service workers, Firefox background scripts, two dev maps, and zero release maps.
- [x] **Task 5: Implement immutable selected-target watch generations** - PASS: one focused run and five consecutive full-suite runs passed immediate post-sequence-1 source mutations for all three ordinary public browser rows. The same full runs passed representative Chrome's immediate package mutation followed by common manifest, selected variant, all four icons, TypeScript, compile-error retention/repair, and rapid final-generation consistency. Selected unpacked and ZIP pairs changed together; unselected browser/mode pairs remained byte-identical.
- [x] **Task 6: Prove exact-PID termination and phase-safe cleanup** - PASS: watch coverage passed graceful cleanup for all public rows, compile/package/promotion shutdown cases, the forced post-cleanup fallback, repeated guarded failures, exact build/wrapper PID disappearance, sentinel preservation, and zero task/generation/candidate residue. Production contains no child-process or browser launch/reload behavior.
- [x] **Task 7: Run direct-pnpm Node 24 gates** - PASS: login-shell Node `v24.18.1` and direct pnpm `10.34.5` ran the 3-file/60-test focused gate, five complete lint/typecheck/232-test gates, `make dev chrome`, `make release`, semantic artifact validation, and a final standalone lint successfully.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | `make dev` or `make release` produces distinct unpacked and ZIP artifacts for all three browsers. | MET | The public command matrix passed, and the explicit release gate produced and semantically validated `dist/release/{chrome,firefox,edge}/` with matching ZIPs. |
| 2 | An optional Chrome, Firefox, or Edge Make browser produces only the appropriate target artifact. | MET | All six fresh single-target Make combinations and selected-update preservation cases passed in `tests/build/commands.test.ts`; the explicit selected Chrome dev build also passed artifact validation. |
| 3 | `pnpm dev <browser> --watch` rebuilds only the selected target after an input change and launches/reloads no browser. | MET | Across five ordinary full-suite runs, every Chrome, Firefox, and Edge row mutated `src/content/main.ts` immediately after observing initial success and received a later success. Selected unpacked/ZIP bytes changed with equal contents; all unselected browser/mode hashes and the launch sentinel remained unchanged. Representative Chrome also passed every maintained metadata/icon/source mutation and rapid invalidation case. |
| 4 | Unknown targets and invalid combinations fail with actionable usage. | MET | The focused and full invalid-command matrices passed unsuccessful status, usage diagnostics, unchanged seeded output, and no task/candidate mutation. |
| 5 | Every manifest and release archive uses the single package version. | MET | Tests changed only isolated `package.json` and parsed requested unpacked/ZIP manifests. The explicit artifact probe found package, unpacked, and archived version `0.1.0` for selected dev Chrome and all release targets; source manifests remain versionless. |
| 6 | A fresh build has the temporary icon and does not open onboarding or settings automatically. | MET | All target manifests reference the four validated 16/32/48/128 clock PNGs. Emitted backgrounds passed fake install/navigation APIs with no onboarding/settings action; no real browser was launched. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Build Request | Mode, literal browser list, and watch flag are present | Expands into selected/all artifact pairs | Public grammar, exit status, pre-mutation rejection, and Make hardening pass | PASS |
| Compilation Snapshot | Browser/mode, private output, emitted metadata, bundles, icons, and maps are present | One completed compilation feeds snapshot and ZIP creation | Same-compilation dependencies, error retention, rapid consistency, and semantic artifacts pass | PASS |
| Artifact Pair | Unpacked directory, ZIP, sorted inventory, and version are present | Candidate roots consume validated pairs | Exact inventory/bytes, PNG/bundle validation, determinism, and unsafe-input rejection pass | PASS |
| Published Mode Root | Mode root, candidate, prior publication, and optional backup are represented | One root-level swap publishes selected/all pairs | Preservation, stale removal, promotion, rollback, actionable failures, and cleanup pass | PASS |
| Watch Session | Selected browser, watcher, events, cleanup state, and generations are present | Converts completed compilations into selected dev publications | Five full-suite repetitions observed every immediate public and representative maintained-input mutation, monotonic consistent generations, exact-PID cleanup, and no residue | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| `createRspackConfig({ workspaceRoot, browser, mode, outputPath })` | PASS | All target/mode artifacts compile in process; maintained metadata/icons are watched and emitted in the same compilation with correct browser forms. |
| `createArtifactServices({ fs, zipSync, unzipSync })` | PASS | Snapshot, ZIP, validation, candidate construction, root publication, injected failure, preservation, and cleanup behavior pass. |
| `runBuildCommand({ workspaceRoot, mode, argv, compilerFactory, artifacts, events, phaseHooks })` | PASS | One-shot, watch, lifecycle, and injected seams pass. Watch status delivery occurs only after Rspack's next-tick re-arm boundary and remained reliable across five full-suite repetitions. |

No HTTP, GraphQL, browser-message, product-persistence, or external API contract is added, and no issue-local `contracts/` directory exists. Predecessor adapter, timestamp, document ownership, scheduler, and content-runtime contracts remain covered by the complete green suite.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Test observable behavior at public/runtime boundaries | COMPLIANT | Evidence comes from ordinary pnpm/Make processes, parsed manifests/ZIPs/PNGs/bundles, fake runtimes, injected seams, exact PIDs, and observable filesystem state; no source-text assertion test was added. |
| Use login-shell Node 24 and direct pnpm; do not invoke Corepack | COMPLIANT | Validation used login-shell Node `v24.18.1` and direct pnpm `10.34.5`; Corepack was never invoked. |
| Do not use Git, browser automation, website UI, network, external process-tree utilities, or external utility provenance tests | COMPLIANT | Validation used local isolated workspaces, fake runtimes, local public commands, and exact PIDs only. |
| Keep issue validation non-destructive | COMPLIANT | No implementation, test, plan, package, manifest, fixture, or configuration source was edited. Only this report and the issue status were updated; approved verification commands generated ignored `dist` artifacts. |
| Preserve issue scope and predecessor contracts | COMPLIANT | The repair changes only watch status timing; build selection, synchronous generation/publication, error recovery, lifecycle, and all predecessor suites remain green. |

No project-local `AGENTS.md` exists; the supplied workspace instructions were applied.

## Verification Evidence

- Toolchain: login-shell Node `v24.18.1`; direct pnpm `10.34.5`.
- Repair boundary: `scripts/build/pipeline.mjs:90-93` schedules build-status delivery with `Promise.resolve().then(...)`; `scripts/build/pipeline.mjs:109-134` keeps compilation result handling, snapshot, packaging, candidate construction, publication, and cleanup synchronous before the callback returns.
- Delay/poll/browser audit: the success/failure boundary has no sleep, timer, polling, or test hook. The only production timer is the bounded five-second watcher-close fallback at `scripts/build/pipeline.mjs:95-102`. Production build scripts contain no `child_process`, spawn, browser launch, navigation, or reload path. Public tests mutate immediately after the initial success at `tests/build/watch.test.ts:36-40` and `tests/build/watch.test.ts:66-72`; no delay is inserted to mask the re-arm race.
- Focused gate: `pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/commands.test.ts tests/build/watch.test.ts` exited 0 with 3 files and 60 tests passed.
- Ordinary full gate: five consecutive `pnpm check` invocations exited 0. Each completed lint, strict typecheck, and 16 test files / 232 tests. Reported Vitest durations were 13.40s, 13.47s, 13.34s, 13.36s, and 13.40s.
- Immediate mutation stress: those five full runs amount to five successful immediate post-initial-success rebuilds for each public browser row and five successful representative Chrome maintained-input matrices (package, common manifest, selected variant, four icons, TypeScript, compile-error repair), all under the ordinary full-suite gate.
- Lifecycle and selection: the same runs passed exact-PID graceful/forced cleanup, compile/package/promotion interruption, selected-only hash preservation, launch sentinel preservation, and rapid-generation serialization. Final root-level residue inspection returned `[]` for task/candidate/generation paths.
- Make/artifact gate: `make dev chrome`, `make release`, and final `pnpm lint` exited 0. Semantic loaders validated unpacked/ZIP parity, package version `0.1.0`, four icons, correct background forms, two dev Chrome maps, and no release maps.
- A non-failing jsdom `Not implemented: navigation to another Document` diagnostic appeared in each full run; all runs still exited 0 with every test passing, and fake-runtime assertions confirmed no extension onboarding/settings navigation.
- No browser, website UI, network, Git, Corepack, external process-tree utility, or external utility provenance check was used.

## Issues Found

None.

## Recommendations

- Mark issue `5-AFK` as `Validated`.
- Keep the approved plan unchanged and retain real unpacked-extension installation validation in separately scoped issue `16-HITL`.
