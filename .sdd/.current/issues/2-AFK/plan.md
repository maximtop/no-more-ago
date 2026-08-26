# Implementation Plan: [no-more-ago] Own and restore timestamp DOM safely

- **Created**: 2026-08-23
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/2-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Final revision after rejected review attempt 2; reuse the exact valid recorded output during detached/reparented repair so no created identity is forgotten; clear and remove that retained identity during teardown after page-code reattachment; preserve every review-attempt-1 resolution; keep MutationObserver, settings, and background fan-out out of scope

## Summary

Replace `1-AFK`'s destructive renderer with a reversible owned-sibling transformation. The GitHub source remains intact in its interaction container, and one semantic `time` sibling carries the authoritative `datetime` and formatted text. A document-scoped in-memory registry records the exact source/output identities, opaque token, and source's original `hidden` state before the first mutation.

DOM attributes are evidence but never sufficient ownership proof. Render, repair, update, and teardown require a runtime record plus the exact expected marker on each node being mutated. A marked pair without a record is foreign. Each record retains one immutable output identity for its whole lifecycle. Removed or reparented output repair moves that exact valid node back beside the source instead of allocating a replacement, and reuses the original token and hidden-state snapshot. Teardown clears the marker from that exact output before removing it from whichever parent page code most recently chose, so a retained reference cannot reintroduce an extension marker after teardown.

At `document_start`, the content entrypoint installs one document-global runtime slot and message listener immediately. Only the processing start is deferred for a loading document. Teardown during loading leaves a persistent stopped state and invalidates the queued readiness start. The teardown literal, type, and guard live in a browser-neutral shared runtime module. This slice adds no observer, scheduler, settings path, registration removal, tab injection, or background message sender.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, ECMAScript 2022, Node.js 24
- **Primary Dependencies**: date-fns 4.4.0, Rspack 2.1.10, Chrome Manifest V3 types; no new dependency
- **Storage**: N/A — ownership is document-local in memory and no page/timestamp data is persisted
- **Testing**: Vitest 4.1.11 with jsdom 30.0.1; renderer/controller/content behavior and artifact smoke
- **Target Platform**: Current stable Chrome development artifact; core DOM/message modules remain browser-neutral

## Research

### Validated dependency and narrow change seams

Issue `1-AFK` is `Validated`. `processDocument` already separates exact-host adapter selection, trusted timestamp resolution, formatting, and the final `renderExactTime` DOM call. `src/content/main.ts` currently defers everything to `DOMContentLoaded`, although `src/runtime/register-github.ts` registers the bundle at `document_start`. `src/background/chrome.ts` only reconciles registration and contains no settings or tab fan-out.

The revision changes the renderer boundary, lets `processDocument` exclude a renderer safe-no-op, adds one controller/content lifecycle, and adds one shared message module. Adapter eligibility, timestamp resolution, formatting, registration, manifest, build scripts, and background behavior stay unchanged.

### Correlated ownership and fail-closed rules

`src/core/render-exact-time.ts` owns a `WeakMap<Document, Map<Element, OwnedPairRecord>>`. Each record contains the exact `source`, immutable exact `output`, token, and immutable `sourceWasHidden` captured before first mutation. The DOM markers are:

- `data-no-more-ago-source="visible:<token>"` or `"hidden:<token>"`.
- `data-no-more-ago-output="<token>"`.

The source parser accepts only those two prefixes plus a nonempty token. For an unrecorded source, an absent marker permits first ownership; any present marker makes rendering return `null` without mutation. Thus a forged matching pair or malformed/orphan source marker is never adopted. A nearby marked output with no record is never reused or removed.

For a recorded source, its exact identity and marker must match the record. The record's output identity is immutable. If that exact output is adjacent and its marker matches, rerender updates it in place. If it is detached or reparented and still has the expected marker, rerender uses `source.after(record.output)` to move the same node identity back beside the source, then updates its authoritative `datetime` and text. Repair never creates a second output, overwrites the recorded identity, or leaves a formerly owned identity untracked. A missing/malformed/mismatched output marker, or a source without a valid insertion parent, makes rerender fail closed without allocating another node. No repair path reads current `hidden` as a new initial value.

### Precise record-driven teardown

`restoreExactTimes(root)` iterates only runtime records for the root document; it does not blanket-remove queried marker nodes. It restores the exact recorded source only if the source still has the exact encoded marker, using immutable `sourceWasHidden`. If the immutable recorded output still has the expected marker, teardown first removes that marker from the exact identity and then removes the node from any current parent; this also clears the marker when the node is detached but retained by page code. Missing, malformed, or mismatched sides are left untouched, records are released, and every marked node with no runtime record remains unchanged.

Checks are per recorded identity: a removed output does not prevent safe restoration of a still-valid recorded source, and a removed source does not authorize deletion of arbitrary marked output. Within one record lifecycle only the first render creates an output, so the registry retains every extension-created output identity (exactly one) until teardown. Automatic mutation-triggered repair remains issue `4-AFK`; this issue tests repair through an explicit rerender call.

### Immediate runtime installation

`src/content/main.ts` calls `installContentRuntime` immediately. The installer synchronously creates/reuses a `Symbol.for("no-more-ago.document-runtime")` slot and installs one listener. The slot owns one controller, a `waiting | active | stopped` phase, and at most one readiness callback/generation.

For `readyState === "loading"`, only `controller.start()` is deferred. Teardown immediately invalidates/removes the pending action, calls idempotent teardown, and sets `stopped`; the callback also checks its generation and phase so an already queued event cannot start. Duplicate installation reuses the listener/slot. A later explicit installation is reactivation and may leave `stopped`, while a stale readiness callback may not.

### Browser-neutral teardown protocol

`src/runtime/messages.ts` contains only `TEARDOWN_DOCUMENT_MESSAGE`, `TeardownDocumentMessage`, and `isTeardownDocumentMessage(unknown)`. It imports neither DOM/content types nor Chrome APIs. Content consumes it now; issue `6-AFK` can later import the same module without depending on content implementation or copying a literal. This issue does not modify the background or send the message.

### Scope boundaries

- `3-AFK`: `time-ago`/`time-until`, already-absolute, malformed/ambiguous/zone-less, and expanded GitHub fixtures.
- `4-AFK`: MutationObserver, incremental regions, automatic attribute updates, removed-subtree cleanup, coalescing, loop filtering, and idle behavior.
- `5-AFK`: Edge/Firefox/release/ZIP/watch builds.
- `6-AFK`: settings, popup, registration removal, tab queries/injection, and background teardown fan-out.

## Entities

### Owned Pair Record

- **Fields**: exact `source: Element`; immutable exact `output: HTMLTimeElement`; `token: string`; immutable `sourceWasHidden: boolean`
- **Relationships**: Stored only in the source document's runtime registry; used by rendering and restoration
- **Validation**: Mutation requires runtime identity plus the exact marker expected by that record; marker presence alone is never ownership; repair may move but never replace `output`; teardown clears its exact valid marker before detaching it
- **States**: absent -> intact -> same output detached/reparented -> same output moved adjacent -> same output unmarked/removed and record released; altered evidence -> fail closed/released

### Document Transformation Controller

- **Fields**: immutable `ProcessInput`; `idle | active`; connected outputs
- **Relationships**: Calls the existing pipeline and registry-backed restore function; held by the content slot
- **Validation**: Duplicate active start creates no pair/marker/observer; teardown is idempotent; later explicit start may reactivate
- **States**: idle -> active -> idle

### Content Runtime Slot

- **Fields**: controller identity; `waiting | active | stopped`; listener state; readiness generation/callback
- **Relationships**: Stored on the isolated-world document; installed by `main.ts`; consumes the shared message guard
- **Validation**: One slot/listener/controller/pending start; stopped defeats stale readiness
- **States**: absent -> waiting or active -> stopped -> waiting or active after explicit reinstall

### Teardown Document Message

- **Fields**: `type: "no-more-ago:teardown"`
- **Relationships**: Defined in shared runtime; consumed by content now and sent by `6-AFK` later
- **Validation**: Exact non-null object/type; unrelated values are ignored
- **States**: ignored, or slot stopped/controller torn down

## Contracts

No external API/storage contract is added, so no `contracts/` directory is created.

```ts
export const OWNED_SOURCE_ATTRIBUTE = "data-no-more-ago-source";
export const OWNED_OUTPUT_ATTRIBUTE = "data-no-more-ago-output";

export function renderExactTime(
  source: Element,
  datetime: string,
  text: string
): HTMLTimeElement | null;

export function restoreExactTimes(root: ParentNode): void;

export class DocumentTransformationController {
  constructor(input: ProcessInput);
  start(): readonly HTMLTimeElement[];
  teardown(): void;
}
```

`processDocument(ProcessInput): readonly HTMLTimeElement[]` remains the adapter-to-renderer path and excludes a `null` safe-no-op.

```ts
export const TEARDOWN_DOCUMENT_MESSAGE = "no-more-ago:teardown";
export interface TeardownDocumentMessage {
  readonly type: typeof TEARDOWN_DOCUMENT_MESSAGE;
}
export function isTeardownDocumentMessage(
  value: unknown
): value is TeardownDocumentMessage;
```

```ts
export interface ContentMessageRuntime {
  readonly onMessage: {
    addListener(listener: (message: unknown) => void): void;
  };
}
export interface ContentRuntimeHandle {
  teardown(): void;
}
export function installContentRuntime(input: {
  readonly document: Document;
  readonly url: URL;
  readonly locales: readonly string[];
  readonly messages: ContentMessageRuntime;
}): ContentRuntimeHandle;
```

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/core/render-exact-time.ts` | Modify | Runtime identity registry; create once, update/move the immutable output, and restore owned pairs |
| `src/core/process-document.ts` | Modify | Exclude renderer safe-no-op without changing upstream pipeline behavior |
| `src/core/document-transformation-controller.ts` | Create | Idempotent initial processing and precise teardown |
| `src/runtime/messages.ts` | Create | Browser-neutral teardown literal, type, and guard |
| `src/content/runtime.ts` | Create | Immediate listener/slot, deferred processing, stopped-before-ready lifecycle |
| `src/content/main.ts` | Modify | Install runtime immediately at bundle evaluation |
| `tests/core/render-exact-time.test.ts` | Modify | Intact source, duplicate render, repair, hostile markers, exact teardown |
| `tests/core/document-transformation-controller.test.ts` | Create | Start/teardown/reactivation lifecycle |
| `tests/runtime/messages.test.ts` | Create | Shared guard behavior without browser/DOM coupling |
| `tests/content/runtime.test.ts` | Create | Loading/ready, immediate listener, stopped-before-ready, reactivation |
| `tests/content/main.test.ts` | Create | Production entrypoint loading/ready behavior through module isolation |
| `tests/integration/process-document.test.ts` | Modify | Intact hidden source and renderer no-op end to end |
| `tests/integration/document-ownership.test.ts` | Create | Interaction, accessibility, foreign DOM, shadow integrity, no page UI |

## Tasks

### [x] Task 1: Specify owned-pair repair and hostile-marker behavior

**Files:**

- Modify: `tests/core/render-exact-time.test.ts`
- Modify: `tests/integration/process-document.test.ts`

- [x] **Step 1: Write intact-source and duplicate-render failures**

Render a visible source and assert retained source identity, `hidden`, one adjacent semantic `time`, authoritative `dateTime`, exact text, matching tokens, and one marker per owned identity. Rerender and assert the same output/token/source marker. Update the public pipeline test to assert one returned output and an intact hidden source; retain the non-GitHub unchanged case.

- [x] **Step 2: Write identity-retaining detach/reparent repair regressions for both original hidden states**

For initially visible and initially hidden sources, parameterize both displacement paths and retain `firstOutput` plus its token before any page action:

- Detach `firstOutput`, rerender, and assert the returned/adjacent output is `firstOutput` by identity, with the original token, authoritative `datetime`, and new text; assert no second marked `time` was created.
- Reparent `firstOutput` into a foreign container, rerender, and assert that same identity was moved back directly after the source, with no second marked `time`.
- After each repair, simulate page code using its retained pre-repair reference by appending `firstOutput` to another container again, then call teardown. Assert visible sources return to no `hidden`, initially hidden sources remain hidden, `firstOutput.isConnected` is false, `firstOutput` no longer has the output marker, the source no longer has the source marker, and the document contains zero owned outputs or ownership attributes.

This sequence explicitly covers detach/reparent -> repair -> retained-old-reference reattachment -> teardown; because repair returns the original identity, the page's "old" reference and the record's current output are provably the same node.

- [x] **Step 3: Write forged/malformed/mismatched/orphan safety tests**

Prove with node identities and full attribute/text snapshots that:

- A forged matching source/output pair without a record is not adopted, updated, unhidden, unmarked, or removed.
- `visible:`, unknown-prefix, and tokenless source markers make render a no-op.
- Altering a legitimate source or connected-output marker to another token makes the affected node fail closed.
- An orphan marked `time` retains identity, parent, marker, `datetime`, and text through teardown.
- An unmarked foreign sibling remains unchanged.

Assert marked unrecorded sources yield `null`, and `processDocument` excludes that result.

- [x] **Step 4: Run before implementation**

Run: `zsh -lic 'corepack pnpm vitest run tests/core/render-exact-time.test.ts tests/integration/process-document.test.ts'`

Expected: FAIL because current rendering is destructive and has no registry, repair, restore, or safe no-op.

**Verification**: The tests distinguish runtime identity from attribute resemblance, prove the first hidden-state snapshot survives both repair paths, and prove repair plus page-code reattachment cannot leave any created output identity or marker behind after teardown.

### [x] Task 2: Implement correlated ownership and precise restoration

**Files:**

- Modify: `src/core/render-exact-time.ts`
- Modify: `src/core/process-document.ts`

- [x] **Step 1: Add strict parsing and the document registry**

Define `OwnedPairRecord` and `WeakMap<Document, Map<Element, OwnedPairRecord>>`. Generate tokens with the owning window's `crypto.randomUUID()` and fail before mutation if unavailable. Accept only exact `visible|hidden:<nonempty-token>` source markers. Internal ownership predicates compare node identity and record marker.

- [x] **Step 2: Implement first render, in-place update, and identity-retaining repair**

For an unrecorded/unmarked source, capture `sourceWasHidden` once, create one output, and store that output as an immutable record field. For an unrecorded/marked source, return `null`. For a recorded source, require the exact source/output identities and expected markers. Update an adjacent output in place. When the exact valid output is detached or reparented and the source has a valid insertion parent, call `source.after(record.output)` to move that same identity adjacent before updating it. Never allocate a repair replacement or overwrite the record's output reference. Fail closed without creation on mismatched evidence or impossible placement. Never resnapshot current `hidden`, traverse shadow roots, clone/replace source, inspect relative prose, or add listeners.

- [x] **Step 3: Implement record-driven marker clearing, teardown, and pipeline no-op**

Iterate registry records, never all marked DOM. Restore each exact source only when its expected marker remains, removing that source marker and applying immutable `sourceWasHidden`. For the immutable exact output with its expected marker, remove the output marker first and then remove the node from whatever parent currently contains it; clear the marker even when the output is already detached. Leave missing/malformed/mismatched/unrecorded sides untouched and release records. Make `processDocument` push only non-null renderer output.

- [x] **Step 4: Run focused tests**

Run: `zsh -lic 'corepack pnpm vitest run tests/core/render-exact-time.test.ts tests/integration/process-document.test.ts'`

Expected: PASS for intact identity, duplicate render, same-identity detach/reparent repair, retained-reference reattachment cleanup, original-state restoration, safe no-op, and foreign DOM preservation.

**Verification**: No marker-only query authorizes mutation, no repair snapshots an already-owned source or creates a replacement identity, and teardown clears/removes the sole recorded output wherever page code moved it.

### [x] Task 3: Preserve interaction/accessibility and add the controller

**Files:**

- Create: `tests/integration/document-ownership.test.ts`
- Create: `tests/core/document-transformation-controller.test.ts`
- Create: `src/core/document-transformation-controller.ts`

- [x] **Step 1: Write failing integration behavior**

Place the source in a link with existing click/keyboard handlers; process and dispatch bubbled click/Enter. Assert handlers still run, source/output remain in the link, source is hidden, and exactly one non-hidden semantic date is represented. Preserve open-shadow-root child identities/markup across transform/restore. Snapshot foreign siblings and assert no button/input/link/role-button/toolbar/panel/toast is added.

- [x] **Step 2: Write failing controller lifecycle**

Assert first `start()` creates one pair; repeated start returns the same connected output without duplicates; double teardown restores current live source text and foreign siblings; later start creates one fresh lifecycle. No test expects an observer, timer, or per-element listener.

- [x] **Step 3: Implement minimal controller and run**

Wrap `processDocument` with `idle | active` state. Active duplicate start returns connected outputs. Teardown calls `restoreExactTimes(document)`, clears state, and is repeatable.

Run: `zsh -lic 'corepack pnpm vitest run tests/core/document-transformation-controller.test.ts tests/integration/document-ownership.test.ts tests/integration/process-document.test.ts'`

Expected: PASS.

**Verification**: This slice owns zero observers; `4-AFK` can later attach one scheduler to this controller.

### [x] Task 4: Define the browser-neutral teardown contract test-first

**Files:**

- Create: `tests/runtime/messages.test.ts`
- Create: `src/runtime/messages.ts`

- [x] **Step 1: Write the failing guard matrix**

Accept the exact teardown object. Reject null, arrays, strings, empty objects, other type values, and unrelated objects without using `document`, `window`, `chrome`, or content mocks.

- [x] **Step 2: Implement and verify the shared module**

Add only the constant, interface, and guard shown in Contracts; import no DOM/Chrome/controller/content types.

Run: `zsh -lic 'corepack pnpm vitest run tests/runtime/messages.test.ts && corepack pnpm typecheck'`

Expected: PASS.

**Verification**: Content imports the shared contract; background stays unchanged and no sender/literal copy is added.

### [x] Task 5: Specify immediate installation and deferred processing

**Files:**

- Create: `tests/content/runtime.test.ts`
- Create: `tests/content/main.test.ts`

- [x] **Step 1: Write loading and duplicate-install tests**

Install on a loading document with a fake message runtime. Immediately assert one listener but no processing. Install again and assert the same handle, one listener/pending start, and no output. Dispatch readiness and assert one start/output. An unrelated message changes nothing.

- [x] **Step 2: Write teardown-before-ready and reactivation tests**

Install while loading, dispatch teardown through the already-installed listener, then dispatch readiness. Assert the source remains visible/unmarked and no output appears. Explicitly install again after readiness and assert one output returns while slot/handle/listener remain singular; teardown restores it.

- [x] **Step 3: Write ready-document and production-entrypoint tests**

For interactive/complete documents, assert synchronous processing and idempotent duplicate installation. Exercise `src/content/main.ts` with controlled globals/module isolation for loading and ready imports; both must install the listener immediately. Assert observable calls/listeners/DOM, never source text.

- [x] **Step 4: Run before implementation**

Run: `zsh -lic 'corepack pnpm vitest run tests/content/runtime.test.ts tests/content/main.test.ts'`

Expected: FAIL because runtime/slot are absent and current main delays all installation.

**Verification**: This directly reproduces teardown during loading followed by readiness.

### [x] Task 6: Implement immediate content lifecycle and stale-start protection

**Files:**

- Create: `src/content/runtime.ts`
- Modify: `src/content/main.ts`

- [x] **Step 1: Implement the global slot**

Store one slot under `Symbol.for("no-more-ago.document-runtime")`. Synchronously construct/reuse the handle and install one listener. Loading registers one readiness generation but does not start; interactive/complete starts synchronously. Duplicate install reuses everything. Explicit install from stopped reactivates using current readiness.

- [x] **Step 2: Implement teardown-before-ready**

Consume `isTeardownDocumentMessage`. Valid teardown invalidates the readiness generation, removes the callback when possible, calls idempotent controller teardown, and sets stopped. The callback checks generation and phase before start. Ignore unrelated messages.

- [x] **Step 3: Wire main immediately**

Call `installContentRuntime({ document, url: new URL(window.location.href), locales: navigator.languages, messages: chrome.runtime })` at module evaluation. Remove the outer readiness gate; do not modify background or add a sender/fan-out.

- [x] **Step 4: Run cross-boundary checks**

Run: `zsh -lic 'corepack pnpm vitest run tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/runtime/register-github.test.ts tests/build/chrome-artifact.test.ts && corepack pnpm typecheck'`

Expected: PASS; listener is available at document start, only processing waits, and teardown-before-ready remains stopped.

**Verification**: Shared protocol and content lifecycle are complete without observers, settings, or background coordination.

### [x] Task 7: Run the full quality gate and prepare manual smoke

**Files:**

- Modify: none

- [x] **Step 1: Run automated gates**

Run: `zsh -lic 'corepack pnpm lint && corepack pnpm typecheck && corepack pnpm test && corepack pnpm lint'`

Expected: Node 24/pnpm 10.34.5 login-shell toolchain; all lint, strict types, behavior tests, and artifact smoke pass.

- [x] **Step 2: Rebuild Chrome development artifact**

Run: `zsh -lic 'corepack pnpm dev chrome'`

Expected: fresh installable `dist/chrome-dev/`.

- [x] **Step 3: Record separately authorized manual checks**

Load the artifact, verify one exact linked date and working interaction, send the shared teardown message from an authorized extension diagnostic context, and verify the live source returns without reload. On a throttled/loading page, send teardown before readiness and verify no later transformation. Browser UI work requires human execution or explicit browser permission.

**Verification**: Artifact is ready for interaction/loading-race smoke without expanding this AFK implementation scope.

## Acceptance Coverage

| Acceptance criterion | Planned evidence |
| --- | --- |
| 1. Intact hidden host plus exactly one owned semantic output | Tasks 1-3: identities, markers, sibling position, semantic name, `dateTime`, public pipeline |
| 2. Repeated activation creates no duplicate replacement/observer/marker | Tasks 1, 3, 5-6: duplicate renderer/controller/slot/listener/output; zero observers in slice |
| 3. Interaction works and exact date is announced once | Task 3: bubbled pointer/keyboard behavior and one visible semantic date |
| 4. Teardown after nearby foreign changes removes only owned state | Tasks 1-3, 5-6: identity/marker matrix, live source, foreign siblings, same-output detach/reparent repair, retained-reference reattachment, zero owned nodes/markers, idempotent/message teardown |
| 5. Shadow root untouched and no page controls | Task 3: child identity/markup and control-count/addition assertions |

## Revision Finding Coverage

| Review finding | Concrete revision |
| --- | --- |
| Attempt 2: detached/reparented repair forgot the prior extension-created output identity, allowing old-node reattachment to survive teardown | Correlated ownership research makes `output` immutable and forbids repair allocation; the Owned Pair Record retains the sole created identity through teardown; Task 1 Step 2 exercises detach and reparent, same-identity repair, page-code reattachment through the retained old reference, and teardown with zero output/source markers; Task 2 Steps 2-3 move that exact valid identity back and later clear its marker before removal from any parent |
| Attempt 1: removed/reparented output repair could lose original hidden state | Research correlated rules and Tasks 1-2 keep immutable runtime `sourceWasHidden`/token. Both repair paths rerender then teardown initially visible and hidden sources |
| Attempt 1: marker presence could mutate forged/malformed/mismatched/orphan DOM | Research ownership/teardown and Tasks 1-2 require runtime identity plus exact markers; hostile matrices remain untouched; teardown iterates records, not marked queries |
| Attempt 1: listener installed after readiness lost teardown-before-ready | Research immediate installation and Tasks 5-6 install synchronously, defer only start, model stopped/generation, and test loading/ready/teardown-before-ready/reactivation |
| Attempt 1: content-owned teardown literal inverted future background dependency | Shared protocol research, Contracts, File Structure, and Task 4 put literal/type/guard in browser-neutral `src/runtime/messages.ts`; background/fan-out remain unchanged |

## Self-Review

- Every issue criterion and every review-attempt finding maps to a public behavior test before implementation.
- Runtime identity plus the exact expected marker authorizes mutation; attributes alone never do.
- Original hidden state is captured once and survives detached/reparented output repair.
- Each lifecycle creates exactly one output identity; valid detach/reparent repair moves that immutable identity rather than replacing it.
- The retained-reference regression moves the pre-repair output again after repair, then proves teardown leaves it disconnected and unmarked with zero owned nodes or markers in the document.
- Listener installation is immediate; stopped state defeats a stale readiness callback.
- The teardown protocol is shared/browser-neutral without implementing a background sender.
- MutationObserver, mutation scheduling, automatic updates/removal cleanup, settings, popup, tab injection/querying, registration removal, and fan-out remain out of scope.
- Types are consistent across record, nullable renderer, controller, message guard, runtime handle, and phases.
- Tests assert observable behavior and do not inspect implementation/configuration source text.
- No external contract or persistence is introduced; no `contracts/` directory is needed.
- The plan contains no unresolved placeholder or deferred in-scope decision.
