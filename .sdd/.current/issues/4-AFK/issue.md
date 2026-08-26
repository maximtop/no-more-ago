# Issue: [no-more-ago] Process dynamic GitHub updates incrementally

**Issue ID**: 4-AFK
**Type**: AFK
**Status**: Validated
**Blocked by**: 2-AFK, 3-AFK

## Parent PRD

`.sdd/.current/prd.md`

## What to Build

Extend the document runtime to handle client-side navigation and live GitHub DOM changes through one incremental scheduler. Coalesce relevant added-subtree and `datetime` mutations, clean up removed candidates, ignore owned/unrelated mutations, and remain idle without polling, per-element observers, or repeated whole-page scans.

## How to Verify

- **Manual**: Navigate within GitHub without a full reload and expand or load dynamic timeline content; confirm new dates are processed once and removed content leaves no orphan output.
- **Automated**: Drive mutation batches in DOM integration tests and observe candidate calls, observer count, scan scope, ownership-loop protection, attribute updates, removal cleanup, and zero periodic work while idle.

## Acceptance Criteria

1. **Given** an eligible element is added after initial load, **When** its mutation batch is delivered, **Then** it receives exactly one replacement without a whole-document rescan.
2. **Given** an owned host’s `datetime` changes to another valid instant, **When** the attribute mutation is processed, **Then** its exact output updates in place.
3. **Given** GitHub replaces or removes a processed subtree, **When** removal is observed, **Then** No More Ago leaves no orphan nodes or retained per-element observers.
4. **Given** unrelated or extension-owned mutations, **When** the scheduler receives them, **Then** they cause no recursive processing or global reformat pass.
5. **Given** an active document becomes idle, **When** no relevant event occurs, **Then** the runtime performs no polling or scheduled date refresh and owns no more than one document observer.

## User Stories Addressed

- User Story 2: Handle dynamic GitHub pages
- User Story 8: Remain lightweight on dynamic pages
