# Issue: [no-more-ago] Manage exact-host site preferences

**Issue ID**: 7-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 6-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Add exact-hostname preferences to the popup and an options-page `Sites` section. Every HTTP/HTTPS hostname is enabled by default; an explicit user action creates a retained preference. Disabling `github.com` must restore current tabs and remove future registration, while hostnames without adapters keep a neutral status and saved preference but perform no DOM processing. Global policy remains the effective override.

## How to Verify

- **Manual**: Disable and re-enable `github.com`, then change a preference on a site with no adapter; inspect `Sites` and confirm exact hostname independence and immediate GitHub behavior.
- **Automated**: Drive current-tab and options UI actions across parent/subdomain, adapter/no-adapter, global-off, restart, and inaccessible-page cases; assert storage is created only by explicit actions.

## Acceptance Criteria

1. **Given** global activation and active GitHub tabs, **When** `github.com` is disabled, **Then** its exact hostname preference persists, current tabs restore immediately, and future GitHub documents do not start the adapter.
2. **Given** `github.com` is disabled, **When** it is re-enabled, **Then** open tabs process immediately and its retained `Sites` row remains available.
3. **Given** a hostname with no adapter, **When** the popup opens, **Then** its switch is usable and status says `Rules are not available for <hostname> yet` without calling it unsupported.
4. **Given** parent, subdomain, or sibling hostnames, **When** one preference changes, **Then** no other exact hostname inherits that value.
5. **Given** ordinary browsing without a preference action, **When** `Sites` is inspected, **Then** no visited hostname was stored; `github.com` is always listed because it has a built-in adapter.
6. **Given** the global switch is off, **When** a site preference is edited, **Then** it is saved but causes no runtime activation until global enablement returns.

## User Stories Addressed

- User Story 3: Disable and restore safely
- User Story 5: Understand and manage current status
- User Story 13: Add future adapters without rewriting the core
