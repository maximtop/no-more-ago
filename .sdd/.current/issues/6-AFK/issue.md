# Issue: [no-more-ago] Toggle global activation from the popup

**Issue ID**: 6-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 2-AFK, 5-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Deliver the first persisted control path: an English popup backed by a background-owned versioned settings snapshot with a global enabled flag. The toggle must dynamically register or unregister future GitHub documents, inject already-open eligible tabs on enable, tear down active tabs on disable, and expose active, globally disabled, inaccessible-page, and runtime-failure status without page UI or a replacement counter.

## How to Verify

- **Manual**: Open GitHub and the popup, switch the extension off and on, and confirm immediate restoration/replacement across already-open tabs and persistence after an extension restart.
- **Automated**: Exercise popup actions through the background service boundary and assert saved state, dynamic registration calls, existing-tab execution, teardown, status rendering, write-failure feedback, and idempotent repeated commands.

## Acceptance Criteria

1. **Given** a fresh valid settings state, **When** the popup opens on GitHub, **Then** the global switch is on, the hostname is shown, and status is `Active on github.com` with no counter.
2. **Given** active GitHub tabs, **When** the global switch is turned off and the setting commits, **Then** future registration is removed and every reachable active tab restores its original dates immediately.
3. **Given** the global switch is off, **When** it is turned on, **Then** early registration returns and already-open GitHub tabs are injected and processed without reload.
4. **Given** a restricted browser page or a runtime activation failure, **When** the popup loads, **Then** it shows `Cannot run on this page` or `Could not process this page` without injecting a page error.
5. **Given** persistence rejects a toggle change, **When** the popup receives the failure, **Then** it reports the save error and keeps the previous setting and runtime behavior.

## User Stories Addressed

- User Story 3: Disable and restore safely
- User Story 5: Understand and manage current status
- User Story 7: Keep settings valid and recoverable
