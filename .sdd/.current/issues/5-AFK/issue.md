# Issue: [no-more-ago] Build Chrome, Firefox, and Edge targets

**Issue ID**: 5-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 1-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Complete the maintainer-facing build slice for distinct Chrome, Firefox, and Edge development and release artifacts. Provide the agreed Make and pnpm target interfaces, browser-specific manifests derived from a common definition, package-version propagation, a temporary clock icon, ZIP outputs, watch rebuilding, and clear invalid-target failures. Watch mode must not launch or reload a browser.

## How to Verify

- **Manual**: Run one all-target build, one single-target build, and one watch command; inspect the resulting browser-specific artifacts and stop watch after observing a rebuild.
- **Automated**: Invoke every public build mode in an isolated test workspace, validate manifests and archives through parsers/loaders, verify version consistency, observe watch output behavior, and assert invalid targets fail clearly.

## Acceptance Criteria

1. **Given** dependencies are installed, **When** `make dev` or `make release` runs, **Then** all three browser targets produce distinct unpacked and ZIP artifacts for that mode.
2. **Given** `chrome`, `firefox`, or `edge` is supplied to a Make target, **When** it runs, **Then** only that browser artifact is produced with an appropriate manifest.
3. **Given** `pnpm dev <browser> --watch`, **When** an input changes, **Then** only that development target rebuilds and no browser is launched or reloaded.
4. **Given** an unknown target or invalid command combination, **When** the command runs, **Then** it exits unsuccessfully with actionable usage information.
5. **Given** any generated manifest or release artifact, **When** its version is inspected, **Then** it matches the single package version and requires no duplicate manual version value.
6. **Given** a fresh build is installed, **When** installation completes, **Then** it has the temporary icon and does not open onboarding or settings automatically.

## User Stories Addressed

- User Story 12: Build and run each browser target
