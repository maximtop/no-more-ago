# Implementation Plan: [no-more-ago] Process dynamic GitHub updates incrementally

- **Created**: 2026-08-24
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/4-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Revise rejected review attempt 1; automatically repair detached or reparented exact owned outputs through the existing renderer registry; suppress asynchronous observer delivery for controller-originated output removals; keep the controller input document-typed and add a separate bounded `ParentNode` reconcile boundary; make failed starts retryable on loading and ready documents; preserve one observer/controller, direct pnpm, public behavior tests, and the no-polling/no-full-rescan/no-numeric-budget/no-live-site-promise constraints

## Summary

Extend the validated `DocumentTransformationController` with one document-level `MutationObserver` scheduler and a separate bounded reconcile path. `ProcessInput.root` remains `Document`, so the controller and existing content runtime retain their validated document-specific constructor contract. Dynamic work uses a new `ReconcileInput.root: ParentNode` and runs only the added root, changed source, displaced-output source, or removed source region delivered by the scheduler.

The renderer's existing document registry remains the sole owned-pair authority. It gains exact lookup from the immutable recorded output identity back to its recorded source. When page code detaches or reparents only that output, the scheduler routes the recorded source to bounded reconciliation; the existing `renderExactTime` repair path moves the same output identity and token back beside the source. Forged marker-shaped nodes have no record and are never adopted, repaired, or removed.

Targeted invalidation and removed-region restoration may clear the output marker and release the ownership record before their removal mutation is delivered asynchronously. Before removing a valid connected output, the renderer therefore calls a controller-to-scheduler provenance hook with the exact output identity. The scheduler records only that identity and its current observer-lifecycle generation. The later observer delivery consumes the matching removal before ownership lookup or generic root normalization, emits no batch, and clears remaining entries for that delivery; stop/restart clears the generation state. This ephemeral suppression is not an ownership registry and cannot authorize any DOM mutation.

Controller start is transactional. Observer setup and the one initial document pass either both complete or the controller disconnects observation, restores any pair created by that attempt, clears lifecycle state, returns to idle, and rethrows. The content runtime catches that failed start boundary, invalidates pending readiness generations, tears down idempotently, moves to its existing stopped/retryable state, and rethrows the original error. A later explicit installation retries successfully on both loading and ready documents without adding a second listener, slot, controller, or active observer.

## Technical Context

- **Language/Version**: TypeScript 6.0.3 targeting ES2022; Node.js 24
- **Primary Dependencies**: Native DOM `MutationObserver`, date-fns 4.4.0, Vitest 4.1.11, jsdom 30.0.1, Rspack 2.1.10; no new package
- **Storage**: N/A — candidates, mutation batches, lifecycle generations, suppression identities, and owned-pair records remain document-local in memory
- **Testing**: Public adapter, renderer, scheduler, controller, content-runtime, and offline DOM integration behavior under Vitest/jsdom
- **Target Platform**: Exact HTTP(S) `github.com` documents in the existing Chrome development tracer bullet; cross-browser and current-live-site checks remain later issues

## Research

### Validated dependencies and present code seams

Issues `1-AFK`, `2-AFK`, and `3-AFK` are `Validated`. `src/core/render-exact-time.ts` owns a `WeakMap<Document, Map<Element, OwnedPairRecord>>`; each record contains the exact source, immutable exact output, opaque token, and immutable original `hidden` state. `renderExactTime` already moves that same valid output back beside the source during an explicit rerender. This issue exposes lookup and scoped restore operations over that registry rather than adding scheduler-owned pair state.

`SiteAdapter.discover(root: ParentNode)` is already generic, but GitHub's implementation uses `querySelectorAll`, which excludes an eligible element root. `src/core/process-document.ts` currently accepts only a document. The minimal type-safe split is to leave `ProcessInput` and `processDocument` document-specific for initial activation and introduce `ReconcileInput` plus `reconcileDocumentRegion` for an affected `ParentNode`. Both functions share the existing registry -> adapter -> resolver -> formatter -> renderer pipeline; only bounded reconcile restores an exact discovered source when extraction or resolution becomes invalid.

`src/content/runtime.ts` explicitly creates a `ProcessInput` and passes it to `DocumentTransformationController`. Keeping the controller constructor at `ProcessInput` avoids the rejected plan's incompatible narrowing and needs no cast or widened document contract. The runtime does require a production failure transition because its current `start(slot)` leaves `phase === "waiting"` when `controller.start()` throws, and `activate()` then rejects every retry.

### Exact output displacement through the existing registry

`getOwnedSourceForOutput(node)` consults only the node's owner-document registry. It returns a source only when `node` is the immutable `record.output` identity and still has that record's exact output marker. Marker presence without a record returns `null`. Full source-marker validation remains inside `renderExactTime`, so a tampered source still fails closed when reconciliation tries to repair it.

For each child-list record, the scheduler checks exact added and removed element identities before treating them as generic roots. If an identity resolves to an owned source, it is excluded from generic roots. At delivery time:

- An output that is again the source's immediate sibling is an internal insertion/repair or a move of the intact pair and produces no displacement work.
- An output that is detached or has a different parent is a displaced output and contributes its recorded source exactly once.
- An exact owned output used as the child-list target, or as a `datetime` attribute target, is extension output activity and produces no candidate root.
- A forged marker-shaped `time` has no record, receives ordinary bounded treatment, and is never classified as owned.

The controller reconciles the displaced source through the same adapter/resolver/formatter/renderer boundary. If source and output evidence remain valid, `renderExactTime` moves the immutable output identity back and keeps the original token and hidden-state snapshot. No new output is allocated.

### Asynchronous removal provenance after record release

When invalidation or removed-region cleanup removes a valid connected output, MutationObserver delivers the child-list record after the renderer has cleared its marker and deleted the record. A registry-only check at delivery time would misclassify that node as a foreign removed root and schedule a recursive no-op batch.

The fix is an `OwnedOutputMutationSink` implemented by the scheduler. Immediately before a valid connected output is removed, `restoreExactTime` or `restoreExactTimes` calls `beforeOwnedOutputRemoval(output)`. The scheduler must synchronously store `{ output identity, active lifecycle generation }` before that hook returns. Only after the hook returns may the renderer clear the marker, remove the node, or release the record. On the later observer delivery, normalization checks suppression first, consumes the exact matching removed identity, and never sends it to ownership lookup or `removedRoots`. After that delivery it clears any unconsumed entries from the current generation. `stop()` increments the lifecycle generation and clears the map, so a stale identity cannot suppress an unrelated later lifecycle.

The hook is called only for a recorded output with the exact expected marker that is connected to the controller's observed document and is about to be removed. Detached outputs create no observed removal and need no entry. Mismatched or forged output markers never call the hook. The suppression map carries no source, token, hidden state, or mutation authority and is not parallel ownership state.

### Coalescing and reconciliation order

One observer watches the document using:

```ts
{
  childList: true,
  subtree: true,
  attributes: true,
  attributeFilter: ["datetime"]
}
```

Each native delivery is normalized once with stable first-seen identity order:

1. Consume generation-matching internally removed outputs.
2. Classify exact recorded outputs and collect only those whose final position is displaced.
3. Deduplicate added and removed element roots and discard a root contained by another root in the same list.
4. Deduplicate `datetime` targets and discard targets already covered by an added root.
5. Deduplicate displaced sources and discard sources already covered by a connected added root or changed target.

The controller applies the batch against final DOM state:

1. Restore disconnected removed source roots. A removed root connected again by delivery time is a move and is skipped.
2. Reconcile connected added roots.
3. Reconcile connected changed targets not covered by an added root.
4. Reconcile connected displaced-output sources not covered above.

This ordering handles a source move, subtree replacement, final `datetime` value, and output displacement in one delivery without duplicate discovery. A truly removed source releases its pair before any later work; a connected moved source keeps the same pair; an output-only displacement routes back to its connected source. Unrelated text, non-`datetime` attributes, non-element nodes, and empty normalized deliveries call no controller reconciliation.

### Controller and content-runtime failure lifecycle

`DocumentTransformationController.start()` creates and starts one fresh scheduler, then runs the one initial document pass. Duplicate active start returns the initial connected outputs without another scan or observer. If observer construction/observe or initial processing throws, the controller stops the scheduler, restores document records while observation is disconnected, clears outputs and scheduler references, returns to idle, and rethrows. A later start creates a fresh scheduler/observer and performs one fresh initial pass.

Content runtime start wraps that transactional boundary. On failure it increments `generation`, removes/clears any pending readiness callback, calls idempotent controller teardown, sets `phase = "stopped"`, and rethrows the original error. The document slot and message listener remain installed. A captured stale readiness callback sees the changed phase/generation and cannot start. A later explicit `installContentRuntime` reuses the same slot/handle/listener, enters a fresh waiting generation when still loading or starts immediately when ready, and can succeed.

### Scope boundaries

- `5-AFK` owns Firefox, Edge, release, ZIP, and watch builds.
- `6-AFK` and later settings issues own background activation, open-tab injection, settings reformat, and user-visible failure status.
- `11-AFK` owns diagnostic persistence; this issue adds no journal or elapsed-time threshold.
- `15-AFK` owns the synthetic second-adapter proof.
- `16-HITL` owns permissioned browser and current live-GitHub validation.

## Entities

### Affected Mutation Batch

- **Fields**: non-overlapping `addedRoots`; deduplicated `datetimeTargets`; non-overlapping `removedRoots`; deduplicated `displacedOutputSources`
- **Relationships**: Produced once per nonempty observer delivery and consumed once by the existing controller
- **Validation**: Element identities only; generation-suppressed removals consumed first; exact outputs resolved through the renderer registry; duplicates/descendant overlap removed; no document fallback root
- **States**: native records -> normalized final-state batch -> reconciled once -> released

### Document Mutation Scheduler

- **Fields**: exact document; one observer; active lifecycle generation; batch callback; owned-output resolver; ephemeral suppressed-removal identities; `idle | observing` phase
- **Relationships**: Created and stopped only by the controller; implements `OwnedOutputMutationSink`; receives ownership lookup from the renderer without owning pair data
- **Validation**: One observer per active lifecycle; idempotent start/stop; stale generation suppression rejected; callbacks ignored outside observing; no timer or selector knowledge
- **States**: idle -> observing -> idle; failed setup -> idle; stop/restart increments generation

### Owned Pair Record

- **Fields**: unchanged exact source; immutable exact output; token; immutable original hidden state
- **Relationships**: Remains solely in `render-exact-time.ts`; used by render/update/repair, output-to-source lookup, scoped restoration, and teardown
- **Validation**: Runtime identity plus exact per-side markers authorize DOM mutation; output lookup never adopts marker-shaped foreign DOM; provenance is emitted only before removing an exact valid connected output
- **States**: absent -> owned -> updated/displaced -> same output repaired; owned -> restored/released; hostile evidence -> fail closed/released per existing rules

### Bounded Reconcile Input

- **Fields**: URL; `root: ParentNode`; locales; optional adapter registry; optional owned-output mutation sink
- **Relationships**: Shares processing context with document initial pass but is used only for scheduler-delivered regions
- **Validation**: Never substitutes `Document` for a mutation region; invalid discovered sources request exact record-backed restore only
- **States**: affected root/target/source -> rendered/updated/restored/no-op

### Content Runtime Slot

- **Fields**: unchanged controller/handle/document/message identities; `waiting | active | stopped`; readiness generation/callback
- **Relationships**: Owns one document controller and listener; retries the same controller after its transactional rollback
- **Validation**: Start failure always reaches stopped; pending/stale readiness is invalidated; explicit install is the only restart; duplicate active/waiting installs remain idempotent
- **States**: stopped -> waiting -> active; waiting/starting -> failed start -> stopped -> waiting/active on explicit retry

## Contracts

No HTTP endpoint, browser message, persistence schema, or external API contract is added, so no `contracts/` directory is created.

The initial document contract remains unchanged and assignable from `src/content/runtime.ts`:

```ts
export interface ProcessInput {
  readonly url: URL;
  readonly root: Document;
  readonly locales: readonly string[];
  readonly registry?: AdapterRegistry;
}

export function processDocument(input: ProcessInput): readonly HTMLTimeElement[];

export class DocumentTransformationController {
  constructor(input: ProcessInput);
  start(): readonly HTMLTimeElement[];
  teardown(): void;
}
```

Dynamic processing uses a separate bounded contract:

```ts
export interface ReconcileInput {
  readonly url: URL;
  readonly root: ParentNode;
  readonly locales: readonly string[];
  readonly registry?: AdapterRegistry;
  readonly ownedOutputMutations?: OwnedOutputMutationSink;
}

export function reconcileDocumentRegion(
  input: ReconcileInput
): readonly HTMLTimeElement[];
```

Ownership adds exact lookup, targeted restore, and pre-removal provenance over the existing registry:

```ts
export interface OwnedOutputMutationSink {
  beforeOwnedOutputRemoval(output: HTMLTimeElement): void;
}

export function getOwnedSourceForOutput(node: Node): Element | null;
export function restoreExactTime(
  source: Element,
  mutations?: OwnedOutputMutationSink
): void;
export function restoreExactTimes(
  root: ParentNode,
  mutations?: OwnedOutputMutationSink
): void;
```

`restoreExactTimes(document)` remains full record-driven teardown. For an element or fragment root it selects only records whose exact source is the root or a descendant. The optional sink is called before removal only when the exact valid output is connected in the observed document.

The scheduler boundary is generic and has no adapter or pair-record fields:

```ts
export interface AffectedMutationBatch {
  readonly addedRoots: readonly Element[];
  readonly datetimeTargets: readonly Element[];
  readonly removedRoots: readonly Element[];
  readonly displacedOutputSources: readonly Element[];
}

export class DocumentMutationScheduler implements OwnedOutputMutationSink {
  constructor(input: {
    readonly document: Document;
    readonly onBatch: (batch: AffectedMutationBatch) => void;
    readonly getOwnedSourceForOutput: (node: Node) => Element | null;
  });
  start(): void;
  stop(): void;
  beforeOwnedOutputRemoval(output: HTMLTimeElement): void;
}
```

`SiteAdapter.discover(root: ParentNode)` keeps its signature and is clarified to include an eligible element root before eligible descendants.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/core/render-exact-time.ts` | Modify | Exact output-to-source lookup, single-source/root restoration, and pre-removal provenance over the existing registry |
| `src/adapters/github.ts` | Modify | Include an approved element root in discovery before approved descendants |
| `src/core/process-document.ts` | Modify | Keep document `ProcessInput`; add bounded `ReconcileInput` and invalid-source restoration |
| `src/core/document-mutation-scheduler.ts` | Create | One observer, coalescing, output-displacement routing, and generation-scoped removal suppression |
| `src/core/document-transformation-controller.ts` | Modify | Transactional scheduler lifecycle and ordered bounded reconciliation |
| `src/content/runtime.ts` | Modify | Failed-start transition to stopped, readiness invalidation, and explicit retry |
| `tests/core/render-exact-time.test.ts` | Modify | Exact lookup/scoped cleanup/provenance and forged-marker behavior |
| `tests/adapters/github.test.ts` | Modify | Element-inclusive discovery and unrelated root behavior |
| `tests/integration/process-document.test.ts` | Modify | Type-separated bounded update/invalidation and exact unaffected ownership |
| `tests/core/document-mutation-scheduler.test.ts` | Create | Observer/count/coalescing/displacement/suppression/idle public behavior |
| `tests/core/document-transformation-controller.test.ts` | Modify | Dynamic ordering, automatic output repair, no recursive restore batch, and transactional rollback/retry |
| `tests/content/runtime.test.ts` | Modify | Loading/ready failure transition, stale readiness cancellation, dynamic stop/retry behavior |
| `tests/content/main.test.ts` | Modify | Production entrypoint retry-compatible loading/ready installation behavior |
| `tests/integration/github-fixtures.test.ts` | Modify | Offline dynamic matrix add/update/remove regression without network or live-site claims |

## Tasks

### [x] Task 1: Extend exact ownership lookup and scoped restoration

**Files:**

- Modify: `tests/core/render-exact-time.test.ts`
- Modify: `src/core/render-exact-time.ts`

- [x] **Step 1: Write failing public ownership tests**

Create two independent owned pairs. Assert `getOwnedSourceForOutput(firstOutput)` returns the exact first source while a forged marker-shaped `time`, an altered output marker, a detached unrecorded marker, and the second output never resolve to the wrong source. Preserve the existing source-marker/output-marker hostile cases.

Call `restoreExactTime(firstSource)` and assert only the first exact source/output/token lifecycle is released. Re-own both, wrap the first source, call `restoreExactTimes(wrapper)`, and assert the second pair remains unchanged. Remove the first source while its output remains elsewhere, perform scoped restore, and assert immutable original hidden state, output marker clearing/removal, and later full teardown of the unrelated pair.

Pass a public `OwnedOutputMutationSink` spy. For a valid connected output, assert the hook receives that exact output by identity while its marker and registry record still resolve; record that synchronous notification, return from the hook, and only then observe marker clearing, node removal, and record release. Assert detached outputs and altered/forged marker nodes do not produce provenance callbacks and remain subject to the validated per-side fail-closed rules.

- [x] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/core/render-exact-time.test.ts`

Expected: FAIL because exact output lookup, single-source/root-scoped selection, and pre-removal provenance do not exist.

- [x] **Step 3: Implement operations over the existing registry only**

Factor current per-record restoration into one internal operation. `getOwnedSourceForOutput` scans only the owner-document registry for the exact immutable output identity and expected output marker. `restoreExactTime` looks up the exact source record. `restoreExactTimes` selects all records only for `Document`, otherwise only records whose source is the root or its descendant. Immediately before removing an exact valid connected output, synchronously notify the optional sink and wait for the hook to return; only then clear its marker, remove it, restore the valid source side independently, and release the same record. Add no output index, scheduler pair map, or marker query adoption.

- [x] **Step 4: Run the focused test to verify it passes**

Run: `pnpm vitest run tests/core/render-exact-time.test.ts tests/integration/document-ownership.test.ts`

Expected: PASS for exact lookup, immutable identity/token/hidden state, targeted/root/full restore, provenance timing, hostile evidence, retained references, interaction, and shadow integrity.

**Verification**: The validated renderer registry remains the only ownership authority and exposes only the minimum lookup/removal seam needed by the scheduler.

### [x] Task 2: Add a type-safe bounded reconcile boundary

**Files:**

- Modify: `tests/adapters/github.test.ts`
- Modify: `tests/integration/process-document.test.ts`
- Modify: `src/adapters/github.ts`
- Modify: `src/core/process-document.ts`

- [x] **Step 1: Write failing adapter and public DOM tests**

Assert `githubAdapter.discover(candidateElement)` returns that exact approved root followed by approved descendants without duplicates, while an unrelated element root returns no candidates. Keep path independence and every issue-3 eligibility rejection green.

Assert the unchanged `processDocument` contract accepts only a document in typed production usage. Call `reconcileDocumentRegion` with one owned source element after changing `datetime` to a second valid instant and assert the same output identity/token updates. Change the value to zone-less and then missing in independent lifecycles; assert the exact source is restored, only its output is removed, and the supplied removal-provenance sink receives that output. A second owned source outside the region must retain identity, token, hidden state, and text.

- [x] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm vitest run tests/adapters/github.test.ts tests/integration/process-document.test.ts`

Expected: FAIL because discovery excludes its element root and no separate bounded reconcile function exists.

- [x] **Step 3: Implement the separate document and region contracts**

Keep `ProcessInput.root: Document` and `processDocument(ProcessInput)` unchanged. Add `ReconcileInput.root: ParentNode` and `reconcileDocumentRegion`. Share one private adapter-to-renderer loop; document initial processing skips invalid unowned candidates as before, while bounded reconcile calls `restoreExactTime(element, ownedOutputMutations)` for an invalid discovered source. Make GitHub discovery include an approved element root before its approved descendants. A forged source marker or renderer ownership mismatch remains a safe no-op.

- [x] **Step 4: Run focused tests and strict types**

Run: `pnpm vitest run tests/adapters/github.test.ts tests/integration/process-document.test.ts tests/core/resolve-trusted-timestamp.test.ts && pnpm typecheck`

Expected: PASS; `src/content/runtime.ts`'s existing `ProcessInput` construction remains assignable to the unchanged controller constructor.

**Verification**: Dynamic scope is `ParentNode` without weakening document-level controller typing or moving GitHub selectors into core.

### [x] Task 3: Implement one coalescing scheduler with displacement and provenance handling

**Files:**

- Create: `tests/core/document-mutation-scheduler.test.ts`
- Create: `src/core/document-mutation-scheduler.ts`

- [x] **Step 1: Write failing observer and coalescing tests**

Through the scheduler's public callback and a controllable `MutationObserver` wrapper, assert duplicate `start()` owns one active observer with the exact options. Deliver one burst containing nested/sibling additions, repeated final-value `datetime` mutations, nested removals, text nodes, unrelated attributes, and unrelated elements. Assert stable first-seen identity deduplication, outer-root overlap removal, changed-target coverage by added roots, one callback for one nonempty normalized delivery, and no document root.

Create a legitimate owned pair before starting the scheduler. Detach only its exact output and, in a separate lifecycle, reparent only that output. Assert each delivery contains the recorded source once in `displacedOutputSources`, never the output as an added/removed root. Put the output back adjacent before delivery and assert no displacement batch. Perform the same operations on a forged marker-shaped `time`; assert it is not resolved to a source and the scheduler does not mutate or adopt it.

Start observation over a valid pair, call `restoreExactTime(source, scheduler)`, and allow the asynchronous removal record to deliver after marker clearing and record release. Instrument the native observer wrapper and assert that raw removal delivery occurred while the public batch callback count remains zero. In a second case, first deliver a real invalidating `datetime` batch whose callback calls bounded restore with the scheduler; after all queued observer deliveries, assert the raw delivery count includes the later suppressed removal while the public batch/reconciliation count remains exactly one with no recursive removed-root work. Stop/restart and prove a stale suppression identity cannot hide an ordinary later mutation.

Advance fake timers while an observing document is idle and assert the public batch count remains unchanged. After `stop()`, DOM mutations produce no callback; a later start uses a fresh lifecycle generation and one new observer.

- [x] **Step 2: Run the scheduler test to verify it fails**

Run: `pnpm vitest run tests/core/document-mutation-scheduler.test.ts`

Expected: FAIL because the scheduler module does not exist.

- [x] **Step 3: Implement normalization and lifecycle-scoped suppression**

Create one native observer per active lifecycle. Observe only child-list/subtree changes and the `datetime` attribute. Normalize each delivered record list in the Research order. Check and consume exact generation-matching suppressed removals before registry resolution. For exact recorded output additions/removals, emit the source only when final adjacency is broken; ignore owned-output targets and final-adjacent internal work. Deduplicate/overlap-collapse generic roots and targets, then call `onBatch` only for a nonempty final batch.

`beforeOwnedOutputRemoval` records only the exact output identity plus current observing generation. Clear unconsumed entries after the next delivery and clear all entries/increment generation on stop. It owns no source/token/marker/hidden-state fields and never authorizes DOM mutation. Use no interval, timeout, animation frame, polling promise, per-element observer, shadow-root traversal, site selector, or document fallback scan.

- [x] **Step 4: Run the scheduler and ownership tests**

Run: `pnpm vitest run tests/core/document-mutation-scheduler.test.ts tests/core/render-exact-time.test.ts`

Expected: PASS for one observer, coalescing, exact displacement routing, forged-marker treatment, asynchronous post-release suppression, stopped/restarted generations, and idle behavior.

**Verification**: Internal removal records may reach the native observer, but they produce no public scheduler batch or controller reconciliation after the record is released.

### [x] Task 4: Integrate ordered dynamic reconciliation and transactional controller start

**Files:**

- Modify: `tests/core/document-transformation-controller.test.ts`
- Modify: `src/core/document-transformation-controller.ts`

- [x] **Step 1: Write failing dynamic public DOM tests**

Start with one initial source, append a wrapper containing multiple valid sources in one burst, and assert one output per source and one visit per candidate through an instrumented public `SiteAdapter`. Change one owned source's `datetime` several times before delivery and assert only its same output/token updates to the final value.

Remove a processed wrapper and retain source/output references; assert exact marker cleanup, immutable original hidden-state restoration, disconnected output, and an unrelated pair unchanged. Move a processed wrapper within the document and assert source/output/token identity survives. Reinsert a truly removed source and assert a fresh pair.

Detach only an exact recorded output, then reparent only it in a separate case. After delivery assert automatic repair uses the same output identity/token, the source remains hidden according to its owned lifecycle, no second output exists, and later controller teardown reveals/restores the source and clears/removes that exact output. Repeat with an initially hidden source. Detach/reparent a forged marker-shaped output and assert its identity, marker, page-chosen parent, and text remain untouched.

Create a combined delivery containing a connected source move, a truly removed source subtree, repeated `datetime` changes, exact output displacement, an added candidate wrapper, and unrelated text/attribute work. Assert the Research order yields final-state behavior once per affected source, no global reformat, and no visit outside affected roots.

Invalidate a valid owned source and instrument adapter discovery/batch reconciliation. Drain all observer deliveries and assert only the initial invalidation reconcile occurs: the renderer-generated output removal produces no follow-up discover call, batch, duplicate cleanup, or global pass.

- [x] **Step 2: Write failing transactional start tests**

Make observer setup throw and assert `start()` rethrows, owns no active observer/output/marker, and a later start succeeds with one observer and pair. In a separate controller, use an injected public adapter that renders the first source and throws on the next extraction. Assert the scheduler disconnects, the first partial pair is completely restored, the controller returns to idle, and a later nonthrowing start succeeds. Repeated active start and teardown remain idempotent.

- [x] **Step 3: Run the controller test to verify it fails**

Run: `pnpm vitest run tests/core/document-transformation-controller.test.ts`

Expected: FAIL because the controller has no scheduler, bounded reconciliation, output-displacement routing, suppression sink, or transactional rollback.

- [x] **Step 4: Implement one controller-owned scheduler lifecycle**

Keep the constructor input exactly `ProcessInput`. On idle start, create/start one scheduler using `getOwnedSourceForOutput`, then run the initial document pass. On a batch, restore disconnected removed roots through the scheduler sink; skip connected removals; reconcile connected added roots; reconcile uncovered connected changed targets; then reconcile uncovered connected displaced sources. Use only `ReconcileInput` roots and pass the scheduler as `ownedOutputMutations`.

On any start failure, stop/disconnect the scheduler first, restore the document with observation off, clear outputs/scheduler, set idle, and rethrow. Teardown follows the same stop-before-full-restore ordering. Active duplicate start returns the existing initial outputs; explicit start after teardown/failure creates one fresh scheduler and initial pass.

- [x] **Step 5: Run controller, scheduler, ownership, and type gates**

Run: `pnpm vitest run tests/core/document-transformation-controller.test.ts tests/core/document-mutation-scheduler.test.ts tests/core/render-exact-time.test.ts tests/integration/process-document.test.ts tests/integration/document-ownership.test.ts && pnpm typecheck`

Expected: PASS for dynamic ordering, same-identity automatic repair, nonrecursive invalidation, bounded work, one observer, transactional rollback, fresh retry, and complete restoration.

**Verification**: The validated controller remains the only document transformation lifecycle and renderer records remain the only ownership lifecycle.

### [x] Task 5: Make content-runtime start failures stopped and explicitly retryable

**Files:**

- Modify: `tests/content/runtime.test.ts`
- Modify: `tests/content/main.test.ts`
- Modify: `src/content/runtime.ts`

- [x] **Step 1: Write failing loading-document failure/retry tests**

Install while loading and capture the installed readiness callback through the public document event boundary. Make the first scheduler observer setup throw when that callback starts the controller. Assert the original error is rethrown, no output/marker/active observer remains, teardown is safe, and invoking the captured stale callback again cannot retry.

Keep the document loading, explicitly install again, and assert the same slot/handle/listener schedules one fresh readiness generation. Deliver readiness with observer setup fixed; assert one controller/observer/output becomes active and later dynamic candidates process once.

- [x] **Step 2: Write failing ready-document initial-pass failure/retry tests**

On a ready document, use a one-shot public adapter/registry spy that renders one candidate and throws during the same initial pass. Assert `installContentRuntime` rethrows the original error after the controller restores that partial pair, while the document slot/listener remains singular and retryable. Restore normal adapter behavior, install again, and assert one clean initial output plus later dynamic processing. Teardown then leaves the source live and no observer/output.

Import the production content entrypoint in loading and ready modes and retain the one-listener/one-slot behavior. Its runtime must remain retry-compatible without a second installation path or failure panel.

- [x] **Step 3: Run runtime tests to verify they fail**

Run: `pnpm vitest run tests/content/runtime.test.ts tests/content/main.test.ts`

Expected: FAIL because a rejected controller start leaves the existing slot in `waiting`, blocking every later activation.

- [x] **Step 4: Implement the stopped failure transition**

Wrap `slot.controller.start()` so any error increments the readiness generation, removes/clears the pending callback if present, calls idempotent controller teardown, sets `phase = "stopped"`, and rethrows the original error. Set active only after successful start. Leave the slot, handle, and message listener installed. `activate()` continues to ignore active/waiting duplicates but explicitly retries stopped slots using current readiness.

- [x] **Step 5: Run cross-boundary runtime tests**

Run: `pnpm vitest run tests/content/runtime.test.ts tests/content/main.test.ts tests/runtime/messages.test.ts tests/runtime/register-github.test.ts`

Expected: PASS for immediate listener installation, loading/ready failure rollback, stale generation cancellation, same-slot explicit retry, dynamic processing, and teardown/reactivation.

**Verification**: A failed start is observable as the original exception, leaves no active transformation, and never permanently wedges the document runtime.

### [x] Task 6: Prove offline dynamic regression and run direct-pnpm gates

**Files:**

- Modify: `tests/integration/github-fixtures.test.ts`
- Modify: none for production in this task

- [x] **Step 1: Add an offline matrix lifecycle regression**

Start with the existing static synthetic GitHub eligibility matrix outside the document, append it dynamically, change one approved source to a second valid final `datetime`, detach/reparent one exact output, remove the matrix, and assert the existing eligibility/no-op rules, same output/token repair, bounded cleanup, and zero orphan markers. Keep the test offline and enter through public controller/adapter/renderer behavior; do not refresh fixtures or claim compatibility with future GitHub markup.

- [x] **Step 2: Run the focused issue gate**

Run: `pnpm vitest run tests/core/document-mutation-scheduler.test.ts tests/core/document-transformation-controller.test.ts tests/core/render-exact-time.test.ts tests/adapters/github.test.ts tests/integration/process-document.test.ts tests/integration/document-ownership.test.ts tests/integration/github-fixtures.test.ts tests/content/runtime.test.ts tests/content/main.test.ts`

Expected: PASS with one observer, bounded/coalesced work, automatic immutable-output repair, no recursive restoration batch, retryable start failures, and exact restoration.

- [x] **Step 3: Run the complete repository gate with direct pnpm**

Run: `pnpm lint && pnpm typecheck && pnpm test && pnpm dev chrome && pnpm lint`

Expected: all lint, strict types, offline tests, validated predecessor regressions, the public Chrome development artifact, and post-build lint pass.

- [x] **Step 4: Preserve the separately authorized manual scenario**

Issue `16-HITL` retains the manual scenario: with explicit browser permission, navigate within current GitHub, load/remove dynamic timeline content, displace a rendered output through page behavior if reproducible, and verify repair/cleanup. This issue performs no browser work and makes no future compatibility claim.

**Verification**: Automated evidence is structural and observable; no browser, Git, network, Corepack, polling, document-wide mutation rescan, per-element observer, numeric elapsed-time gate, or live-site guarantee enters issue `4-AFK`.

## Acceptance Coverage

| Acceptance criterion | Planned evidence |
| --- | --- |
| 1. Added eligible element receives one replacement without a whole-document rescan | Tasks 2-4 and 6: element-inclusive bounded discovery, outer-root coalescing, instrumented visits, one semantic output |
| 2. Owned `datetime` change updates exact output in place | Tasks 2-4: separate `ReconcileInput`, final-value target coalescing, exact output/token identity and semantic text/value update |
| 3. Removed/replaced subtree leaves no orphan or per-element observer | Tasks 1, 3, 4, and 6: scoped record cleanup, retained references, move-versus-removal order, one document observer, offline lifecycle |
| 4. Unrelated or extension-owned mutations cause no recursion or global reformat | Tasks 3-4: registry-resolved output filtering, generation-scoped asynchronous removal suppression, public batch/discovery counts, forged-marker controls, unaffected sentinel DOM |
| 5. Idle runtime has no polling/refresh and at most one observer | Tasks 3-6: observer lifecycle/count, fake-timer idle callback count, stopped/restarted behavior, direct gates without numeric timing promise |

## Review Finding Coverage

| Review attempt 1 finding | Concrete resolution |
| --- | --- |
| Exact owned output detach/reparent was dropped | Research adds output-to-source lookup through the existing renderer registry; Contracts add `getOwnedSourceForOutput` and `displacedOutputSources`; Task 3 proves output-only records route to the recorded source; Task 4 proves automatic same output/token repair, source hidden state, later teardown, and forged markers untouched |
| Restore/invalidation removal scheduled recursive no-op batch after record release | Research defines pre-removal controller-to-scheduler provenance with output identity plus active generation; Task 1 proves notification precedes marker/record release; Task 3 delivers the later native removal and proves zero public follow-up batch; Task 4 proves one invalidation reconciliation/discovery after all observer deliveries |
| Widened `ProcessInput` broke the controller/content type | Contracts preserve `ProcessInput.root: Document` and `DocumentTransformationController(ProcessInput)`; Task 2 adds separate `ReconcileInput.root: ParentNode`; File Structure keeps `src/content/runtime.ts` in production scope only for failure transition, not a type workaround; strict typecheck is in Tasks 2, 4, and 6 |
| Controller rollback left content runtime permanently waiting | Research defines stopped/retryable failure behavior; Task 4 proves controller observer/initial-pass rollback; Task 5 modifies `src/content/runtime.ts` and proves loading/ready failures invalidate stale readiness, preserve one slot/listener, and succeed on later explicit install |

## Constraint Coverage

| Constraint | Plan disposition |
| --- | --- |
| One observer/controller design | One scheduler belongs to the validated controller; runtime retains one controller slot and listener |
| No parallel ownership state | All source/output/token/hidden data stays in the renderer registry; scheduler suppression holds only output identity plus lifecycle generation until the next delivery |
| No whole-document mutation rescans | Only initial start uses `ProcessInput.root: Document`; every mutation path uses a delivered `ParentNode` region/source and never synthesizes document |
| No polling or per-element observers | One native document observer; no interval, timeout, animation frame, periodic promise, or element observer |
| No numeric performance promise | Tests assert observer/callback/visit counts and scope, never elapsed time |
| No live-site compatibility promise | Existing offline fixtures/matrix only; permissioned current-site checks remain `16-HITL` |
| Direct pnpm and no Corepack | Every planned command uses ordinary `pnpm` |
| Planning-only revision | Only this Draft plan and issue status are changed; no implementation, test, browser, Git, or network work occurs in this revision turn |

## Self-Review

- Every issue acceptance criterion starts with a failing public behavior test and maps to an implementation task.
- All four review findings map to named contracts, production files, observable tests, and lifecycle ordering above.
- `ProcessInput.root` remains `Document`; only `ReconcileInput.root` is `ParentNode`; the controller and content runtime remain type-consistent.
- Output-only detach/reparent records resolve through the existing registry and repair the immutable output/token; forged markers never resolve.
- Internal connected-output removals register suppression before marker clearing/record release, and the asynchronous delivery consumes exact identity plus current lifecycle generation without emitting a batch.
- Suppression stores no ownership relationship and is cleared after delivery and on stop/restart.
- Removed roots, moves, added roots, final `datetime` targets, displaced outputs, owned activity, and unrelated mutations have an explicit coalescing and processing order.
- Observer setup and partial initial-pass failures roll back; content loading/ready paths become stopped and explicitly retryable with stale readiness invalidated.
- Tests use public adapter/renderer/scheduler/controller/content boundaries and semantic DOM identities, not implementation-source substring assertions.
- No setting, diagnostics persistence, background fan-out, second adapter, page UI, network fixture update, browser automation, Git operation, numeric timing threshold, polling, or future live-GitHub promise enters this slice.
- All commands use direct pnpm, and the plan contains no unresolved placeholder or deferred in-scope choice.
