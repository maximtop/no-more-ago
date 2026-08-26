# Issue: [no-more-ago] Reject unsafe GitHub timestamps

**Issue ID**: 3-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 1-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Complete the GitHub adapter’s eligibility rules for `relative-time`, `time-ago`, and `time-until`. Accept only complete, explicitly zoned, date-fns-supported ISO 8601 instants with an explicit terminal `Z` or bounded numeric offset in the supported `±HH`, `±HHMM`, or `±HH:MM` spelling. Preserve and validate the whole raw value; require a complete calendar, ordinal, or week date and a time containing at least minutes, and reject padding, control characters, trailing text, reduced-precision/defaulted components, offset overflow, and negative-zero unknown offsets before parsing. Skip missing, malformed, ambiguous, zone-less, already-absolute, and unsupported elements. Cover all agreed GitHub page categories with small static source-derived fixtures while keeping visible relative prose out of the resolver. Acquire those examples once through direct unauthenticated HTTP, sanitize them by hand, document them in a hand-written README, and keep all automated tests offline. Later changes to the saved examples are out of scope.

Before the timestamp work, remove the two inherited Corepack dependencies in this issue: `scripts/build.mjs` must invoke the project Rspack binary directly, and `tests/build/chrome-artifact.test.ts` must invoke direct pnpm. Corepack is prohibited because it is deprecated. Prove the public `pnpm dev chrome` build succeeds through ordinary direct pnpm in the normal environment with no Corepack invocation, using observable artifact assertions rather than tooling/provenance or source-text checks.

## How to Verify

- **Manual**: Review each sanitized fixture against its one-time HTTP response and confirm the hand-written README records the source URL, capture date, sanitization, and expected eligible/no-op outcome. Live browser validation remains in `16-HITL`.
- **Automated**: Run table-driven resolver tests and offline adapter/process tests for every accepted element kind, rejection category, exact-host rule, and agreed GitHub page category.

## Acceptance Criteria

1. **Given** any approved GitHub relative custom element with a complete, explicitly zoned, date-fns-supported ISO 8601 instant, **When** the adapter extracts it, **Then** the shared pipeline receives that unambiguous instant without filling omitted date or time components.
2. **Given** missing, malformed, zone-less, ambiguous, or prose-only input, **When** it is inspected, **Then** extraction returns a safe no-op and the original element remains visible.
3. **Given** a `local-time` element or an element configured with `format="datetime"`, **When** adapter eligibility is evaluated, **Then** it is rejected as already absolute.
4. **Given** fixtures for commits, issues/pull requests, timelines, releases/tags, profiles/activity, search, and Actions, **When** the contract suite runs, **Then** the same source rules apply without a path allowlist.
5. **Given** a generic `title`, `aria-label`, or `data-*` value, **When** no adapter rule declares it authoritative, **Then** it is never interpreted as a timestamp.

## User Stories Addressed

- User Story 1: See exact GitHub dates
- User Story 13: Add future adapters without rewriting the core
