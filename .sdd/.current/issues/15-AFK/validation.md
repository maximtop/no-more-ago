# Issue Validation Report: [no-more-ago] Prove the adapter contract with a synthetic site

- **Validated**: 2026-08-25
- **Model**: Codex GPT-5.6
- **Issue**: `.sdd/.current/issues/15-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/15-AFK/plan.md`
- **Validation attempt**: 1

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 5 | 0 | 0 | 5 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 2 | 0 | 0 | 2 |
| Contracts | 7 | 0 | 0 | 7 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

## Task Status

- [x] **Task 1: Define one tests-only synthetic fixture and parameterized adapter contract** — PASS. The fixture and second adapter reside solely under `tests/fixtures/synthetic/`; shared parameterized cases exercise both real GitHub and synthetic adapters against exact HTTP(S) host selection, bounded discovery, source identity, explicit trusted `datetime`, and production-registry isolation.
- [x] **Task 2: Demonstrate common semantic ownership, formatting, and incremental mutation** — PASS. The existing document pipeline produces locale-aware System and custom UTC semantic `<time>` output, hides/restores original nodes, observes only `datetime` with one shared MutationObserver, handles added/removed regions and changed/invalid timestamps, and ignores unrelated generic attributes.
- [x] **Task 3: Add only the proven optional content-runtime registry seam** — PASS. The sole production extension is optional typed `registry?: AdapterRegistry` forwarded to its already registry-aware `ProcessInput`; production `content/main.ts` supplies no registry and the unchanged default registry contains GitHub only. Injected-runtime tests retain one listener/observer, revisioned settings/debug acknowledgements, hydration, and teardown.
- [x] **Task 4: Exercise real synthetic settings, activation, diagnostics, and teardown** — PASS. One test-owned browser/storage harness connects actual `BackgroundApplication`, `SettingsService`, `AdapterActivationCoordinator`, `DiagnosticJournal`, and content runtimes for GitHub and the synthetic host. It verifies atomic settings changes, custom display updates, site/global disable and reactivation, opt-in sanitized diagnostics, journal failure isolation, and delete-on-disable.
- [x] **Task 5: Prove all six shipped artifacts remain exact-GitHub-only** — PASS. Real emitted Chrome, Edge, and Firefox development/release backgrounds register only the exact GitHub script, return synthetic/subdomain no-rules states, preserve GitHub-only built-in Sites, never inject unsupported tabs, and leave a real executed synthetic document completely unchanged.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | A harness-only synthetic adapter receives shared formatting, semantic replacement, incremental updates, and restoration without duplicating core behavior. | MET | Parameterized adapter contract plus real `processDocument`, `DocumentTransformationController`, and full background/content integration demonstrate localized System/custom UTC outputs, semantic ownership, one existing observer, dynamic additions/updates, policy restoration, and reactivation. |
| 2 | An untrusted synthetic candidate safely produces no timestamp transformation. | MET | Focused adapter/document tests reject missing, relative, malformed, ambiguous, and timezone-less `datetime` values; invalidated sources restore their exact original text and remain visible. |
| 3 | Any necessary exceptional behavior is limited to a narrow typed extension boundary. | MET | Existing `SiteAdapter` discovery/extraction already suffices without a new adapter hook; the only necessary production seam is optional typed runtime registry forwarding, preserving production default selection and disallowing adapter-owned DOM or observer logic. |
| 4 | Production Chrome, Edge, and Firefox artifacts support only exact `github.com`. | MET | All six emitted backgrounds expose GitHub-only built-in Sites and registration matches, classify synthetic/subdomain hosts as `hasAdapter: false`/`no-rules`, avoid unsupported injection, and execute emitted content on an unchanged synthetic document. |
| 5 | Generic `title`, `aria-label`, and `data-*` values without an explicit adapter rule remain ignored. | MET | Fixture, parameterized extraction, live document, and mutation tests reject metadata-only elements and observe that title/ARIA/data changes trigger no processing; the one existing observer remains restricted to the approved `datetime` attribute. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Test-only synthetic adapter and fixture | Exact synthetic host, explicit selector, authoritative `datetime`, existing source kind, and trusted timestamp rule | Injected only into test-owned adapter registries and runtime definitions; processed by unchanged shared services | HTTP(S) exact-host matching, strict trusted timestamp resolution, bounded discovery, one shared observer, full restore, and GitHub-only production isolation | PASS |
| Narrow optional runtime registry injection | Existing content runtime input plus typed optional `registry?: AdapterRegistry` | Forwards only to existing registry-aware shared `ProcessInput`; production entry point omits it | Omitted registry remains GitHub-only; explicitly injected registry processes both adapters with one listener, one observer, and existing hydration/debug/teardown lifecycle | PASS |

## Contract Status

| Contract | Method | Status | Notes |
| --- | --- | --- | --- |
| Adapter | Existing typed `SiteAdapter` and shared source contract | PASS | Parameterized real GitHub/synthetic cases preserve approved source kinds, trusted datetime rule, exact matching, and root-inclusive discovery. |
| Trusted extraction | Explicit eligible zoned `datetime` only | PASS | Relative, missing, timezone-less, malformed, title/ARIA/data-only, and unrelated candidates remain unprocessed or restore safely. |
| Runtime seam | Optional typed `registry?: AdapterRegistry` | PASS | Conditional forwarding changes only injected test adapter selection; production caller, default registry, and existing runtime/message behavior remain unchanged. |
| Shared lifecycle | Existing formatter, renderer, controller, and one scheduler observer | PASS | Localized/System/custom UTC output, semantic source ownership, incremental updates, invalidation, subtree cleanup, policy restoration, and teardown are all observable. |
| Settings/diagnostics | Real settings service, activation coordinator, background, and bounded local journal | PASS | Atomic strict settings, revisioned policy/display changes, one-shot hydration, debug opt-in, sanitized sender metadata, isolated journal failure, and delete-on-disable are exercised. |
| Production boundary | Real default registry and all six emitted artifacts | PASS | Exact GitHub-only built-in registration/Sites; synthetic/subdomain no-rules, no synthetic registration or injection, and unchanged synthetic DOM. Explicit user-created unsupported-host preferences retain `hasAdapter: false`. |
| Scope | Test-only adapter and minimal unchanged production boundaries | PASS | No second production adapter, generic source guessing, observer expansion, permission/storage/schema/service changes, network, browser automation, or implementation-source assertion tests. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Validate externally observable runtime behavior | COMPLIANT | Adapter contracts, real DOM mutations, actual service interactions, journal contents, emitted background messages, and generated content effects are exercised without implementation-source substring tests. |
| Keep future-site architecture simple and test-only | COMPLIANT | One synthetic fixture/adapter and one necessary typed registry seam reuse all existing ownership, settings, diagnostics, and mutation infrastructure. |
| Preserve prior reporting, reset, diagnostics, and GitHub functionality | COMPLIANT | Focused reporting, Options/reset, ZIP diagnostics, background, GitHub content, and presentation suites pass; emitted artifacts retain validated real reporting and truthful reset behavior. |
| Use the approved local toolchain without conflicting emitted builds | COMPLIANT | Independent focused run used login-shell Node `v24.18.1` and direct pnpm `10.34.5`; no Git, browser, network, Corepack, or concurrent artifact rebuild. |
| Complete focused and full observable quality gates | COMPLIANT | Independent focused validation: **14 files, 302 tests passed**. Implementation full quality gate: **32 files, 832 tests passed**, including actual Chrome/Edge/Firefox development/release artifacts. |

## Issues Found

None.

## Recommendations

- No further implementation changes are required.
