# Implementation Plan: [no-more-ago] Build Chrome, Firefox, and Edge targets

- **Created**: 2026-08-24
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/5-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Revise rejected attempt 2 while preserving all nine attempt-1 resolutions. Make Task 5's public watch test table-driven across Chrome, Firefox, and Edge. For each browser, prove target acceptance, correct initial manifest/path selection, one bounded source rebuild, selected unpacked/ZIP changes, byte-identical unselected browser/mode pairs, no launch/reload, and bounded graceful/forced cleanup. Keep the deeper maintained-input and rapid-generation matrix on representative Chrome. Continue to exclude Corepack, browser automation, Git, and implementation work during planning.

## Summary

Replace the Chrome-only Rspack CLI child with one in-process Node 24 pipeline for Chrome, Firefox, and Edge. Rspack compiles shared TypeScript and emits the package-derived manifest plus selected manifest/icon inputs in the same compilation. One-shot commands stage all requested browser pairs before publishing. Watch owns one selected dev compiler; its callback synchronously copies completed output to a unique immutable snapshot, packages, validates, and publishes it before returning, so the next `output.clean` compilation cannot race the packaged generation.

The only published roots are `dist/dev/` and `dist/release/`. Each contains `<browser>/` and `<browser>.zip`. A single-target command builds a complete candidate mode root by preserving only the two unrequested supported pairs byte-for-byte and replacing the selected pair; an all-target command replaces all three. Both use one transaction: rename the prior mode root to a private backup, rename the complete candidate root into place once, then remove the backup. Injected filesystem tests cover no-prior, mid-swap, successful rollback, restore failure with an actionable preserved backup, and unrequested-pair preservation.

ZIP scope is intentionally narrow. Pinned `fflate` writes sorted root-relative regular files with fixed compression options and a locally constructed 1980 DOS timestamp. Tests parse names/bytes with `unzipSync`, reject an actual symlink before encoding, and prove byte-identical output under distinct `TZ` values. No unverifiable central-directory metadata is promised.

Tests invoke ordinary `pnpm` on POSIX or fixed `pnpm.cmd` arguments on Windows from the normal environment. They never use `npm_execpath`, execute a package-manager launcher through Node, or inspect launcher provenance. The production build CLI compiles in process and spawns no child. Public watch tests learn the exact Node PID from structured output, use graceful exact-PID termination followed by an exact process-group/PID forced fallback without platform task utilities, and put deadlines plus `finally` cleanup around every spawn, event, and exit wait.

## Technical Context

- **Language/Version**: TypeScript 6.0.3; ESM build modules; Node `>=24 <25` (current login shell `v24.18.1`); direct pnpm `10.34.5`
- **Primary Dependencies**: `@rspack/core` 2.1.10 for in-process compile/watch; pinned tooling-only `fflate` 0.8.2; existing application dependencies unchanged
- **Storage**: Published artifacts only at `dist/dev/` and `dist/release/`; private compiler snapshots/candidates/backups in `mkdtemp` roots directly below `dist/`
- **Testing**: Vitest 4.1.11 Node-environment build tests, public pnpm/Make processes, semantic JSON/PNG/ZIP/JS loaders, exact hashes, and injected compiler/filesystem/phase boundaries
- **Target Platform**: Node 24 maintainer environments, GNU Make 3.81 facade, current stable Chrome/Edge/Firefox artifacts; direct pnpm is the Windows interface when Make is absent

## Research

### Baseline and scope

The declared blocker `1-AFK` is `Validated`; implemented predecessors `2-AFK` through `4-AFK` are also validated. Their adapter, timestamp, DOM ownership, scheduler, and content-runtime contracts remain unchanged.

Current behavior is `pnpm dev chrome`: `scripts/build.mjs` launches `@rspack/cli`, `rspack.config.mjs` writes directly to `dist/chrome-dev/`, `src/manifest/chrome.json` mixes shared data with a `0.0.0` placeholder, and the only build test inspects one unpacked artifact. There is no Makefile, release, watch, ZIP, icon, common manifest, Firefox, or Edge target.

This slice owns build validation, manifests/icons, artifacts, watch, publication safety, and maintainer process cleanup. It does not add product settings/diagnostics, signing/store automation, browser minimums, Safari, or another adapter. Real-browser installation remains `16-HITL`; this issue performs no browser automation or website access.

### Public command and artifact contract

The CLI validates literals before creating `dist` or a task. Invalid shapes exit 2 with a reason and complete usage; valid build failures exit 1.

| Command | Result |
| --- | --- |
| `pnpm dev` / `make dev` | Publish all three pairs under `dist/dev/` |
| `pnpm release` / `make release` | Publish all three pairs under `dist/release/` |
| `pnpm <mode> <browser>` / `make <mode> <browser>` | Replace selected pair and preserve existing unrequested pairs in that mode root |
| `pnpm dev <browser> --watch` | Continuously replace only that development pair |
| Missing watch browser, release watch, duplicate/unknown browser, unknown flag, extra input, Safari, or invalid Make goals | Exit 2 with usage and no artifact/sentinel mutation |

Published paths are consistent for every command:

```text
dist/<dev|release>/<chrome|firefox|edge>/
dist/<dev|release>/<chrome|firefox|edge>.zip
```

Each pair contains root `manifest.json`, `background.js`, `content.js`, and `icons/clock-{16,32,48,128}.png`; dev also contains maps and release does not. Rebuilding drops stale selected-pair and unrelated mode-root paths. A selected build preserves the complete inventories/bytes of existing unrequested supported pairs.

### Compilation-owned metadata and watched inputs

`src/manifest/common.json` holds versionless shared MV3 fields and icon paths. Chrome/Edge variants independently select `background.service_worker`; Firefox selects `background.scripts`. Edge has its own request/compiler/pair even though its current background form matches Chrome. No speculative store ID or minimum browser version is added.

`createRspackConfig({ workspaceRoot, browser, mode, outputPath })` receives validated literals. A synchronous compilation plugin adds `package.json`, common manifest, selected variant, and all four icons to `compilation.fileDependencies`. During that same compilation asset stage it reads/validates them once, inserts package version, and emits `manifest.json` plus icons. TypeScript entries are normal compiler dependencies. After compilation, one-shot/watch read only completed emitted output; maintained metadata is never reread post-compile.

### Serialized watch contract

One watch compiler writes only to a private session output. Its non-Promise callback performs, before returning:

1. Reject compiler errors and keep the last publication.
2. Create a unique generation directory with `mkdtemp`.
3. Synchronously preflight/copy completed compiler output into the immutable snapshot.
4. Synchronously parse emitted manifest/icons/bundles, create/reload ZIP, construct the complete candidate `dist/dev/`, and publish through the shared mode-root swap.
5. Delete the generation and synchronously emit one structured success/failure event.

There is no asynchronous packaging promise or generation queue. Rspack may coalesce invalidations while the callback runs and compile again only after it returns; at most one callback and one snapshot/package/publication phase are active. A bounded injected packaging delay lets the parent rapidly change package/common/variant/icon/TypeScript inputs. Tests require the current publication to remain internally consistent with its completed snapshot, a later publication to reflect final values, maximum in-flight packaging 1, and no accumulated generation roots.

Public acceptance coverage is table-driven over `chrome`, `firefox`, and `edge`. Each row prebuilds and snapshots all dev and release pairs, starts ordinary `pnpm dev <browser> --watch`, verifies the selected `dist/dev/<browser>/` and `.zip` paths plus that browser's background manifest form, changes one compiled TypeScript fixture input, and awaits exactly one bounded successful rebuild. The selected unpacked pair and ZIP must both change and remain semantically identical, while every other browser/mode pair remains byte-identical. Each row also uses the same exact-PID, no-launch/reload, deadline, graceful-then-forced cleanup contract. The more expensive package/common/selected-variant/four-icon dependency matrix, compile-error recovery, and delayed rapid-invalidation consistency case run once for representative Chrome.

### Guarded roots and one mode-root transaction

The runner fixes lexical/canonical workspace, `dist`, and private task roots. Before every `mkdir`, `mkdtemp`, copy, write, rename, or recursive removal, the guarded filesystem boundary:

- checks lexical containment under the required root;
- walks existing components with `lstat` and rejects symlinks or non-directory intermediates;
- checks `realpath` containment for existing roots/sources;
- rejects absolute, parent-traversing, special-file, and symlinked artifact input;
- repeats the guard immediately before the mutation.

`dist` is created only after its parent passes. Invocation/session roots use `mkdtempSync(path.join(distRoot, ".task-"))`; generation roots use `mkdtemp` inside the task. Recursive cleanup accepts only an exact validated task/candidate/backup path. Public tests point `dist` and `dist/dev` through a real symlink/junction at an external sentinel and require rejection without external mutation.

The candidate is a complete mode root. Existing unrequested supported pairs are preflighted/copied; requested pairs replace their names. Publication is:

1. No prior root: rename candidate to `dist/<mode>` once.
2. Prior root: rename it to `<task>/previous-<mode>`, rename candidate to `dist/<mode>` once, then remove backup.
3. Candidate promotion failure: restore the backup exactly.
4. Restore failure: preserve backup and candidate, skip task cleanup, and throw an error containing the absolute backup and `rename <backup> -> <dist>/<mode>` recovery action.
5. Backup cleanup failure after successful promotion: keep the valid new root and backup, exit 1, and report the exact removable backup.

The filesystem boundary is injected. Failure tests throw before selected native operations, respecting real rename atomicity. They cover no-prior success/failure, mid-swap failure/restore, failed restore, backup cleanup failure, all/single use of the same final rename, and byte-identical unrequested pairs.

### ZIP contract

The packager inventories with `lstat`, never follows links, and accepts only regular files/directories canonically inside the immutable snapshot. It normalizes separators to `/`, rejects unsafe names, sorts entries, and calls `fflate.zipSync` with fixed compression and `new Date(1980, 0, 1, 0, 0, 0)`, whose DOS local fields are stable across zones.

`unzipSync` validation checks sorted names against the unpacked inventory, root `manifest.json`, and exact bytes. It makes no central-directory OS/attribute assertion. The same workspace is built under `TZ=UTC` and `TZ=Pacific/Kiritimati` and complete ZIP bytes are compared. A direct packager test supplies an actual POSIX symlink or Windows junction and requires preflight rejection with its external target unchanged.

### Make and process lifecycle

Make uses literal lists plus `override` for every derived mode/browser/argument variable. Parse-time branches contain only fixed `pnpm dev|release [chrome|firefox|edge]` recipes; no command-line variable value is interpolated. Tests inject shell syntax through internal variable names and prove it reaches neither shell, artifact, nor sentinel.

Production imports `@rspack/core` and uses no `child_process`. Test helpers spawn `pnpm` with `shell:false` on POSIX or fixed `pnpm.cmd` plus only literal-whitelisted arguments on Windows. They never use `npm_execpath` or launcher provenance.

Watch writes newline-delimited JSON synchronously: `ready` carries exact build PID/browser/mode/session; `build` carries sequence/status; `phase` coordinates bounded fault tests. Public helpers start pnpm in a new POSIX process group, signal exact build PID gracefully, then force the wrapper group on POSIX or exact build/wrapper PIDs on Windows after a deadline. No `taskkill`, `pkill`, `pgrep`, browser utility, or process-tree command is used. Since the build CLI starts no child, exact PID death plus wrapper exit proves no build orphan.

Every spawn, event, compiler close, graceful exit, and forced exit has a deadline. `finally` closes readers/streams, terminates any remaining exact process/group, awaits exit, and removes only the exact test workspace. All three table-driven public browser cases keep the production package script and apply the same exact-PID graceful shutdown plus bounded forced process-group/PID fallback contract; phase cases use an isolated fixture package script that still runs ordinary `pnpm dev chrome --watch` but calls the same exported pipeline with injected seams. Those representative Chrome cases exercise shutdown during compile, synchronous package, and promotion. Synchronous package/promotion finishes its current bounded atomic step before a queued signal is handled, then leaves one valid old/new mode root and cleans its task. A post-cleanup hold exercises the actual forced fallback only after staging is gone.

Tests assert public command status/events, exported module behavior, emitted artifact semantics, filesystem state, and exact PIDs. Copying or changing inputs inside an isolated workspace is setup; no test reads implementation/configuration text and asserts on substrings, formatting, private symbols, or command spelling.

## Entities

### Build Request

- **Fields**: `mode: "dev" | "release"`; literal browser list; `watch: boolean`
- **Relationships**: Expands into requested Artifact Pairs in one candidate mode root
- **Validation**: Watch is dev/exactly one browser; duplicates, unknowns, extras fail before mutation
- **States**: received -> validated -> compiled -> candidate -> published, or rejected/failed with prior publication preserved

### Compilation Snapshot

- **Fields**: browser, mode, unique private path, emitted manifest/version, bundles, icons, optional maps
- **Relationships**: One Rspack compilation; sole input to artifact validation/ZIP
- **Validation**: Regular non-symlink inventory, browser background form, referenced files, icon dimensions, bundle syntax; no post-compile metadata read
- **States**: compiler output -> synchronously detached -> validated/packaged -> deleted

### Artifact Pair

- **Fields**: browser, unpacked directory, ZIP, sorted inventory, parsed version
- **Relationships**: Replaces selected names in a candidate mode root
- **Validation**: ZIP names/bytes equal unpacked; root manifest; no unsafe input; deterministic across time zones
- **States**: staged -> validated -> candidate -> published, or rejected before swap

### Published Mode Root

- **Fields**: mode, complete candidate, zero-to-three supported pairs, prior root, optional private backup
- **Relationships**: Single publication unit for all, selected, and watch builds
- **Validation**: Requested pairs complete; existing unrequested pairs byte-identical; stale unrelated paths excluded; all mutation guarded
- **States**: absent/prior -> candidate -> backup -> promoted; promotion failure -> restored; restore failure -> actionable backup preserved

### Watch Session

- **Fields**: selected dev browser, one compiler/watcher, task/compile roots, event sequence, closing flag, current synchronous generation
- **Relationships**: Converts each successful output to one selected pair and complete dev candidate
- **Validation**: One active callback/publication; no queued generations; every maintained selected input rebuilds; close idempotent
- **States**: starting -> ready -> success/failure -> watching -> closing -> cleaned/exited

## Contracts

No HTTP, GraphQL, browser-message, product persistence, or external API contract is added; no `contracts/` directory is created.

Programmatic boundaries used by production and behavior tests are:

```js
createRspackConfig({ workspaceRoot, browser, mode, outputPath })
createArtifactServices({ fs, zipSync, unzipSync })
runBuildCommand({ workspaceRoot, mode, argv, compilerFactory, artifacts, events, phaseHooks })
```

Artifact services expose snapshot, pair creation, candidate-mode construction, and mode publication. Production supplies native guarded filesystem/fflate/compiler dependencies and no-op phase hooks. Tests inject fail-before filesystem calls, delayed compilers, bounded synchronous phase hooks, and event sinks programmatically; argv/environment cannot select dependencies, paths, browser, or mode.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `Makefile` | Create | Validate literal goals, make derived values unoverrideable, delegate fixed pnpm recipes |
| `package.json` | Modify | Add explicit dev/release modes, pin fflate, remove Rspack CLI |
| `pnpm-lock.yaml` | Update | Lock direct-pnpm dependency changes |
| `scripts/build.mjs` | Replace | Thin executable for mode, structured events/signals, exit status |
| `scripts/build/pipeline.mjs` | Create | Parse, compile/watch in process, synchronously snapshot watch output, construct candidates, clean up |
| `scripts/build/artifacts.mjs` | Create | Guard paths, inventory/copy, ZIP validation, injected atomic publisher |
| `rspack.config.mjs` | Replace | Browser/mode/private-output config and same-compilation manifest/icon emission/dependencies |
| `src/manifest/common.json` | Create | Versionless shared MV3 fields/icon map |
| `src/manifest/chrome.json` | Modify | Chrome background variant |
| `src/manifest/edge.json` | Create | Edge background variant |
| `src/manifest/firefox.json` | Create | Firefox background variant |
| `src/assets/icons/clock-{16,32,48,128}.png` | Create | Four temporary valid clock icons |
| `tests/build/build-workspace.ts` | Create | `mkdtemp` workspaces, normal pnpm/Make spawning, semantic loaders, deadlines/finally cleanup |
| `tests/build/fixtures/injected-build-child.mjs` | Create | Invoke the same pipeline with deterministic compiler/filesystem/phase seams |
| `tests/build/chrome-artifact.test.ts` | Replace | Target manifests/icons/bundles/versions/ZIP/no-navigation behavior |
| `tests/build/commands.test.ts` | Create | Grammar, all/single publication, Make hardening, guarded roots, rollback/preservation |
| `tests/build/watch.test.ts` | Create | Watched inputs, immutable rapid generations, selected-only output, PID shutdown/cleanup |

Application `src/**/*.ts` behavior and predecessor tests remain unchanged. `dist/**` is already ignored by Git, ESLint, and TypeScript.

## Tasks

### [x] Task 1: Lock request parsing and ordinary direct-pnpm tests

**Files:** `tests/build/build-workspace.ts`, `tests/build/commands.test.ts`, `package.json`, `scripts/build.mjs`, `scripts/build/pipeline.mjs`

- [ ] Write failing public tests for Safari, duplicate browsers, missing watch browser, release watch, extra input, and unknown flags. Seed output/sentinel; require exit 2, actionable usage, unchanged inventory, no task root. Helpers use normal `pnpm`/fixed `pnpm.cmd`, separate deadlines, and `finally`; never `npm_execpath` or provenance checks.
- [ ] Run `pnpm exec vitest run tests/build/commands.test.ts`; expect failure against current Chrome-only usage.
- [ ] Set scripts to `node scripts/build.mjs dev|release`; parse only fixed literals, expand absent browser to fixed Chrome/Firefox/Edge order, validate before mutation, reserve exit 2 for usage and 1 for build failure, and keep production free of `child_process`.
- [ ] Re-run `pnpm exec vitest run tests/build/commands.test.ts`; expect the rejection matrix to pass.

**Verification**: Observable public behavior proves direct pnpm; invalid input cannot choose/clean a target.

### [x] Task 2: Emit browser-specific unpacked artifacts with same-compilation metadata

**Files:** `rspack.config.mjs`, `scripts/build/{pipeline,artifacts}.mjs`, manifests/icons, `tests/build/chrome-artifact.test.ts`

- [ ] Write failing fresh-workspace `pnpm dev <browser>` tests for `dist/dev/<browser>/`: common fields, package version, Chrome/Edge service worker, Firefox background scripts, bundle syntax/maps, four PNG dimensions, no Safari. Execute emitted background against fake install/navigation APIs and require zero options/onboarding navigation.
- [ ] Run `pnpm exec vitest run tests/build/chrome-artifact.test.ts`; expect missing targets/icons/layout.
- [ ] Create versionless common data, literal variants, and four valid icons without popup/onboarding/store/minimum/Safari/version additions.
- [ ] Implement `createRspackConfig`; add package/common/selected variant/all icons to `compilation.fileDependencies`, read/emit them in the same synchronous asset stage, and confine `output.clean` to private compiler output.
- [ ] Compile via `@rspack/core`, close in `finally`, synchronously snapshot/validate output, and promote the selected-only no-prior mode root. Never reread maintained metadata after compilation.
- [ ] Re-run the focused artifact test; expect all unpacked target/install assertions to pass.

**Verification**: Manifest/version/variant/icons/bundles share one generation; Edge is independent without invented fields.

### [x] Task 3: Add deterministic ZIPs and one safe mode-root swap

**Files:** `package.json`, `pnpm-lock.yaml`, `scripts/build/{artifacts,pipeline}.mjs`, all build tests/helper

- [ ] Write failing ZIP tests for sorted root names/exact bytes, same-workspace `TZ=UTC` versus `TZ=Pacific/Kiritimati` identity, and actual symlink/junction rejection. Add external-sentinel attacks through `dist`/`dist/dev`. At injected publisher boundary cover no-prior success/failure, mid-swap rollback, failed restore with preserved actionable backup, backup-cleanup failure, exact one candidate rename for all/single, unrequested byte preservation, and stale removal.
- [ ] Run `pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/commands.test.ts`; expect missing ZIP/guards/rollback.
- [ ] Pin `fflate` 0.8.2, remove `@rspack/cli`, and update lock with ordinary `pnpm install`; no Corepack/platform ZIP.
- [ ] Implement immediate lstat/realpath/containment guards, `mkdtemp` task/generation roots, regular-file inventory, sorted fflate entries with fixed local 1980/options, `unzipSync` name/byte parity, and no central-metadata claim.
- [ ] Build a complete candidate mode root preserving only unrequested supported pairs; promote by one root rename, restore on promotion failure, and preserve/report backup/candidate if restoration or cleanup fails. Clean only exact guarded task paths.
- [ ] Re-run both focused files; expect ZIP/path/publication coverage to pass.

**Verification**: All and selected requests share one atomic per-mode publication contract; unrecoverable backups remain visible/actionable.

### [x] Task 4: Complete release/all-target and hardened Make interfaces

**Files:** `Makefile`, `tests/build/commands.test.ts`

- [ ] Write failing matrix for `pnpm dev|release`, `make dev|release`, and all six `make <mode> <browser>` combinations using consistent per-mode paths. Require dev maps/release no maps, selected-only fresh output, Edge-only update preservation, and all six unpacked/archive version observations after changing only package version.
- [ ] Reject invalid goals before mutation. Pass sentinel-writing shell syntax through every internal selector/argument variable and require goals alone determine artifacts with no malicious artifact value/sentinel.
- [ ] Run `pnpm exec vitest run tests/build/commands.test.ts`; expect release/Make failures.
- [ ] Add GNU Make 3.81 parse-time validation. Use `override` literal-derived variables and fixed recipe branches only; interpolate no command-line value. Browser companion goals are no-ops; bare Make may default to all-target dev.
- [ ] Re-run the focused command matrix; expect all valid/invalid/injection cases to pass.

**Verification**: Make is a fixed facade, and every command observes the same `dist/<mode>/<browser>{/,.zip}` contract.

### [x] Task 5: Implement immutable selected-target watch generations

**Files:** build modules, `tests/build/build-workspace.ts`, `tests/build/watch.test.ts`, `tests/build/fixtures/injected-build-child.mjs`

- [ ] Write a failing table-driven public watch test with one row each for `chrome`, `firefox`, and `edge`. In every isolated row, prebuild and hash all six dev/release browser pairs; start ordinary `pnpm dev <browser> --watch`; await bounded `ready` and initial successful `build` events; prove the selected `dist/dev/<browser>/` and `dist/dev/<browser>.zip` paths exist; and parse both manifests to require Chrome/Edge `background.service_worker` or Firefox `background.scripts` as appropriate. Snapshot the selected pair, change one compiled TypeScript fixture source with a row-unique observable marker, await one bounded later successful build, and require both selected unpacked bytes and ZIP bytes to change while their inventories/contents remain equal. Require all five unselected browser/mode pairs to remain byte-identical, launch/reload sentinels to remain untouched, and each row's `finally` to perform exact-build-PID graceful shutdown with deadline, bounded process-group/exact-PID forced fallback, wrapper/build death checks, stream closure, and zero `.task-*`/generation residue.
- [ ] On representative Chrome only, extend the public test through the deeper maintained-input matrix: change package version, common manifest, selected variant (benign standard field in the isolated fixture), each of four valid icons, and compiled TypeScript; after every bounded successful event require the selected unpacked/ZIP generation and expected version/content to update, with all Firefox/Edge dev and all release pairs byte-identical. Add compile-error retention/repair and no-launch/reload assertions.
- [ ] On representative Chrome only, add injected delayed-packaging rapid changes. Require current old snapshot consistency, later final values, maximum in-flight package/publish 1, monotonic events, bounded generation inventory, and no residue.
- [ ] Run `pnpm exec vitest run tests/build/watch.test.ts`; expect missing watch lifecycle.
- [ ] Implement one compiler/watcher. Emit ready PID. In the callback return no Promise: synchronously `mkdtemp`, detach output, parse/package/build complete dev candidate/publish/clean/emit, then return. Failed generations retain prior output; no post-compile maintained reads.
- [ ] Keep one active callback and no generation queue; let Rspack coalesce invalidations. Implement idempotent SIGINT/SIGTERM close with bounded watcher/compiler close, current atomic-step completion, unpublished cleanup, signal removal, and one settlement.
- [ ] Re-run focused watch tests; expect all three public browser rows plus the representative deep-input, rapid-invalidation, selected-isolation, failure-recovery, cleanup, and no-browser-action cases to pass.

**Verification**: Every accepted browser watch target selects the correct paths/manifest, rebuilds only its dev pair after a maintained source change, leaves all other browser/mode pairs unchanged, launches/reloads nothing, and exits cleanly; representative Chrome additionally proves the full dependency and generation-consistency matrix.

### [x] Task 6: Prove exact-PID termination and phase-safe cleanup

**Files:** build modules, helper, injected child, `tests/build/{watch,commands}.test.ts`

- [ ] Add failing lifecycle tests requiring deadlines for every spawn/event/graceful/forced exit and `finally` cleanup. Each Chrome/Firefox/Edge public watch row learns its exact build PID, signals it, applies the same bounded forced fallback if graceful exit misses its deadline, awaits build/wrapper death, checks PID absence, and requires no `.task-*` or generation residue.
- [ ] Through an isolated fixture package script, invoke the injected child with ordinary `pnpm dev chrome --watch`, then request shutdown during delayed compile, synchronous package, and backup/promotion. Require valid old-or-new dev root, unrequested/external safety, no PID, and no task/generation residue. Add post-cleanup hold to force POSIX wrapper-group or Windows exact-PID fallback without task utilities.
- [ ] Run `pnpm exec vitest run tests/build/watch.test.ts tests/build/commands.test.ts`; expect missing PID/deadline/seam behavior.
- [ ] Write ready/build/phase JSON synchronously. Bound close, start new POSIX process group, signal build PID first, force group only after timeout; on Windows force exact build then wrapper. Close streams/readers and remove exact workspace in `finally`. Dependency injection remains programmatic only.
- [ ] Re-run both focused files; expect graceful, compile/package/promotion, forced-fallback, no-orphan, and no-residue cases to pass.

**Verification**: Production build has no child; test escalation is exact, bounded, portable, and cleanup-safe.

### [x] Task 7: Run direct-pnpm Node 24 gates

**Files:** No additional files

- [ ] Run `zsh -lic 'node --version && pnpm --version && pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/commands.test.ts tests/build/watch.test.ts'`; expect Node 24, pnpm 10.34.5, focused pass. All focused filtering goes directly through Vitest.
- [ ] Run `zsh -lic 'pnpm check'`; expect lint, strict typecheck, full predecessor/new suite pass.
- [ ] Run `zsh -lic 'make dev chrome && make release'`; semantically inspect selected dev plus all release pairs under per-mode paths. No browser installation.
- [ ] Run `zsh -lic 'pnpm lint'`; expect pass with no task/test workspace, sentinel mutation, browser process, Corepack, Git, network, or browser automation.

**Verification**: Direct Node 24/pnpm gates cover the build slice and all validated predecessor behavior.

## Acceptance-Criteria Mapping

| Criterion | Planned evidence |
| --- | --- |
| 1. `make dev` / `make release` produce all distinct unpacked/ZIP artifacts | Tasks 3-4 load all three `dist/<mode>/<browser>/` and `.zip` pairs after one complete mode-root swap. |
| 2. Optional Make browser produces only appropriate artifact | Task 4 exercises all six fresh combinations and proves selected update changes only that pair while unrequested pairs/other mode remain byte-identical. |
| 3. `pnpm dev <browser> --watch` selected-only, no launch/reload | Task 5 table-drives ordinary Chrome, Firefox, and Edge watch commands. Every row proves accepted target, correct initial browser manifest and paths, one bounded TypeScript rebuild changing only the selected dev unpacked/ZIP pair, byte-identical other browser/mode pairs, zero launch/reload action, and bounded graceful/forced cleanup. Representative Chrome additionally covers package/common/variant/all icons, errors, and rapid generations. |
| 4. Unknown/invalid combination fails with usage | Task 1 rejects pnpm before task creation; Task 4 rejects Make and malicious variable assignments before mutation. |
| 5. Manifest/archive version has one package source | Tasks 2, 4, 5 change only isolated package version and parse every requested unpacked/ZIP manifest; maintained manifests are versionless. |
| 6. Temporary icon and no automatic onboarding/settings | Task 2 parses four icon dimensions and executes emitted backgrounds against fake install/navigation APIs with zero options/onboarding navigation; real installation remains `16-HITL`. |

## Review-Finding Mapping (Attempt 1)

| # | Exact resolution |
| --- | --- |
| 1 | Summary, baseline/process research, Task 1: delete `npm_execpath`/launcher provenance; ordinary `pnpm` or fixed `pnpm.cmd`; public observable behavior only. |
| 2 | Compilation/watch research, Task 5: same-compilation metadata/icons registered as dependencies; synchronous detached snapshot/package/publication before callback return; no metadata reread/queue; delayed rapid invalidation test. |
| 3 | Mode-root research, Task 3: one complete `dist/<mode>/` candidate swap for all/single; injected no-prior, mid-swap, restore/cleanup failure, actionable backup, and unrequested preservation tests. |
| 4 | ZIP research, Task 3: narrow contract to sorted names/bytes, fixed local 1980/options, UTC/Kiritimati byte equality, actual symlink rejection; no central metadata promise. |
| 5 | Compilation research, Task 5: observable rebuilds for package, common manifest, selected variant, each icon, TypeScript; selected version/artifacts change and unselected remain identical. |
| 6 | Guarded-root research, Task 3: fixed workspace/dist/task anchors; immediate lstat/realpath containment before every mutation; `mkdtemp`; external sentinel symlink/junction tests. |
| 7 | Make research, Task 4: `override` literal selectors/fixed recipes; malicious assignments cannot reach shell, artifacts, or sentinel. |
| 8 | Process research, Task 6: deadlines/finally for every spawn/event/exit; exact ready PID; graceful then group/exact forced fallback without task utilities; injected compile/package/promotion shutdown; no PID/task residue. |
| 9 | Every task/gate uses executable filtering via `pnpm exec vitest run <files>`. |

## Review-Finding Mapping (Attempt 2)

| Finding | Exact resolution |
| --- | --- |
| Correctness medium: public watch evidence covered only Chrome | Serialized-watch research, Task 5 Step 1, Task 6 lifecycle coverage, and acceptance-criterion mapping 3 now table-drive ordinary `pnpm dev <browser> --watch` for Chrome, Firefox, and Edge. Each browser proves its accepted target, initial manifest variant/paths, one bounded source rebuild, selected unpacked/ZIP change, byte-identical unselected browser/mode pairs, no launch/reload, and bounded graceful/forced cleanup. The deeper maintained-input/rapid-generation matrix remains on representative Chrome to avoid tripling expensive cases. |
