# Plan Review: 4-AFK

**Issue**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/4-AFK/issue.md`
**Plan**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/4-AFK/plan.md`
**Model**: Codex (GPT-5; reasoning effort not exposed)
**Verdict**: approved
**Plan Status**: Approved
**Review attempt**: 2

<!--
  The verdict is `approved` iff ALL six dimensions pass; `rejected` if
  ANY dimension fails. The Plan Status mirrors the verdict. This file is
  rewritten on every review round; the Oneshot Agent reads it to route
  revisions and to enforce the review-attempt cap. `Review attempt` is
  incremented by `review-plan` on every round (1 on the first review);
  the Oneshot Agent resets it to `0` by deleting this file when the user
  resumes with guidance after a cap escalation.
-->

## Dimension Results

| Dimension | Result |
| --- | --- |
| Correctness | pass |
| Security | pass |
| Performance | pass |
| Maintainability | pass |
| Architecture | pass |
| Operational | pass |

## Findings

None — the plan passed all six dimensions.

## Revision Verification

| Review attempt 1 finding | Result |
| --- | --- |
| Exact owned output detach/reparent was dropped | Resolved: exact output identity now resolves to its recorded source through the renderer registry, final broken adjacency emits one displaced source, and controller tests require automatic repair with the same output identity/token plus later exact teardown. |
| Renderer-originated removal recurred after record release | Resolved: the renderer synchronously records exact output identity and active scheduler generation before marker clearing/removal/release; the next native delivery consumes it before ownership/generic-root classification, with public tests requiring no follow-up batch or reconciliation. |
| Widened `ProcessInput` broke controller/content typing | Resolved: `ProcessInput.root` and the controller constructor remain document-specific; bounded mutation work uses a separate `ReconcileInput.root: ParentNode`, and strict typecheck is required at focused and complete gates. |
| Failed controller start left content runtime waiting forever | Resolved: loading and ready failures invalidate readiness generation, clear pending readiness, tear down transactionally, set the existing slot to stopped, rethrow the original error, and require a later explicit same-slot retry while stale callbacks remain inert. |

## Edge-Case Verification

- Same-node remove/add moves are evaluated against final DOM state: connected removed roots are not restored, then the connected added scope is reconciled once.
- Truly removed subtrees restore source-scoped ownership before added, changed, or displaced-source work; reinserted sources receive a fresh pair only after prior ownership was released.
- Repeated `datetime` mutations use the final value; invalid or missing values restore only the exact owned source/output through the provenance sink.
- Exact owned output detach/reparent routes to the source; final-adjacent internal work is ignored; forged marker-shaped nodes never gain record-backed authority.
- Teardown disconnects observation before full record-driven restoration. Stop/restart clears suppression identities and advances lifecycle generation, while stale readiness generations cannot restart a failed runtime.
- Mutation work remains bounded to delivered element roots/targets/sources, with one observer, no polling, no per-element observers, no document fallback rescan, no numeric elapsed-time promise, and no live-site compatibility claim.
