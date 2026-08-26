# Issue: [no-more-ago] Collect bounded opt-in debug logs

**Issue ID**: 11-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 4-AFK, 6-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Add an options-page `Debug logs` toggle and a separate local diagnostic journal. When enabled, collect useful structured lifecycle, adapter, mutation, timing, settings, skip, and error events from background and document runtimes. Sanitize forbidden page data, include permitted private/incognito events, evict oldest records to stay within 5 MB, and delete the journal immediately when logging is disabled. Diagnostic failure must not interrupt timestamp processing.

## How to Verify

- **Manual**: Enable debug logging, exercise GitHub processing, inspect journal size/metadata through diagnostics UI, then disable logging and confirm all entries disappear while dates continue working.
- **Automated**: Drive allowed and forbidden event payloads, private-tab context, high-volume and oversized records, storage errors, enable/disable transitions, and runtime activity; inspect persisted structured output and behavior.

## Acceptance Criteria

1. **Given** a fresh install or reset, **When** runtime activity occurs, **Then** debug logging is off and no persistent diagnostic entry is created.
2. **Given** debug logging is enabled, **When** relevant technical events occur, **Then** structured lifecycle, counts, durations, reason codes, environment details, and sanitized errors are recorded locally.
3. **Given** any diagnostic event, **When** it is sanitized, **Then** no full URL, query/hash, DOM content, visible text, secret, or source `datetime` is persisted.
4. **Given** the extension has private/incognito permission, **When** an event occurs there while logging is enabled, **Then** it follows the same sanitized local policy.
5. **Given** the next record would exceed 5 MB, **When** it is appended, **Then** oldest entries are evicted and an excessive individual record is truncated or discarded so the cap is never exceeded.
6. **Given** logging is turned off, **When** the setting commits, **Then** collection stops and all stored entries are deleted; diagnostic storage failure never disables date replacement.

## User Stories Addressed

- User Story 9: Collect opt-in diagnostics
- User Story 11: Protect local browsing data
