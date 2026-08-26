# Issue: [no-more-ago] Configure system format and time zone

**Issue ID**: 8-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 6-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Add the options-page display slice for localized system format and System, UTC, or valid IANA time zones. Default output must use the browser language list, medium date, short time, and system clock convention. Saving a valid choice must persist through Settings Service and reformat all owned dates in open GitHub tabs without reload; invalid or unavailable zones must follow the PRD’s error and fallback rules.

## How to Verify

- **Manual**: Compare default output under two browser locales, save UTC and an IANA zone, and confirm already-open GitHub dates update while invalid input cannot be saved.
- **Automated**: Test representative locales, 12/24-hour output, daylight-saving boundaries, all zone modes, unavailable-zone fallback, save failure, and cross-tab reformat notification.

## Acceptance Criteria

1. **Given** default settings, **When** a timestamp is rendered, **Then** it uses localized medium date and short time with year and minutes, no seconds, and the browser’s system time zone and clock convention.
2. **Given** System, UTC, or a valid IANA zone, **When** the user saves it, **Then** the setting persists and all existing and future owned dates use that zone.
3. **Given** an invalid entered IANA zone, **When** save is attempted, **Then** saving is blocked with an actionable English error and prior output remains active.
4. **Given** a previously saved zone is unavailable at runtime, **When** formatting occurs, **Then** dates use the system-zone fallback and Options exposes a correction error.
5. **Given** the operating-system locale or zone changes while a tab is open, **When** a new candidate appears, **Then** it uses current system values without background polling; existing output waits for an agreed refresh trigger.

## User Stories Addressed

- User Story 4: Choose date presentation
- User Story 7: Keep settings valid and recoverable
