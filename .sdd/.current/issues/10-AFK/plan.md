# Implementation Plan: [no-more-ago] Recover versioned settings safely

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/10-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Keep persistence and recovery simple; preserve one current and one previous local snapshot, use one serialized background writer, validate complete states, fail closed on corruption, avoid pre-publication compatibility machinery, and do not use browsers, Git, Corepack, network access, source-text assertions, or external-utility tests.

## Summary

Extend the existing strict, unpublished V4 settings implementation with exactly one previous known-good local snapshot. Each accepted change atomically writes the complete candidate and former valid current in one `storage.local.set()` call; concurrent intents remain serialized and failed writes preserve both authoritative snapshots. Initialize fresh empty storage with existing defaults, restore a valid backup when current data alone is corrupt, and keep processing inactive when no valid snapshot exists or an unknown future schema is present. Expose one functional `Reset all settings` recovery action in unavailable Options, routed through the sole Settings Service writer and existing background activation pipeline. Preserve all prior global/site/display behavior, six browser artifacts, and strict V4 validation; leave always-visible full reset and diagnostics cleanup to Issue 13.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, React 19.2.8/TSX, ECMAScript 2022, Node `>=24 <25`, direct pnpm 10.34.5.
- **Primary Dependencies**: Existing browser WebExtension storage/runtime APIs, Mantine 9.5.2, date-fns 4.4.0, Rspack 2.1.10; no new dependencies.
- **Storage**: Browser-local `settings` current document and exactly one `settings.previous` known-good document; no sync, third snapshot, history, IndexedDB, or diagnostic coupling.
- **Testing**: Vitest 4.1.11, jsdom, React `act`, fake WebExtension storage/transports, connected GitHub document integration, and emitted extension bundle smoke tests.
- **Target Platform**: Manifest V3 Chrome, Edge, and Firefox development/release artifacts; background service, extension Options, and exact-host `github.com` runtime.

## Research

### Existing strict snapshot, serialized writer, and activation seams

Issues 6–9 are validated. `src/settings/snapshot.ts` accepts exactly five own V4 fields and validates exact hostnames, localized System/custom presentation, safe date patterns, and System/UTC/IANA zones. `src/settings/settings-service.ts` already serializes intent-level writes using `mutationTail`, reloads the latest state inside each transaction, and returns typed validation/persistence failures, but currently reads/writes only `settings`. Preserve schema V4 and all existing field/error contracts: do not add a debug flag, schema alias, released baseline, backward-compatible reader, or account sync.

Use `storage.get(["settings", "settings.previous"])`. A valid current always wins over an invalid backup. Both keys absent mean a genuinely fresh install and existing default behavior. Current absent but backup present is corruption, not a fresh install: restore it only when valid. Current invalid plus valid previous restores previous with one `storage.set({ settings: previous, "settings.previous": previous })`; if that write fails, remain unavailable and preserve stored data. An own current `schemaVersion` numerically greater than V4 is an unknown future schema: fail closed without replacing or restoring it, even when the backup is otherwise valid. Unsupported older pre-public schemas follow the normal corruption/recovery policy and may require explicit reset; no real migration runs before a public baseline is declared.

For an accepted change, validate the entire generated candidate with the existing strict parser before the single atomic `storage.set({ settings: candidate, "settings.previous": current })`. Failed storage operations must not update memory, revise runtime policy, or issue activation reconciliation. Existing unchanged and typed-invalid paths must make zero writes. Concurrent global/site/display intents must merge against the latest committed snapshot without dropping fields.

### Recovery-only action through existing background and Options boundaries

`BackgroundApplication.initialize()` already performs fail-closed registration/document cleanup and exposes unavailable popup, Sites, and Display projections. `src/background/chrome.ts` routes strict message envelopes; `src/options/client.ts` validates typed responses; `OptionsApp` already displays actionable unavailable-state text. Add one exact-key `no-more-ago:reset-all-settings` request and a typed reset response carrying an authoritative Sites state. The recovery action is available only when Options is unavailable; it writes a validated default current and backup in a single storage operation, makes the existing application ready, reconciles GitHub registration/open tabs, and reloads both Sites and Display projections. A failed reset leaves both persisted documents untouched, processing inactive, and displays an actionable error. The popup continues to reach recovery via its existing Settings link. Do not add confirmation, a normal-state reset button, diagnostic deletion, or extra page UI in this issue.

## Entities

### Settings snapshot pair

- **Fields**:
  - `settings`: `SettingsSnapshotV4 | unknown | absent` — authoritative current complete policy and presentation document.
  - `settings.previous`: `SettingsSnapshotV4 | unknown | absent` — exactly one previous valid complete document.
- **Relationships**: Written only by `SettingsService`; consumed by `BackgroundApplication`, existing activation, popup, Sites, Display, and GitHub document runtimes.
- **Validation**: Existing strict V4 own-field parser; safe revision, canonical exact hostnames, custom-format validation, and time-zone shape; unknown future current schema cannot be overwritten automatically.
- **States**: both absent → default; valid current → ready; invalid/absent current + valid previous → atomically recovered; unknown future current or no valid pair → failed closed; explicit reset → valid default pair.

### Recovery reset request and result

- **Fields**:
  - Request `type`: exact own property `"no-more-ago:reset-all-settings"` with no extras.
  - Success `ok`: `true`; `acceptedRevision`: safe nonnegative integer; `state`: authoritative ready `SitesState`.
  - Failure `ok`: `false`; `error`: `"save-failed" | "settings-unavailable"`; `state`: authoritative unavailable `SitesState`.
- **Relationships**: Options transport → background message router → serialized `BackgroundApplication` → sole `SettingsService` writer → activation coordinator and refreshed Sites/Display projections.
- **Validation**: Exact own-field message/response guards, no retry that repeats a possibly committed reset, no activation before a durable successful write.
- **States**: unavailable → requested → committed and ready, or rejected and still unavailable.

## Contracts

No HTTP/API endpoint or external contract file. Internal observable contracts:

```ts
export const SETTINGS_PREVIOUS_STORAGE_KEY = "settings.previous" as const;

type SettingsLoadResult =
  | { readonly ok: true; readonly snapshot: SettingsSnapshotV4;
      readonly source: "default" | "stored" | "recovered" }
  | { readonly ok: false; readonly error: "load-failed" | "invalid-settings" };

class SettingsService {
  load(): Promise<SettingsLoadResult>;
  resetAll(): Promise<SettingsWriteResult>;
}

export const RESET_ALL_SETTINGS_MESSAGE =
  "no-more-ago:reset-all-settings" as const;

type ResetAllSettingsResponse =
  | { readonly ok: true; readonly acceptedRevision: number;
      readonly state: SitesState }
  | { readonly ok: false;
      readonly error: "save-failed" | "settings-unavailable";
      readonly state: SitesState };
```

Successful accepted mutations call `set({ settings: candidate, "settings.previous": current })` exactly once. Successful backup recovery calls `set({ settings: previous, "settings.previous": previous })` exactly once. Explicit recovery reset calls `set({ settings: defaults, "settings.previous": defaults })` exactly once. Unknown future data and invalid candidates cause zero writes.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/settings/snapshot.ts` | Modify | Export the previous-storage key and allow an explicit recovered load source while retaining strict V4 validation. |
| `src/settings/settings-service.ts` | Modify | Read and validate both local snapshots, serialize atomic replacement, restore valid backup, reject unknown future schemas, and implement explicit reset. |
| `tests/settings/snapshot.test.ts` | Modify | Exercise strict schema/future-version behavior through public parser contracts. |
| `tests/settings/settings-service.test.ts` | Modify | Migrate the existing service fake to read/store both snapshot keys atomically and preserve both on rejected writes; observe candidate validation, concurrency, failures, corruption recovery, pre-public schema rejection, future-schema protection, and reset. |
| `src/background/application.ts` | Modify | Keep recovery failed closed and expose a serialized reset operation that reconciles only after successful persistence. |
| `src/background/messages.ts` | Modify | Define the exact recovery-reset message and typed response guard. |
| `src/background/chrome.ts` | Modify | Route exactly one reset request/response through the existing background application. |
| `tests/background/application.test.ts` | Modify | Migrate the existing background fake to two-key atomic read/write/rejection semantics, update its exact former single-key write assertion, and verify backup recovery, failed-closed startup, no activation on failed writes, concurrent intents, and successful/failed reset reconciliation. |
| `tests/background/messages.test.ts` | Modify | Verify exact reset message and success/failure response contracts. |
| `src/options/client.ts` | Modify | Send the reset request and validate its authoritative typed response without duplicate mutation attempts. |
| `src/options/app.tsx` | Modify | Show a functional recovery-only `Reset all settings` action, loading/error feedback, and refreshed ready projections. |
| `tests/options/app.test.tsx` | Modify | Exercise the real Options transport/client boundary, single dispatch, malformed/ambiguous response, visible recovery action, one click without confirmation, successful rehydration, failed reset, and no normal-state reset. |
| `tests/integration/presentation-updates.test.ts` | Modify | Migrate the genuine two-document fixture to atomic two-key reads/writes with failed-write preservation; prove prior GitHub output/policy survives failed mutations and successful recovery/reset restores active document behavior. |
| `tests/build/chrome-artifact.test.ts` | Modify | Migrate emitted-background fake storage to atomic two-key read/write/rejection semantics; exercise the actual public runtime listener, guarded reset dispatch, recovered/failed-closed/reset behavior, and existing CSP/artifact checks across all six Chrome/Edge/Firefox bundles. |

## Tasks

### [x] Task 1: Define strict pair and pre-public schema contracts

**Files:** Modify `src/settings/snapshot.ts`; test `tests/settings/snapshot.test.ts`, `tests/settings/settings-service.test.ts`.

- [x] **Step 1: Write failing public contract tests** for the exported `settings.previous` key, unchanged valid V4 parsing, rejection of V1/V2/V3/future V5 and extra/inherited fields, and `source: "recovered"` without adding schema aliases.
- [x] **Step 2: Verify the new tests fail** with `pnpm test -- tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts`; expect the previous-key export/recovered source to be unavailable.
- [x] **Step 3: Implement only the previous-key constant and recovered-source type**, leaving the five-field V4 schema, default snapshot, custom patterns, hostnames, and time-zone parsing unchanged.
- [x] **Step 4: Verify focused contract tests pass** with `pnpm test -- tests/settings/snapshot.test.ts`.

**Verification**: Strict V4 remains the only accepted schema; the new storage key and recovered source form the complete migration seam with no released baseline or compatibility shim.

### [x] Task 2: Implement atomic serialized current/previous replacement

**Files:** Modify `src/settings/settings-service.ts`; test `tests/settings/settings-service.test.ts`.

- [x] **Step 1: Own and migrate only the existing `tests/settings/settings-service.test.ts` storage fixture** so `get` returns both requested keys, successful `set` commits both keys together, and rejected `set` changes neither; write failing observable tests for one pair read, concurrent global/site/custom-display intents preserving every accepted field and revision, one atomic pair `set` per accepted change, zero writes for unchanged/invalid inputs, candidate whole-state validation, and rejected writes preserving current, backup, and active snapshot.
- [x] **Step 2: Verify failures** with `pnpm test -- tests/settings/settings-service.test.ts`; expect writes to contain only the current key before implementation.
- [x] **Step 3: Extend the existing mutation queue** to reload both keys, parse the entire generated candidate, and call `storage.set({ [SETTINGS_STORAGE_KEY]: candidate, [SETTINGS_PREVIOUS_STORAGE_KEY]: current })` exactly once before publishing the candidate in memory; retain existing typed validation failures and unchanged no-op behavior.
- [x] **Step 4: Verify focused storage tests pass** with `pnpm test -- tests/settings/settings-service.test.ts`.

**Verification**: Popup/Options intent updates are serialized against the latest successful revision; persistence failures do not change either authoritative document or active policy.

### [x] Task 3: Restore one valid backup and explicitly reset unavailable state

**Files:** Modify `src/settings/settings-service.ts`; test `tests/settings/settings-service.test.ts`.

- [x] **Step 1: Write failing load/reset tests** covering both keys absent, valid current with absent/invalid backup, invalid/absent current plus valid previous, failed recovery write, invalid pair, unsupported pre-public schema with/without a valid backup, future current with a valid older backup, storage read failure, successful reset from corruption, and failed reset preserving both stored values.
- [x] **Step 2: Verify failures** with `pnpm test -- tests/settings/settings-service.test.ts`; expect valid backups to be ignored and explicit reset to be missing.
- [x] **Step 3: Parse current and backup as complete snapshots**, restore only a valid eligible backup using one atomic pair write and `source: "recovered"`, reject future current schemas without writing, use defaults only when both keys are genuinely absent, and serialize `resetAll()` as one validated default-pair write independent of corrupt existing documents.
- [x] **Step 4: Verify recovery tests pass** with `pnpm test -- tests/settings/settings-service.test.ts`.

**Verification**: Single corruption recovers the former policy; dual corruption/future schema never silently enables defaults; reset alone replaces unrecoverable data, and failed writes leave storage and processing unchanged.

### [x] Task 4: Route fail-closed recovery reset through the background

**Files:** Modify `src/background/application.ts`, `src/background/messages.ts`, `src/background/chrome.ts`; test `tests/background/application.test.ts`, `tests/background/messages.test.ts`.

- [x] **Step 1: Own and migrate only the `tests/background/application.test.ts` storage fixture** to read both keys, commit both atomically, and preserve both on rejection; replace its exact old single-key write assertion with the exact current/previous pair, then write failing behavior tests for backup-driven enabled/disabled startup, unknown-future/dual-corrupt cleanup and unavailable projections, atomic-write failure retaining prior activation, exact own-field reset messages/responses, successful reset registration/open-tab injection, and failed reset retaining failed-closed state. Task 6 owns actual emitted-runtime listener dispatch.
- [x] **Step 2: Verify failures** with `pnpm test -- tests/background/application.test.ts tests/background/messages.test.ts`; expect the reset envelope/operation to be absent.
- [x] **Step 3: Add the exact reset message, strict typed response guard, one existing-router branch, and serialized `BackgroundApplication.resetAllSettings()`** that calls `SettingsService.resetAll()`, adopts defaults/reconciles only after a successful write, returns the authoritative Sites state, and keeps failure state inactive on rejection.
- [x] **Step 4: Verify all background tests pass** with `pnpm test -- tests/background/application.test.ts tests/background/messages.test.ts`.

**Verification**: Corruption never enables an adapter; recovered policies and explicit durable reset activate or restore existing GitHub documents through the established coordinator, with one response per request.

### [x] Task 5: Expose one functional recovery action in unavailable Options

**Files:** Modify `src/options/client.ts`, `src/options/app.tsx`; test `tests/options/app.test.tsx`.

- [x] **Step 1: Extend the existing `tests/options/app.test.tsx` suite through a real `SitesClient` with a fake public transport** to write failing UI/transport tests for unavailable Sites/Display showing `Reset all settings`, one click sending exactly one guarded request without confirmation, success reloading ready Sites and system Display, disabled/loading feedback, save failure remaining unavailable with actionable text, malformed/interrupted response causing no repeated reset, and no button in normal ready Options.
- [x] **Step 2: Verify failures** with `pnpm test -- tests/options/app.test.tsx`; expect the reset transport method and visible recovery action to be absent.
- [x] **Step 3: Add a typed single-dispatch reset method to `SitesClient` and a recovery-only button in `OptionsApp`**, consume the authoritative response, reload the existing Sites/Display projections on success, and present a clear retryable error on failure without confirmation or page-injected UI.
- [x] **Step 4: Verify UI and real-client transport tests pass** with `pnpm test -- tests/options/app.test.tsx`.

**Verification**: A user can recover from both-snapshot corruption in one click; normal-state global reset, debug controls, and diagnostic cleanup remain outside this slice.

### [x] Task 6: Verify actual GitHub recovery and six emitted extension artifacts

**Files:** Modify `tests/integration/presentation-updates.test.ts`, `tests/build/chrome-artifact.test.ts`; own migration of exactly these two existing public fake-storage fixtures.

- [x] **Step 1: Migrate only the genuine connected-document and emitted-background fixtures in `tests/integration/presentation-updates.test.ts` and `tests/build/chrome-artifact.test.ts`** so each reads both requested keys, commits current/previous together, and preserves both documents on rejected atomic writes; then write failing tests proving a saved disabled/custom policy survives current corruption through backup restoration; failed persistence leaves two owned GitHub documents unchanged; dual corruption removes/avoids ownership; one reset re-enables exact `github.com` registration, processes existing documents, and restores System format/time zone; future schema remains untouched; all six generated bundles dispatch exactly one guarded recovery request through their actual public runtime listener without weakening CSP.
- [x] **Step 2: Verify focused integration failures** with `pnpm test -- tests/integration/presentation-updates.test.ts tests/build/chrome-artifact.test.ts`; expect recovery/reset behavior to fail before completed wiring.
- [x] **Step 3: Complete only missing boundary wiring and the two task-owned realistic atomic fixtures**, retaining inherited exact-host policy, document ownership/restoration, localized/custom formatting, popup states, existing manifest permissions, artifact packaging, and watch behavior; Task 2 exclusively owns the service fixture and Task 4 exclusively owns the background-application fixture.
- [x] **Step 4: Run full quality and build gates** with `pnpm check`, `pnpm dev`, `pnpm release`, and `pnpm lint`; require every existing/new behavior test and all Chrome/Edge/Firefox development/release artifacts to pass.

**Verification**: Acceptance criteria 1–6 hold through public service, runtime, user-interface, actual GitHub-document, and emitted-bundle boundaries without browser automation, network access, external-utility assertions, or additional dependencies.
