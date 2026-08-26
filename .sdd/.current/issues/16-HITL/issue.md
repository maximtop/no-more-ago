# Issue: [no-more-ago] Validate live GitHub across supported browsers

**Issue ID**: 16-HITL
**Type**: HITL
**Status**: Approved
**Blocked by**: 4-AFK, 5-AFK, 7-AFK, 9-AFK, 10-AFK, 12-AFK, 13-AFK, 14-AFK, 15-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Resolve the PRD’s browser/runtime open questions with a final release-candidate slice. With explicit human permission for browser work, install the built artifacts in current stable Chrome, Edge, and Firefox; verify dynamic `document_start` registration, open-tab execution, teardown/re-enable, settings, reporting, and current live GitHub DOM across every agreed page category. Fix browser-runtime or adapter discrepancies inside their established boundaries, refresh fixtures, and set evidence-based manifest minimum versions. Exclude a GitHub path only after a reproducible documented safety problem and human review.

## How to Verify

- **Manual**: Grant browser-testing permission, install each release candidate, run the shared checklist on commits, issues/pull requests, timelines, releases/tags, profiles/activity, search, and Actions, then review any proposed route exclusion and the selected minimum versions.
- **Automated**: Run the full unit/integration/build suite against final artifacts, validate all manifests and refreshed fixtures, and retain reproducible regression coverage for every discrepancy fixed during live smoke.

## Acceptance Criteria

1. **Given** current stable Chrome, Edge, and Firefox with the corresponding release artifacts, **When** a fresh GitHub document loads, **Then** early dynamic registration reaches the new top-level document and eligible dates render correctly.
2. **Given** an already-open tab, client-side navigation, dynamic content, disable, and re-enable, **When** the shared checklist is executed in each browser, **Then** processing and exact restoration behave consistently without requiring page reloads.
3. **Given** the agreed GitHub page categories, **When** live smoke is completed, **Then** every category passes or has a reproducible safety failure, fixture, documented exclusion proposal, and human decision.
4. **Given** a browser-specific API discrepancy, **When** it is corrected, **Then** the change remains inside the Browser Runtime boundary and a regression test covers the observable behavior.
5. **Given** the scripting, locale, and time-zone APIs actually used, **When** compatibility evidence is reviewed, **Then** each manifest declares a justified minimum browser version.
6. **Given** final artifacts and test results, **When** the HITL review completes, **Then** no unresolved cross-browser activation or live-GitHub compatibility question remains for MVP sign-off.

## User Stories Addressed

- User Story 1: See exact GitHub dates
- User Story 2: Handle dynamic GitHub pages
- User Story 12: Build and run each browser target
