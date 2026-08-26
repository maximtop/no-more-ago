# Issue: [no-more-ago] Prove the adapter contract with a synthetic site

**Issue ID**: 15-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 3-AFK, 4-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Prove the future-site boundary by registering a synthetic adapter only in the integration test/demo harness. It must supply hostname matching, candidate discovery, trusted extraction, eligibility, and fixtures while reusing the complete shared validation, presentation, ownership, mutation, settings, and diagnostics pipeline. Exercise one narrow optional hook if the contract needs it; do not ship a second production site or add generic attribute guessing.

## How to Verify

- **Manual**: Run the synthetic adapter demo fixture and show exact replacement, a dynamic update, and teardown using the same controls and output behavior as GitHub while production artifacts still list only GitHub.
- **Automated**: Run the shared adapter contract suite against GitHub and the synthetic adapter, including safe no-op and dynamic behavior, and validate that production adapter discovery has no synthetic hostname.

## Acceptance Criteria

1. **Given** a synthetic site fixture with an authoritative source, **When** its adapter is registered in the harness, **Then** it receives shared formatting, semantic replacement, incremental updates, and restoration without duplicating those behaviors.
2. **Given** a synthetic candidate cannot be trusted, **When** extraction returns no instant, **Then** the common pipeline performs a safe no-op.
3. **Given** the contract requires exceptional behavior, **When** it is expressed, **Then** it uses a narrow typed hook rather than allowing arbitrary adapter-owned DOM or observer logic.
4. **Given** production Chrome, Edge, and Firefox artifacts, **When** adapter availability is queried, **Then** only exact `github.com` is supported in the MVP.
5. **Given** generic `title`, `aria-label`, or `data-*` values in the synthetic document, **When** no explicit adapter rule declares them, **Then** they remain ignored.

## User Stories Addressed

- User Story 13: Add future adapters without rewriting the core
