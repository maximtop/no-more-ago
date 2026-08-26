# Implementation Plan: [no-more-ago] Collect bounded opt-in debug logs

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/11-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Logging is opt-in, capped at 5 MB, useful for debugging, and deleted when disabled. Keep the design simple, preserve validated settings recovery, and delegate implementation across independent settings/journal, runtime, and Options/build boundaries.

## Summary

Persist a default-off `debugEnabled` flag in the existing sole-writer, atomic current/previous settings pair using a strict unpublished V5 schema. Store independently sanitized diagnostic entries under one separate local key, serialize writes, and enforce a maximum of exactly 5,000,000 UTF-8 bytes including the persisted envelope. Route trusted background and GitHub-document events through the background writer, derive page context from trusted runtime senders, and immediately remove the entire journal when the English Options `Debug logs` switch is disabled. Logging/storage failures must never interrupt date replacement. Preserve recovery, existing formats, hostname policy, and all six browser artifacts; postpone export, manual clearing, reporting, and the normal-state reset interface.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, React 19.2.8, ECMAScript 2022, Node 24, pnpm 10.34.5.
- **Primary Dependencies**: Existing Mantine, WebExtension APIs, and browser `TextEncoder`; no additional dependency or permission.
- **Storage**: Browser `storage.local` keys `settings`, `settings.previous`, and separate `diagnostics`; never `storage.sync`.
- **Testing**: Vitest 4.1.11, jsdom, fake browser storage and senders, actual connected document runtimes, and emitted CSP-constrained bundles.
- **Target Platform**: Manifest V3 Chrome, Edge, and Firefox development/release builds; exact `github.com` content scripts.

## Research

### Existing storage and runtime boundaries

Validated Issues 9–10 provide a strict unpublished V4 snapshot, `SettingsService` as the sole serialized settings writer, one atomic current/previous storage write, corruption recovery, fail-closed activation, recovery-only reset, custom display preferences, and exact runtime message guards. Replace the unpublished schema with strict V5; update all valid fixtures, imports, and factory calls together. Reject V4 snapshots rather than implementing migration, aliases, or pre-publication backward compatibility. Preserve every existing field on global/site/display/debug updates, backup recovery, and reset.

`BackgroundApplication` coordinates runtime policy; `src/background/chrome.ts` owns the actual background listener and browser storage adapter; `src/content/main.ts` connects browser transport to `src/content/runtime.ts`, which owns one existing listener and incremental document controller; and Options communicates exclusively through `SitesClient`. Initial content hydration must receive committed `debugEnabled` and `revision` through the existing ready `DisplayState` projection, whose producer, own-field guard, browser route, Options consumer, and content loader are updated together. After a committed debug toggle, broadcast one revisioned debug-policy update to every already-active matching top-frame document through the existing content listener; require its exact revision acknowledgement, ignore stale updates/hydration generations, and surface delivery failures without changing committed policy. Disabling closes the background event gate immediately, stops each reachable document before deleting/draining its journal, and prevents late messages from recreating it. Keep background as the only journal writer. Extend browser fake storage with public `remove(key)` semantics. Do not introduce duplicate listeners, timers, extra observers, page-injected UI, remote requests, account sync, browser automation, Git, Corepack, network access, implementation-text assertions, or external-utility tests.

Real mutation batches are already consumed in `src/core/document-transformation-controller.ts`; adapter candidate rejection, formatting, and safe skip decisions are already made in `src/core/process-document.ts`. Add only optional lightweight diagnostic sink hooks at those existing boundaries, reusing the current scheduler batch and one-pass candidate paths. An undefined sink must invoke no callback and construct no payload; enabling/disabling updates the existing controller's sink without creating another observer, scanning the document again for instrumentation, or modifying timestamp semantics.

### Privacy, capacity, and failure handling

Allow only event category, timestamp, canonical exact hostname, coarse GitHub page category, adapter/extension versions, coarse browser family, safe counts/durations, reason code, permitted incognito marker, and scrubbed stack frames. Derive hostname/category/incognito from trusted runtime sender metadata, never a page-supplied URL. Strict guards reject unknown/inherited fields; sanitize error stacks by removing URLs, paths, query strings, hashes, arbitrary messages, tokens, and secrets. Never persist source `datetime`, visible text, DOM content, page URLs, or replacement text.

Compute capacity from `new TextEncoder().encode(JSON.stringify({ entries })).byteLength`; remove oldest entries until the complete envelope is at most `5_000_000` bytes, discarding an individually excessive event. Serialize append/delete operations so disabling cannot resurrect stale entries. With logging off, avoid journal writes, observer additions, extra mutation processing, and per-event payload construction. When permitted by existing browser access, private/incognito events follow the same local sanitization rules without requesting new access.

## Entities

### Settings snapshot V5

- **Fields**: `schemaVersion: 5`; safe `revision`; `globalEnabled`; exact-host `sitePreferences`; existing validated `display`; `debugEnabled: boolean` defaulting to `false`.
- **Relationships**: Both current and previous complete documents are validated and atomically written only by `SettingsService`; background and Options consume authoritative state.
- **Validation**: Exactly six own fields, existing hostname/display/format/time-zone rules, strict boolean debug flag, and no acceptance of unpublished V4 or unknown future schemas.
- **States**: default-off → enabled → disabled; dual corruption remains failed closed until existing explicit recovery reset.

### Diagnostic event and journal

- **Fields**: Separate local `diagnostics` envelope containing ordered allowlisted technical event records; maximum serialized UTF-8 size `5_000_000` bytes.
- **Relationships**: Real background/document emitters feed one background-only sanitizer and serialized journal service; debug state remains exclusively in the settings snapshot.
- **Validation**: Trusted sender-derived hostname/page class/incognito context, canonical hostname, bounded safe scalar fields, stripped stack data, oldest-first eviction, oversize discard, and zero forbidden browsing data.
- **States**: absent/off → collecting/on → bounded eviction → immediately absent/off; storage failure is isolated from timestamp replacement.

## Contracts

- **Settings**: `SettingsSnapshotV5`, strict `parseSettingsSnapshot`, default `debugEnabled: false`, and serialized `SettingsService.setDebugEnabled(enabled)` preserving one atomic validated current/previous write.
- **Diagnostics journal**: A background-owned `DiagnosticJournal` using `storage.local.get/set/remove`; `append(event)` and `delete()` are serialized, sanitized, bounded, and non-disruptive on storage errors.
- **Options transport**: Exact-own-field get-debug-state and set-debug-enabled runtime messages, typed authoritative responses, one dispatch per toggle, actionable save errors, and no automatic duplicate mutation.
- **Document hydration**: Existing ready `DisplayState` contains its existing exact `revision`/`display` plus committed `debugEnabled: boolean`; background projection, strict response guard, content entrypoint/loader, and connected fixtures share this one authoritative read. A superseded hydration generation or lower policy revision never overwrites a newer committed content policy.
- **Document policy updates**: Exactly one strict background-to-content message `{ type: "no-more-ago:update-debug-policy", revision, enabled }` and exact acknowledgement `{ type: "no-more-ago:debug-policy-updated", revision }`; committed toggles broadcast to all already-active matching `github.com` top frames through their existing listener, reject malformed/stale revisions, and report missing/mismatched acknowledgements without inventing a second listener or reverting committed settings.
- **Document events and disable ordering**: One strict content-to-background diagnostic-event envelope; sender hostname/category/incognito is derived by the actual background listener and ignored if logging is disabled, context is invalid, or policy does not permit collection. On disable: commit V5 settings, immediately close the background gate, broadcast stop and await reachable acknowledgements, then drain/delete the separate journal before returning; stale queued messages cannot resurrect entries even when a document is unreachable.
- **Processing hooks**: Optional disabled-by-default sink callbacks reuse the existing controller scheduler batch and existing processing candidate pass to emit actual mutation counts, formatting counts/durations, and safe adapter/skip reason codes; no callback/payload construction, extra discovery, scan, observer, or timer when disabled.
- **Existing reset**: Existing recovery reset restores V5 defaults with logging disabled and deletes a previously present diagnostic journal without weakening fail-closed behavior.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/settings/snapshot.ts` | Modify | Strict V5 snapshot, default-off debug flag, unchanged validated display/hostname rules. |
| `src/settings/settings-service.ts` | Modify | Serialized debug updates, V5 current/previous preservation, storage `remove` contract. |
| `src/diagnostics/events.ts` | Create | Strict technical-event allowlist, trusted context categorization, privacy sanitization. |
| `src/diagnostics/journal.ts` | Create | Separate local journal, exact UTF-8 cap, oldest-first eviction, serialized deletion and errors. |
| `src/background/application.ts` | Modify | Authoritative debug state and ready Display hydration, durable toggle, revisioned existing-document broadcast/ACK, trusted lifecycle/settings events, ordered disable cleanup. |
| `src/background/messages.ts` | Modify | Strict debug state/toggle/document-event envelopes, exact ready Display hydration shape, and typed response guards. |
| `src/background/chrome.ts` | Modify | Journal construction, storage `remove`, one runtime dispatch, trusted sender context. |
| `src/content/main.ts` | Modify | Connect existing initial Display hydration and content event transport to the same browser document runtime. |
| `src/content/runtime.ts` | Modify | Generation/revision-safe initial debug hydration, one existing-listener policy update/ACK, optional sink lifecycle, and gated document events. |
| `src/runtime/messages.ts` | Modify | Exact-own-field diagnostic-event and revisioned debug-policy-update/acknowledgement contracts. |
| `src/core/document-transformation-controller.ts` | Modify | Optional diagnostic sink at the existing scheduler-batch boundary; one observer and zero disabled callback/payload work. |
| `src/core/process-document.ts` | Modify | Optional diagnostic sink in the existing single candidate pass for actual adapter decisions, formatting timing/counts, and safe skip reasons. |
| `src/options/client.ts` | Modify | Validated debug state reads and one-shot toggle mutation transport. |
| `src/options/app.tsx` | Modify | English default-off `Debug logs` switch with persistence/failure feedback. |
| `tests/settings/snapshot.test.ts`, `tests/settings/settings-service.test.ts` | Modify | V5 strictness, atomic pair, debug transitions, recovery, and fake `remove`. |
| `tests/diagnostics/events.test.ts`, `tests/diagnostics/journal.test.ts` | Create | Allowlist/privacy, sender context, UTF-8 envelope capacity, concurrency, eviction, deletion, failures. |
| `tests/background/application.test.ts`, `tests/background/messages.test.ts`, `tests/content/runtime.test.ts`, `tests/runtime/messages.test.ts` | Modify | Authoritative hydration, strict revisioned updates/ACK, trusted activity, stale races, disabled overhead, incognito, failures. |
| `tests/integration/document-ownership.test.ts`, `tests/integration/process-document.test.ts` | Modify | Observable real scheduler batches, candidate skips, formatting timing/counts, one observer, and zero disabled diagnostic callbacks. |
| `tests/options/app.test.tsx` | Modify | Accessible English toggle, loading, persistence, actionable failures, recovery. |
| `tests/integration/presentation-updates.test.ts`, `tests/build/chrome-artifact.test.ts` | Modify | Real connected GitHub documents, separate storage privacy, V5 fixtures, and six emitted CSP artifacts. |

## Tasks

### [x] Task 1: Advance the atomic settings pair to strict default-off V5

**Files:** `src/settings/snapshot.ts`, `src/settings/settings-service.ts`, `tests/settings/snapshot.test.ts`, `tests/settings/settings-service.test.ts`.

- [x] **Step 1: Add failing public snapshot/service tests** for exactly six own V5 fields, default `debugEnabled: false`, V4 rejection, typed boolean validation, preserving all global/site/display fields during concurrent debug mutations, unchanged no-op, one atomic current/previous write, prior-snapshot recovery, failed writes, and default-off recovery reset; extend this suite's fake storage with `remove(key)`.
- [x] **Step 2: Run** `pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts` **and confirm missing V5/debug behavior fails.**
- [x] **Step 3: Implement strict `SettingsSnapshotV5`, default-off factory/parser, and serialized `SettingsService.setDebugEnabled`**, updating all settings-only valid fixtures while preserving whole-document validation, strict errors, current/previous recovery, and reset; do not read unpublished V4.
- [x] **Step 4: Rerun both settings suites** and require every old policy/display/recovery case and every new V5 case to pass.

**Verification**: Debug preference is local, fully validated, recovery-safe, off by default, and never stored independently or synchronized.

### [x] Task 2: Define a strict privacy-preserving diagnostic event contract

**Files:** Create `src/diagnostics/events.ts`, `tests/diagnostics/events.test.ts`; modify `src/runtime/messages.ts`, `tests/runtime/messages.test.ts`.

- [x] **Step 1: Write failing observable sanitizer/message tests** covering allowed lifecycle/adapter/mutation/timing/settings/skip/error categories, event timestamps and counts, canonical hostname and GitHub page category, coarse environment/version, trusted incognito metadata, own-field exactness, sender-context derivation, hostile extra/inherited fields, stacks containing forbidden data, the exact revisioned `no-more-ago:update-debug-policy` request, its exact matching acknowledgement, unsafe revisions, and stale/malformed messages.
- [x] **Step 2: Run** `pnpm exec vitest run tests/diagnostics/events.test.ts tests/runtime/messages.test.ts` **and confirm the missing sanitizer/event/policy-update contracts fail.**
- [x] **Step 3: Implement compact allowlisted event/context sanitization, one strict content event envelope, and exact-own-field revisioned debug-policy update/acknowledgement guards**, deriving trusted hostname/coarse category/incognito only at the receiving boundary and discarding unsafe strings/fields.
- [x] **Step 4: Rerun both suites** and verify persisted-ready events contain exclusively permitted technical scalar fields.

**Verification**: No full URL, query/hash, page text, DOM, datetime, secret, arbitrary error text, or stack URL can cross the durable event contract.

### [x] Task 3: Build an isolated, serialized, exactly bounded local journal

**Files:** Create `src/diagnostics/journal.ts`, `tests/diagnostics/journal.test.ts`.

- [x] **Step 1: Write failing journal API tests** for disabled zero `get/set/remove`, allowed event persistence under a separate key, exact `TextEncoder` UTF-8 envelope sizes including multibyte content, oldest-first eviction at `5_000_000` bytes, excessive-entry discard, concurrent append ordering, disable/delete preventing in-flight resurrection, absent-key deletion, malformed journal handling, and get/set/remove failures isolated from callers.
- [x] **Step 2: Run** `pnpm exec vitest run tests/diagnostics/journal.test.ts` **and confirm the missing public journal fails.**
- [x] **Step 3: Implement one simple background-owned journal service** with a serialized operation tail, allowlisted append, full-envelope byte measurement, oldest-first eviction/oversize discard, immediate `storage.remove("diagnostics")` on disable, and contained typed storage failures.
- [x] **Step 4: Rerun the journal suite** and assert the complete durable envelope never exceeds `5_000_000` bytes.

**Verification**: Diagnostics can neither exceed 5 MB nor corrupt/interfere with the atomic settings pair, and disabling leaves no diagnostic key.

### [x] Task 4: Wire trusted background toggles and document activity

**Files:** `src/background/application.ts`, `src/background/messages.ts`, `src/background/chrome.ts`, `src/content/main.ts`, `src/content/runtime.ts`, `src/core/document-transformation-controller.ts`, `src/core/process-document.ts`, `tests/background/application.test.ts`, `tests/background/messages.test.ts`, `tests/content/runtime.test.ts`, `tests/integration/document-ownership.test.ts`, `tests/integration/process-document.test.ts`. Task 2 owns shared `src/runtime/messages.ts` and its guard tests; Task 4 consumes those established contracts.

- [x] **Step 1: Migrate only these suites' valid V4 fixtures to V5 and extend their fake storages with `remove`**, then add failing public tests for ready Display hydration exposing the committed debug boolean/revision, one existing content listener receiving enable/disable broadcasts and exact ACK, rejected stale hydration generations/updates, missing/mismatched ACK failure, one sender-derived event response, lifecycle/settings/activation, optional existing-controller batch counts, actual one-pass candidate formatting counts/timings and safe skip reasons, private sender, untrusted-host rejection, one observer, zero disabled callbacks/payload construction, failed settings writes, storage failure while date replacement continues, and ordered disable gate → document stop → journal deletion/recovery cleanup.
- [x] **Step 2: Run** `pnpm exec vitest run tests/background/application.test.ts tests/background/messages.test.ts tests/content/runtime.test.ts tests/integration/document-ownership.test.ts tests/integration/process-document.test.ts` **and confirm missing hydration, policy updates, and processing-hook events fail.**
- [x] **Step 3: Connect one background-owned journal, authoritative existing Display hydration, exact background listener branches, and the existing content listener's revisioned debug-policy update/ACK**, broadcasting committed transitions to matching active top frames and rejecting stale hydration/update generations. Pass an optional lightweight sink through the existing controller scheduler batch and one-pass document processor; emit safe actual metrics only when enabled, with no duplicate listeners, observers, scans, timers, disabled callbacks, or payload construction. On disable, commit settings, close the background event gate, stop/await reachable documents, then drain/delete before replying; contain delivery/storage errors and preserve recovery cleanup.
- [x] **Step 4: Rerun the background/content suites** and confirm all old activation, display, site, recovery, and fail-closed cases still pass.

**Verification**: Actual background/content activity is useful and sanitized only after opt-in; diagnostic failure never blocks page replacement, and private events require only access already granted by the browser.

### [x] Task 5: Expose one accessible English Debug logs opt-in switch

**Files:** `src/options/client.ts`, `src/options/app.tsx`, `tests/options/app.test.tsx`.

- [x] **Step 1: Extend real-transport Options tests** for a visible English `Debug logs` switch, authoritative default-off hydration, one enabling request, durable enabled reread, one disabling request with immediate off state, malformed/interrupted response without mutation replay, duplicate-click prevention, actionable settings/journal failures, recovery unavailable state, and existing Sites/Display/custom-format behavior.
- [x] **Step 2: Run** `pnpm exec vitest run tests/options/app.test.tsx` **and confirm the new public control and transport are absent.**
- [x] **Step 3: Add guarded read/toggle methods to `SitesClient` and one accessible Mantine switch**, consume authoritative background responses, present concise actionable failures, and preserve existing reset/display interactions without download, manual clear, reporting, counters, confirmation, or page-injected controls.
- [x] **Step 4: Rerun Options tests** and verify disabled-by-default, persistence, single dispatch, errors, and recovery.

**Verification**: Users explicitly control debug collection from English extension Options, and changing the switch never writes browser storage from the UI.

### [x] Task 6: Prove privacy and non-interference through actual GitHub documents

**Files:** `tests/integration/presentation-updates.test.ts`; modify only this connected-document fixture and narrowly necessary public wiring.

- [x] **Step 1: Migrate the connected two-document fixture to strict V5**, model atomic current/previous writes plus independent diagnostic `get/set/remove`, supply realistic trusted normal/private sender metadata, and add failing cases for authoritative initial hydration, default-off zero journal/callbacks, live enable of both already-open documents without reinjection or extra observers, exact revision ACKs, genuine existing-scheduler mutation counts, actual candidate formatting timing/counts and safe skip reasons, stale hydration/update generation races, no persisted URL/text/datetime, private sanitization, unchanged custom format/time zone/global/site policy, diagnostic failures while both dates update, and live disable stopping both sinks before deletion with no late-message resurrection or recovery-reset leakage.
- [x] **Step 2: Run** `pnpm exec vitest run tests/integration/presentation-updates.test.ts` **and confirm missing live two-document policy and actual hook behavior fails.**
- [x] **Step 3: Complete only missing connected public runtime wiring/fixture behavior**, preserving exactly one existing listener/observer per document, incremental batches without extra scans, zero disabled payload construction, idle silence, owned-node restoration, revision/generation guards, and Issue 10 fail-closed recovery.
- [x] **Step 4: Rerun the connected-document suite** and require both actual GitHub documents to keep their expected semantic dates in every journal-failure transition.

**Verification**: Observable processing remains correct and local while real opted-in events obey privacy and deletion boundaries.

### [x] Task 7: Validate strict V5 diagnostics in all six emitted browser artifacts

**Files:** `tests/build/chrome-artifact.test.ts`; modify only emitted-runtime fake fixtures and narrowly necessary production boundary wiring.

- [x] **Step 1: Migrate all emitted valid V4 snapshots to exact V5 snapshots and extend fake `storage.local` with isolated diagnostic `remove`**, then write failing emitted-listener tests across Chrome/Edge/Firefox development and release for strict ready Display hydration, default-off zero events, exact one-response debug state/toggle routing, live policy broadcast to existing active top-frame documents with exact ACK, rejected stale policy/hydration, real existing-sink hook events without duplicate listener/observer, background/document sender sanitization, permitted incognito metadata, persisted pair/journal isolation, storage-failure non-interference, disable stop-before-delete/no resurrection, recovery reset cleanup, and inherited exact-host/CSP/display/site/recovery behavior.
- [x] **Step 2: Run** `pnpm exec vitest run tests/build/chrome-artifact.test.ts` **and confirm emitted live diagnostics are absent before final wiring.**
- [x] **Step 3: Complete only missing browser storage/sender/runtime integration** without new permissions, dependencies, code-generation exceptions, remote access, or compatibility aliases.
- [x] **Step 4: Run** `pnpm check`, `pnpm dev`, `pnpm release`, **and** `pnpm lint`; require every observable behavior test and all six emitted development/release bundles to pass.

**Verification**: Every acceptance criterion holds through actual emitted public extension boundaries without browser automation, external-utility assertions, or pre-publication compatibility support.
