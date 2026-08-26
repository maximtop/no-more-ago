# Issue: [no-more-ago] Own and restore timestamp DOM safely

**Issue ID**: 2-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 1-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Turn the initial replacement into a reversible, idempotent document transformation. Keep GitHub’s custom element intact, hide it only with extension-owned state, insert one semantic `time` sibling, preserve its containing interaction, and expose teardown that restores only No More Ago’s changes. Do not mutate GitHub’s shadow root or add page UI.

## How to Verify

- **Manual**: On a GitHub timestamp inside a link, verify the exact date, activate the link, request runtime teardown, and confirm the live original relative element returns without reloading.
- **Automated**: Run DOM and accessibility integration tests covering ownership, duplicate activation, semantic output, link behavior, screen-reader representation, foreign nearby changes, and complete teardown.

## Acceptance Criteria

1. **Given** an eligible GitHub host, **When** it is transformed, **Then** the host remains intact but hidden and exactly one extension-owned semantic `time` sibling carries the authoritative `datetime`.
2. **Given** the runtime is activated repeatedly, **When** the same host is processed again, **Then** no duplicate replacement, observer, or ownership marker is created.
3. **Given** a timestamp is inside an interactive container, **When** a keyboard or pointer user activates it, **Then** the original interaction still behaves correctly and the exact date is announced once.
4. **Given** teardown is requested after GitHub or another extension changed nearby DOM, **When** restoration runs, **Then** only No More Ago’s nodes, markers, and hiding state are removed.
5. **Given** GitHub renders relative content in a shadow root, **When** transformation and teardown run, **Then** that shadow root is never directly mutated and no page controls are injected.

## User Stories Addressed

- User Story 1: See exact GitHub dates
- User Story 3: Disable and restore safely
- User Story 6: Preserve accessibility and page ownership
