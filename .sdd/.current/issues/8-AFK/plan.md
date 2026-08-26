# Implementation Plan: [no-more-ago] Configure system format and time zone

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/8-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Preserve browser language and clock preferences by default, use date-fns, retain a simple generic adapter architecture, support System/UTC/IANA zones, immediately update existing GitHub tabs, and use direct pnpm without Corepack, Git, browser automation, network access, or implementation-source-text tests. Address review attempt 1 by hydrating once per fresh activation generation, accepting safe supported single-component IANA aliases, and requiring exact revision-matched document acknowledgements.

## Summary

Extend the existing strict, background-owned settings snapshot with one system-format presentation preference and a System, UTC, or IANA time-zone selection. Keep locale-sensitive default formatting on `date-fns` `intlFormat`, passing `dateStyle: "medium"`, `timeStyle: "short"`, the current browser language list, and the selected `timeZone` only when the selection is explicit. A browser-language Unicode hour-cycle preference remains effective, dates include year and minutes without seconds, and normal `Intl` conversion handles daylight-saving changes.

At `document_start`, install the content-message listener immediately, request the authoritative presentation projection exactly once for each fresh activation generation, and wait for both presentation readiness and document readiness before taking DOM ownership. Same-document disable followed by re-enable starts a fresh generation and obtains settings saved while processing was off; obsolete callbacks cannot resurrect a stopped generation. Resolve browser locales and the system time zone again for each newly processed candidate; do not poll or retain a stale system formatter. A committed presentation change sends a revisioned update directly to every active exact-host adapter tab in frame zero and succeeds per tab only after its strict acknowledgement matches that exact revision. Its existing controller reformats only its tracked, proven extension-owned sources; registration, script injection, page UI, and unrelated documents remain untouched.

Add an English `Display` section to the existing Options page with `Date format: System`, a `Time zone` selector, an IANA identifier field when relevant, `Save`, and actionable inline errors. Draft edits never change saved output. Invalid proposed zones are rejected before persistence, while a structurally valid previously saved zone that becomes unavailable falls back to the current system zone and remains visibly marked for correction. Custom formats, preview, diagnostics, backup/recovery, reset, reporting, and browser smoke remain assigned to later issues.

## Technical Context

- **Language/Version**: TypeScript 6.0.3/TSX and ECMAScript 2022 on Node `>=24 <25`; direct pnpm 10.34.5.
- **Primary Dependencies**: Existing `date-fns` 4.4.0, browser `Intl.DateTimeFormat`, React 19.2.8, Mantine 9.5.2, Rspack 2.1.10, and WebExtension runtime/tabs APIs; no new package. Existing `@date-fns/tz` remains available for the later custom-token implementation but is unnecessary for correct `intlFormat` time-zone conversion.
- **Storage**: The sole existing `chrome.storage.local["settings"]` document, upgraded to unpublished strict schema V3; no synchronization, backup document, visited-host history, or diagnostic storage.
- **Testing**: Vitest 4.1.11, jsdom, React `act`, injected storage/browser APIs, deferred promises, observable DOM ownership, emitted extension bundles, disabled-code-generation VM contexts, exact ZIP verification, and selected-target watch behavior.
- **Target Platform**: Manifest V3 Chrome, Firefox, and Edge development/release artifacts; all preference controls remain extension-local, and only the exact top-level `github.com` adapter runs in production.

## Research

### Validated predecessors and current extension seams

Issues `1-AFK` through `7-AFK` are `Validated`. Their maintained public boundaries already provide trusted zoned timestamp resolution, date-fns-backed system formatting, strict ownership and exact restoration, one event-driven mutation observer, browser-specific artifacts, serialized background settings transactions, exact-host adapter policy, truthful popup responses, and a local Options `Sites` section.

`src/core/format-default-date.ts` already uses `date-fns` `intlFormat` with `{ dateStyle: "medium", timeStyle: "short" }`; extending its public behavior is preferable to replacing it with a parallel formatter. `src/core/process-document.ts` receives a fixed `locales` array today, so a live locale provider must be resolved inside each candidate formatting pass. `src/core/render-exact-time.ts` already owns a document-local `WeakMap<Document, Map<Element, OwnedPairRecord>>`; exposing a narrow, proven-owned source enumeration avoids either another registry or full-document discovery when the user explicitly saves settings.

`src/content/runtime.ts` immediately installs a single document listener and defers initial work until `DOMContentLoaded` when needed, but it currently starts without reading persisted settings. `src/background/application.ts` already serializes commit, effective-policy reconciliation, latest-state response barriers, and popup/Sites projections. `src/options/client.ts` and `src/options/app.tsx` already own the sole extension-local Options transport and site list. Extend these seams rather than adding an event bus, subscription service, second content script, storage reads inside content/Options, or a duplicate options application.

No project-local `AGENTS.md`, `DEVELOPMENT.md`, or `README.md` exists; the supplied workspace instructions, PRD, approved predecessor plans, and validated observable contracts govern this slice.

### Strict unpublished V3 and separately validated zone availability

Replace unpublished V2 with exactly this five-field V3 document:

```ts
type TimeZoneSelection =
  | { readonly mode: "system" }
  | { readonly mode: "utc" }
  | { readonly mode: "iana"; readonly identifier: string };

interface DisplaySettings {
  readonly formatMode: "system";
  readonly timeZone: TimeZoneSelection;
}

interface SettingsSnapshotV3 {
  readonly schemaVersion: 3;
  readonly revision: number;
  readonly globalEnabled: boolean;
  readonly sitePreferences: Readonly<Record<string, boolean>>;
  readonly display: DisplaySettings;
}
```

The missing-document default is revision zero, globally enabled, empty explicit sites, and `{ formatMode: "system", timeZone: { mode: "system" } }`; reading this default never writes. Preserve exact canonical own-hostname validation, frozen snapshots, safe nonnegative revisions, publish-after-write semantics, and all existing policy fields. Reject extra or missing fields, invalid discriminants, unexpected identifiers, non-string/empty/whitespace identifiers, and unsafe malformed identifiers; `system` and `utc` have no identifier. Accept both safe single-component IANA aliases such as `CET`, `Japan`, and `Iceland` and safe slash-separated names such as `America/New_York` and `Etc/GMT+5`. An identifier starts with an ASCII letter, subsequent nonempty components contain only ASCII letters/digits/underscore/dot/plus/hyphen, and surrounding whitespace, controls, backslashes, empty slash components, leading/trailing slashes, and `.`/`..` path components are rejected; do not require a slash. Current `Intl` support, not the component count, decides whether a proposed safe identifier is an available zone. Do not migrate old unpublished V1/V2 documents or silently replace corrupt storage with defaults.

Distinguish **structural persisted validity** from **current runtime support**. Snapshot loading must accept a structurally valid previously saved IANA identifier even if the present browser can no longer resolve it; otherwise the required system fallback would incorrectly become a failed-closed settings error. A new Options/Settings Service write separately calls `new Intl.DateTimeFormat(undefined, { timeZone: identifier }).resolvedOptions()` before persistence and rejects unsupported identifiers with typed `invalid-time-zone`. The formatter and Options state check availability again when they operate: unsupported saved zones return system-zone output plus a typed correction error without rewriting settings. Inject narrow availability/formatting dependencies in behavioral tests to simulate support disappearing after a successful save.

Existing V2 seed objects in settings, application, lifecycle, emitted-artifact, and concurrent-control tests must be updated to complete V3 seeds; retain explicit obsolete-V2 rejection coverage. V3 is intentionally not the promised public migration baseline: backup recovery, public-schema migrations, recovery UI, and reset belong to `10-AFK`/`13-AFK`.

### Localized system date, clock preference, and zone correctness

Keep `formatDefaultDate(instant, locales)` behavior available for validated callers and extend it, or add a closely related exported presentation formatter, with the saved `TimeZoneSelection`. Use the existing date-fns `intlFormat` with `dateStyle: "medium"`, `timeStyle: "short"`, browser locales in preference order, and `timeZone: "UTC"` or `timeZone: identifier` for explicit selections. Do not set `hour12` or hard-code an English layout: `en-US`, `en-GB`, locale fallbacks, and `en-US-u-hc-h23`/`en-GB-u-hc-h12` must retain their observable browser `Intl` conventions. Medium date supplies the year; short time supplies minutes without seconds.

Do not preconvert the instant with `TZDate` before also passing an Intl `timeZone`, because that would risk double conversion; Intl already applies IANA daylight-saving rules. Assert the two instants on opposite sides of the `America/New_York` spring-forward boundary against independently constructed `Intl.DateTimeFormat` results. Handle empty/unsupported locale lists through runtime browser defaults; never display a guessed date. Resolve `navigator.languages` anew inside each actual initial, mutation, or explicit-refresh formatting pass. In `system` mode omit `timeZone`, allowing each new Intl invocation to resolve the current system zone. Existing output need not change until save, re-enable, or reload; create no timer, observer-per-date, periodic task, or locale/zone poll.

### Initial presentation hydration and stale-update races

Define a small background `get-display-state` read model and `set-display-settings` intent. Background responses are authoritative, revisioned, and unavailable on invalid storage. `src/content/main.ts` supplies an asynchronous `chrome.runtime.sendMessage({ type: GET_DISPLAY_STATE_MESSAGE })` loader to `installContentRuntime` and a live `() => navigator.languages` provider. A production content document never formats with assumed defaults while a persisted non-default selection is unresolved.

The content runtime must first install its existing status/teardown listener and accept a strict new `update-presentation` message, then issue exactly one authoritative read **per fresh activation generation**, not once for the lifetime of the retained document slot. Duplicate activation while the current generation is waiting or active reuses its one request, controller, and listener. Teardown invalidates that generation and its pending callbacks; re-enabling the same existing document creates a new activation generation, clears the prior hydration gate, and performs exactly one fresh read of the latest committed display settings. Thus disable -> save another zone while disabled (no fanout) -> re-enable formats the original same-document sources with the newer zone rather than reusing stale presentation. Both successful current-generation hydration and document readiness are required for `controller.start()`. A ready document starts in that generation's response microtask; a loading document remains safely waiting until both conditions hold. Existing direct public-runtime tests may inject a synchronously known state, but production `main.ts` must always use the authoritative background read for each fresh generation.

Track the latest accepted safe revision and existing generation token. If a committed update arrives before that generation's initial read resolves, accept the newer revision and do not later overwrite it with an older read. A strictly higher revision updates future candidates and invokes `reformatOwned()` only when the generation is active. A duplicate **same-revision** update returns the exact successful acknowledgement again without rerunning formatting; an older revision, malformed request, or stopped/failed generation returns no successful acknowledgement and never changes presentation. Teardown during an unresolved read invalidates the pending result; a later reactivation starts its own independent read, and an old-generation completion cannot satisfy or overwrite the new generation. Missing/malformed/rejected initial state leaves the document safely unmodified and reports failed/inactive status rather than inventing enabled defaults. Avoid top-level `await`: document script evaluation must finish while each request is in flight, so existing coordinator injection and queued MV3 initialization cannot deadlock.

### Atomic commit and exact-host open-tab refresh

`SettingsService.setDisplaySettings(display)` validates the exact draft and currently available IANA zone, then performs the existing serialized latest-snapshot mutation. A successful change preserves global/site fields and increments the single revision; repeated equivalent settings do not write. Typed validation/persistence failures preserve the prior snapshot and perform no tab work.

`BackgroundApplication.setDisplaySettings(display)` reserves the same whole-transaction queue as popup global and site writes. After persistence it advances the retained activation-result revision and refreshes cached popup state without running registration/reconciliation because display alone never changes effective activation policy. If the latest snapshot is globally enabled, enumerate only adapter definitions with enabled exact hostnames, query their declared match patterns, filter tabs again through each adapter's exact `matches(url)`, and send exactly one `{ type: UPDATE_PRESENTATION_MESSAGE, revision, display }` to each matching top-frame tab with `{ frameId: 0 }`. A resolved `tabs.sendMessage` is not proof of application: validate that its response is exactly `{ type: "no-more-ago:presentation-updated", revision: committedRevision }`, including exact own keys and a safe nonnegative revision. Missing/undefined acknowledgement, extra/malformed keys, wrong type, stale/future revision, a stopped listener, rejected send, or refused update each becomes `{ hostname, tabId, reason: "tab-update" }`; a matching-tab query exception becomes `{ hostname, reason: "matching-tabs-query" }`. Deduplicate a tab/adapter pair and do not contact `gist.github.com`, disabled adapter sites, non-adapter tabs, restricted frames, or globally disabled documents. Continue after individual failures and return typed refresh-failure metadata with the successful committed response; never describe a committed save as rolled back.

Only release the transaction after all reachable selected tabs have acknowledged or failed. A later response read barrier returns the latest reserved state, while `acceptedRevision` identifies the caller's own commit. Mixed global/site/display writes preserve every accepted field and cannot send an older zone after a newer committed transaction. Global-off or site-disabled display saves persist for the next activation without querying matching tabs, injecting scripts, registering scripts, or adding DOM observers. A newer content read cannot regress to an older update. Preserve existing unrelated-adapter activation failures and failure-precedence behavior; presentation delivery errors are shown as a display-save warning, not falsely converted into activation success or a popup site-status rewrite.

### User-visible scope and compatibility boundaries

Extend the existing Options app rather than creating another page. Show an English `Display` heading, a `Date format` field fixed to `System`, `Time zone` choices `System`, `UTC`, and `IANA`, an identifier field only for IANA, and a user-invoked `Save`. Draft changes remain local until the accepted response. Show actionable English invalid-zone, unavailable-saved-zone, persistence, interrupted-response, and partial-tab-refresh messages while retaining the committed state and existing `Sites` controls. A successful identical save produces no storage write or tab refresh. UI labels never mention `date-fns`, never expose `Custom format`, and never offer a combined exact-plus-relative mode.

All new code remains extension-local and inside existing background/content/options artifacts. Preserve no-inline-executable CSP, browser-correct manifests, `<all_urls>` host permission, only existing `scripting`/`storage` API permissions, exact GitHub registration, each unpacked/ZIP pair, and selected-target Options/background/content watch inputs. No user navigation, browser launch, network access, settings sync, private page data persistence, reporting, diagnostics, backup, reset, custom format, live preview, synthetic production adapter, browser automation, Git operation, Corepack, external-utility test, or source-text test belongs to this issue.

## Entities

### Settings Snapshot V3

- **Fields**: Exact `schemaVersion: 3`, safe nonnegative `revision`, `globalEnabled`, canonical exact-own-host `sitePreferences`, and `display: DisplaySettings`.
- **Relationships**: Sole background-owned local settings document consumed by activation policy, popup/Sites state, Options display controls, and content presentation hydration.
- **Validation**: Exact five top-level fields; strict display and discriminated zone shapes; preserved host-map safety; structural saved IANA validity distinct from current runtime availability; no old unpublished schema migration.
- **States**: Missing/in-memory defaults; committed monotonically revisioned valid snapshot; unchanged equal draft; failed load/write with previous runtime behavior retained.

### Time Zone Selection

- **Fields**: `{ mode: "system" }`, `{ mode: "utc" }`, or `{ mode: "iana", identifier: string }`.
- **Relationships**: Embedded exclusively in `DisplaySettings`; used by background save validation, current Options correction state, and each content-side formatter invocation.
- **Validation**: Exact discriminated keys; safe nonempty trimmed IANA identifier with either one component (`CET`, `Japan`, `Iceland`) or multiple nonempty slash-separated components (`America/New_York`, `Etc/GMT+5`), using only safe ASCII letters/digits/underscore/dot/plus/hyphen and no traversal/control/whitespace patterns; a proposed identifier must additionally be supported by current `Intl.DateTimeFormat`, while a historical saved identifier need not still be supported.
- **States**: Default system; explicit UTC; supported explicit IANA; historically saved but currently unavailable IANA with ephemeral system fallback/correction error.

### Display Settings and Projection

- **Fields**: `formatMode: "system"`; selected `timeZone`; projected safe revision and optional typed `unavailable-time-zone` correction failure.
- **Relationships**: Stored inside V3; returned through a read-only background message and used by Options and content runtimes without giving either surface direct storage ownership.
- **Validation**: No custom format, locale persistence, browser page URL, source datetime, output text, or account synchronization; unavailable settings remain explicitly unavailable.
- **States**: Unavailable; ready/current; draft-only local Options value; accepted committed projection; correction-required saved projection.

### Revisioned Document Presentation

- **Fields**: Last accepted safe revision, authoritative `DisplaySettings`, live locale resolver, existing document generation/phase, and exactly one pending authoritative read per fresh activation generation.
- **Relationships**: One instance on the existing document runtime; consumed by the existing controller, owned-source records, and content listener.
- **Validation**: Listener installed before background hydration; no rendering before trustworthy current-generation saved state; exactly one read per fresh activation and no extra read for duplicate active activation; nondecreasing revisions with idempotent same-revision acknowledgements; exact top-frame update; ownership-verified output only; old-generation callbacks cannot restart or overwrite a re-enabled document.
- **States**: Listener installed/waiting for document and settings; active hydrated; active refreshed; unavailable/failed without DOM mutation; stopped/restored with invalidated pending work.

### Display Refresh Result

- **Fields**: `acceptedRevision`; latest authoritative `DisplayState`; optional exact-host/tab refresh failures.
- **Relationships**: Produced by the existing serialized background transaction after persistence and all reachable active adapter tabs settle; consumed only by Options error/warning UI.
- **Validation**: Invalid/failed persistence implies no fanout and no accepted revision; successful persistence remains successful even if one matching tab cannot be reached or returns a missing/malformed/wrong-revision acknowledgement; only a strict acknowledgement for the committed revision counts as a refreshed tab; global-off and disabled-site policies suppress fanout.
- **States**: Rejected/unchanged; committed/all refreshed; committed/partial refresh with actionable notice.

## Contracts

No HTTP, OpenAPI, GraphQL, remote service, browser permission, or issue-local contract file is needed. Extend only these existing TypeScript/WebExtension public boundaries:

```ts
type TimeZoneSelection =
  | { readonly mode: "system" }
  | { readonly mode: "utc" }
  | { readonly mode: "iana"; readonly identifier: string };

interface DisplaySettings {
  readonly formatMode: "system";
  readonly timeZone: TimeZoneSelection;
}

interface SettingsSnapshotV3 {
  readonly schemaVersion: 3;
  readonly revision: number;
  readonly globalEnabled: boolean;
  readonly sitePreferences: Readonly<Record<string, boolean>>;
  readonly display: DisplaySettings;
}

type DisplayState =
  | {
      readonly availability: "ready";
      readonly revision: number;
      readonly display: DisplaySettings;
      readonly error?: "unavailable-time-zone";
    }
  | {
      readonly availability: "unavailable";
      readonly revision: null;
      readonly display: null;
      readonly failure: "settings-load" | "fail-closed-cleanup";
    };

interface GetDisplayStateMessage {
  readonly type: "no-more-ago:get-display-state";
}

interface SetDisplaySettingsMessage {
  readonly type: "no-more-ago:set-display-settings";
  readonly display: unknown;
}

interface PresentationUpdateMessage {
  readonly type: "no-more-ago:update-presentation";
  readonly revision: number;
  readonly display: DisplaySettings;
}

interface PresentationUpdateAcknowledgement {
  readonly type: "no-more-ago:presentation-updated";
  readonly revision: number;
}

interface DisplayRefreshFailure {
  readonly hostname: string;
  readonly tabId?: number;
  readonly reason: "matching-tabs-query" | "tab-update";
}

type SetDisplaySettingsResponse =
  | {
      readonly ok: true;
      readonly acceptedRevision: number;
      readonly state: DisplayState;
      readonly refreshFailures: readonly DisplayRefreshFailure[];
    }
  | {
      readonly ok: false;
      readonly error: "invalid-time-zone" | "invalid-display-settings" | "save-failed" | "settings-unavailable";
      readonly state: DisplayState;
    };
```

The outer `set-display-settings` guard checks exact envelope shape only; the sole background Settings Service validates the display payload semantically so an invalid zone reaches exactly one typed authoritative response rather than being mistaken for transport loss. `PresentationUpdateAcknowledgement` has exactly two own fields, the exact literal type, and a safe nonnegative revision. An active or legitimately waiting current generation returns this acknowledgement after adopting a newer presentation; a duplicate already-applied revision returns the same acknowledgement without reformatting again. Older/malformed updates and stopped/failed generations never return a successful acknowledgement. Background accepts delivery only if the strict acknowledgement validator passes and `response.revision === committedRevision`; undefined, malformed, wrong-type, stale/future, stopped, or rejected responses become committed `tab-update` failures. Content requests `get-display-state` exactly once per fresh activation generation, shares that request across duplicate active activation calls, and rehydrates after same-document disable/re-enable. Options validates every response and rereads its own display projection only for a genuinely ambiguous transport failure. Existing popup/Sites contracts remain available and revision-safe.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/settings/snapshot.ts` | Modify | Strict unpublished V3 shape, frozen default display settings, discriminated structural IANA validation, and preserved exact-host policy. |
| `src/settings/settings-service.ts` | Modify | Serialized, semantically validated display intent preserving all latest global/site fields. |
| `src/core/format-default-date.ts` | Modify | Date-fns-backed localized medium/short formatting for System, UTC, IANA, dynamic locales, DST, and unavailable-zone fallback. |
| `src/core/process-document.ts` | Modify | Resolve live locale/presentation providers per candidate and preserve trusted source/ownership behavior. |
| `src/core/render-exact-time.ts` | Modify | Expose a narrow enumeration of existing proven-owned document sources without DOM discovery or a duplicate registry. |
| `src/core/document-transformation-controller.ts` | Modify | Refresh only tracked extension-owned sources on an explicit accepted presentation update. |
| `src/runtime/messages.ts` | Modify | Exact revisioned document presentation-update request/acknowledgement guards alongside existing status/teardown. |
| `src/content/runtime.ts` | Modify | Immediate singular listener/controller, exactly one authoritative hydration per fresh activation generation, document/readiness barrier, dynamic locales, strict revision acknowledgement, same-document reactivation, and stale-generation safety. |
| `src/content/main.ts` | Modify | Supply the production runtime-message settings loader and current `navigator.languages` provider without top-level await. |
| `src/background/application.ts` | Modify | Display read model, serialized display save, exact-host active-tab update fanout, exact committed-revision acknowledgement validation, response barrier, and typed partial refresh failures. |
| `src/background/messages.ts` | Modify | Exact display-state read/write envelopes and authoritative projection/response guards. |
| `src/background/chrome.ts` | Modify | Single-response background dispatch for display reads and semantic display writes. |
| `src/options/client.ts` | Modify | Typed display read/save transport, authoritative response handling, and ambiguous-response reread. |
| `src/options/app.tsx` | Modify | English Display/system-format/zone draft controls, Save, correction notices, failure states, and existing Sites retention. |
| `src/options/styles.css` | Modify if needed | Existing local Options layout for accessible Display controls without inline styles. |
| `tests/settings/snapshot.test.ts` | Modify | Exact V3/default/old-schema/zone-structure, safe one-component/slash IANA aliases, malformed identifier rejection, and unavailable-saved-zone acceptance behavior. |
| `tests/settings/settings-service.test.ts` | Modify | Valid single-component/slash IANA writes, invalid unsupported zones, persistence failures, unchanged drafts, concurrent preserved fields, and current support changes. |
| `tests/core/format-default-date.test.ts` | Modify | Locale order, 12/24-hour preferences, System/UTC/IANA, DST, runtime system changes, and fallback. |
| `tests/core/render-exact-time.test.ts` | Modify | Enumerate only genuine connected owned sources and preserve hostile-marker isolation. |
| `tests/core/document-transformation-controller.test.ts` | Modify | Owned-only explicit refresh, dynamic nodes, unchanged observer count, no whole-document discovery, and restoration. |
| `tests/integration/process-document.test.ts` | Modify | Live locale/zone settings, trusted extraction, dynamic candidate presentation, and saved fallback through the complete pipeline. |
| `tests/runtime/messages.test.ts` | Modify | Strict update envelope and exact two-field revisioned acknowledgement, same-revision acceptance, malformed/wrong-revision rejection, zone shape, and predecessor status/teardown boundaries. |
| `tests/content/runtime.test.ts` | Modify | Exactly-one-per-activation hydration, same-document disable/change-zone/re-enable, document barriers, live system changes, old-generation races, strict idempotent acknowledgements, stopped-document safety, and one controller/listener. |
| `tests/content/main.test.ts` | Modify | Actual entrypoint immediate listener, authoritative background request before first ownership, rejected read safety, and activation failure recovery. |
| `tests/background/messages.test.ts` | Modify | Display read/write request validation, structurally valid semantic rejection, exact response shapes, and preserved legacy control paths. |
| `tests/background/application.test.ts` | Modify | Exact two-tab acknowledged reformat, concurrent global/site/display writes, failed save, policy gating, retained activation failures, and committed partial failures for undefined/malformed/stale/stopped acknowledgements. |
| `tests/options/app.test.tsx` | Modify | Accessible Display controls, draft isolation, invalid/unavailable zones, successful saves, partial failures, and surviving Sites interactions. |
| `tests/build/chrome-artifact.test.ts` | Modify | Fresh V3 emitted background/content/options behavior, hydration, cross-tab messages, correction states, CSP, permissions, and all browser/mode ZIP pairs. |
| `tests/build/watch.test.ts` | Modify if needed | Preserve observed selected-target background/content/options rebuild and exact ZIP publication for maintained inputs. |

## Tasks

### [x] Task 1: Specify strict V3 display settings and persisted-zone structural safety

**Files:** Modify `tests/settings/snapshot.test.ts`; modify `src/settings/snapshot.ts`.

- [x] **Step 1: Write failing observable parser/default tests.** Assert the exact five-field V3 default, System/UTC/IANA discriminants, frozen safe host maps, preserved own prototype-like keys, and independent fields. Explicitly accept safe valid single-component `CET`, `Japan`, and `Iceland` plus `America/New_York` and `Etc/GMT+5`. Reject obsolete V2, extra/missing keys, malformed display/zone shapes, unknown format mode, absent/extra identifier, empty/surrounding-whitespace/control/backslash values, repeated/leading/trailing slash, `.`/`..` traversal components, invalid revisions, and invalid host preferences. Demonstrate a structurally safe once-valid one-component or slash-separated saved IANA string remains parseable even when an injected current support check would reject it.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts'`; expect the V2 parser/default to reject or omit the new V3 display shape.
- [x] **Step 3: Implement the minimum exact V3 snapshot.** Define frozen discriminated display defaults, strict structural helpers, exact five-key parsing, copied/frozen presentation objects, safe one-component-or-multicomponent IANA identifier syntax without a mandatory slash, and a constructor that preserves existing global/site values while accepting the selected display. Reserve runtime `Intl` availability for semantic write validation. Keep old development snapshots failed-closed and do not add migration, backup, sync, or recovery UI.
- [x] **Step 4: Re-run the parser gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts'`; expect every valid/invalid shape and own-host behavior to pass.

**Verification**: One complete V3 document preserves all predecessor settings and can represent a previously valid zone that later becomes unavailable.

### [x] Task 2: Persist validated display changes without losing concurrent controls

**Files:** Modify `tests/settings/settings-service.test.ts`; modify `src/settings/settings-service.ts`; adjust V3 seeds in `tests/background/application.test.ts` and `tests/build/chrome-artifact.test.ts` only where necessary to keep predecessor scenarios meaningful.

- [x] **Step 1: Write failing public service tests.** Save System, UTC, supported one-component `CET`/`Japan`/`Iceland`, and supported slash-separated `America/New_York`/`Etc/GMT+5`; reject structurally unsafe drafts and safe-but-currently-unsupported identifiers before storage read/write; preserve revision, previous global/site fields, and exact own-site entries. Assert unchanged equal values avoid persistence, storage failures retain the prior snapshot, old V2 remains invalid, and deferred mixed global/site/display writes commit distinct revisions without lost fields. Simulate once-supported one-component and slash-separated identifiers becoming unavailable after persistence and show both documents still load.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/settings-service.test.ts tests/settings/snapshot.test.ts'`; expect no display mutation entrypoint and stale V2 assumptions.
- [x] **Step 3: Implement one existing-writer display mutation.** Add typed `invalid-display-settings`/`invalid-time-zone` outcomes, an injectable or existing Intl-backed availability validator, structural-before-semantic checking, latest-snapshot merge, publish-after-write, and unchanged-intent short circuit; update existing global/site constructor calls to preserve `display`. Do not write from Options or content.
- [x] **Step 4: Re-run serialized settings gates.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts'`; expect valid revisions, failed-write preservation, and mixed-field serialization to pass.

**Verification**: Proposed invalid zones never persist; accepted site/global/display changes merge into one strictly validated document.

### [x] Task 3: Format exact instants using current locales, clock preference, and selected zone

**Files:** Modify `tests/core/format-default-date.test.ts`; modify `src/core/format-default-date.ts`; modify `tests/integration/process-document.test.ts`; modify `src/core/process-document.ts`.

- [x] **Step 1: Write failing presentation/pipeline behavior tests.** Compare `en-US`, `en-GB`, ordered fallback locales, empty browser defaults, `en-US-u-hc-h23`, and `en-GB-u-hc-h12` with independently constructed `Intl.DateTimeFormat({ dateStyle: "medium", timeStyle: "short" })`. Assert System, UTC, and representative IANA zones; New York values immediately before/after spring-forward; explicit year/minutes and no seconds; unsupported saved-zone fallback plus typed correction; and a changed locale/zone provider affecting a newly added candidate without a timer or changing already owned output.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/core/format-default-date.test.ts tests/integration/process-document.test.ts'`; expect unsupported zone arguments and static locale processing.
- [x] **Step 3: Extend the existing date-fns formatting pipeline.** Use `intlFormat` with current language preferences, medium/short styles, explicit `timeZone` only for UTC/IANA, and safe system fallback after a runtime RangeError. Preserve the existing two-argument public formatter and add optional presentation/live-locale inputs to the generic adapter-independent processing path. Resolve providers during each candidate pass and never parse visible text or infer a missing timestamp.
- [x] **Step 4: Re-run formatter and pipeline gates.** Run `zsh -lic 'pnpm exec vitest run tests/core/format-default-date.test.ts tests/integration/process-document.test.ts tests/integration/github-fixtures.test.ts'`; expect locales, hour cycles, DST, zones, and unchanged trusted GitHub fixture behavior to pass.

**Verification**: Every presented instant follows current browser locale/hour-cycle preferences and correct selected-zone civil time without timers or double conversion.

### [x] Task 4: Reformat only proven extension-owned sources on an explicit settings change

**Files:** Modify `tests/core/render-exact-time.test.ts`; modify `src/core/render-exact-time.ts`; modify `tests/core/document-transformation-controller.test.ts`; modify `src/core/document-transformation-controller.ts`.

- [x] **Step 1: Write failing ownership/controller tests.** Start a document with initial and dynamically added trusted sources, foreign lookalike markers, invalid/disconnected sources, and one existing observer. Change the supplied presentation and invoke an explicit refresh; assert every genuine connected owned output updates in place once, original GitHub hosts/links remain untouched, no new output/observer appears, foreign nodes are unchanged, invalid sources restore safely, and teardown still reveals the exact live originals. Observe no full adapter/document discovery for unrelated mutations or explicit owned-only refresh.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/core/render-exact-time.test.ts tests/core/document-transformation-controller.test.ts'`; expect the controller to lack an owned-source refresh operation.
- [x] **Step 3: Reuse the existing owned-source map.** Expose a narrow read-only enumeration of genuine connected document records from `render-exact-time.ts`; add `DocumentTransformationController.reformatOwned()` that revisits only these proven source elements through the existing trusted single-region path and mutation sink. Keep observer ownership filtering, one source/output pair, and no new document scan or source registry.
- [x] **Step 4: Re-run owned-DOM regression gates.** Run `zsh -lic 'pnpm exec vitest run tests/core/render-exact-time.test.ts tests/core/document-transformation-controller.test.ts tests/core/document-mutation-scheduler.test.ts tests/integration/document-ownership.test.ts'`; expect in-place updates, exact restoration, hostile-marker isolation, and one idle observer.

**Verification**: User-requested reformat work scales with extension-owned timestamps and cannot mutate unrelated page DOM.

### [x] Task 5: Define strict revisioned document presentation messages

**Files:** Modify `tests/runtime/messages.test.ts`; modify `src/runtime/messages.ts`.

- [x] **Step 1: Write failing public message-boundary tests.** Accept only an exact `update-presentation` request with a safe nonnegative revision and structurally complete V3 display object; reject inherited/missing/extra fields, unsafe revisions, malformed zones, and unexpected format modes. Independently require the exact two-field `PresentationUpdateAcknowledgement` `{ type: "no-more-ago:presentation-updated", revision }`; reject undefined/null, wrong type, missing/extra/inherited keys, unsafe revision, and nonmatching expected committed revision. Specify that an already-applied same-revision message receives the same valid acknowledgement without another formatting pass, while older revision or stopped/failed document receives no successful acknowledgement. Preserve exact status/teardown guards.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/runtime/messages.test.ts'`; expect absent update/acknowledgement guards.
- [x] **Step 3: Extend the existing runtime protocol.** Add typed request and exact `PresentationUpdateAcknowledgement` constants/interfaces, a strict acknowledgement validator, safe-revision/equal-expected-revision validation, and exact request shape checking backed by the shared structural display checker. Specify idempotent same-revision success without reformat; stopped/failed or older requests return no successful acknowledgement. Do not require currently supported zone availability when receiving a valid historical selection.
- [x] **Step 4: Re-run message gates.** Run `zsh -lic 'pnpm exec vitest run tests/runtime/messages.test.ts tests/runtime/adapter-activation.test.ts'`; expect strict new messages and unchanged activation/teardown behavior.

**Verification**: Only a complete revisioned presentation update reaches a document; only its strict exact-revision acknowledgement proves application; duplicate same revisions are safe, and saved unavailable zones remain representable.

### [x] Task 6: Hydrate authoritative presentation before first content ownership

**Files:** Modify `tests/content/runtime.test.ts`; modify `tests/content/main.test.ts`; modify `src/content/runtime.ts`; modify `src/content/main.ts`.

- [x] **Step 1: Write failing document/runtime race tests.** At `document_start`, verify one listener is installed synchronously while the current generation's authoritative read remains unresolved and no candidate is hidden. Cover ready/loading documents in both readiness orders, non-default first paint, malformed/unavailable/rejected reads, live locale changes, exactly one read per fresh activation generation, zero additional reads for duplicate waiting/active activation, and newer update before older hydration. Explicitly exercise the same retained document through global/site disable -> zone change with no fanout -> re-enable, assert a second current-generation read returns the new zone, and keep one listener/controller. Tear down during an unresolved first read, start a second activation, resolve the old response first, and prove it neither starts the document nor satisfies/overwrites the second read. Assert same-revision update acknowledgement with zero duplicate reformat, older update rejection, stopped/failed listener no successful acknowledgement, failed/retry activation, no stale resurrection, and no polling.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/content/runtime.test.ts tests/content/main.test.ts'`; expect immediate default formatting before background hydration and missing update processing.
- [x] **Step 3: Add a two-condition readiness barrier to the existing runtime.** Register one status/teardown/update listener before starting the asynchronous authoritative loader. Start exactly one fresh read whenever a stopped/failed retained document enters a new activation generation; share the existing request during duplicate waiting/active activation. Capture and verify the generation in every readiness callback, clear the old-generation hydration gate on teardown/reactivation, and activate only after both the current trusted ready display and document readiness exist. Use a live locale provider, apply newer updates to active owned sources, return the strict exact-revision acknowledgement after adopting a newer revision or idempotently seeing the same revision, and return no successful acknowledgement while stopped/failed or for older revisions. Keep direct public-runtime injection usable for existing offline tests, make production `main.ts` call background `sendMessage` once per fresh generation, and avoid top-level await.
- [x] **Step 4: Re-run content/controller gates.** Run `zsh -lic 'pnpm exec vitest run tests/content/runtime.test.ts tests/content/main.test.ts tests/runtime/messages.test.ts tests/core/document-transformation-controller.test.ts'`; expect safe hydration, non-default initial output, no duplicate controller, ordered revisions, and exact restoration.

**Verification**: A production page cannot acquire an assumed-default or pre-disable stale owned date; each real activation hydrates exactly once and obsolete generations cannot restart it.

### [x] Task 7: Add authoritative display read/write messages and exactly-once MV3 responses

**Files:** Modify `tests/background/messages.test.ts`; modify `src/background/messages.ts`; modify `src/background/chrome.ts`; modify `tests/build/chrome-artifact.test.ts`.

- [x] **Step 1: Write failing transport and emitted-boundary tests.** Validate exact display-state reads, structural-only save envelopes, ready/unavailable display projections, saved unavailable-zone correction, accepted response revisions, typed invalid-zone/save failures, and typed partial-refresh arrays. Dispatch a malformed zone inside an otherwise valid save envelope through the real listener and assert exactly one typed response with unchanged storage/runtime work; malformed envelopes receive no dispatch. Verify an early document read joins the existing single initialization flight without deadlock.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/background/messages.test.ts tests/build/chrome-artifact.test.ts'`; expect missing display request/projection branches and obsolete emitted V2 fixtures.
- [x] **Step 3: Extend existing shared guards and listener.** Add strict display state/response validation, structural-only intent dispatch, authoritative unavailable fallbacks, and `sendOnce` integration for both new background actions. Update maintained emitted fake storage to exact V3 while retaining intentionally invalid old-schema coverage. Leave popup/Sites listeners, cold-worker readiness, lifecycle coalescing, and extension permissions unchanged.
- [x] **Step 4: Re-run messaging/emitted gates.** Run `zsh -lic 'pnpm exec vitest run tests/background/messages.test.ts tests/build/chrome-artifact.test.ts tests/content/main.test.ts'`; expect single callbacks, reachable typed validation failures, safe content hydration, and unchanged predecessor message behavior.

**Verification**: Options and documents obtain trustworthy revisioned settings only through the sole background owner, even during cold-worker initialization.

### [x] Task 8: Serialize display saves and refresh all enabled exact-host top-frame tabs

**Files:** Modify `tests/background/application.test.ts`; modify `src/background/application.ts`; modify `tests/settings/settings-service.test.ts` if additional deferred integration fixtures are needed.

- [x] **Step 1: Write failing real-coordinator/application tests.** Seed two active `github.com` tabs plus `gist.github.com` and a no-adapter sibling. Save UTC/IANA and assert one committed revision, direct update to both exact-host top frames, each strict `{ type: "no-more-ago:presentation-updated", revision: acceptedRevision }` acknowledgement, no registration/unregistration/injection, and latest authoritative response after both settle. Separately return undefined, malformed object, wrong acknowledgement type, missing/extra keys, stale revision, future revision, stopped-document response, and rejected send from one tab while the other replies correctly; in every case require persisted accepted settings, unchanged success/accepted revision, continued delivery to the second tab, and the exact first-tab `tab-update` refresh failure. Cover failed matching-tab query, unsupported saved-zone correction, invalid/persistence-failed drafts with zero fanout, unchanged saves, globally off and disabled-site saves with zero matching-tab work, retained unrelated activation failures, and deferred concurrent global/site/display transactions without lost fields or stale responses.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/background/application.test.ts tests/settings/settings-service.test.ts'`; expect absent display read/save and cross-tab refresh.
- [x] **Step 3: Extend the existing full-transaction owner.** Project the current display and dynamic zone-availability warning; call the sole validated Settings Service display mutation; preserve last activation failures while advancing revision/cache; iterate enabled generic adapters, filter exact matching tabs, and send one strict update with `{ frameId: 0 }`. Await every reachable send and validate its response with the exact acknowledgement guard **and equality to the transaction's own committed revision**. Convert missing/malformed/wrong/stale/future/stopped acknowledgements and rejected sends into per-tab `tab-update` failures, classify query exceptions separately, continue remaining tabs, preserve accepted settings, and return a revision-barrier authoritative response. Skip all fanout under inactive policy, no change, validation failure, or persistence failure.
- [x] **Step 4: Re-run serialized runtime gates.** Run `zsh -lic 'pnpm exec vitest run tests/background/application.test.ts tests/settings/settings-service.test.ts tests/runtime/adapter-activation.test.ts tests/content/runtime.test.ts'`; expect exact two-tab refresh, policy gating, mixed transaction convergence, preserved predecessor failure attribution, and no reinjection.

**Verification**: Every reachable enabled GitHub tab proves its applied revision with a strict acknowledgement; any missing/wrong/stopped response is an honest committed partial failure, while disabled/unrelated documents and activation policy remain untouched.

### [x] Task 9: Expose accessible English Display controls without disturbing Sites

**Files:** Modify `tests/options/app.test.tsx`; modify `src/options/client.ts`; modify `src/options/app.tsx`; modify `src/options/styles.css` only if needed.

- [x] **Step 1: Write failing rendered-options behavior tests.** Assert the existing `Sites` section and switches coexist with `Display`, `Date format: System`, `Time zone`, `System`/`UTC`/`IANA`, conditional labeled identifier input, and `Save`. Changing a draft leaves background state/pages unchanged until a successful save. Enter and save valid supported one-component `CET`, `Japan`, and `Iceland` plus supported slash-separated `America/New_York`; invalid/empty/malformed/traversal/unsupported identifiers block save with an actionable English field error. A saved now-unavailable IANA zone remains visible with correction guidance and system fallback. Exercise accepted zone changes, identical save, typed persistence failure, ambiguous response and successful/failed reread, stale revision rejection, committed missing/wrong-ack partial-refresh warning, unavailable settings, and usable globally disabled/site-disabled save. Confirm UI contains no combined/custom mode or underlying library name through rendered accessible output.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/options/app.test.tsx'`; expect no Display controls or display-capable transport.
- [x] **Step 3: Extend the existing Options transport and view.** Add typed display read/save calls and own-surface ambiguous reread; load the authoritative display beside existing Sites state, retain a local editable draft, accept safe one-component and slash-separated aliases through the shared structural/current-Intl-support helper, submit one background intent only on Save, apply nondecreasing revisions, retain prior committed state on known failures, and render actionable errors including committed tab-acknowledgement warnings without writing storage or changing popup/page UI.
- [x] **Step 4: Re-run UI/transport gates.** Run `zsh -lic 'pnpm exec vitest run tests/options/app.test.tsx tests/popup/app.test.tsx tests/background/messages.test.ts tests/background/application.test.ts'`; expect accessible English display controls, unchanged Sites/popup behavior, safe drafts, and accurate authoritative failures.

**Verification**: The user can safely select System, UTC, or a valid IANA zone; unavailable historical choices are correctable and all existing site controls survive.

### [x] Task 10: Verify end-to-end saved zone, dynamic candidates, and observer ownership

**Files:** Modify `tests/integration/process-document.test.ts`; modify `tests/core/document-transformation-controller.test.ts`; modify `tests/content/runtime.test.ts`; modify `tests/background/application.test.ts`.

- [x] **Step 1: Write failing integrated observable scenarios.** Connect actual V3 settings service/application, fake WebExtension messaging, two jsdom GitHub documents, and their real document controllers. Start with a persisted IANA zone and require the first owned output in both documents to match that zone. Save UTC, await the accepted background response, and assert both preexisting outputs changed in place with strict committed-revision acknowledgements; add later candidates and require the same saved zone. Change the live locale/system-zone provider with system mode and verify only a newly added candidate reflects it. In each same retained document, disable global/site policy, save another zone while disabled and prove no fanout, re-enable via normal existing-tab injection, and require exactly one new hydration request plus first new owned output using the latest zone; preserve one listener/controller. Repeat with an unresolved old-generation read completed after teardown/reactivation and prove no stale restart/value. Return missing/malformed/stale/stopped acknowledgement for one document while the other updates, then require the accepted committed settings plus a truthful `tab-update` warning. Cover unavailable-zone fallback, valid one-component aliases, foreign DOM isolation, and exact teardown.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/integration/process-document.test.ts tests/content/runtime.test.ts tests/background/application.test.ts'`; expect any disconnected hydration/fanout/readiness seam to fail through actual DOM or runtime behavior.
- [x] **Step 3: Complete only narrow integration seams.** Correct exact revision-matched acknowledgements, generation-scoped document hydration/readiness, stopped/reenabled state, owned-source mutation filtering, revision propagation, and browser runtime fake boundaries exposed by the integrated scenarios; do not add polling, page scanning, presentation-triggered registration changes, a second adapter, or speculative abstractions.
- [x] **Step 4: Re-run full date/DOM/runtime gates.** Run `zsh -lic 'pnpm exec vitest run tests/core/format-default-date.test.ts tests/core/render-exact-time.test.ts tests/core/document-transformation-controller.test.ts tests/core/document-mutation-scheduler.test.ts tests/integration/process-document.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/background/application.test.ts tests/options/app.test.tsx'`; expect both current and future exact dates, locale changes, DST, policy gating, errors, ownership, and idleness to pass.

**Verification**: One end-to-end public/runtime/DOM chain demonstrates persisted first render, strictly acknowledged two-tab reformat, truthful malformed/stopped-ack partial failure, same-document disable/change-zone/re-enable rehydration, dynamic additions, safe system changes, and lossless restoration.

### [x] Task 11: Preserve CSP-safe emitted browser artifacts, selected watch, and ZIP parity

**Files:** Modify `tests/build/chrome-artifact.test.ts`; modify `tests/build/watch.test.ts` only when existing observable source generations do not cover changed presentation paths; modify existing browser/runtime implementation only if emitted behavioral tests expose an integration defect.

- [x] **Step 1: Write failing emitted behavior checks.** For Chrome, Firefox, and Edge in development and release modes, seed strict persisted V3 settings, boot emitted background/options/content bundles under disabled string/Wasm code generation, and observe one authoritative content presentation request per fresh activation generation, first non-default owned output, a supported one-component/slash-alias Options save, and strict revision-acknowledged frame-zero messages to matching active tabs. Exercise same-document disable/change-zone/re-enable and a missing/wrong/stopped acknowledgement that yields a committed partial-refresh warning. Verify invalid-zone callback exactly once/no write, unavailable-zone correction, old-schema fail-closed, unchanged popup/Sites controls, no inline executable markup/remote resource, unchanged API/host permissions, browser-appropriate manifests, exact unpacked/ZIP inventories/bytes, and existing selected-target watch publication for changed Options/content/background graph inputs.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/watch.test.ts'`; expect unconverted V2 seeds, an unhandled emitted message, missing document hydration fake, or stale selected artifacts to fail observably.
- [x] **Step 3: Correct emitted-boundary behavior only.** Adapt maintained API/document harnesses and shared packaging inputs as required; preserve local external-only existing Options/popup HTML, current Rspack entries, browser variants, immutable watch generations, direct pnpm commands, and deterministic archive publication. Do not add permissions, generated files, browser launching, or source-layout assertions.
- [x] **Step 4: Re-run public build behavior gates.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/watch.test.ts tests/build/commands.test.ts'`; expect all maintained browser/mode/CSP/message/watch/ZIP behaviors to pass.

**Verification**: Every installable browser artifact contains working saved presentation behavior without widening permissions, introducing unsafe executable markup, or breaking selected-target watch.

### [x] Task 12: Run complete direct-pnpm quality and six-artifact gates

**Files:** No planned production changes.

- [x] **Step 1: Run focused presentation/settings/runtime/UI regressions.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/core/format-default-date.test.ts tests/core/render-exact-time.test.ts tests/core/document-transformation-controller.test.ts tests/core/document-mutation-scheduler.test.ts tests/integration/process-document.test.ts tests/integration/document-ownership.test.ts tests/runtime/messages.test.ts tests/runtime/adapter-activation.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/popup/app.test.tsx tests/options/app.test.tsx'`; expect all default/explicit-zone, locale/hour-cycle, DST/fallback, transaction, ownership, exact-host, and predecessor controls to pass.
- [x] **Step 2: Run the complete repository quality gate.** Run `zsh -lic 'pnpm check'`; expect ESLint, strict TypeScript, and all offline unit/integration/build/watch behavior tests to pass.
- [x] **Step 3: Build every development target.** Run `zsh -lic 'pnpm dev'`; expect separate valid Chrome, Firefox, and Edge development directories/ZIPs.
- [x] **Step 4: Build every release target.** Run `zsh -lic 'pnpm release'`; expect separate valid Chrome, Firefox, and Edge release directories/ZIPs with identical unpacked/archive inventories.
- [x] **Step 5: Run the final standalone lint gate.** Run `zsh -lic 'pnpm lint'`; expect no remaining implementation, test, or configuration lint violations.

**Verification**: All checks run against the user's direct Node 24/pnpm environment; Corepack, Git, browser automation/UI, website/network access, external-utility checks, and implementation-source-text tests are never used.

## Acceptance Coverage

| Acceptance criterion | Planned observable evidence |
| --- | --- |
| 1. Default medium date/short time includes year/minutes, follows browser language/clock preference, and omits seconds | Tasks 1 and 3 test default V3, `en-US`, `en-GB`, ordered locale fallback, runtime-default locales, Unicode 12/24-hour preferences, and public date-fns-backed formatted output. |
| 2. Saving System, UTC, or valid IANA persists and updates existing/future owned dates | Tasks 1, 2, and 4-11 cover safe one-component/slash IANA aliases, whole-snapshot writes, exactly-once-per-activation hydration, same-document disable/change-zone/re-enable, DST-aware formatting, owned-only controller refresh, exact two-tab frame-zero fanout with committed-revision acknowledgement, truthful malformed/stopped-ack partial failures, dynamic candidates, Options Save, and emitted browser behavior. |
| 3. Invalid IANA input is blocked with actionable English error while prior output remains active | Tasks 1, 2, and 7-10 separately verify safe single-component/slash syntax versus malformed/traversal values, semantic Intl availability, exactly-once typed response, zero storage/tab operations, local field errors, unchanged revision, and retained page output. |
| 4. Previously saved unavailable zone falls back to system output and Options exposes correction | Tasks 1-3 and 7-11 load structurally valid historical IANA values after support disappears, format using the live system zone without overwriting saved settings, expose typed correction state, and render actionable Options guidance. |
| 5. New candidates reflect current system locale/zone without polling; existing output waits for an agreed trigger | Tasks 3, 4, 6, and 10 resolve locale/system-zone providers per candidate, assert previously owned output remains unchanged until explicit save/re-enable/reload, and retain one observer with no periodic processing. |

## Constraint Coverage

| Constraint | Planned enforcement |
| --- | --- |
| Existing validated date-fns and current browser preferences | Task 3 extends `date-fns` `intlFormat`, preserves ordered `navigator.languages` and hour-cycle Unicode preferences, and lets Intl apply selected IANA DST rules. |
| One strict background-owned versioned document | Tasks 1, 2, 7, and 8 use only the strict V3 local `settings` snapshot and existing Settings Service transaction; no direct Options/content persistence or account sync. |
| No unpublished backward-compatibility promise | Tasks 1, 2, and 11 explicitly reject unpublished V1/V2 without migration, backup restoration, or silent defaults. |
| Correct first paint, reactivation, and acknowledged live updates | Tasks 5-8 and 10 install one listener first, hydrate authoritative settings exactly once per fresh activation generation, rehydrate the same document after disable/zone-change/re-enable, reject obsolete generations/messages, and classify open-tab fanout as successful only after strict committed-revision frame-zero acknowledgement. |
| Global/site policy and existing response/failure barriers | Tasks 2, 7-10 preserve all latest fields, exact host filtering, global/site inactivity, retained unrelated activation failures, typed save failures, truthful committed malformed/stale/stopped-ack partial failures, nondecreasing state models, and single callback semantics. |
| Lightweight generic content runtime | Tasks 3-6 and 10 reuse one controller, observer, adapter registry, and owned-source map; no polling, full-document rescan, reinjection, per-node observer, GitHub-specific core branch, or foreign DOM mutation. |
| English-only extension UI and strict downstream boundaries | Task 9 exposes only system-format and zone controls; custom pattern/preview, diagnostics, reset, reporting, backup/migration/recovery, user navigation, and browser smoke stay in their owning issues. |
| Cross-browser privacy/CSP/artifact integrity | Tasks 7, 11, and 12 preserve extension-local executable resources, unchanged permissions, no page data persistence/network, all six browser/mode ZIP pairs, selected watch behavior, and direct-pnpm-only gates. |

## Review Attempt 1 Finding Disposition

| Rejected finding | Concrete resolution | Observable coverage |
| --- | --- | --- |
| Initial hydration was limited to a document lifetime, preventing same-document re-enable from loading settings changed while disabled. | Hydrate exactly once per fresh activation generation; retain one listener/controller and share the read during duplicate active activation; teardown invalidates old callbacks and a stopped/failed reactivation clears the gate and starts a fresh read. | Research / Initial presentation hydration; Revisioned Document Presentation; Contracts; Tasks 6, 10, and 11 explicitly cover same-document disable -> changed-zone save with no fanout -> re-enable, one read per generation, pending old-generation completion, no stale resurrection, and latest-zone initial ownership. |
| Slash-only IANA validation rejected valid runtime-supported identifiers. | Permit safe single-component aliases and safe slash-separated names structurally; reject malformed/traversal/control values; independently require current Intl support only for proposed saves while retaining historically valid unavailable storage. | Research / Strict unpublished V3; Time Zone Selection; Tasks 1, 2, 9, 10, and 11 accept `CET`, `Japan`, `Iceland`, `America/New_York`, and `Etc/GMT+5`; test unsafe and unsupported values through parsers, service, rendered Options, and emitted artifacts. |
| Open-tab delivery lacked a defined exact revision acknowledgement and could incorrectly report stale/stopped tabs as refreshed. | Define exact two-field `PresentationUpdateAcknowledgement`, validate its shape and equality to the transaction's own committed revision, make same-revision retries idempotent, and report undefined/malformed/wrong/stale/future/stopped/rejected responses as committed `tab-update` failures. | Research / Atomic commit; Contracts; Display Refresh Result; Tasks 5, 6, 8, 9, 10, and 11 assert strict public guards, accepted same-revision acknowledgement without reformat, stopped rejection, retained committed settings, continued sibling delivery, and visible partial-failure warning. |

## Self-Review

- The direct prerequisite `6-AFK` and relevant `1-AFK` through `7-AFK` behavior are validated; no blocked dependency remains Draft.
- All five acceptance criteria map to specific failing public/module/DOM/UI/emitted-artifact tests and subsequent minimal implementation tasks.
- `SettingsSnapshotV3`, `DisplaySettings`, `TimeZoneSelection`, `DisplayState`, strict message envelopes, `PresentationUpdateAcknowledgement`, accepted revision, partial refresh failures, and existing global/site policy names stay consistent across research, entities, contracts, tasks, and acceptance evidence.
- Safe valid one-component aliases and slash-separated IANA names are accepted; unsafe or currently unsupported proposed identifiers are rejected before persistence, while structurally valid once-supported stored zones continue loading and visibly fall back without silently replacing settings.
- Production content installs one listener immediately but waits for exactly one authoritative settings read per fresh activation generation before owning DOM; same-document disable/change-zone/re-enable, duplicate activation, pending old-generation callbacks, teardown, failed reads, and coordinator initialization cannot produce stale output, stale resurrection, duplicate controllers, or a deadlock.
- System locales and zone are resolved per formatting event rather than cached or polled; Unicode clock preferences and DST boundaries are asserted against observable browser Intl output.
- A presentation-only save never reinjects/registers scripts or reprocesses unrelated documents; it updates existing proven owned sources in every reachable enabled exact-host frame-zero tab, accepts only an exact committed-revision acknowledgement, returns idempotent same-revision acknowledgements without duplicate formatting, and records missing/malformed/stale/stopped/rejected delivery failures truthfully while retaining the committed save.
- The existing `Sites` section, popup controls, privacy guarantees, disabled-site/global behavior, host canonicalization, one observer, source ownership, and exact restoration all retain explicit regression coverage.
- UI remains English, local, actionable, and scoped to system format plus time zone; custom format/preview, reset, recovery backup/migration, diagnostics, reporting, production extra adapters, and permissioned live browsers remain excluded.
- Every test exercises public parsing, formatting, storage, DOM, React controls, messages, browser-runtime behavior, emitted resources, exact ZIP contents, or public commands; no test inspects implementation source text.
- No placeholder task, external API, browser automation/UI, website/network operation, Corepack, Git operation, process-tree utility, utility-provenance check, extra permission, or account synchronization is included.
- All three review-attempt-1 findings are resolved in the disposition matrix; the existing review report/counter and issue `Reviewing` status remain untouched.
