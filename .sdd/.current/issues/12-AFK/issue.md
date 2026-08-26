# Issue: [no-more-ago] Download and clear diagnostic logs

**Issue ID**: 12-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 11-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Complete the local diagnostics workflow with `Download logs` and `Clear logs`. Download must create one ZIP containing the entire current sanitized journal and environment metadata without uploading it. Clear must remove entries while preserving the enabled toggle. Empty, storage, and compression states must be understandable and non-fatal.

## How to Verify

- **Manual**: Generate several debug events, download and inspect the ZIP, clear the journal, confirm logging remains enabled, and generate a new entry afterward.
- **Automated**: Open generated ZIPs and validate their structured contents, exclusion rules, environment metadata, empty state, clear semantics, and typed storage/compression failure behavior.

## Acceptance Criteria

1. **Given** a non-empty sanitized journal, **When** `Download logs` is pressed, **Then** one local ZIP containing all current entries and environment metadata is produced and no upload occurs.
2. **Given** downloaded diagnostics, **When** the archive is inspected, **Then** it contains no field forbidden by the journal privacy contract.
3. **Given** logging is enabled and entries exist, **When** `Clear logs` is pressed, **Then** all entries are removed while logging remains enabled for future events.
4. **Given** the journal is empty or ZIP generation fails, **When** the user invokes diagnostics actions, **Then** the UI shows a clear state or actionable error and timestamp processing remains active.

## User Stories Addressed

- User Story 9: Collect opt-in diagnostics
- User Story 11: Protect local browsing data
