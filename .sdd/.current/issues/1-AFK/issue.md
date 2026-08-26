# Issue: [no-more-ago] Replace the first trusted GitHub timestamp

**Issue ID**: 1-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: None — can start immediately

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Create the first installable Chrome development tracer bullet from the empty repository. It must build with the agreed stack, activate at the earliest reliable point on exact `github.com`, resolve one trusted zoned GitHub `relative-time` timestamp through an adapter boundary, format it with the default localized system presentation, and render one semantic exact date. Include the common registry and browser-runtime seams needed by later slices without adding another supported site.

## How to Verify

- **Manual**: Build and load the Chrome development artifact, visit a public `github.com` page containing a relative timestamp, and confirm that it becomes an exact localized date while another hostname remains untouched.
- **Automated**: Exercise the public Chrome build, validate the installable manifest and package-derived version, and run an end-to-end fixture test from GitHub adapter selection through trusted resolution, formatting, and semantic DOM output.

## Acceptance Criteria

1. **Given** project dependencies are installed, **When** the Chrome development build runs, **Then** it produces an installable artifact with the agreed extension name, package-derived version, `<all_urls>` host permission, and required scripting/storage capabilities.
2. **Given** default activation and a `github.com` document containing a valid zoned `relative-time`, **When** the document runtime starts, **Then** one exact date is produced through the registered GitHub adapter and shared presentation path.
3. **Given** the same markup on a non-GitHub hostname, **When** activation is evaluated, **Then** no GitHub adapter is selected and the document is unchanged.
4. **Given** the first implementation is reviewed through its public adapter interface, **When** candidate discovery is invoked, **Then** GitHub-specific selection and extraction are not required by the shared formatter or browser runtime.

## User Stories Addressed

- User Story 1: See exact GitHub dates
- User Story 12: Build and run each browser target
- User Story 13: Add future adapters without rewriting the core
