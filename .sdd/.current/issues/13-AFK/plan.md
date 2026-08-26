# Implementation Plan: [no-more-ago] Reset all extension state

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/13-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Keep the implementation simple: one immediately effective `Reset all settings` action resets every setting and local diagnostic entry in both healthy and recovery Options, without confirmation or mutation replay.

## Summary

Extend the existing recovery-only Options reset into one visible, accessible, single-click action for both healthy and unavailable settings. Reuse the existing strict reset message, one-shot Options client, background-owned Settings Service, atomic default current/backup write, diagnostic cleanup, registration reconciliation, and open-document activation. Restore globally enabled GitHub processing, only built-in adapter site rows, System date format/time zone and clean editor drafts, debug-off diagnostics, and authoritative popup/Options projections. Keep healthy persistence failures healthy with truthful actionable feedback, preserve unavailable recovery failures and interrupted-mutation non-retry, and verify all six browser artifacts without adding services, permissions, confirmation dialogs, or schema changes.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, React 19.2.8, ECMAScript 2022, Node 24, pnpm 10.34.5.
- **Primary Dependencies**: Existing Mantine, WebExtension APIs, date presentation services, and React state; no new dependency.
- **Storage**: One strict unpublished V5 `settings` snapshot, one `settings.previous` snapshot, and independently deleted `diagnostics`, all in `storage.local`.
- **Testing**: Vitest 4, jsdom, real Settings Service/browser-storage boundaries, connected background/popup/Options transports, two real GitHub document controllers, and six emitted CSP-constrained browser bundles.
- **Target Platform**: Chrome, Edge, and Firefox development and release extension builds.

## Research

### Existing reset already owns settings, diagnostics, and activation

Validated Issues 7, 9, 10, and 11 provide retained exact-host preferences, System/custom display, atomic recovery, and bounded opt-in diagnostics. `SettingsService.resetAll()` already serializes with other settings intents, writes `{ settings: DEFAULT_SETTINGS_SNAPSHOT, "settings.previous": DEFAULT_SETTINGS_SNAPSHOT }` in one operation without requiring a valid previous pair, preserves both documents on failure, and restores V5 revision `0`, `globalEnabled: true`, empty `sitePreferences`, System format/zone, and `debugEnabled: false`. Existing settings tests already cover healthy, dual-corruption, rejected-write, and serialized reset cases; add only missing complete cross-feature evidence rather than introducing another reset service or migration.

`BackgroundApplication.resetAllSettings()` already accepts healthy and unavailable state, preserves a healthy application on rejected persistence, disables/stops prior active document ownership when necessary, calls the existing disabling `DiagnosticJournal.clear()`, performs an enabled activation sweep for all registered/open adapter documents, and refreshes its popup projection. The existing exact `no-more-ago:reset-all-settings` listener and typed success/failure guard already accept a ready failure projection. Current real two-document and emitted tests already verify active custom/debug reset; strengthen coverage for globally disabled, GitHub-disabled, explicit no-adapter rows, default projections, persistence failure, and no stale callbacks without inventing push notifications, listeners, or a second journal API.

### The missing behavior is the normal Options surface

`OptionsApp` currently renders its button only in `state.availability === "unavailable"`; its handler explicitly rejects the ready state, and `tests/options/app.test.tsx` asserts a ready view has no reset. Update that observable test to require exactly one button in **both** states and reuse the existing `SitesClient.resetAllSettings()` single-dispatch transport. Render the one shared reset action and its alert outside availability-specific branching, accept both states, retain the current in-flight guard, and rehydrate authoritative Display/Debug after a successful response without applying ordinary monotonic revision gating to the deliberate reset to revision `0`.

Successful reset must clear obsolete Sites/Display/Diagnostics/reset notices, replace unsaved custom-format/IANA drafts with clean System defaults, remove every retained explicit host row, uncheck Debug logs, disable existing download/clear actions, and keep only adapter-derived `github.com`. A healthy `save-failed` response preserves its ready state, draft, controls, diagnostics, and page output, and must state that current settings remain active; unavailable failures retain the existing truthful processing-disabled text. An ambiguous healthy response is not retried and must not falsely claim processing is disabled; existing unavailable interruption coverage and zero-retry guarantees remain unchanged. Popup consistency is demonstrated through the already refreshed authoritative background projection and a fresh popup read/mount, not a speculative cross-window subscription.

## Entities

### Complete default settings pair

- **Fields**: Exact existing V5 snapshot with `schemaVersion: 5`, `revision: 0`, `globalEnabled: true`, `sitePreferences: {}`, `display: { formatMode: "system", timeZone: { mode: "system" } }`, and `debugEnabled: false`, written identically under `settings` and `settings.previous`.
- **Relationships**: Produced only by `SettingsService.resetAll()`, consumed by existing background activation, popup/Sites/Display/Debug projections, and active GitHub document hydration.
- **Validation**: Exactly one atomic pair write; strict V5 parser; no settings loss on rejected persistence; no passive site history; no pre-public compatibility aliases.
- **States**: healthy customized or dual-corrupt/unavailable → one explicit committed reset → validated defaults; rejected write preserves the prior healthy or failed-closed state.

### Single reset action and outcome

- **Fields**: Existing exact reset request; success `{ ok: true, acceptedRevision: 0, state: ready SitesState }`; failure `{ ok: false, error: "save-failed" | "settings-unavailable", state: SitesState }`; one-shot ambiguous transport result.
- **Relationships**: One Options click → existing guarded client/message → serialized background settings transaction → diagnostic deletion and enabled adapter sweep → fresh Sites/Display/Debug/popup state.
- **Validation**: Exactly one visible action in either availability branch, no confirmation, no automatic retry/reread of an ambiguous mutation, no duplicate click while pending, and truthful availability-specific actionable notices.
- **States**: ready/unavailable → resetting once → ready defaults, unchanged ready save failure, unchanged unavailable save failure, or safely surfaced ambiguous outcome.

## Contracts

- **Persistence**: Reuse `SettingsService.resetAll()` and exactly one `storage.local.set({ settings: defaults, "settings.previous": defaults })`; diagnostics use the existing separately serialized disabling journal clear only after successful settings commit.
- **Runtime**: Reuse the existing exact reset message/listener/typed guards and `BackgroundApplication.resetAllSettings()`; preserve recovery, strict sender rules for diagnostic-only routes, ordinary route behavior, one response, and immediate adapter registration/open-tab activation.
- **Projection synchronization**: Successful reset returns authoritative adapter-derived Sites state and Options explicitly rereads existing Display and Debug projections once; popup's next existing authoritative read observes enabled `github.com`, revision `0`, and active status without adding a push mechanism.
- **Healthy UI**: Exactly one `Reset all settings` button is available while settings are ready or unavailable, triggers immediately with no dialog, guards double clicks, accepts the intentionally lower reset revision, removes stale notices/custom drafts/explicit host rows, and exposes truthful actionable errors in both branches.
- **Failure ordering**: A rejected healthy settings write leaves the current/backup pair, diagnostic journal, enabled debug state, active documents, and ready projections unchanged; a rejected recovery write remains unavailable/failed closed. Interrupted responses cause one mutation dispatch with no retry and no unsupported assertion that a previously healthy runtime is disabled.
- **Scope**: No new schema, backup, message, settings writer, browser permission, remote request, confirmation, popup reset control, background broadcast protocol, implementation-text test, Git/Corepack/browser operation, or additional adapter.

## File Structure

| File | Action | Responsibility / ownership |
| --- | --- | --- |
| `tests/settings/settings-service.test.ts` | Modify | Prove complete V5 defaults/backup, explicit-host removal, atomic healthy/recovery failures, and serialization through the existing public service; runtime owner. |
| `src/background/application.ts` | Modify only if required | Reuse existing successful reset ordering, ready-failure projection, journal cleanup, adapter activation, and popup cache; runtime owner. |
| `tests/background/application.test.ts` | Modify | Prove full healthy/recovery reset, journal cleanup, disabled-policy reactivation, authoritative Sites/Display/Debug/popup, and non-destructive failures; runtime owner. |
| `tests/background/messages.test.ts` | Modify | Verify existing exact reset response guard accepts authoritative ready save-failure and rejects malformed/inherited envelopes; runtime owner. |
| `src/options/app.tsx` | Modify | Expose one shared ready/recovery action, truthful alerts, one-shot handler, clean defaults/drafts/notices, and authoritative rehydration; UI owner. |
| `tests/options/app.test.tsx` | Modify | Replace the old ready-no-reset assertion; cover both visible states, one-click reset, retained-row removal, system selections, debug off, truthful failures, and existing recovery/non-retry; UI owner. |
| `tests/popup/app.test.tsx` | Modify | Observe fresh authoritative popup state after healthy/reset recovery without adding popup listeners or production popup logic; UI owner. |
| `tests/integration/presentation-updates.test.ts` | Modify | Exercise real two-document globally/site-disabled reactivation, custom-to-system output, cleared diagnostics/no stale events, failed resets, and future timestamps; runtime owner. |
| `tests/build/chrome-artifact.test.ts` | Modify | Drive actual emitted Options reset through the real background listener in healthy and recovery modes across all six CSP artifacts; runtime owner. |

## Tasks

### [x] Task 1: Lock down complete atomic defaults and safe background ordering

**Files:** `tests/settings/settings-service.test.ts`, `src/background/application.ts` (only if required), `tests/background/application.test.ts`, `tests/background/messages.test.ts`.

- [x] **Step 1: Add failing public service/application/guard cases** seeded with global-off, disabled `github.com`, retained enabled/disabled no-adapter hosts, custom format, IANA zone, debug-on, populated journal, and healthy/corrupt current+backup; require one atomic default pair, separate journal deletion only after commit, built-in-only Sites, default Display/Debug, active popup projection, registration/open-tab activation, exact ready/unavailable typed failures, and no state/log/document mutation on a rejected healthy write.
- [x] **Step 2: Run** `pnpm exec vitest run tests/settings/settings-service.test.ts tests/background/application.test.ts tests/background/messages.test.ts` **and identify only genuinely missing public behavior.**
- [x] **Step 3: Reuse the existing Settings Service/reset message/journal contracts** and minimally adjust `BackgroundApplication` only when a failing observable case demonstrates missing ordering, projection, registration, or active-document recovery; do not introduce a schema bump, service, message, settings writer, or migration.
- [x] **Step 4: Rerun the three suites** and preserve all existing healthy, corruption, future-schema, persistence-failure, one-shot, diagnostics, and exact-message behavior.

**Verification**: Every documented default is restored atomically, diagnostics disappear only after commit, healthy failures remain healthy, and background projections/registration are immediately consistent.

### [x] Task 2: Make one reset action visible and effective in healthy and recovery Options

**Files:** `src/options/app.tsx`, `tests/options/app.test.tsx`.

- [x] **Step 1: Replace the existing test that expects no ready reset** with tests requiring exactly one accessible `Reset all settings` action in healthy and unavailable views; add one-click/no-confirmation full-state reset with retained explicit rows, custom/IANA selected and unsaved draft, debug enabled/log actions/notices, authoritative revision `0`, default System selectors and draft, only checked built-in `github.com`, debug-off/disabled log actions, cleared stale notices, exactly one Display and Debug reread, and pending double-click suppression.
- [x] **Step 2: Run** `pnpm exec vitest run tests/options/app.test.tsx` **and confirm the current ready-state absence/handler guard fails.**
- [x] **Step 3: Move one existing button and its alert to a shared Options location**, permit both availability states in the current guarded handler, reuse existing `SitesClient.resetAllSettings()` and explicit Display/Debug reads, accept authoritative reset revision `0`, clear obsolete notices/drafts only on success, and retain existing Mantine labels, recovery rendering, and Diagnostics download/clear behavior.
- [x] **Step 4: Rerun Options tests** and prove immediate single-click reset, no confirmation or duplicate mutation, all clean defaults, and unchanged prior recovery behavior.

**Verification**: A user can reset every setting once from either Options state with clean synchronized Sites, System Display, and default-off Diagnostics.

### [x] Task 3: Preserve truthful healthy/recovery failures and fresh popup consistency

**Files:** `src/options/app.tsx`, `tests/options/app.test.tsx`, `tests/popup/app.test.tsx`.

- [x] **Step 1: Add failing observable UI cases** for a healthy typed `save-failed` response preserving ready Sites/custom draft/debug state with an actionable current-settings-remain-active alert, an unavailable typed failure preserving existing processing-disabled wording, healthy and unavailable interrupted/malformed responses dispatching exactly once, no incorrect healthy disabled claim, and a freshly mounted popup consuming the background's post-reset enabled/active revision-`0` projection.
- [x] **Step 2: Run** `pnpm exec vitest run tests/options/app.test.tsx tests/popup/app.test.tsx` **and confirm the current recovery-only alert placement/wording and healthy ambiguous handling fail.**
- [x] **Step 3: Adapt existing reset notice wording and authoritative state handling to the originating availability**, render failures outside the recovery-only branch, preserve the ready projection on an unconfirmed healthy response without replay, and demonstrate popup synchronization using its existing read/mount path; add no popup reset button, subscription, or new transport.
- [x] **Step 4: Rerun both UI suites** and retain all existing strict one-shot, unavailable-state, popup global/site switch, hostname, and recovery tests.

**Verification**: Users receive truthful recovery guidance, healthy settings remain usable after failures, mutations are never replayed, and the existing popup reflects committed defaults on its next authoritative read.

### [x] Task 4: Prove immediate System presentation in both real GitHub documents

**Files:** `tests/integration/presentation-updates.test.ts`.

- [x] **Step 1: Extend the existing connected two-document fixture** with separately global-disabled and `github.com`-disabled restored documents, custom/IANA presentation, populated debug journal, retained no-adapter host rows, and dual corruption; require one reset to atomically restore the default pair, register/reinject both existing top-frame documents, replace old/new output with localized System date and System zone, remove non-adapter rows, disable and delete diagnostics with no stale callbacks/resurrection, and return consistent Sites/Display/Debug/popup projections without duplicate listener/observer.
- [x] **Step 2: Run** `pnpm exec vitest run tests/integration/presentation-updates.test.ts tests/background/application.test.ts` **and confirm any missing policy/reactivation or healthy-failure integration is exposed.**
- [x] **Step 3: Complete only narrow existing fixture/public-boundary setup**, coordinate any demonstrated runtime fix through Task 1 ownership, and verify rejected healthy reset preserves both open outputs, both snapshots, enabled diagnostics, and ready state while rejected recovery remains failed closed.
- [x] **Step 4: Rerun both suites** and assert new post-reset timestamps also use System formatting without new diagnostics or a page reload.

**Verification**: Already-open globally/site-disabled GitHub documents reactivate immediately, both existing/future timestamps use defaults, and diagnostics cannot resurrect after reset.

### [x] Task 5: Validate one real Options click across all six emitted browser artifacts

**Files:** `tests/build/chrome-artifact.test.ts`.

- [x] **Step 1: Extend the existing actual emitted Options/background fixture** for Chrome, Edge, and Firefox development/release: seed every non-default field, default-off/disabled host policy and retained no-adapter rows, saved diagnostics, existing custom-rendered documents, and a matching popup; click the generated healthy Options `Reset all settings` button once, route it through the existing real listener, and assert one atomic default pair write, deleted journal, checked built-in-only site, System format/zone, unchecked debug, disabled log actions, fresh active popup, live/default future output, and no confirmation/new permission. Separately exercise emitted dual-corruption recovery, healthy/recovery rejected writes, one-shot interrupted response, and truthful visible error states.
- [x] **Step 2: Run** `pnpm exec vitest run tests/build/chrome-artifact.test.ts` **and confirm the currently generated healthy Options bundle lacks the required reset action.**
- [x] **Step 3: Extend only real browser-boundary fake storage/transport and connected emitted DOM fixtures**, preserve exact existing reset/diagnostic sender routes, local-only CSP, one listener/observer, prior ZIP privacy/download lifecycle, and the separate healthy/recovery state contracts; avoid source-text assertions and invented runtime abstractions.
- [x] **Step 4: Run** `pnpm check`, `pnpm dev`, `pnpm release`, **and** `pnpm lint`; require the inherited 752-test baseline plus all new observable cases and all six development/release artifacts to pass without browser automation, Git, network, Corepack, or external-utility testing.

**Verification**: Every acceptance criterion is enforced through a real generated extension Options click, public storage/runtime behavior, active document output, and installable cross-browser artifacts.
