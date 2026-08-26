# Issue: [no-more-ago] Recover versioned settings safely

**Issue ID**: 10-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 6-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Harden Settings Service into the sole serialized writer for one schema-versioned current snapshot and one previous known-good snapshot. Validate whole proposed states before atomic replacement, preserve behavior on write failure, restore a valid backup, and enter inactive recovery mode when both snapshots fail. Include the pre-public reset policy and migration seam without promising downgrade compatibility or account sync.

## How to Verify

- **Manual**: Simulate a save failure and each corruption state through the development harness; confirm old behavior remains, backup recovery succeeds, and dual corruption leaves processing off with a reset action.
- **Automated**: Run concurrent intent updates, invalid whole-state inputs, persistence failures, current-only corruption, dual corruption, unknown schema, pre-public reset, and migration contract tests through Settings Service’s public interface.

## Acceptance Criteria

1. **Given** popup and options submit changes concurrently, **When** Settings Service processes them, **Then** they are serialized against the latest valid revision and no accepted field update is lost.
2. **Given** any proposed field or schema value is invalid, **When** validation runs, **Then** the entire write is rejected and current runtime behavior is preserved.
3. **Given** persistence fails during replacement, **When** the caller receives the result, **Then** the prior current and backup snapshots remain authoritative and an actionable error is returned.
4. **Given** the current snapshot is invalid and the previous snapshot is valid, **When** initialization runs, **Then** the previous snapshot is restored and used.
5. **Given** both snapshots are invalid, **When** initialization runs, **Then** adapters remain inactive and UI exposes `Reset all settings` rather than silently enabling defaults.
6. **Given** a pre-store schema is incompatible, **When** a development build initializes, **Then** it may request reset; once a public baseline exists, only tested forward migrations from released schemas are accepted.

## User Stories Addressed

- User Story 7: Keep settings valid and recoverable
