# Implementation Plan: [no-more-ago] Prove the adapter contract with a synthetic site

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/15-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Keep future-site proof simple: register one synthetic adapter only in test/demo fixtures, reuse the entire existing shared pipeline, add only a demonstrably necessary narrow typed runtime seam, and ship exact `github.com` only.

## Summary

Define one test-only synthetic hostname/HTML adapter and run the same public typed adapter contract against that adapter and the real GitHub adapter. Feed its explicitly selected `time-ago` element and authoritative zoned `datetime` through the existing registry, timestamp resolver, System/custom formatter, semantic ownership/restore, one-observer incremental scheduler, background-owned settings/activation, and opt-in sanitized diagnostics. The only potentially necessary production change is an optional typed `registry?: AdapterRegistry` input passed through the existing content runtime into its already registry-aware shared document controller; production `content/main.ts` never supplies it and retains its GitHub-only default. Reject relative/ambiguous and undeclared `title`, `aria-label`, or `data-*` sources, verify real policy/format/debug updates and teardown, and prove all six emitted browser artifacts still register and process only exact `github.com`.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, ECMAScript 2022, Node 24, pnpm 10.34.5.
- **Primary Dependencies**: Existing date-fns, WebExtension runtime/activation interfaces, browser DOM/MutationObserver, jsdom, and Vitest; no new dependency.
- **Storage**: Existing sole-writer strict V5 current/backup settings and separate bounded local diagnostic journal only inside injectable integration fakes; no new production key/site preference.
- **Testing**: Parameterized adapter contract tests, static sanitized synthetic HTML fixture, shared DOM/controller/runtime tests, actual BackgroundApplication/SettingsService/DiagnosticJournal integration, fake activation browser APIs, and all six emitted CSP-constrained artifacts.
- **Target Platform**: Tests-only `synthetic.test`; shipped Chrome, Edge, and Firefox development/release artifacts remain exact-`github.com`-only.

## Research

### Existing adapter and processing contracts are already generic

Validated Issues 3 and 4 expose `SiteAdapter` with `id`, exact URL `matches`, bounded `discover`, and nullable trusted `extract`; `TimestampCandidate` requires an existing approved source kind plus `EXPLICIT_ZONED_DATETIME_RULE`. `AdapterRegistry` already accepts an injected adapter list while production `defaultRegistry` contains only `githubAdapter`. `processDocument`/`reconcileDocumentRegion` and `DocumentTransformationController` already accept `registry`, localized/custom display providers, and optional diagnostic sinks; the shared renderer alone owns semantic siblings, reversible hidden state, tokens, restoration, and forged-node safety. `DocumentMutationScheduler` owns exactly one existing `MutationObserver` with `attributeFilter: ["datetime"]`; no polling, adapter-owned observer, generic attribute inference, or duplicate DOM renderer is needed.

Use a test-only exact HTTP(S) `synthetic.test` adapter that explicitly discovers `time-ago.synthetic-event`, reads only its authoritative `datetime`, returns the existing `sourceKind: "time-ago"` and exact trusted timestamp rule, and rejects missing/invalid/relative values. This exercises genuinely distinct hostname/selector/eligibility while preserving the existing narrow source-kind union, resolver, scheduler attribute filter, and GitHub adapter unchanged. Generic `title`, `aria-label`, and arbitrary `data-*` remain untrusted; an explicit class is only a selector, never a timestamp. No optional adapter hook is justified because the existing `matches`/`discover`/`extract` contract expresses all required behavior.

### One narrow runtime injection seam enables the complete real pipeline

`BackgroundApplication` and `AdapterActivationCoordinator` already accept injected `RuntimeAdapterDefinition[]`; tests already use multiple synthetic definitions. However, `installContentRuntime` constructs its `ProcessInput` without forwarding a custom registry, despite `ProcessInput` and `DocumentTransformationController` already accepting one. Thus a test-only synthetic runtime can activate/register but currently cannot discover its document through the actual content settings/debug/teardown lifecycle. Add only optional typed `registry?: AdapterRegistry` to `installContentRuntime` and forward it when provided; existing production `src/content/main.ts` supplies nothing, existing content defaults remain unchanged, and no adapter-specific DOM, timestamp, presentation, settings, diagnostics, registration, or manifest logic changes.

Build a compact test-owned synthetic `SiteAdapter`, matching test-owned `RuntimeAdapterDefinition`, reserved `synthetic.test` HTML fixture, and fake browser tab/storage wiring. Inject both GitHub and synthetic definitions/registry only into the integration harness; drive genuine background `setSiteEnabled`, `setGlobalEnabled`, `setDisplaySettings`, and `setDebugEnabled` plus content hydration/update/teardown acknowledgements. Use trusted synthetic sender metadata and the existing journal sanitizer; never write full URLs, relative phrases, source `datetime`, or DOM text. Production proof must query the real `defaultRegistry`, execute emitted backgrounds/content on GitHub and synthetic URLs, inspect actual dynamic registration matches and public Popup/Sites responses, and avoid searching bundled/source text.

## Entities

### Test-only synthetic adapter and fixture

- **Fields**: `id: "synthetic"`, exact HTTP(S) hostname `synthetic.test`, explicit selector `time-ago.synthetic-event`, raw authoritative `datetime`, existing `sourceKind: "time-ago"`, and `timestampRule: "datetime:iso8601-explicit-zone"`; corresponding test-only runtime registration metadata.
- **Relationships**: Selected only from an explicitly injected test `AdapterRegistry`; its runtime definition is passed only to test `BackgroundApplication`/`AdapterActivationCoordinator`; existing production registries remain GitHub-only.
- **Validation**: Canonical exact hostname/protocol, bounded root-inclusive discovery, no duplicates, explicit eligibility, no extraction from relative prose/title/aria/data attributes, strict shared zoned-date parsing, and no adapter DOM mutations or observer ownership.
- **States**: tests-only registered → selected and enabled → shared owned output/dynamic updates → restored on invalidation, site/global disable, or teardown; absent from production adapter discovery.

### Narrow optional runtime registry injection

- **Fields**: Existing `installContentRuntime` inputs plus optional `registry?: AdapterRegistry`, forwarded solely to its existing `ProcessInput`.
- **Relationships**: Allows injected synthetic registry to reach the already generic shared document controller while existing settings hydration, presentation updates, diagnostics sink, listener, observer, and teardown remain untouched.
- **Validation**: Omitted input behaves identically to current `defaultRegistry`; supplied registry changes only adapter selection; duplicate installation still creates one listener/controller/observer.
- **States**: omitted/production → GitHub-only; provided/test harness → selected GitHub-or-synthetic adapter; no production synthetic registration.

## Contracts

- **Adapter**: Preserve existing `SiteAdapter`, `TimestampCandidate`, approved `TimestampSourceKind`, `EXPLICIT_ZONED_DATETIME_RULE`, `AdapterRegistry`, and GitHub extraction unchanged; implement the synthetic adapter solely under `tests/fixtures/synthetic/`.
- **Trusted extraction**: Only explicitly selected synthetic `time-ago.synthetic-event[datetime]` with a complete explicit-zone ISO instant reaches `resolveTrustedTimestamp`; visible relative text, ambiguous/zone-less values, unsupported elements, generic `title`, `aria-label`, and `data-*` cause safe no-op/restoration.
- **Runtime seam**: Extend only `installContentRuntime({ ..., registry?: AdapterRegistry })`, forwarding an explicitly provided registry into existing `ProcessInput`; production main/manifest/background/default registry never receive or import the synthetic adapter.
- **Shared lifecycle**: Real existing controller/scheduler/renderer own localized System/custom formatting, semantic `<time datetime>`, original-source hiding, one coalescing observer, added subtree and `datetime` updates, invalidation, removed subtree, policy disable/re-enable, ownership restoration, and teardown.
- **Settings/diagnostics**: Test-only injected runtime definitions participate in existing exact-host/global policy, atomic settings service, display revision updates, debug opt-in, trusted sender sanitization, 5 MB journal boundary, and delete-on-disable; no synthetic production setting is created.
- **Production boundary**: `defaultRegistry.select(new URL("https://synthetic.test/...")) === null`; every actual emitted Chrome/Edge/Firefox dev/release background exposes only `github.com` adapter/Sites status and registers only exact `http://github.com/*`/`https://github.com/*`; emitted synthetic documents remain untouched.
- **Scope**: No new production adapter/hook/selector, generalized attribute observer, repeated document scan, adapter-managed DOM/observer, schema/permission change, settings key, reporting change, source-text assertion, network, browser automation, Git, or Corepack.

## File Structure

| File | Action | Responsibility / ownership |
| --- | --- | --- |
| `tests/fixtures/synthetic/site.html` | Create | Small offline authoritative synthetic fixture with explicit eligible, ambiguous, relative, title/aria/data-only, dynamic, and unrelated markup; adapter owner. |
| `tests/fixtures/synthetic/adapter.ts` | Create | Typed tests-only `SiteAdapter` and matching runtime definition using existing approved `time-ago`/`datetime` contracts; adapter owner. |
| `tests/adapters/adapter-contract.test.ts` | Create | One parameterized shared public contract for actual GitHub and synthetic adapters, including exact selection, extraction, no-op, and test-only registry isolation; adapter owner. |
| `src/content/runtime.ts` | Modify | Add only optional typed `registry?: AdapterRegistry` and forward it to the already registry-aware `ProcessInput`; runtime-seam owner. |
| `tests/content/runtime.test.ts` | Modify | Prove injected registry works through real hydration/messages while omitted production behavior, one listener/observer, and teardown remain unchanged; runtime-seam owner. |
| `tests/integration/synthetic-adapter.test.ts` | Create | Actual shared formatter/ownership/mutation plus background/settings/activation/diagnostics integration using only injected test adapters and offline fixture; integration owner. |
| `tests/build/chrome-artifact.test.ts` | Modify | Assert public default-registry/actual emitted registration, Popup/Sites, and content behavior remains exact-GitHub-only in all six artifacts; artifact owner. |

## Tasks

### [x] Task 1: Define one tests-only synthetic fixture and parameterized adapter contract

**Files:** `tests/fixtures/synthetic/site.html` (create), `tests/fixtures/synthetic/adapter.ts` (create), `tests/adapters/adapter-contract.test.ts` (create).

- [x] **Step 1: Add failing table-driven public adapter cases** for real `githubAdapter` and a typed synthetic adapter: exact HTTP(S) hostname match versus sibling/subdomain/non-HTTP rejection, bounded root-inclusive discovery without duplicates, correct adapter ID/source identity/existing source kind/trusted rule, authoritative zoned `datetime`, custom eligibility, no-op for missing/zone-less/ambiguous/relative datetime, and ignored `title`, `aria-label`, generic `data-*`, visible text, already-absolute/non-candidate markup, and foreign registry hosts.
- [x] **Step 2: Run** `pnpm exec vitest run tests/adapters/adapter-contract.test.ts` **and confirm the synthetic fixture/adapter/contract do not yet exist.**
- [x] **Step 3: Create one small offline `synthetic.test` HTML fixture and tests-only adapter/runtime definition**, explicitly discover `time-ago.synthetic-event`, extract only `datetime` using existing `sourceKind: "time-ago"`/trusted rule, and instantiate `new AdapterRegistry([githubAdapter, syntheticAdapter])` only inside tests; do not add a production adapter, source kind, optional adapter hook, formatter, renderer, or observer.
- [x] **Step 4: Rerun** `pnpm exec vitest run tests/adapters/adapter-contract.test.ts tests/adapters/github.test.ts`; require both adapters to pass identical shared behavioral cases and the production default registry to reject `synthetic.test`.

**Verification**: A truly distinct tests-only site satisfies the existing typed GitHub adapter contract while all undeclared attribute guessing and production registration remain forbidden.

### [x] Task 2: Demonstrate common semantic ownership, formatting, and incremental mutation

**Files:** `tests/integration/synthetic-adapter.test.ts` (create), `tests/fixtures/synthetic/adapter.ts`.

- [x] **Step 1: Add failing public synthetic document/controller cases** for System/custom/UTC presentation through existing `processDocument`, semantic owned `<time datetime>`, intact hidden source/accessible text/link behavior, one existing MutationObserver, bounded added-root discovery, unchanged idle/unrelated mutations, updated valid `datetime`, restoration on invalid/missing `datetime`, removed-root cleanup, duplicate idempotence, teardown restoring only owned nodes, and ignored title/aria/data-only carriers.
- [x] **Step 2: Run** `pnpm exec vitest run tests/integration/synthetic-adapter.test.ts tests/core/document-transformation-controller.test.ts` **and establish missing synthetic test coverage without changing GitHub behavior.**
- [x] **Step 3: Drive the existing `processDocument`/`DocumentTransformationController` with the injected test registry and static HTML fixture**, assert actual owned DOM and scheduler behavior only, and use the existing `datetime` observer filter; add no shared selector logic, source-rule guessing, extra observer, polling, adapter DOM operations, or speculative optional adapter hook.
- [x] **Step 4: Rerun** `pnpm exec vitest run tests/integration/synthetic-adapter.test.ts tests/core/document-transformation-controller.test.ts tests/core/document-mutation-scheduler.test.ts tests/integration/process-document.test.ts`.

**Verification**: The synthetic site receives identical localized/custom semantic replacement, incremental update, safe invalidation, and full restoration without owning any shared behavior.

### [x] Task 3: Add only the proven optional content-runtime registry seam

**Files:** `src/content/runtime.ts`, `tests/content/runtime.test.ts`, `tests/fixtures/synthetic/adapter.ts`.

- [x] **Step 1: Add failing actual `installContentRuntime` tests** supplying a synthetic document plus injected two-adapter registry; require saved display/debug hydration, one existing message listener/controller/observer, dynamic source updates, presentation/debug acknowledgements, safe teardown, and unchanged omitted-registry GitHub-only and duplicate-install behavior.
- [x] **Step 2: Run** `pnpm exec vitest run tests/content/runtime.test.ts tests/adapters/adapter-contract.test.ts` **and show the current runtime drops the custom registry before document processing.**
- [x] **Step 3: Add optional typed `registry?: AdapterRegistry` only to the existing content-runtime input** and conditionally include it in its existing `ProcessInput`; preserve production callers/default registry, content entrypoint, readiness generation/revision gating, one listener, one observer, diagnostic sink, and message contracts unchanged.
- [x] **Step 4: Rerun** `pnpm exec vitest run tests/content/runtime.test.ts tests/content/main.test.ts tests/adapters/github.test.ts tests/adapters/adapter-contract.test.ts` **and confirm production defaults remain exact-GitHub-only.**

**Verification**: The smallest demonstrably necessary typed seam lets test-defined adapters use the real shared content lifecycle while production code never registers or imports a second site.

### [x] Task 4: Exercise real synthetic settings, activation, diagnostics, and teardown

**Files:** `tests/integration/synthetic-adapter.test.ts`, `tests/fixtures/synthetic/adapter.ts`.

- [x] **Step 1: Add failing compact end-to-end harness cases** injecting actual GitHub+synthetic site/runtime adapters into `BackgroundApplication`, `AdapterActivationCoordinator`, `SettingsService`, `DiagnosticJournal`, and `installContentRuntime`; require synthetic exact-host registration and existing-tab activation only inside the test fake, default localized output, committed custom/UTC presentation updates on existing/future owned dates, site/global disable restoration and re-enable reinjection, revisioned content acknowledgements, opt-in sanitized synthetic-host events, debug-off zero collection, delete-on-disable/no resurrection, no persisted source text/URL/datetime, isolated diagnostics failure, and one runtime listener/observer.
- [x] **Step 2: Run** `pnpm exec vitest run tests/integration/synthetic-adapter.test.ts tests/runtime/adapter-activation.test.ts tests/background/application.test.ts` **and confirm only the injected real multi-adapter integration remains unproven.**
- [x] **Step 3: Assemble a small test-owned browser/storage/document harness over existing public services**, inject the new optional registry only into test `installContentRuntime`, use real settings intents and trusted synthetic sender metadata, and retain atomic V5 snapshots/shared diagnostics without changing background, settings, diagnostics, activation, formatting, DOM ownership, or mutation production code.
- [x] **Step 4: Rerun** `pnpm exec vitest run tests/integration/synthetic-adapter.test.ts tests/integration/presentation-updates.test.ts tests/runtime/adapter-activation.test.ts tests/background/application.test.ts` **and preserve every evolving Issue 13/14 GitHub/reset/reporting case.**

**Verification**: A second harness-only site traverses the complete unchanged policy, presentation, ownership, observer, debug, and teardown pipeline without duplicated business logic.

### [x] Task 5: Prove all six shipped artifacts remain exact-GitHub-only

**Files:** `tests/build/chrome-artifact.test.ts`.

- [x] **Step 1: Extend observable emitted Chrome/Edge/Firefox development/release tests** to execute each real generated background against active `https://synthetic.test/...`/non-HTTP/subdomain cases and assert no synthetic registration/injection, Popup `hasAdapter: false`/no-rules status, built-in Sites containing only `github.com`, and retained ordinary explicit-host preference without processing; execute generated content on a synthetic fixture and require untouched DOM, while exact HTTP(S) GitHub still registers once, transforms dates, and preserves diagnostics/reset/reporting behavior.
- [x] **Step 2: Run** `pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/adapters/adapter-contract.test.ts` **and ensure the test-only multi-adapter harness cannot alter emitted runtime discovery.**
- [x] **Step 3: Update only existing fake browser/public emitted artifact interactions**, inspect dynamic script registration matches and actual Popup/Sites/content outcomes, preserve `<all_urls>` host permission with exact GitHub activation, and avoid bundled/source-text scans, new manifests/adapters, network, browser automation, or external utility tests.
- [x] **Step 4: Run** `pnpm check`, `pnpm dev`, `pnpm release`, **and** `pnpm lint`; require at least the inherited 752 tests plus all concurrent Issue 13/14 additions, synthetic contract/integration cases, and six installable development/release artifacts to pass without Git, Corepack, network, or live browsers.

**Verification**: The future-adapter architecture is proven by a complete tests-only synthetic site while every production browser artifact still supports only exact `github.com`.
