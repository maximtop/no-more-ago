# Issue Validation Report: [no-more-ago] Report missing or broken site support

- **Validated**: 2026-08-25
- **Model**: Codex GPT-5.6
- **Issue**: `.sdd/.current/issues/14-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/14-AFK/plan.md`
- **Validation attempt**: 1

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 5 | 0 | 0 | 5 |
| Acceptance Criteria | 6 | 0 | 0 | 6 |
| Entities | 2 | 0 | 0 | 2 |
| Contracts | 7 | 0 | 0 | 7 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

## Task Status

- [x] **Task 1: Define one editable public issue form and fixed-origin composer** — PASS. The single public `Site report` template contains both exact reason labels and editable hostname, URL, version, browser, observed, and expected fields. Parsed observable composer URLs demonstrate the fixed GitHub HTTPS destination, template selection, safe context encoding, and rejection of malformed or untrusted values.
- [x] **Task 2: Add a tiny trusted, user-invoked tab reporter with private-window isolation** — PASS. Reporting performs no active-tab query, browser-context acquisition, or navigation before explicit invocation; only a selected matching credential-free HTTP(S) page may populate the composer, and private reports remain in their original private window or fail safely.
- [x] **Task 3: Expose site-specific reporting from eligible Popup states** — PASS. Exactly one `Report this site` action supports adapter, no-adapter, and disabled eligible states; exact report reasons and complete selected URLs are verified through rendered Popup behavior and all six emitted browser artifacts.
- [x] **Task 4: Expose useful generic reporting in Options Diagnostics** — PASS. One explicit `Open GitHub issue` action opens the same form with blank hostname, URL, and reason, without querying or exposing its extension page; reporting remains usable with debugging disabled and preserves diagnostics/archive actions and the healthy/recovery reset workflows.
- [x] **Task 5: Prove user-controlled reporting in all six emitted extension artifacts** — PASS. Actual Chrome, Edge, and Firefox development/release Popup and Options bundles exercise user clicks, both exact report reasons, trusted browser/version context, pre-click inactivity, safe private-window binding, failure notices, and unchanged diagnostics/settings boundaries.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Supported `github.com` opens the public Site report composer with `Dates are not working correctly`. | MET | Focused reporter/Popup tests and all six emitted Popup executions parse the fixed GitHub destination, `template=site-report.yml`, exact broken-site reason, canonical `github.com`, and selected full URL. |
| 2 | An HTTP(S) site without an adapter opens the same composer with `Add support for this site`. | MET | Focused reporter/Popup tests and every emitted artifact exercise a disabled `news.example` Popup and observe the same fixed template with the exact missing-adapter reason and full selected URL. |
| 3 | The composer exposes editable hostname, current URL, extension/browser context, and observed/expected prompts. | MET | The single public issue form declares all editable fields and separate observed/expected text areas; focused and emitted behavior verifies canonical matching hostname, full HTTP(S) URL, trusted manifest version, and coarse Chrome/Edge/Firefox browser identity. Options intentionally leaves site fields and reason blank. |
| 4 | Reports are user-reviewed and never auto-submitted or populated with captured page content. | MET | The small UI-owned reporter exclusively opens one fixed GitHub issue-composer tab per explicit action, never reads page content or DOM, and has no submission, network-request, background-route, or persistence mechanism; emitted tests observe no navigation or browser-context reads before clicks. |
| 5 | Diagnostics ZIP files are never automatically uploaded or attached. | MET | Options artifact tests explicitly establish unchanged diagnostics access, settings writes, blob/download activity, and ZIP state when reporting; existing archive/download suites and explicit user-triggered ZIP download remain independently green. |
| 6 | Normal extension behavior never initiates reporting navigation without an explicit action. | MET | All six emitted Options/Popup artifacts assert zero report tab queries, navigations, and manifest reads before interaction; focused tests also cover pending duplicate suppression and restricted, missing, mismatched, credentialed, private-window, and rejected-create failures without unintended navigation. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Editable GitHub site-report context | Exact editable template field IDs, both reason labels, trusted version/coarse browser, and observed/expected prompts | Site-specific trusted Popup state and active tab; intentionally generic Options environment-only context | Fixed HTTPS destination/template, canonical host equality, HTTP(S)-only selected URL, credential rejection, safe percent encoding | PASS |
| Minimal user-invoked browser reporter | Narrow existing tab query/create, trusted manifest, coarse browser identity, and private tab/window metadata | UI-owned injectable Popup/Options integration without new background, persistence, diagnostics, or permission surfaces | Explicit-click-only work, one navigation, duplicate suppression, mandatory private-window binding, typed actionable failures | PASS |

## Contract Status

| Contract | Method | Status | Notes |
| --- | --- | --- | --- |
| GitHub template | One public issue-form template | PASS | `site-report.yml` exposes one `Site report` form with both exact reasons and all editable metadata/behavior fields. |
| Public URL | Fixed parsed GitHub HTTPS composer | PASS | Only `https://github.com/maximtop/no-more-ago/issues/new` with `template=site-report.yml`; site-specific reasons are exact and Options omits site/reason values. |
| Popup intent | Explicit current-window active-tab query and safe tab creation | PASS | Trusted ready-state hostname/adapter agreement, HTTP(S) validation, credential rejection, disabled/no-adapter support, and safe restricted/mismatch failures. |
| Options intent | Explicit generic issue-form navigation | PASS | Works with debugging disabled; no active-tab query, extension URL disclosure, diagnostics access, archive attachment, or implicit download. |
| Trusted environment/private boundary | Manifest version, coarse browser family, and original private window | PASS | Actual emitted Chrome/Edge/Firefox metadata is validated; incognito source opens in exact originating `windowId`, while missing private-window ownership blocks navigation. |
| Security/privacy | UI-only manual composer | PASS | No pre-click collection/navigation, page capture, uploads, submission, persistence, new permission, or background reporting route. |
| Error handling | Single attempted user action and actionable notices | PASS | Missing/restricted/mismatched/credentialed contexts, unsafe private placement, invalid trusted environment, and rejected tab creation fail without retries or unintended navigation. |

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Validate externally observable behavior | COMPLIANT | Focused tests render real UI and parse composer URLs; integration exercises actual emitted extension artifacts rather than implementation-source substring assertions. |
| Preserve simple existing architecture and privacy | COMPLIANT | One public template, one small UI helper, no new browser permissions, routes, services, dependencies, history, automatic reporting, or upload mechanism. |
| Preserve prior diagnostics, reset, and presentation behavior | COMPLIANT | Focused background/settings/Options/archive/live-presentation suites remain green, including truthful healthy/recovery reset handling and manual-only diagnostic downloads. |
| Use the approved local toolchain and avoid conflicting builds | COMPLIANT | Independent focused run used login-shell Node `v24.18.1` and direct pnpm `10.34.5` without simultaneously rebuilding emitted artifacts. |
| Complete independent focused and full quality gates | COMPLIANT | Focused: **8 files, 369 tests passed**. Independently reported full `pnpm check`: clean ESLint, strict TypeScript, **30 files, 807 tests passed**, including all six Chrome/Edge/Firefox development/release emitted artifacts. |

## Issues Found

None.

## Recommendations

- No further implementation changes are required.
