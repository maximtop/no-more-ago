# Issue: [no-more-ago] Reset all extension state

**Issue ID**: 13-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 7-AFK, 9-AFK, 10-AFK, 11-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Make `Reset all settings` a single immediate recovery action across every implemented setting and diagnostic store. It must rebuild a valid default snapshot, enable the extension, clear explicitly managed hostnames, restore system format and time zone, turn debug logging off, delete logs, reconcile dynamic registration, and update open tabs. It must work from both normal Options and dual-corruption recovery mode without a confirmation dialog.

## How to Verify

- **Manual**: Change every setting, disable GitHub, create logs, press reset once, and confirm defaults and active GitHub output return immediately; repeat from simulated recovery mode.
- **Automated**: Seed every non-default field and diagnostics, invoke reset through Settings Service, and assert the committed snapshot, backup, site list, journal, registration, popup/options state, and open-tab behavior.

## Acceptance Criteria

1. **Given** non-default global, site, format, time-zone, and debug values plus stored logs, **When** `Reset all settings` is pressed, **Then** one action restores every documented default and deletes diagnostics without asking for confirmation.
2. **Given** active tabs were restored because global or GitHub policy was disabled, **When** reset commits, **Then** GitHub registration returns and those tabs are processed immediately.
3. **Given** custom presentation is active, **When** reset commits, **Then** system format and system time zone are applied to existing and future owned dates.
4. **Given** current and backup settings are corrupt, **When** reset is invoked from recovery mode, **Then** a valid default snapshot is created and normal activation resumes.
5. **Given** explicitly managed site rows exist, **When** reset completes, **Then** those preferences are cleared and only built-in adapter hosts remain listed by definition.

## User Stories Addressed

- User Story 3: Disable and restore safely
- User Story 7: Keep settings valid and recoverable
- User Story 9: Collect opt-in diagnostics
