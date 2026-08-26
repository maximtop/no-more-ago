# Issue: [no-more-ago] Configure a custom date format

**Issue ID**: 9-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 8-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Add the `Custom format` mode with an English-labeled pattern field, examples, live preview, Unicode-token validation, browser-locale month/weekday names, and `en-US` fallback. Draft edits must not affect pages until `Save` succeeds. The UI must not advertise the underlying library and must not offer combined exact-plus-relative output.

## How to Verify

- **Manual**: Enter valid numeric and localized-name formats, observe preview-only changes, save one, and confirm open GitHub tabs update; try empty, malformed, and legacy-token patterns and confirm save is blocked.
- **Automated**: Exercise the options form and presentation service across valid/invalid tokens, locale availability, fallback, persistence failure, time-zone combinations, and open-tab reformatting.

## Acceptance Criteria

1. **Given** `Custom format` is selected, **When** a valid pattern is edited, **Then** preview updates immediately while saved GitHub output remains unchanged until `Save`.
2. **Given** a valid custom pattern is saved, **When** current and future dates render, **Then** they use that pattern and the selected time zone without any appended relative phrase.
3. **Given** an empty, malformed, or rejected legacy-token pattern, **When** save is attempted, **Then** persistence is blocked and an actionable English field error is shown.
4. **Given** localized month or weekday tokens, **When** output is formatted, **Then** the nearest available browser locale is used and `en-US` is the fallback.
5. **Given** the options UI is inspected, **When** format controls are read, **Then** they use product terminology rather than naming `date-fns`, and no combined mode exists.

## User Stories Addressed

- User Story 4: Choose date presentation
