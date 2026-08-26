# Implementation Plan: [no-more-ago] Toggle global activation from the popup

- **Created**: 2026-08-24
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/6-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Review-attempt-1 revision: serialize and revision-gate the full settings-commit-to-runtime transaction; define one single-flight MV3 initialization/lifecycle/message state machine and fail-closed cleanup; distinguish typed save failure from ambiguous response loss; attribute reconciliation failures truthfully with current-tab precedence and recovery; target exact top frame `frameId: 0`; prove emitted popup CSP-safe behavior locally; preserve the English hostname popup, exact `github.com`, no counter/page UI, `<all_urls>` permission context, behavioral tests, and the stated no-Git/Corepack/browser/UI/network/external-utility boundaries

## Summary

Deliver one background-owned global activation transaction and an English popup without changing the validated timestamp, DOM ownership, mutation, or formatting pipeline. A V1 local snapshot contains `schemaVersion`, `revision`, and `globalEnabled`. The background serializes the entire operation—load or persist, reconcile dynamic registration, inject or teardown open GitHub tabs, publish the reconcile result, and derive the response model—so concurrent commands cannot leave runtime behavior behind the latest committed revision.

The MV3 background uses one single-flight state machine shared by module startup, `onStartup`, `onInstalled`, and early popup messages. A cold worker repairs only missing or mismatched registration and does not re-execute an already-correct enabled runtime in every tab. Startup/install activation sweeps are coalesced. Invalid or unreadable storage enters a typed failed-closed state that unregisters known persistent registrations and tears down exact top-frame GitHub runtimes before responding.

The popup receives revisioned authoritative models. A typed background `save-failed` response proves persistence failed and preserves the authoritative prior/latest model. A rejected transport is ambiguous: the client re-reads state, applying the returned revision if available; if re-read also fails, it shows a disabled mixed/unknown switch and explicitly unavailable status rather than claiming the old value. Reconciliation failures are attributed to registration, matching-tab query, current-tab query, or one tab/action. Failures relevant to the active GitHub tab override `Active`/`Extension is off`; unrelated-tab failures do not. The next successful reconciliation replaces stale failure state.

## Technical Context

- **Language/Version**: TypeScript 6.0.3 with TSX, ECMAScript 2022; Node `>=24 <25`; direct pnpm 10.34.5
- **Primary Dependencies**: React 19.2.8, React DOM 19.2.8, Mantine 9.5.2, Rspack 2.1.10, Chrome WebExtension types; no new dependency
- **Storage**: `chrome.storage.local`, one current V1 snapshot key; no sync, backup, diagnostics, page data, or site-history storage in this slice
- **Testing**: Vitest 4.1.11, jsdom 30.0.1, injected browser/storage clocks and deferred promises, parsed artifacts, and a local VM context with string/wasm code generation disabled
- **Target Platform**: Manifest V3 Chrome, Edge, and Firefox artifacts; exact top-level HTTP/HTTPS `github.com`; live-browser compatibility remains `16-HITL`

## Research

### Existing validated boundaries

Blockers `2-AFK` and `5-AFK` are `Validated`; implemented issues `1-AFK`, `3-AFK`, and `4-AFK` are also validated.

- `src/runtime/messages.ts:1-11` already owns the exact teardown message.
- `src/content/runtime.ts:7-115` already owns one document-global slot, listener, controller, and retry-safe teardown lifecycle.
- `src/runtime/register-github.ts:3-21` already defines exact GitHub `document_start`, top-frame-only registration.
- `src/runtime/scripting.ts:1-20` is the browser-neutral registration boundary.
- `src/background/chrome.ts:1-13` is currently an unconditional registration entrypoint and becomes a thin API adapter.
- `src/manifest/common.json:1-13` already declares `scripting`, local `storage`, and `<all_urls>`; no permission is added.
- `rspack.config.mjs:12-59` and `scripts/build/artifacts.mjs:105-113` provide compilation-owned metadata and semantic artifact validation without changing issue-5 publication/watch safety.

No project-local `AGENTS.md`, `DEVELOPMENT.md`, or root `README.md` exists. Supplied workspace instructions and the PRD apply.

### Whole transaction serialization and response consistency

`SettingsService` validates and persists one snapshot, but `BackgroundApplication` owns the wider transaction queue. Every settings command reserves a queue position immediately and runs these steps without overlap:

1. Read the latest committed snapshot.
2. For a changed boolean, persist revision `current + 1`, then publish it in memory; for an unchanged boolean, retain the revision but still reconcile so a previous runtime failure can recover.
3. Reconcile registration and matching open tabs for that exact revision.
4. Atomically replace `lastReconcile` with the result tagged by the same revision.
5. Release the mutation transaction.

After its mutation settles, each request appends a response-model read barrier to the same queue. Commands already reserved concurrently run before that barrier. Therefore a response records `acceptedRevision` for its own successful intent while `state.revision` is the latest authoritative revision at response time and is never lower. In the delayed `off`/`on` concurrency case, both response models resolve to the final enabled revision, while the first response still records its earlier accepted revision; final storage, registration, every reachable tab, and both returned models agree with the last accepted intent. Commands arriving after the barrier are later causal work.

A persistence rejection creates no revision, no coordinator call, and no `lastReconcile` replacement. Its typed `save-failed` response is also derived behind a queue barrier, so its state may truthfully include a different concurrently accepted command rather than blindly returning a stale pre-request object.

### Single-flight MV3 lifecycle state machine

The background phase is `cold | initializing | ready | failed-closed`. Module evaluation synchronously installs runtime/lifecycle listeners and calls `ensureReady("cold-worker")`. `ensureReady` owns one promise; early popup messages and lifecycle events await the same flight rather than starting another storage load or reconcile.

Lifecycle reasons are kept in a set and drained through the same transaction queue. `startup` plus `installed`/`updated` events received before or during initialization coalesce into one `activation-sweep`; rapid duplicates while ready coalesce per drain. Message reads wait behind initialization and any already-requested lifecycle drain. Settings commands reserve their transaction after readiness, so lifecycle and command reconciliation never overlap.

Reconcile modes are explicit:

| Mode | Registration behavior | Open-tab behavior |
| --- | --- | --- |
| `cold-worker`, enabled, exact registration present | No update | No injection |
| `cold-worker`, enabled, missing/mismatched registration | Register/update | Inject matching tabs once |
| `activation-sweep` from startup/install/update | Repair only missing/mismatched registration | Inject matching tabs once; coalesced events do not duplicate the sweep |
| settings command, enabled | Repair only missing/mismatched registration | Inject matching tabs; content runtime remains idempotent |
| settings command, disabled | Unregister present known registrations | Teardown matching tabs |
| `cold-worker`, disabled | Unregister if present | Query status and teardown only top-frame runtimes not already `stopped` |
| `failed-closed` | Unregister every present known registration | Teardown every matching top-frame tab |

`getRegisteredContentScripts` returns enough normalized fields to compare ID, matches, files, run-at, all-frames, and persistence. Equal specs are not updated. This prevents routine MV3 cold starts from repeatedly updating and executing the bundle.

Missing storage uses the enabled revision-0 default. Read failure or invalid V1 data does not use defaults. It enters `failed-closed`, attempts unregister and teardown even when a persistent registration predates the worker, records cleanup failures, and exposes settings-unavailable/unknown state with a disabled switch. Lifecycle events may retry cleanup but never enable processing until a later recovery/reset slice provides a valid snapshot.

### Adapter activation, exact frame, and failure attribution

The coordinator consumes injected `RuntimeAdapterDefinition[]`; production contains only GitHub. A synthetic test definition proves no coordinator branch is site-specific. All returned tab URLs are reparsed through the definition matcher, so `<all_urls>` remains only the permission context.

One-shot execution uses `target: { tabId, allFrames: false }`. Every teardown and status call uses `tabs.sendMessage(tabId, message, { frameId: 0 })`; no tab-wide broadcast is allowed. Per-tab operations settle independently.

`ActivationReconcileResult` is tagged with revision/mode and contains sanitized failures:

- registration operation failure, global to that adapter policy;
- matching-tab query failure, global to existing-tab reconciliation;
- tab-specific `inject | teardown | status` failure with adapter and tab ID.

Background active-tab lookup has its own `current-tab-query` failure. Popup precedence is:

1. Settings load/validation failure: `settings-unavailable`; if fail-closed cleanup is incomplete, explicitly say processing state is unknown.
2. Active-tab query failure: `runtime-failed` (`Could not process this page`).
3. Missing/non-HTTP(S)/hostless URL: `inaccessible` (`Cannot run on this page`).
4. No matching adapter: `no-rules`.
5. For a matching adapter, registration failure, matching-tab query failure, or this active tab's inject/teardown failure for the current revision: `runtime-failed`.
6. Committed disabled policy with no relevant failure: `global-disabled`.
7. Committed enabled policy: top-frame `waiting`/`active` is `active`; `stopped`/`failed`, malformed response, or status rejection is `runtime-failed`.

A failure for a different tab is retained for diagnostics in the in-memory reconcile result but does not downgrade the current tab. A later successful reconcile for the same or newer revision replaces the entire result, clearing recovered failures. Repeating an unchanged toggle therefore performs no storage write but can recover registration/query/tab state.

### Typed save failure versus ambiguous response loss

The popup never writes storage. A valid `save-failed` response proves the candidate was not persisted; the popup applies its authoritative revisioned state and shows `Could not save this change. Try again.`

`chrome.runtime.sendMessage` rejection, popup closure, or malformed/no response does not prove failure. After ambiguous loss, the client immediately sends `get-popup-state`:

- successful re-read: apply only if its revision is at least the last applied revision, and show `The response was interrupted. Current state was reloaded.`;
- failed re-read: set local availability to `unknown`, disable the switch, set its native `indeterminate`/`aria-checked="mixed"` state, and show `Could not confirm whether the change was saved. Reopen the popup to try again.` plus `Current state is unavailable`;
- late/out-of-order valid models with lower revision are ignored.

The prior checked value is never restored as authoritative after ambiguous response loss.

### CSP-safe popup artifact boundary

The emitted popup uses only extension-local `popup.js` and `popup.css`; no inline script/style, inline `on*` handler, remote/protocol-relative/data/blob/javascript executable reference, or runtime string code generation is allowed.

For every browser and dev/release mode, tests parse emitted `popup.html`, resolve local script/style references inside the artifact, and reject inline or remote executable markup. A local harness creates the DOM from emitted HTML, provides a fake runtime response, evaluates emitted `popup.js` inside a `vm` context created with `{ codeGeneration: { strings: false, wasm: false } }`, flushes render work, and asserts the hostname, global switch, and exact status appear. This proves CSP-relevant packaged behavior locally; it does not claim live browser compatibility, which remains `16-HITL`.

### Scope boundaries

- `7-AFK` owns hostname switches and Sites/options behavior.
- `8-AFK` through `14-AFK` own presentation, recovery hardening, diagnostics, reset, and reporting.
- `16-HITL` owns real-browser/live-GitHub verification.
- This issue adds no per-site control, options page, counter/badge, host-page UI, diagnostic store, remote request, second production adapter, or live-browser claim.

### Review-attempt-1 resolution map

| Finding | Resolution | Tasks |
| --- | --- | --- |
| Full transaction race | One background queue covers commit through reconcile/publication; response barriers and revisions define concurrent models | 1-2 |
| MV3 initialization gaps | Single readiness flight, coalesced lifecycle drain, spec-aware cold modes, failed-closed cleanup/status | 3-6 |
| Ambiguous response loss | Typed save failure only for known rejection; re-read or mixed unknown state; revision gate | 7 |
| Failure attribution | Revision-tagged registration/query/tab outcomes, precedence, unrelated-tab isolation, replacement on recovery | 3-6 |
| Top-frame messages | Exact `{ frameId: 0 }` for teardown and status | 3-4 |
| CSP behavior | Parsed local-only HTML policy and emitted-bundle boot with string code generation disabled | 8 |

## Entities

### Settings Snapshot V1

- **Fields**: `schemaVersion: 1`; safe nonnegative `revision`; `globalEnabled: boolean`
- **Relationships**: Solely owned/written by background Settings Service; tags activation and popup state
- **Validation**: Whole exact V1 object; invalid/unreadable current data enters failed-closed instead of defaults
- **States**: missing -> default revision 0; valid current -> persisted next revision; persistence rejection -> unchanged; invalid -> unavailable/failed-closed

### Background Control State

- **Fields**: phase; one readiness promise; queued lifecycle reasons; transaction tail; current snapshot or unavailable cause; last reconcile result
- **Relationships**: Shared by module startup, lifecycle listeners, and popup messages
- **Validation**: At most one initialization and one active transaction; `lastReconcile.revision` must equal its snapshot revision or be null for failed-closed
- **States**: cold -> initializing -> ready, or cold/initializing -> failed-closed; failed-closed may retry cleanup only

### Activation Reconcile Result

- **Fields**: revision/null; mode; desired policy; registration outcome; matching-query outcome; per-tab action outcomes
- **Relationships**: Atomically published after reconciliation; used to derive truthful popup state
- **Validation**: Exact adapter/tab attribution and sanitized reason codes; unrelated tab outcomes do not affect current-tab status
- **States**: pending -> published success/partial failure; replaced wholesale by next result

### Popup Model

- **Fields**: availability; revision/null; globalEnabled/null; hostname/null; status; optional failure cause
- **Relationships**: Computed behind the control queue; revision-gated by popup
- **Validation**: Ready models have boolean/revision; unavailable models have null setting/revision and a disabled mixed switch; no counter field
- **States**: loading -> ready; saving -> authoritative response; ambiguous loss -> reread-ready or unknown

## Contracts

No remote API or issue-local contract file is required. Internal contracts are:

```ts
export interface SettingsSnapshotV1 {
  readonly schemaVersion: 1;
  readonly revision: number;
  readonly globalEnabled: boolean;
}

export type SettingsWriteResult =
  | { readonly ok: true; readonly changed: boolean; readonly snapshot: SettingsSnapshotV1 }
  | { readonly ok: false; readonly error: "persistence-failed"; readonly snapshot: SettingsSnapshotV1 };
```

```ts
export interface TabsRuntime {
  query(query: {
    readonly url?: string[];
    readonly active?: boolean;
    readonly currentWindow?: boolean;
  }): Promise<readonly RuntimeTab[]>;
  sendMessage(
    tabId: number,
    message: unknown,
    options: { readonly frameId: 0 }
  ): Promise<unknown>;
}

export interface ScriptingRuntime {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<readonly RegisteredContentScriptSpec[]>;
  registerContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;
  updateContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;
  unregisterContentScripts(filter: { ids: string[] }): Promise<void>;
  executeScript(input: {
    readonly target: { readonly tabId: number; readonly allFrames: false };
    readonly files: string[];
  }): Promise<unknown>;
}
```

```ts
export type ReconcileFailure =
  | { readonly scope: "registration"; readonly adapterId: string; readonly operation: "get" | "register" | "update" | "unregister" }
  | { readonly scope: "matching-tabs-query" }
  | { readonly scope: "tab"; readonly adapterId: string; readonly tabId: number; readonly action: "inject" | "teardown" | "status" };

export interface ActivationReconcileResult {
  readonly revision: number | null;
  readonly mode: "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";
  readonly policy: "enabled" | "disabled" | "unknown";
  readonly failures: readonly ReconcileFailure[];
}
```

```ts
export type PopupStatus =
  | "active"
  | "global-disabled"
  | "inaccessible"
  | "runtime-failed"
  | "no-rules"
  | "settings-unavailable";

export type PopupState =
  | {
      readonly availability: "ready";
      readonly revision: number;
      readonly globalEnabled: boolean;
      readonly hostname: string | null;
      readonly status: Exclude<PopupStatus, "settings-unavailable">;
      readonly failure?: "current-tab-query" | "registration" | "matching-tabs-query" | "current-tab-inject" | "current-tab-teardown" | "document-status";
    }
  | {
      readonly availability: "unavailable";
      readonly revision: null;
      readonly globalEnabled: null;
      readonly hostname: string | null;
      readonly status: "settings-unavailable" | "runtime-failed";
      readonly failure: "settings-load" | "fail-closed-cleanup";
    };

export type SetGlobalEnabledResponse =
  | { readonly ok: true; readonly acceptedRevision: number; readonly state: PopupState }
  | { readonly ok: false; readonly error: "save-failed" | "settings-unavailable"; readonly state: PopupState };
```

Document status keeps exact request/response guards and phases `waiting | active | stopped | failed`; teardown remains unchanged. `BackgroundApplication` exposes `ensureReady(reason)`, coalesced `requestLifecycle(reason)`, queued `getPopupState()`, and queued `setGlobalEnabled(enabled)`.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/settings/snapshot.ts` | Create | V1 defaults/parser/candidate validation |
| `src/settings/settings-service.ts` | Create | Persist-before-publish snapshot mutation |
| `src/runtime/scripting.ts` | Modify | Full comparable registrations, unregister, top-frame execution |
| `src/runtime/tabs.ts` | Create | Tab query and exact-frame messaging contracts |
| `src/runtime/register-github.ts` | Modify | Exact GitHub runtime definition and unchanged registration spec |
| `src/runtime/adapter-activation.ts` | Create | Mode-aware spec diff, inject/teardown/status fan-out, typed outcomes |
| `src/runtime/messages.ts` | Modify | Existing teardown plus exact document-status guards |
| `src/content/runtime.ts` | Modify | Failed phase and status response on the singular listener |
| `src/background/messages.ts` | Create | Strict popup request/response guards |
| `src/background/application.ts` | Create | Single-flight lifecycle, full transaction queue, failure precedence, response barrier |
| `src/background/chrome.ts` | Modify | Synchronous listener installation and browser API adapters |
| `src/popup/client.ts` | Create | Typed command/read transport and ambiguous-loss reread |
| `src/popup/app.tsx` | Create | Revision-gated English global popup and mixed unavailable state |
| `src/popup/main.tsx` | Create | Mantine/React mount and extension-local styles |
| `src/popup/styles.css` | Create | Bounded popup-only layout |
| `src/popup/popup.html` | Create | Local external CSS/JS document with no inline executable content |
| `src/manifest/common.json` | Modify | Manifest action/default popup; permissions unchanged |
| `rspack.config.mjs` | Modify | TSX/CSS popup compilation and watched HTML emission |
| `scripts/build/artifacts.mjs` | Modify | Manifest popup reference validation |
| `tsconfig.json` | Modify | Strict React JSX and TSX includes |
| `eslint.config.mjs` | Modify | Typed TSX lint coverage |
| `vitest.config.ts` | Modify | TSX behavior test discovery |
| `tests/settings/settings-service.test.ts` | Create | V1 persistence/validation/no-op behavior |
| `tests/runtime/adapter-activation.test.ts` | Create | Modes, spec diff, frame 0, failure attribution/isolation/recovery |
| `tests/runtime/register-github.test.ts` | Modify | Exact matcher/registration regression |
| `tests/runtime/messages.test.ts` | Modify | Exact status and teardown guard matrices |
| `tests/content/runtime.test.ts` | Modify | Waiting/active/stopped/failed status lifecycle |
| `tests/background/application.test.ts` | Create | Concurrent transactions and MV3 single-flight/fail-closed state machine |
| `tests/popup/app.test.tsx` | Create | Revision gate, typed save error, response-loss reread/unknown UI, visible states |
| `tests/build/chrome-artifact.test.ts` | Modify | All-target/mode popup CSP parsing and VM boot; emitted background state-machine smoke |
| `tests/build/watch.test.ts` | Modify | Maintained popup input rebuild regression |

## Tasks

### [x] Task 1: Specify settings and concurrent full-transaction behavior

**Files:**

- Create: `tests/settings/settings-service.test.ts`
- Create: `tests/background/application.test.ts`

- [x] Write failing V1 tests for missing default, valid disabled reload, exact whole-object rejection, changed revision, unchanged no-write, and persistence failure.
- [x] Write a deferred concurrent `set(false)` / `set(true)` test that blocks revision-1 reconcile operations, proves revision 2 cannot begin early, then asserts final storage enabled, exact registration present, every reachable tab injected/active, and both response `state` models at revision 2 enabled; accepted revisions remain 1 and 2.
- [x] Assert typed persistence failure performs no reconcile, while a repeated unchanged command does reconcile and clears a prior runtime failure without storage churn.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/settings/settings-service.test.ts tests/background/application.test.ts'`; expect missing settings/background modules.

**Verification**: Delayed public promises prove queue order and returned-model semantics without inspecting implementation text.

### [x] Task 2: Implement V1 persistence and the revisioned control queue

**Files:**

- Create: `src/settings/snapshot.ts`
- Create: `src/settings/settings-service.ts`
- Create: `src/background/messages.ts`
- Create: `src/background/application.ts`

- [x] Implement exact V1 parsing, default-on-missing, typed invalid/load failure, and persist-before-publish mutation.
- [x] Implement one application transaction tail covering mutation, reconcile, `lastReconcile` publication, and release; tag results by revision and reject stale publication.
- [x] Reserve command transactions immediately and append response-model barriers after mutation settlement, returning `acceptedRevision` plus the latest nonolder model.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/settings/settings-service.test.ts tests/background/application.test.ts'`; expect all persistence and concurrency cases to pass.

**Verification**: No delayed schedule can leave registration/tab state opposite the latest committed snapshot.

### [x] Task 3: Specify activation modes, exact frame, and attributed failures

**Files:**

- Modify: `tests/runtime/register-github.test.ts`
- Create: `tests/runtime/adapter-activation.test.ts`

- [x] Preserve exact GitHub matcher/spec tests and add a synthetic injected definition proving generic coordinator behavior.
- [x] Test cold-worker exact-spec no-update/no-inject; cold missing/mismatch repair plus one injection sweep; activation sweep; enabled/disabled settings modes; stopped-runtime skip; failed-closed unregister/teardown.
- [x] Assert every status/teardown call is exactly `sendMessage(tabId, message, { frameId: 0 })` and execution is `{ tabId, allFrames: false }`.
- [x] Inject registration get/register/update/unregister failure, matching-tab query failure, current-tab inject/teardown/status failure, and unrelated-tab failure. Assert typed scope/action/tab attribution, sibling continuation, and replacement by a later successful result.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts'`; expect missing extended runtime contracts/coordinator.

**Verification**: Only failures relevant to the selected active tab or global adapter policy can downgrade its status.

### [x] Task 4: Implement mode-aware activation and top-frame messaging

**Files:**

- Modify: `src/runtime/scripting.ts`
- Create: `src/runtime/tabs.ts`
- Modify: `src/runtime/register-github.ts`
- Create: `src/runtime/adapter-activation.ts`

- [x] Extend comparable registration, unregister, execute, tab, and exact `{ frameId: 0 }` message types.
- [x] Implement normalized spec equality so correct persistent registration is not updated.
- [x] Implement each reconcile mode, URL reselection, independent settled fan-out, stopped-status skip, and sanitized attributed results.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/runtime/messages.test.ts tests/content/runtime.test.ts'`; expect all green.

**Verification**: Routine cold workers do not reinject enabled tabs, while explicit activation and failed-close paths do the required bounded work.

### [x] Task 5: Specify the single-flight MV3 and failed-closed state machine

**Files:**

- Modify: `tests/runtime/messages.test.ts`
- Modify: `tests/content/runtime.test.ts`
- Modify: `tests/background/application.test.ts`

- [x] Test exact document-status guards and content `waiting -> active`, teardown `stopped`, rollback `failed`, and retry on one listener/controller.
- [x] Fire module cold start, startup, install/update, and an early get message during one deferred storage load. Assert one load, one coalesced activation sweep, one response after readiness, and no overlapping transactions.
- [x] Recreate multiple cold-worker application instances over the same enabled storage and exact persistent registration. Assert no update or open-tab execution. Repeat with valid disabled storage and assert inactive reconciliation.
- [x] Seed invalid storage plus a pre-existing persistent registration and active GitHub runtimes. Assert unregister and frame-0 teardown are attempted before unavailable response; cleanup failure reports unknown processing state. Assert lifecycle retries cleanup but never defaults to enabled.
- [x] Test precedence for current-tab query, restricted URL, no adapter, registration, matching query, current-tab action, unrelated tab, and document phase; verify recovery after the next successful reconciliation.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/background/application.test.ts'`; expect failures until lifecycle/status logic is implemented.

**Verification**: All MV3 entry paths share one readiness/transaction state and invalid settings cannot leave a silently active known runtime.

### [x] Task 6: Implement lifecycle gating, fail-closed cleanup, and truthful status

**Files:**

- Modify: `src/runtime/messages.ts`
- Modify: `src/content/runtime.ts`
- Modify: `src/background/application.ts`
- Modify: `src/background/chrome.ts`

- [x] Add exact status request/response guards; retain the teardown contract and mark rollback `failed`.
- [x] Implement `cold | initializing | ready | failed-closed`, one readiness flight, coalesced lifecycle reason drain, and message gating through the same transaction tail.
- [x] On invalid/read-failed storage, call failed-closed coordinator cleanup and publish unavailable/unknown state; never construct defaults.
- [x] Implement the documented active-tab/failure precedence and replace stale failure state only with a same/newer successful reconcile.
- [x] Register runtime/startup/install listeners synchronously in `chrome.ts`, adapt storage/scripting/tabs including frame 0, and send each async response once.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/background/application.test.ts'`; expect all green.

**Verification**: Registration/query/current-tab failures cannot be mislabeled as active/off, and unrelated tabs remain isolated.

### [x] Task 7: Implement popup behavior for revision, save failure, and response loss

**Files:**

- Create: `tests/popup/app.test.tsx`
- Create: `src/popup/client.ts`
- Create: `src/popup/app.tsx`
- Create: `src/popup/main.tsx`
- Create: `src/popup/styles.css`
- Modify: `tsconfig.json`
- Modify: `eslint.config.mjs`
- Modify: `vitest.config.ts`

- [x] First write failing rendered-DOM tests for active GitHub hostname/global switch/no counter, globally disabled, inaccessible, runtime-failed, no-rules, settings-unavailable, and fail-closed unknown wording.
- [x] Test lower-revision response rejection and a typed `save-failed` response that preserves/applies its authoritative model and exact save alert.
- [x] Test committed-but-response-lost: reject the set transport after background success, re-read and apply the committed revision with interrupted-response notice. Then reject both calls and assert disabled indeterminate/`aria-checked="mixed"` switch and unavailable wording, not the prior checked claim.
- [x] Enable strict TSX tooling, implement typed transport guards/reread, revision gate, Mantine view, and popup mount; no storage/tabs/scripting access.
- [x] Run `zsh -lic 'pnpm exec vitest run tests/popup/app.test.tsx tests/background/application.test.ts'`, then direct `pnpm typecheck` and `pnpm lint`; expect all green.

**Verification**: Only typed save failure claims a failed save; ambiguous delivery cannot display stale policy as authoritative.

### [x] Task 8: Emit and behaviorally validate a CSP-safe popup

**Files:**

- Create: `src/popup/popup.html`
- Modify: `src/manifest/common.json`
- Modify: `rspack.config.mjs`
- Modify: `scripts/build/artifacts.mjs`
- Modify: `tests/build/chrome-artifact.test.ts`
- Modify: `tests/build/watch.test.ts`

- [x] First extend artifact tests for every browser/dev-release pair: parse manifest/HTML, require only local external script/style references, reject inline script/style/handlers and remote/protocol/data/blob/javascript executable references, and verify ZIP parity.
- [x] Add a local emitted-popup boot harness with fake ready state and `vm` string/wasm code generation disabled; assert rendered hostname, switch, and status for every target/mode without browser automation.
- [x] Extend emitted-background smoke with deferred lifecycle/message fakes, valid disabled restart, exact enabled cold restart, and invalid storage plus persistent registration cleanup.
- [x] Create external-only popup HTML/action metadata; compile TSX/CSS with automatic JSX, built-in CSS, `popup.css`, and watched HTML; validate manifest popup references without changing issue-5 publication logic.
- [x] Add representative popup TSX/CSS/HTML watch generations, then run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/commands.test.ts tests/build/watch.test.ts'`; expect all target/mode and watch cases green.

**Verification**: Packaged popup behavior works under the local CSP-constrained boundary; no live-browser compatibility claim is made.

### [x] Task 9: Run full local gates and preserve HITL scope

**Files:**

- No planned production changes

- [x] Confirm `zsh -lic 'node --version'` is Node 24 and `zsh -lic 'pnpm --version'` is 10.34.5.
- [x] Run `zsh -lic 'pnpm check'`.
- [x] Run `zsh -lic 'pnpm dev'` and `zsh -lic 'pnpm release'`; semantically validate all three target pairs and CSP boot tests.
- [x] Run final `zsh -lic 'pnpm lint'`.
- [x] Record, but do not perform, the permissioned manual cross-browser popup/disable/re-enable/restart smoke in `16-HITL`.

**Verification**: No Git, Corepack, browser automation/UI, network, external process-tree utility, or external utility provenance test is used.
