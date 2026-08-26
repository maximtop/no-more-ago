# Issue: [no-more-ago] Report missing or broken site support

**Issue ID**: 14-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 7-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Add `Report this site` to the popup and an `Open GitHub issue` diagnostics action, backed by one public `Site report` issue template. Prefill the missing-site or broken-site reason from adapter availability, along with editable hostname, current URL, extension/browser context, and prompts for observed and expected behavior. The user must review and submit; no DOM capture, automatic submission, log upload, or attachment is allowed.

## How to Verify

- **Manual**: Open reporting from `github.com` and from a no-adapter hostname, inspect each GitHub composer, edit the body, and abandon it without submission; separately confirm a downloaded ZIP must be attached manually.
- **Automated**: Exercise report composition for adapter, no-adapter, restricted, and missing-context states; parse the resulting GitHub URL/template values and observe that no network action occurs before explicit invocation.

## Acceptance Criteria

1. **Given** `github.com`, **When** `Report this site` is invoked, **Then** the public `Site report` composer opens with `Dates are not working correctly` preselected.
2. **Given** an HTTP/HTTPS hostname with no adapter, **When** reporting is invoked, **Then** the same composer opens with `Add support for this site` preselected.
3. **Given** report context is available, **When** the composer opens, **Then** editable fields include hostname, current URL, extension version, browser context, and observed/expected prompts.
4. **Given** the composer is open, **When** the user edits or closes it, **Then** nothing is submitted automatically and the extension has captured no DOM snapshot or page content.
5. **Given** a diagnostic ZIP exists, **When** reporting is used, **Then** the extension neither uploads nor attaches it; the user handles attachment manually.
6. **Given** no explicit report action, **When** normal extension behavior is observed, **Then** no reporting network navigation occurs.

## User Stories Addressed

- User Story 5: Understand and manage current status
- User Story 10: Report a site or broken behavior
- User Story 11: Protect local browsing data
