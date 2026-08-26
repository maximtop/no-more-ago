# Implementation Plan: [no-more-ago] Download and clear diagnostic logs

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/12-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Provide simple local diagnostics export and clearing, include everything safe that helps debugging, retain enabled logging after manual clearing, and never upload browsing data or add counters.

## Summary

Add English `Download logs` and `Clear logs` actions beside the existing opt-in Options switch. Obtain one strictly validated, JSON-serializable snapshot of the complete sanitized journal and trusted background environment metadata through an owned runtime message, generate one ZIP with the existing `fflate` dependency inside the Options page, and download it through a local blob URL and anchor. Clear the serialized background-owned journal without disabling debug collection or changing settings. Isolate actionable empty, malformed-storage, storage, transport, compression, and download failures from timestamp replacement; preserve strict V5 settings, recovery/reset behavior, privacy, and all six emitted browser artifacts.

## Technical Context

- **Language/Version**: TypeScript 6, React 19, ECMAScript 2022, Node 24, pnpm 10.
- **Primary Dependencies**: Existing Mantine, `fflate`, WebExtension runtime/storage APIs, and browser Blob/object-URL APIs; no new dependency or permission.
- **Storage**: Existing background-owned `storage.local` journal under `diagnostics`; strict settings/current-backup keys remain untouched.
- **Testing**: Vitest, jsdom, public runtime transports, fake browser storage, actual connected document controllers, emitted CSP-constrained bundles, and decompression of real ZIP bytes.
- **Target Platform**: Chrome, Edge, and Firefox development/release extension builds.

## Research

Issue 11 is validated with 28 files/695 passing tests. `DiagnosticJournal` already serializes bounded appends, validates allowlisted events, and invalidates stale generations. Its existing `clear()` deliberately disables collection for recovery reset, so manual clearing must use a separate preserving-enable operation rather than changing that contract. Reads and manual clears must share the same operation tail as appends/disable/reset, report storage failure explicitly, and invalidate older queued writes without preventing newer events. A malformed stored envelope/event must never enter an archive.

`BackgroundApplication` already derives trusted extension version and coarse browser family from the real background manifest/user agent; content cannot supply export metadata. `src/background/messages.ts` and the single listener in `src/background/chrome.ts` enforce exact own-field request/response contracts. Only the two privileged diagnostics routes additionally require an extension-owned Options sender: own `sender.url === chrome.runtime.getURL('options.html')` with exact extension origin/path and no query/hash, and matching own `sender.id === chrome.runtime.id` whenever the runtime ID is available. Reject missing, inherited, content, web, foreign, or spoofed senders before any application/journal access and without invoking the callback; ordinary existing routes are unchanged. Chrome runtime messaging must carry only a validated JSON snapshot, never a `Blob`, `Uint8Array`, object URL, or arbitrary user/page-supplied properties. `SitesClient` is the existing Options transport and must not replay an ambiguous clearing request. Options can synchronously compress a user-requested snapshot with already-installed `fflate` and invoke one injected, testable local blob/anchor downloader; a successful click keeps its object URL valid until exactly one next-task revocation, while click/scheduling failure releases an already-created URL safely. No `downloads` permission, network, account sync, reporting screen, new content observer/listener, timers in content, counters, dialogs, or page-injected controls are needed.

## Entities

### Diagnostics export snapshot

- **Fields**: Exact own-field JSON object containing ordered validated `entries` and trusted `environment` with coarse browser family and available extension version.
- **Relationships**: Produced only by the background journal/application, validated at both runtime response and Options boundaries, and serialized into exactly one JSON member inside one ZIP.
- **Validation**: Existing strict event allowlist, trusted background-only environment allowlist, no inherited/extra fields, no binary runtime payload, and no URL, query/hash, account data, page text, DOM, source datetime, credentials, or unsanitized stack.
- **States**: debug-disabled/unavailable → empty/failure, or enabled → nonempty validated snapshot → local user-initiated ZIP download.

### Journal clear operation

- **Fields**: Separate serialized `clearEntries` result with typed success/storage failure; existing `clear()` and debug settings are unchanged.
- **Relationships**: Runs on the same journal operation tail and generation lifecycle as append, disable, reset, and export reads.
- **Validation**: Removes only `diagnostics`, preserves `debugEnabled: true` and settings revision, invalidates stale writes, and accepts events queued after the manual clear.
- **States**: collecting → manually empty while still collecting → future entries; existing reset/disable still yields absent journal and disabled collection.

## Contracts

- **Journal**: Public serialized read returns only a strictly validated, ordered complete persisted snapshot or typed empty/malformed/storage failure; distinct preserving-enable manual clear reports removal failure without modifying existing disabling `clear()` semantics.
- **Background messages**: Two exact owned requests for snapshot and manual clear; the existing listener authorizes only an own exact `sender.url === chrome.runtime.getURL('options.html')` and, whenever the runtime ID exists, own `sender.id === chrome.runtime.id`. Reject missing, inherited, content/web/foreign, wrong extension-origin/path, query/hash, or spoofed senders before journal access and without a callback; do not change ordinary existing routes. Authorized JSON-only authoritative responses use strict own-field guards, trusted environment metadata, and actionable disabled/unavailable/empty/storage/invalid-journal states.
- **Options transport**: `SitesClient` dispatches each action once, validates every response, and returns actionable failure without retrying an ambiguous mutation or writing browser storage.
- **Archive/download**: Existing `fflate` creates `no-more-ago-diagnostics.zip` with exactly one `diagnostics.json` member containing all ordered sanitized entries and trusted environment; a small injectable browser downloader creates a local `Blob`, invokes exactly one explicit user-initiated anchor click while its object URL remains valid, and revokes that URL exactly once on the next task. If click/download initiation or deferred scheduling fails, safely release the created URL immediately or through deterministic bounded cleanup; distinguish typed compression/download errors without promising an arbitrary timeout duration. No binary crosses `runtime.sendMessage`, and no content timer is introduced.
- **Options UI**: English `Download logs`/`Clear logs` buttons appear with `Debug logs`, activate only while collection is enabled, expose accessible status/error feedback, prevent duplicate in-flight actions, and preserve the existing switch, Sites, Display, and recovery UI.
- **Isolation**: Export/clear errors never alter rendered dates, activation policy, setting revision, settings recovery, private-event sanitization, debug-off overhead, or permission/CSP boundaries.

## Files to Modify/Create

| File | Action | Purpose / ownership |
| --- | --- | --- |
| `src/diagnostics/journal.ts` | Modify | Serialized strict snapshot read and separate preserving-enable clear; journal owner. |
| `tests/diagnostics/journal.test.ts` | Modify | Observable read/clear, privacy, storage errors, and concurrent generation races; journal owner. |
| `src/background/application.ts` | Modify | Trusted snapshot/clear application operations and typed outcomes; runtime owner. |
| `src/background/messages.ts` | Modify | Exact JSON-only export/clear request/response guards; runtime owner. |
| `src/background/chrome.ts` | Modify | Authorize exact extension Options sender before routing either privileged message through the existing listener; runtime owner. |
| `tests/background/application.test.ts` | Modify | Public trusted metadata, errors, preserved enabled state, ordering, and authorized-vs-content privacy; runtime owner. |
| `tests/background/messages.test.ts` | Modify | Strict requests/responses, inherited/extra-field and spoofed-sender rejection, and JSON round trip; runtime owner. |
| `src/diagnostics/archive.ts` | Create | Browser-safe one-file ZIP creation and small injectable local download boundary; UI owner. |
| `tests/diagnostics/archive.test.ts` | Create | Real ZIP decompression, exact content, typed errors, valid-during-click next-task-only revoke, and failure cleanup; UI owner. |
| `src/options/client.ts` | Modify | Guarded one-shot snapshot/clear transport without mutation replay; UI owner. |
| `src/options/app.tsx` | Modify | Accessible English actions, local download, enabled-state preservation, and actionable feedback; UI owner. |
| `tests/options/app.test.tsx` | Modify | Observable click, snapshot, real ZIP bytes, no upload, empty/error, and clear flows; UI owner. |
| `tests/integration/presentation-updates.test.ts` | Modify | Real connected-document export/clear, continued events, privacy, and error isolation; runtime owner. |
| `tests/build/chrome-artifact.test.ts` | Modify | Actual connected authorized Options/background behavior, rejected content senders, and safe deferred blob lifetime across all six CSP artifacts; runtime owner. |

## Tasks

### [x] Task 1: Add ordered strict journal reads and preserving-enable manual clear

**Files:** `src/diagnostics/journal.ts`, `tests/diagnostics/journal.test.ts`.

- [x] **Step 1: Add failing public journal tests** for complete ordered snapshot, empty journal, malformed envelope/event/forbidden or inherited fields, rejected `get`/`remove`, retaining enabled state, no settings writes, pre-clear append invalidation, post-clear append persistence, and races with in-flight append, disable, and existing disabling reset clear.
- [x] **Step 2: Run** `pnpm exec vitest run tests/diagnostics/journal.test.ts` **and confirm the missing read/manual-clear contracts fail.**
- [x] **Step 3: Extend the existing operation tail and generation guard** with one strict typed snapshot read and one distinct preserving-enable manual clear; keep existing bounded append, disabled `clear()`, failure isolation, and diagnostic-key-only storage behavior.
- [x] **Step 4: Rerun the journal suite** and prove no stale write resurrects cleared or disabled data while genuinely newer enabled events persist.

**Verification**: Snapshot reads are complete/safe, manual clear keeps collection enabled, and reset/disable remain unchanged.

### [x] Task 2: Expose trusted JSON-only background snapshot and clear messages

**Files:** `src/background/application.ts`, `src/background/messages.ts`, `src/background/chrome.ts`, `tests/background/application.test.ts`, `tests/background/messages.test.ts`.

- [x] **Step 1: Add failing public application/message tests** for exactly one owned Options snapshot/clear response, exact browser-extension Options URL and matching runtime/sender ID, rejection of missing/inherited/content/web/foreign/wrong-origin/wrong-path/query/hash/spoofed senders without journal access or callback, unchanged ordinary routes, JSON-round-trippable complete events, trusted manifest version/coarse browser family, rejection of inherited/extra/forbidden snapshot fields and spoofed metadata, disabled/unavailable/empty/invalid/storage outcomes, unchanged settings revision/debug state, post-clear recording, one-shot failure, and concurrent clear/disable/reset ordering.
- [x] **Step 2: Run** `pnpm exec vitest run tests/background/application.test.ts tests/background/messages.test.ts` **and confirm export/clear requests are not implemented.**
- [x] **Step 3: Add only two exact request routes and strict typed JSON response guards** to the existing background listener/application; authorize own exact `sender.url === chrome.runtime.getURL('options.html')` and, when the runtime ID exists, matching own `sender.id === chrome.runtime.id` before either privileged route accesses its application/journal. Reject unauthorized senders without invoking the callback, keep ordinary routes unchanged, reuse trusted background environment and journal serialization, preserve the V5 settings document and reset cleanup, and never send binary, create a second listener, or replay clear.
- [x] **Step 4: Rerun both suites** and verify malformed/foreign/content senders have no callback or journal access while exact authorized Options senders work and failures leave timestamp processing unaffected.

**Verification**: The sole background journal owner exposes complete sanitized data and safe preserving-enable clearing over strictly validated plain JSON.

### [x] Task 3: Build a browser-safe one-file ZIP and injectable local downloader

**Files:** `src/diagnostics/archive.ts` (create), `tests/diagnostics/archive.test.ts` (create).

- [x] **Step 1: Add failing public archive tests** that decompress actual bytes with `fflate`, require exactly one `diagnostics.json` file containing every ordered sanitized event plus trusted environment, reject malformed/forbidden snapshots, distinguish injected compression and download failures, and observe exactly one explicit local anchor click with its object URL still valid during/immediately after click, exactly one revocation on the next task, deterministic cleanup when click/scheduling fails, no automatic download, and zero remote transfer.
- [x] **Step 2: Run** `pnpm exec vitest run tests/diagnostics/archive.test.ts` **and confirm the archive boundary is absent.**
- [x] **Step 3: Implement one small browser-safe archive module** using existing `fflate`, `Blob`, object URLs, and an injectable anchor/downloader boundary; keep the URL alive throughout one user-initiated click, schedule exactly one next-task revoke, clean up an allocated URL if clicking or scheduling fails, and preserve distinct typed compression/download failures without adding a content timer or arbitrary promised timeout.
- [x] **Step 4: Rerun the archive suite** and inspect decompressed structured contents, no premature URL revocation, exactly one deferred revoke, and failure cleanup through observable injected browser behavior.

**Verification**: One correct local ZIP is generated without network access, Node-only APIs, additional dependency/permission, or binary runtime messages.

### [x] Task 4: Add English Options download/clear actions with actionable failures

**Files:** `src/options/client.ts`, `src/options/app.tsx`, `tests/options/app.test.tsx`.

- [x] **Step 1: Add failing real-transport Options tests** for visible accessible English `Download logs`/`Clear logs`, disabled actions while logging is off, exactly one click-driven plain snapshot request and one decompressed ZIP, no automatic download, valid-during-click next-task-only URL revocation and cleanup on click failure, empty-state feedback, typed unavailable/storage/malformed/transport/compression/download failures, in-flight duplicate suppression, one-shot non-replayed clear, retained enabled switch/revision, and preserved Sites/Display/custom-format/recovery controls without counters or upload.
- [x] **Step 2: Run** `pnpm exec vitest run tests/options/app.test.tsx tests/diagnostics/archive.test.ts` **and confirm the user actions are absent.**
- [x] **Step 3: Extend the existing guarded `SitesClient` and Options Diagnostics section**, consume only validated background snapshots, invoke the small injected archive/downloader boundary on an explicit click, show concise actionable English feedback, and clear without disabling logging or independently touching storage.
- [x] **Step 4: Rerun Options/archive suites** and verify failed download initiation releases its object URL and surfaces an actionable error, successful URLs remain valid through the click and revoke once on the next task, and failed export/clear never resets settings, stops diagnostics, initiates an upload, or requires page reload.

**Verification**: Users can download or clear safe diagnostics locally while keeping existing extension behavior and understandable failure states.

### [x] Task 5: Prove live connected-document privacy and non-interference

**Files:** `tests/integration/presentation-updates.test.ts`.

- [x] **Step 1: Extend the existing actual two-document fixture** with full enabled snapshot export only from a trusted browser-extension Options URL/ID, attempted read/clear from each GitHub content sender rejected before journal access without callback, trusted normal/private environment and sanitized events, one preserving-enable clear, subsequent real mutation entries from already-active documents, concurrent append/clear/disable no-resurrection, malformed/get/remove failures, and unchanged date rendering, custom formats, listener/observer counts, debug-off silence, and recovery reset.
- [x] **Step 2: Run** `pnpm exec vitest run tests/integration/presentation-updates.test.ts` **and confirm any missing connected observable behavior fails.**
- [x] **Step 3: Complete only narrowly necessary existing fixture/public-boundary wiring**, coordinating runtime-owner changes in Task 2 and preserving exact sender-derived metadata and the established activation/presentation lifecycle.
- [x] **Step 4: Rerun the connected-document suite** and require both GitHub documents to continue replacing dates after every export/clear/error transition.

**Verification**: Actual opted-in documents continue working and producing sanitized future entries after clear; diagnostic failure never interrupts processing.

### [x] Task 6: Verify export/clear in all six emitted CSP-constrained artifacts

**Files:** `tests/build/chrome-artifact.test.ts`.

- [x] **Step 1: Extend existing emitted background/Options fixtures** across Chrome/Edge/Firefox development and release with the real Options transport connected to the same actual background listener and journal; configure each browser's extension URL scheme/runtime ID and prove only its exact Options sender receives one JSON snapshot/clear response, while GitHub content/web/foreign/inherited/query/hash/spoofed senders receive no callback and trigger no journal access. Exercise genuine user-click Options buttons, exactly one local ZIP with decompressed complete sanitized entries/trusted environment, no automatic click, URL valid throughout the click with exactly one next-task revoke and deterministic click-failure cleanup, retained enabled switch and later recording after clear, disabled/empty/storage/compression/download errors, reset cleanup, no new permission/network/counter, and unchanged ordinary routes/strict V5/CSP/timestamp behavior.
- [x] **Step 2: Run** `pnpm exec vitest run tests/build/chrome-artifact.test.ts` **and confirm emitted archive/actions require the completed browser integration.**
- [x] **Step 3: Complete only missing real connected emitted Options/background fixture and browser-boundary wiring**, reuse the single existing listener/local browser APIs, reject untrusted senders before accessing the journal, preserve one-task deferred URL cleanup, and maintain CSP compatibility, settings recovery, content zero-off overhead, and all previous artifact cases.
- [x] **Step 4: Run** `pnpm check`, `pnpm dev`, `pnpm release`, **and** `pnpm lint`; require the full inherited 695-test baseline, new observable tests, and all six development/release artifacts to pass without browser automation, Git, Corepack, network, source-text assertions, or external-utility tests.

**Verification**: Every acceptance criterion is observable in actual browser artifacts with a single private local ZIP, safe enabled-state-preserving clearing, and no extension regressions.
