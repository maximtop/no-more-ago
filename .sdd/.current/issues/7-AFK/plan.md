# Implementation Plan: [no-more-ago] Manage exact-host site preferences

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/7-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Revise review attempt 1: make surface-specific invalid-hostname responses reachable through structural message dispatch and semantic writer validation; define one canonical exact-host policy for normalized URL case/IDNs, URL ports, IPv6, trailing dots, and safe own prototype-like keys; ensure relevant adapter cleanup failures outrank global-off status. Preserve strict unpublished V2, the validated serialized MV3 architecture, explicit-only privacy, generic adapter policy, truthful popup/Options responses, CSP-safe browser artifacts, and all existing downstream-scope boundaries.

## Summary

Add exact-host site preferences to the existing background-owned settings and activation transaction. Bump the unpublished, strictly validated settings document to V2 and add one `sitePreferences: Readonly<Record<string, boolean>>` field. An absent own hostname key means enabled; a present key proves an explicit user action and remains present whether its value is `true` or `false`. Merely reading a popup, opening Options, browsing, or observing runtime status never writes a hostname.

Give every generic runtime adapter definition an explicit exact `hostname`. Compute each adapter's effective policy as `globalEnabled && sitePreferences[adapter.hostname] !== false`; derive Options rows from the union of adapter hostnames and explicit preference keys. A changed effective GitHub policy immediately unregisters/restores or registers/injects existing top-frame tabs through the established full-transaction queue. Saving a no-adapter hostname, saving an already-effective value, or editing any site while globally off changes persistence without starting or reinjecting a runtime. Scoped adapter reconciliation preserves unrelated adapter failures instead of reporting a false recovery.

Extend the existing popup with an exact-host switch and an extension-local Settings link; add one English Options page containing only a `Sites` section. Both surfaces send validated intent messages to the sole background writer and retain revision-gated authoritative responses, typed save failures, ambiguous-response rereads, and fail-closed states. Emit Options HTML/JS/CSS into every existing Chrome, Firefox, and Edge development/release artifact with the same local-only CSP, ZIP-parity, and watch guarantees as the validated popup.

## Technical Context

- **Language/Version**: TypeScript 6.0.3 with TSX, ECMAScript 2022; Node `>=24 <25`; direct pnpm 10.34.5
- **Primary Dependencies**: React 19.2.8, React DOM 19.2.8, Mantine 9.5.2, Rspack 2.1.10, existing Chrome WebExtension types; no new dependency
- **Storage**: One `chrome.storage.local` document at the existing `settings` key; unpublished schema V2 with revision, global policy, and explicit exact-host preferences; no sync, second snapshot, site-history store, or diagnostic journal
- **Testing**: Vitest 4.1.11, jsdom 30.0.1, React `act`, injected browser/storage runtimes and deferred promises, public messaging, parsed emitted manifests/documents, VM contexts with string/Wasm code generation disabled, artifact/ZIP parity, and existing isolated watch workspaces
- **Target Platform**: Manifest V3 Chrome, Edge, and Firefox development/release artifacts; every HTTP/HTTPS hostname may hold a preference, but only exact top-level `github.com` documents have a production adapter

## Research

### Validated predecessor and actual change boundaries

Issue `6-AFK` is `Validated`; its final validation report confirms full commit-to-reconcile serialization, revisioned response barriers, one MV3 readiness flight, exact top-frame operations, fail-closed cleanup, real matching-sibling isolation, recovery at the same revision, emitted background single-response delivery, CSP-safe popup boot, and popup TSX/CSS/HTML watch generations. Those maintained observable contracts must continue to pass.

`src/settings/snapshot.ts:1-46` currently accepts an exact three-field V1 document. `src/settings/settings-service.ts:19-99` reloads the latest document inside a serialized mutation and publishes only after storage succeeds. `src/background/application.ts:92-326` owns the wider transaction queue, initialization, lifecycle, failure precedence, and authoritative popup responses. `src/runtime/adapter-activation.ts:13-226` already iterates injected generic runtime adapter definitions, and `src/runtime/register-github.ts:35-40` defines the only production adapter.

The popup transport/view currently spans `src/background/messages.ts:1-59`, `src/background/chrome.ts:53-75`, `src/popup/client.ts:17-55`, and `src/popup/app.tsx:39-115`. `rspack.config.mjs:14-52` compiles the popup and watches/emits its HTML; `scripts/build/artifacts.mjs:105-137` validates extension-local popup references and complete ZIP parity. No root `AGENTS.md`, `DEVELOPMENT.md`, or `README.md` exists; supplied workspace instructions and the PRD are controlling.

### Explicit unpublished schema evolution and safe hostname identity

Use `SETTINGS_SCHEMA_VERSION = 2` and one exact four-field snapshot:

```ts
{
  schemaVersion: 2,
  revision: 0,
  globalEnabled: true,
  sitePreferences: {}
}
```

Missing storage yields this in-memory default without a write. An existing V1 document is rejected as an invalid unpublished schema and follows the already-validated failed-closed path; it is not silently defaulted, rewritten, or migrated. Developers can reset obsolete pre-public state outside this slice. First-public-schema migration, backup recovery, and recovery UI remain the separately owned `10-AFK`/`13-AFK` work.

Validate the entire document and every own map entry before accepting or persisting it. Use exactly one identity rule everywhere: **a site key is the canonical `URL.hostname` returned by an HTTP/HTTPS URL, never `URL.host`**. Tab URL parsing normalizes case and Unicode before the popup/background sees the key: `https://EXAMPLE.TEST:8443/a` becomes `example.test`; `https://bücher.example/` becomes `xn--bcher-kva.example`; HTTP and HTTPS and every URL port for the same canonical hostname share one key. Site-intent/storage keys are already-canonical strings: reconstruct `new URL("https://" + hostname)` and require `parsed.hostname === hostname`, no credentials, explicit port syntax, path other than `/`, query, fragment, wildcard, surrounding whitespace, or empty host. Thus raw uppercase, raw Unicode, and `example.test:443` are rejected as noncanonical **intent keys**, even though uppercase/Unicode/port-bearing **tab URLs** normalize correctly before intent creation.

IPv4, canonical bracketed IPv6 such as `[::1]`, and lowercase `localhost` are accepted. One trailing dot is **allowed and preserved** as a distinct exact-host identity: `example.test.` and `example.test` are separate keys; two trailing dots are rejected. Accordingly `github.com.` has no built-in GitHub adapter and cannot inherit `github.com` policy. `__proto__` and `constructor` are valid lowercase hostname identities when URL parsing accepts them and can be retained as harmless own boolean entries; mixed-case `toString` is rejected because its canonical hostname is `tostring`, while canonical lowercase `tostring` is allowed. Build/copy/read maps exclusively with `Object.entries`, `Object.fromEntries`, and `Object.hasOwn`; never use inherited-property lookup or assignment that can invoke `__proto__`. Parent, subdomain, sibling, trailing-dot, and prototype-like keys never inherit one another's preference.

The map owns the explicit-action marker through key presence: first `setSiteEnabled("example.test", true)` persists `{ "example.test": true }` even though its effective default was already enabled; a repeated identical explicit intent does not write or advance the revision. A global mutation preserves every existing site entry, and a site mutation preserves the latest global flag and all unrelated exact keys. Invalid hostname, invalid boolean, invalid document, unsafe revision, and rejected storage leave both the prior snapshot and runtime unchanged.

### Adapter metadata, exact effective policy, and scoped failures

Add `hostname: string` to `RuntimeAdapterDefinition`; production GitHub sets `hostname: "github.com"`, while existing public coordinator tests use `hostname: "synthetic.test"`. Matching remains the adapter's existing `matches(url)` contract; no shared core, coordinator branch, popup, or options code infers that a hostname containing `github` has an adapter.

Extend coordinator input with the complete authoritative `sitePreferences` and optional `affectedHostnames`. Global/lifecycle/failed-closed reconciliation considers every injected definition. A site-induced policy transition limits registration, tab query, top-frame injection, or frame-0 teardown to definitions whose explicit hostname exactly equals the changed hostname. Effective policy is computed independently for each definition; global-off and unknown/failed-closed override every preference. Parent, child, sibling, path, scheme, and URL-port values never participate in inherited lookup.

Add `adapterId` to matching-tab-query failures so every scoped failure can be attributed. When a scoped reconciliation replaces state, preserve previous failure/registration/tab results for unrelated adapters, replace the affected adapter's complete result, and publish the merged result at the newly committed revision. Active-tab status consults only failures matching its selected adapter and tab. This prevents a site edit for one adapter from erasing another adapter's unresolved registration/query/tab failure.

If a site write does not change any adapter's effective policy, perform no registration, injection, teardown, or matching-tab query; advance the last reconcile revision while retaining still-relevant failure information. This includes hosts with no adapter, first explicit enabled values, unrelated hostnames, and every site edit while global policy is off. An unchanged explicit adapter intent may perform a narrowly scoped recovery only when an existing failure for that adapter needs repair; unchanged global intents retain their validated same-revision recovery behavior. Restart and lifecycle reconciliation always derive their policy from the complete persisted V2 snapshot.

### Full transaction queue, concurrent intent safety, and truthful responses

Both global and site commands reserve positions on `BackgroundApplication`'s existing queue. Each transaction loads the latest valid snapshot, validates one intent, persists before publication, derives the previous/new effective policy, performs only required scoped runtime work, publishes the same-revision reconcile outcome, and releases the queue. Only then does the command reserve its response-model read barrier. Concurrent popup/global/options writes therefore preserve every accepted field and return models for the latest already-reserved revision, with their own `acceptedRevision` recorded separately.

Use a surface discriminant so popup commands receive `PopupState` and Options commands receive `SitesState` without performing an unnecessary current-tab lookup for Options. Site-message dispatch is deliberately two-stage: the MV3 envelope guard accepts exactly `{ type, hostname: string, enabled: boolean, surface: "popup" | "sites" }` **without validating the hostname semantically**, and the sole background writer then applies the canonical-hostname rule. A well-shaped invalid-host request therefore reaches `BackgroundApplication.setSiteEnabled`/`SettingsService`, returns exactly one `{ ok: false, error: "invalid-hostname", surface, state }` with the matching authoritative model, and performs zero storage writes, coordinator calls, registrations, injections, teardowns, or tab-runtime work attributable to that intent. A malformed envelope is not dispatched. A known failed storage write produces `save-failed`; neither typed failure changes committed state or runtime. A rejected/malformed **response** remains ambiguous: each surface rereads its own authoritative state. Successful reread applies only nondecreasing revisions and displays an interrupted-response notice. Failed reread exposes a disabled mixed/unknown switch or unavailable Sites list, never the prior policy as an authoritative rollback.

Extend ready popup states with `siteEnabled: boolean | null` and `hasAdapter: boolean`; unavailable states carry `siteEnabled: null` and `hasAdapter: false`. Apply this single, complete precedence order:

1. Invalid/unreadable settings or incomplete fail-closed cleanup -> the existing unavailable/unknown state.
2. Current-tab query failure -> `runtime-failed`; inaccessible/non-HTTP(S)/hostless URL -> `inaccessible` with no site control.
3. A registration/get/unregister failure, matching-tab-query failure, or current-tab teardown/injection/status failure for the **currently selected adapter** -> `runtime-failed`, even when `globalEnabled === false`, because successful inactivity is unconfirmed.
4. Only when no relevant current-adapter failure remains, `globalEnabled === false` -> `global-disabled` / `Extension is off`; failures for other adapters do not prevent this clean current-host result.
5. Clean global-on plus exact disabled preference -> `site-disabled` / `Disabled on <hostname>`.
6. Clean global-on plus enabled exact host with no adapter -> `no-rules` / `Rules are not available for <hostname> yet`.
7. Clean globally/site-enabled adapter -> verified document status (`active` or the existing truthful runtime failure).

An inactive site edit while globally off retains a relevant existing cleanup failure and keeps `runtime-failed`; it neither registers, injects, unregisters, tears down, nor queries matching runtime tabs. No status calls a no-adapter host unsupported.

### Options rows, privacy, and cross-browser packaging

`getSitesState()` obtains data from the already-loaded authoritative snapshot and adapter metadata only. Its deterministically ordered union contains built-in adapter hosts even when no preference exists, plus exactly the own keys created by explicit user actions; explicitly enabled rows remain present. It performs no tab query, DOM work, storage write, network request, or browsing-history collection. Site controls remain editable while global policy is off, with an English notice describing the global override.

Add `src/options/{app.tsx,client.ts,main.tsx,options.html,styles.css}` and `tests/options/app.test.tsx`. Declare `options_ui: { page: "options.html", open_in_tab: true }` in the existing shared manifest. Add an `options` Rspack entry; watch/emit Options HTML in the same compilation as metadata, producing extension-local `options.js` and `options.css`. Generalize the existing artifact document validator for both popup and options references: required files remain inside the unpacked artifact/ZIP, executable markup remains external and local, inline scripts/styles/handlers and remote executable references fail, and emitted bundles boot under the existing disabled-code-generation VM harness.

Preserve selected-target publication, all-browser/mode ZIP parity, and existing watch generation semantics. Add maintained Options TSX/CSS/HTML mutations to the current isolated watch test and assert observed emitted marker/ZIP bytes; do not assert implementation-file text. The popup Settings link points to extension-local `options.html` and is user initiated; no first-install/onboarding/options navigation is added.

### Strict issue ownership and prohibited work

- `8-AFK`/`9-AFK` own display, time-zone, custom-format, preview, and page reformat settings.
- `10-AFK` owns previous-known-good snapshots, migration seams, invalid-state recovery hardening, and recovery UI.
- `11-AFK`/`12-AFK` own opt-in diagnostics, logging, ZIP download, and clear actions.
- `13-AFK` owns `Reset all settings`; retained site rows are not removed by this issue.
- `14-AFK` owns `Report this site`, GitHub issue templates, and reporting navigation.
- `15-AFK` owns a synthetic production-pipeline adapter proof; Issue 7 may use injected coordinator fakes only.
- `16-HITL` owns explicitly permitted live browser and live-GitHub checks.
- Add no browser permission, `<all_urls>` registration, site-history tracking, remote request, browser UI/automation, page UI, replacement counter, account sync, Corepack, Git operation, external process-tree utility, utility provenance test, or implementation-source-text test.

## Entities

### Settings Snapshot V2

- **Fields**: `schemaVersion: 2`; safe nonnegative `revision: number`; `globalEnabled: boolean`; `sitePreferences: Readonly<Record<string, boolean>>`
- **Relationships**: The sole background-owned local document; supplies popup state, Options rows, and adapter activation
- **Validation**: Exactly four own top-level fields; canonical exact own hostname keys; boolean values; no inherited map lookup; invalid/older unpublished documents remain failed-closed
- **States**: missing -> in-memory enabled/default-empty; accepted explicit/global mutation -> revision plus one; identical existing intent -> same revision; invalid/load/write failure -> unchanged or unavailable

### Exact Site Preference

- **Fields**: canonical exact hostname; own boolean map value; explicit action represented by own-key presence
- **Relationships**: Embedded in V2 snapshot; joined with matching adapter metadata and global flag; becomes an Options row
- **Validation**: Canonical `URL.hostname` only; lowercase/punycode tab normalization, URL ports ignored, canonical bracketed IPv6 accepted, one trailing dot preserved as a distinct exact identity, own `__proto__`/`constructor` safe, mixed-case `toString` rejected; no scheme, path, wildcard, query, fragment, intent-key port, parent fallback, or inherited property
- **States**: absent/default enabled -> explicit false or explicit true -> retained on any later true/false toggle; removal belongs only to later reset

### Runtime Adapter Policy

- **Fields**: existing adapter ID, registration, matcher; new exact `hostname`; effective `globalEnabled && (sitePreferences[hostname] ?? true)`
- **Relationships**: One registration and matching-tab fan-out per generic adapter definition
- **Validation**: Exact hostname match; global/failed-closed override; unrelated site edits have no activation side effect; only impacted adapters are reconciled
- **States**: enabled/registered/active -> exact-site-disabled/unregistered/restored -> reenabled/registered/injected; globally disabled desires inactivity, but unsuccessful unregister/query/teardown remains explicitly reported as uncertain runtime failure

### Sites View State

- **Fields**: availability; safe revision or null; globalEnabled or null; rows of `{ hostname, enabled, hasAdapter }`; typed unavailable failure
- **Relationships**: Read-only projection of validated snapshot plus registered adapter metadata; consumed by Options and revisioned site command responses
- **Validation**: Built-in hostnames always appear; explicit enabled and disabled rows persist; deterministic unique exact-host rows; no entries from visits or active-tab inspection
- **States**: loading -> ready; saving -> latest authoritative revision; typed rejection -> prior/latest authoritative revision; ambiguous response -> reread ready or unavailable

### Host-Aware Popup State

- **Fields**: existing availability/revision/global policy/hostname/status/failure plus `siteEnabled: boolean | null`, `hasAdapter: boolean`, and `site-disabled` status
- **Relationships**: Derived from the active HTTP/HTTPS tab, authoritative snapshot, adapter list, and scoped reconcile failures
- **Validation**: Null hostname has no actionable site control; relevant current-adapter registration/query/teardown failure outranks global-off; unrelated failures remain isolated; only clean global-off outranks site/no-rules; unavailable state never claims a known policy
- **States**: active; globally disabled; exact-host disabled; no rules yet; inaccessible; runtime failure; settings unavailable

## Contracts

No HTTP, OpenAPI, GraphQL, remote service, or issue-local contract file is required. The extension-local TypeScript/browser-message contracts are:

```ts
export interface SettingsSnapshotV2 {
  readonly schemaVersion: 2;
  readonly revision: number;
  readonly globalEnabled: boolean;
  readonly sitePreferences: Readonly<Record<string, boolean>>;
}

export type SettingsWriteResult =
  | {
      readonly ok: true;
      readonly changed: boolean;
      readonly snapshot: SettingsSnapshotV2;
    }
  | {
      readonly ok: false;
      readonly error: "persistence-failed" | "invalid-hostname";
      readonly snapshot: SettingsSnapshotV2;
    };

class SettingsService {
  setGlobalEnabled(enabled: boolean): Promise<SettingsWriteResult>;
  setSiteEnabled(hostname: string, enabled: boolean): Promise<SettingsWriteResult>;
}
```

```ts
export interface RuntimeAdapterDefinition {
  readonly id: string;
  readonly hostname: string;
  readonly registration: RegisteredContentScriptSpec;
  matches(url: URL): boolean;
}

export interface ActivationReconcileInput {
  readonly revision: number | null;
  readonly mode: "cold-worker" | "activation-sweep" | "settings-change" | "failed-closed";
  readonly policy: "enabled" | "disabled" | "unknown";
  readonly sitePreferences: Readonly<Record<string, boolean>>;
  readonly affectedHostnames?: readonly string[];
}

export type ReconcileFailure =
  | {
      readonly scope: "registration";
      readonly adapterId: string;
      readonly operation: "get" | "register" | "update" | "unregister";
    }
  | { readonly scope: "matching-tabs-query"; readonly adapterId: string }
  | {
      readonly scope: "tab";
      readonly adapterId: string;
      readonly tabId: number;
      readonly action: "inject" | "teardown" | "status";
    };
```

```ts
export interface SiteListEntry {
  readonly hostname: string;
  readonly enabled: boolean;
  readonly hasAdapter: boolean;
}

export type SitesState =
  | {
      readonly availability: "ready";
      readonly revision: number;
      readonly globalEnabled: boolean;
      readonly sites: readonly SiteListEntry[];
    }
  | {
      readonly availability: "unavailable";
      readonly revision: null;
      readonly globalEnabled: null;
      readonly sites: readonly [];
      readonly failure: "settings-load" | "fail-closed-cleanup";
    };

export type PopupStatus =
  | "active"
  | "global-disabled"
  | "site-disabled"
  | "inaccessible"
  | "runtime-failed"
  | "no-rules"
  | "settings-unavailable";
```

```ts
export const GET_SITES_STATE_MESSAGE = "no-more-ago:get-sites-state";
export const SET_SITE_ENABLED_MESSAGE = "no-more-ago:set-site-enabled";

export interface GetSitesStateMessage {
  readonly type: typeof GET_SITES_STATE_MESSAGE;
}

export interface SetSiteEnabledMessage {
  readonly type: typeof SET_SITE_ENABLED_MESSAGE;
  readonly hostname: string;
  readonly enabled: boolean;
  readonly surface: "popup" | "sites";
}

/** Checks exact envelope fields/types only; semantic hostname validation is deferred. */
export function isSetSiteEnabledMessage(
  value: unknown
): value is SetSiteEnabledMessage;

/** Enforced by Settings Service before any persistence or activation operation. */
export function isCanonicalHostname(hostname: string): boolean;

export type SetSiteEnabledResponse =
  | {
      readonly ok: true;
      readonly acceptedRevision: number;
      readonly surface: "popup";
      readonly state: PopupState;
    }
  | {
      readonly ok: true;
      readonly acceptedRevision: number;
      readonly surface: "sites";
      readonly state: SitesState;
    }
  | {
      readonly ok: false;
      readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable";
      readonly surface: "popup";
      readonly state: PopupState;
    }
  | {
      readonly ok: false;
      readonly error: "save-failed" | "invalid-hostname" | "settings-unavailable";
      readonly surface: "sites";
      readonly state: SitesState;
    };
```

Existing `get-popup-state`, `set-global-enabled`, exact document status, frame-0 teardown, full-transaction response barriers, fail-closed cleanup, and top-frame execution contracts remain in force. The site envelope guard rejects missing/extra fields, nonstring hostname values, nonboolean values, and unknown surfaces before dispatch, but accepts any string hostname for semantic validation inside the sole writer. For example, both `{ type: SET_SITE_ENABLED_MESSAGE, hostname: "EXAMPLE.TEST", enabled: false, surface: "popup" }` and its `surface: "sites"` counterpart are dispatched once and receive exactly one surface-specific `invalid-hostname` response with the authoritative unchanged model. Neither invalid intent performs a storage write or runtime reconciliation.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/settings/snapshot.ts` | Modify | Strict V2 snapshot, safe canonical hostname validation, own-property site map, default empty preferences |
| `src/settings/settings-service.ts` | Modify | Sole serialized global/site writer, latest-snapshot merge, explicit enabled retention, typed invalid-host/write failures |
| `src/runtime/adapter-activation.ts` | Modify | Exact adapter hostname metadata, per-adapter effective policy, affected-host scoping, adapter-attributed query failures |
| `src/runtime/register-github.ts` | Modify | Declare built-in exact GitHub hostname without changing registration patterns or matching semantics |
| `src/background/application.ts` | Modify | Shared global/site transaction queue, scoped reconciliation merge, no-effect persistence, host-aware popup state, authoritative Sites view |
| `src/background/messages.ts` | Modify | Strict site/list messages, V2-aware popup/site response guards, surface-specific state contracts |
| `src/background/chrome.ts` | Modify | Synchronously dispatch new read/site intents and preserve one deferred response per request |
| `src/popup/client.ts` | Modify | Site-intent transport with popup-specific typed response guards and ambiguous reread |
| `src/popup/app.tsx` | Modify | English exact-host switch, disabled-site status, global-off editing, inaccessible suppression, local Settings link |
| `src/popup/styles.css` | Modify | Minimal layout for the additional popup control and Settings link |
| `src/options/client.ts` | Create | Typed Sites read/write transport, revision-safe ambiguous reread, no direct storage access |
| `src/options/app.tsx` | Create | English Sites list, built-in/explicit exact-host switches, global-off notice, truthful save/unavailable states |
| `src/options/main.tsx` | Create | Mantine/React Options mount and bundled local styles |
| `src/options/options.html` | Create | External-only local Options HTML with root, `options.css`, and `options.js` |
| `src/options/styles.css` | Create | Bounded extension-local Options presentation |
| `src/manifest/common.json` | Modify | Register extension-local `options_ui` while preserving popup, scripting/storage permissions, and `<all_urls>` |
| `rspack.config.mjs` | Modify | Compile Options TSX/CSS and watch/emit Options HTML in the same metadata compilation |
| `scripts/build/artifacts.mjs` | Modify | Validate manifest Options reference and apply the existing local-only CSP document policy to both extension surfaces |
| `tests/settings/snapshot.test.ts` | Create | Public V2 parser/default/canonical-host/own-property validation behavior |
| `tests/settings/settings-service.test.ts` | Modify | Explicit-only persistence, exact-host independence, V2 restart, latest-snapshot merge, failed/invalid write preservation |
| `tests/runtime/register-github.test.ts` | Modify | Built-in generic hostname metadata and unchanged exact GitHub registration behavior |
| `tests/runtime/adapter-activation.test.ts` | Modify | Per-adapter effective policy, scoped generic reconciliation, global override, frame-zero behavior, adapter-attributed failures |
| `tests/background/application.test.ts` | Modify | Mixed global/site serialization, no-effect edits, restart, Sites rows/privacy, precedence, current failure preservation/recovery |
| `tests/background/messages.test.ts` | Create | Public request/state/response guard matrices for exact site intents and surface-specific models |
| `tests/popup/app.test.tsx` | Modify | Adapter/no-adapter host controls, disabled status, off-state editing, restricted-page omission, exact site failures/rereads |
| `tests/options/app.test.tsx` | Create | Built-in/explicit row behavior, retained enabled rows, exact-host independence, global-off editing, save/reread/unavailable states |
| `tests/build/chrome-artifact.test.ts` | Modify | V2 emitted background site/list dispatch, cross-browser Options manifest/CSP boot, local-only resource rejection, unchanged ZIP parity |
| `tests/build/watch.test.ts` | Modify | Maintained Options TSX/CSS/HTML watch generations and exact unpacked/ZIP bytes |

## Tasks

### [x] Task 1: Define the strict unpublished V2 snapshot and canonical exact-host contract

**Files:**

- Create: `tests/settings/snapshot.test.ts`
- Modify: `src/settings/snapshot.ts`
- Modify: `src/settings/settings-service.ts`
- Modify: `src/background/application.ts`

- [x] **Step 1: Write failing public snapshot tests.** Assert the exact V2 default has an empty preference map and table-drive canonical stored keys: `example.test`, `xn--bcher-kva.example`, `127.0.0.1`, `[::1]`, `localhost`, `example.test.`, own `__proto__`, own `constructor`, and lowercase `tostring`. Assert `example.test.` remains distinct from `example.test`, and reject `example.test..`. Reject raw `EXAMPLE.TEST`, raw `bücher.example`, mixed-case `toString`, `example.test:443`, unbracketed/noncanonical IPv6, schemes, paths, credentials, wildcards, queries, fragments, whitespace, malformed hosts, missing/extra fields, invalid revisions, nonboolean values, arrays/null maps, inherited values, and the old V1 object. Assert own `__proto__`/`constructor` entries remain boolean data entries and do not change an unrelated object's prototype.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts'`; expect the current V1 default/parser and missing hostname validator to fail.
- [x] **Step 3: Implement only the V2 snapshot boundary.** Set schema version 2, rename the public snapshot type/guard to V2, require exactly four own document fields, copy site entries through safe own-property operations, and add one canonical hostname guard based on equality with `URL.hostname`, canonical bracketed IPv6, and at most one preserved trailing dot. Reject raw uppercase/Unicode/intent ports and mixed-case `toString` while safely accepting lowercase own `__proto__`, `constructor`, and `tostring`. Freeze/default an empty map, retain missing-only default/fail-closed behavior, update existing settings/background TypeScript type imports, and let snapshot construction carry an explicit preference map.
- [x] **Step 4: Re-run the focused green gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts'`; expect every public parser and hostname case to pass.

**Verification**: V1 data is not silently migrated or defaulted; the only valid persisted shape is one complete V2 document with safe canonical own hostname keys.

### [x] Task 2: Persist only explicit exact-host intent without losing concurrent global fields

**Files:**

- Modify: `tests/settings/settings-service.test.ts`
- Modify: `src/settings/settings-service.ts`

- [x] **Step 1: Write failing Settings Service behavior tests.** Convert existing valid seeds/expected snapshots to V2 with `sitePreferences: {}`. Assert missing-storage loads and read-only calls never invoke `storage.set`; absent host defaults enabled; first explicit `true` and `false` each write one retained exact key; repeated equal explicit values do not write. Independently persist `example.test`, `sub.example.test`, `sibling.example.test`, and `example.test.`, then assert `example.test..` and `example.test:443` return typed invalid-hostname without a write. Persist canonical `xn--bcher-kva.example`, `[::1]`, own `__proto__`, and own `constructor`; reject raw Unicode, uppercase, and mixed-case `toString`; prove inherited prototype values never count as preferences and unrelated prototypes remain unchanged. Assert global mutation preserves all entries, site mutation preserves the latest global flag, and a new service instance reloads every explicit key. Add deferred overlapping global/site service intents, nonboolean cases, revision overflow, and rejected writes; assert latest valid document and runtime-facing snapshot remain unchanged on failure.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts'`; expect missing `setSiteEnabled`, dropped site fields, and unhandled explicit-true persistence.
- [x] **Step 3: Implement one serialized mutation path.** Reuse the existing service mutation tail and latest storage load for both operations, validate canonical hostname and boolean before replacing the document, use own-key presence to distinguish absent/default from an explicitly enabled entry, copy and preserve all unrelated fields, validate safe next revision, persist before publishing, and return typed invalid-hostname/persistence outcomes. Do not add a storage key, migration, backup, browsing hook, or UI writer.
- [x] **Step 4: Re-run the focused green gate.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts'`; expect exact-host persistence, no-op writes, restart, concurrency, and failure cases to pass.

**Verification**: One document and one writer preserve every accepted explicit/global field; passive reads store nothing and explicit enabled entries remain durable.

### [x] Task 3: Reconcile generic adapters from exact-host effective policy

**Files:**

- Modify: `tests/runtime/register-github.test.ts`
- Modify: `tests/runtime/adapter-activation.test.ts`
- Modify: `src/runtime/register-github.ts`
- Modify: `src/runtime/adapter-activation.ts`

- [x] **Step 1: Write failing public coordinator tests.** Add exact `hostname` metadata to GitHub and injected synthetic definitions. Exercise two independently matched synthetic adapters: default-enabled registration/injection, one exact disabled adapter unregister/restore with the other untouched, exact reenable/register/inject, parent/subdomain independence, globally disabled cleanup regardless of per-host true, cold-worker behavior with disabled exact policy, affected-host scoping, and adapter-attributed matching-query/registration/tab failures. Preserve exact `{ allFrames: false }`, `{ frameId: 0 }`, sibling continuation, stopped-runtime skip, and failed-closed cleanup.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts'`; expect absent hostname metadata and global-only activation behavior to fail.
- [x] **Step 3: Implement generic adapter policy.** Add one exact `hostname` to the adapter definition and GitHub production definition. Accept complete site preferences and optional affected hostnames, compute own-key exact policy per definition, scope site-induced work without hardcoding GitHub, and attach the definition ID to matching-tab-query errors. Keep the existing registration matcher/spec, URL reselection, modes, top-frame fan-out, failure isolation, and fail-closed semantics.
- [x] **Step 4: Re-run the focused green gate.** Run `zsh -lic 'pnpm exec vitest run tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/runtime/messages.test.ts tests/content/runtime.test.ts'`; expect existing and new observable coordinator contracts to pass.

**Verification**: Built-in and injected adapters share one exact-host policy algorithm; no non-adapter hostname receives registration or DOM execution.

### [x] Task 4: Add authoritative host-aware popup and privacy-preserving Sites read models

**Files:**

- Modify: `tests/background/application.test.ts`
- Modify: `src/background/application.ts`

- [x] **Step 1: Write failing background read-model tests.** Convert all maintained V1 seeds and adapter definitions to V2/exact hostname. Table-drive URL-to-popup identity: `https://EXAMPLE.TEST:8443/a` and `http://example.test:80/b` share `example.test`; Unicode `https://bücher.example/` and punycode `https://xn--bcher-kva.example/` share `xn--bcher-kva.example`; `https://[::1]:8443/a` uses `[::1]`; `https://example.test./` uses exact distinct `example.test.`; `https://github.com./` has no GitHub adapter. Assert parent/subdomain/sibling/trailing-dot rows stay independent, own `__proto__`/`constructor` keys do not inherit, popup states contain `siteEnabled`/`hasAdapter`, and no-adapter reads never store hostnames. Verify the complete precedence matrix: current-adapter unregister, matching-query, or current-tab teardown failure under global-off yields `runtime-failed`; a failure belonging to a different adapter under global-off yields clean `global-disabled`; only a failure-free current adapter says `Extension is off`; global-off then outranks site/no-rules. Inaccessible/malformed pages have null site control. Assert `getSitesState()` returns `github.com` even with empty storage, deduplicates/sorts built-in plus only explicit keys, retains explicit `true`, does not query the active tab or write storage, and exposes a fail-closed unavailable model.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/background/application.test.ts tests/settings/settings-service.test.ts'`; expect missing host fields, Sites state, and global/site precedence.
- [x] **Step 3: Implement read-only projections.** Derive the identity exactly from parsed HTTP/HTTPS `URL.hostname`, so URL case/Unicode normalize, URL ports disappear, bracketed IPv6 stays canonical, and one trailing dot remains distinct. Derive exact own-key policy and adapter availability from snapshot plus runtime definitions; add `site-disabled`; apply relevant-current-adapter failure before clean global-off, isolating failures for other adapters; preserve document status checks. Implement queued readiness-gated `getSitesState()` from built-in/explicit union only and feed full site preferences to initialization/lifecycle reconciliation without touching storage during projection.
- [x] **Step 4: Re-run the focused gate.** Run `zsh -lic 'pnpm exec vitest run tests/background/application.test.ts tests/settings/settings-service.test.ts tests/runtime/adapter-activation.test.ts'`; expect host/status/list/privacy and predecessor lifecycle behavior to pass.

**Verification**: Ordinary browsing never creates a preference; Options always includes the built-in exact host and popup accurately distinguishes unavailable, off, disabled, active, and no-rules states.

### [x] Task 5: Serialize site writes and reconcile only changed effective adapter policy

**Files:**

- Modify: `tests/background/application.test.ts`
- Modify: `src/background/application.ts`

- [x] **Step 1: Write failing end-to-end background transaction tests.** Use the real activation coordinator, mutable phases, persistent registration, and several matching tabs. Disable then reenable `github.com`, asserting exact V2 entries, unregister/frame-0 restoration, `document_start` registration/top-frame injection, and retained enabled row. Interleave a deferred global toggle with popup/options site actions and assert accepted revisions, latest-state response barriers, no lost global/site fields, final registration/tab phases, and no overlapping reconciliation. Seed current-GitHub unregister, matching-query, and current-tab teardown failures separately under committed global-off and assert `runtime-failed`; seed only another adapter's failure and assert `global-disabled`. While global-off and a relevant GitHub cleanup failure remains, edit `example.test`; assert the explicit site persists and popup still reports the original GitHub `runtime-failed` with zero additional coordinator calls, registrations, injections, unregisters, teardowns, or matching-tab queries. Assert similarly zero runtime operations for clean no-adapter writes, first explicit-effective true, and other globally off site writes; enabling global later respects persisted exact GitHub policy. Recreate a cold worker over disabled/enabled site snapshots; cover typed save/invalid-host failures and preserve a different synthetic adapter's unresolved failure across scoped reconciliation.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/background/application.test.ts tests/runtime/adapter-activation.test.ts'`; expect absent queued site mutation, effective-policy diff, scoped failure merge, and surface-specific response barriers.
- [x] **Step 3: Implement the queued site transaction.** Add `setSiteEnabled(hostname, enabled, surface)` to the same readiness/lifecycle/transaction queue as global writes; perform semantic canonical-host validation in the sole writer and return the selected surface's typed unchanged `invalid-hostname` result without storage or runtime work. Compare prior/new effective policy for matching adapter hostnames; perform scoped runtime work only for changed adapter policy or an existing matching failure requiring recovery while global is enabled. When global is off or no adapter is affected, publish the new revision while retaining the same current-adapter cleanup failure and perform no runtime operation. Merge scoped adapter results without erasing unrelated failures, derive the requested authoritative popup/Sites model behind a read barrier, and retain typed save/fail-closed behavior.
- [x] **Step 4: Re-run focused regression gates.** Run `zsh -lic 'pnpm exec vitest run tests/background/application.test.ts tests/settings/settings-service.test.ts tests/runtime/adapter-activation.test.ts tests/content/runtime.test.ts tests/integration/document-ownership.test.ts'`; expect immediate restoration/reenable, concurrency, cold restart, inactive edits, failure retention, and predecessor ownership behavior to pass.

**Verification**: A persisted site policy and registration/tab state cannot diverge after a completed transaction; global-off and no-adapter edits have no runtime activation side effects.

### [x] Task 6: Validate strict site/Sites messages and wire the single-response MV3 listener

**Files:**

- Create: `tests/background/messages.test.ts`
- Modify: `tests/background/application.test.ts`
- Modify: `src/background/messages.ts`
- Modify: `src/background/chrome.ts`

- [x] **Step 1: Write failing public message/response guard tests.** Assert the envelope guard accepts any **string** hostname when the message has exactly the correct type, boolean `enabled`, and `popup`/`sites` surface; structurally reject missing/extra fields, nonstring hostname, nonboolean enabled, and unknown surface. Pass otherwise well-shaped invalid raw uppercase, raw Unicode, `example.test:443`, full-URL, `example.test..`, and mixed-case `toString` messages through the actual registered MV3 listener for **both** surfaces after readiness: assert the listener returns `true`, invokes its response callback exactly once, and supplies `{ ok: false, error: "invalid-hostname", surface, state }` with the matching unchanged authoritative popup/Sites state, zero new `storage.set` calls, and zero coordinator/registration/injection/teardown work. Cover ready/unavailable Sites and popup models, accepted/typed-rejected responses, invalid revisions, and malformed mixed-surface responses. Extend deferred readiness tests with early valid Sites read/site-write messages and exactly one authoritative response per request.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/background/messages.test.ts tests/background/application.test.ts'`; expect missing public guards and site/list dispatch.
- [x] **Step 3: Implement structural dispatch plus semantic writer validation.** Extend existing constants/unions with an exact field/type/surface envelope guard that deliberately does not call `isCanonicalHostname`; update strict popup/Sites/site-response model validators; synchronously register new listener branches that dispatch every structurally valid site message to the queued background writer. There the existing canonical validator returns one surface-specific typed `invalid-hostname` response before any write/reconciliation. Return `true` for valid envelopes, preserve the listener's exactly-once callback guard, reject malformed envelopes, and keep one readiness flight, unavailable host fields, existing global paths, and no automatic navigation.
- [x] **Step 4: Re-run focused gates.** Run `zsh -lic 'pnpm exec vitest run tests/background/messages.test.ts tests/background/application.test.ts tests/runtime/messages.test.ts'`; expect strict schemas, same readiness gating, and one response for every accepted message.

**Verification**: A structurally valid but semantically invalid hostname reaches the real listener/writer, receives exactly one correctly surfaced typed response, and causes zero writes/runtime operations; malformed envelopes remain undispatched.

### [x] Task 7: Make the popup exact-host switch usable and truthful on every accessible site

**Files:**

- Modify: `tests/popup/app.test.tsx`
- Modify: `src/popup/client.ts`
- Modify: `src/popup/app.tsx`
- Modify: `src/popup/styles.css`

- [x] **Step 1: Write failing rendered-popup interaction tests.** Replace outdated predecessor assertions forbidding site/options controls while preserving no counter, no report action, and no page UI. Assert separate accessible `Global enabled` and exact-host switch names, checked default GitHub/no-adapter states, `Rules are not available for example.test yet`, exact `Disabled on example.test`, canonical lowercase/punycode/bracketed-IPv6 labels, independently retained `example.test.`/undotted/parent/subdomain/sibling states, and an extension-local Settings link. Render current-GitHub unregister, matching-query, and teardown failures with `globalEnabled: false` and assert `Could not process this page`, never `Extension is off`; render an unrelated-adapter failure/clean current host with global-off and assert exactly `Extension is off`. Verify a globally off site edit that retains relevant failure still renders the failure while its switch remains operable. Distinguish a real listener-delivered typed `invalid-hostname` response (authoritative state retained; actionable validation notice; no ambiguous reread) from an actually lost response (popup reread/unknown behavior). Cover save rejection, lower revisions, restricted/unavailable pages, and double transport failure.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/popup/app.test.tsx tests/background/messages.test.ts'`; expect missing site control, Settings link, site response handling, and disabled-site wording.
- [x] **Step 3: Implement popup-specific site intent.** Extend the existing client with structurally valid `surface: "popup"` site requests, an actionable typed `invalid-hostname` notice that does not trigger an ambiguous reread, and popup-state reread only after genuinely rejected/malformed transport responses. Render the current canonical `URL.hostname` switch only when a ready accessible host exists; keep it usable regardless of global checked state; render `runtime-failed` ahead of global-off exactly as supplied by background. Add exact English disabled/no-rules text and an extension-local Settings anchor; reuse revision gating, native mixed switch behavior, loading state, and no direct storage/browser DOM processing.
- [x] **Step 4: Re-run focused gates.** Run `zsh -lic 'pnpm exec vitest run tests/popup/app.test.tsx tests/background/messages.test.ts tests/background/application.test.ts'`; expect all global/site states, save handling, and prior popup transport guarantees to pass.

**Verification**: Both adapter and no-adapter HTTP/HTTPS hostnames have a usable exact-host preference; restricted pages cannot imply a setting was applied.

### [x] Task 8: Render only built-in and explicitly retained Sites rows in Options

**Files:**

- Create: `tests/options/app.test.tsx`
- Create: `src/options/client.ts`
- Create: `src/options/app.tsx`

- [x] **Step 1: Write failing rendered Options tests.** Start with a background-provided ready Sites state containing only default `github.com` and assert a `Sites` heading plus one checked exact-host row. Add disabled/reenabled explicit adapter and no-adapter rows, deterministic parent/subdomain/sibling/trailing-dot independence, canonical punycode/IPv6/safe own-key labels, persistent explicit-true rows, and globally off notice with still-usable switches. Deliver a real structurally valid invalid-hostname intent through the listener/transport and assert exactly one `surface: "sites"` typed `invalid-hostname` response, unchanged authoritative Sites rows, an actionable validation notice, and no ambiguous reread; separately exercise genuine transport loss/reread, typed save failure, latest-revision gating, double-failure unavailable state, and failed-closed controls. Assert Options never accesses storage or creates visit rows.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/options/app.test.tsx tests/background/application.test.ts'`; expect absent Options modules and Sites interaction.
- [x] **Step 3: Implement one narrow Sites surface.** Build a typed Options client with `get-sites-state`, structurally valid `surface: "sites"` writes, an authoritative `invalid-hostname` notice without reread, own-surface reread only for genuinely ambiguous responses, and nondecreasing revisions. Render a Mantine English `Sites` section, exact canonical hostname labels/switches, global-off explanatory notice, authoritative save errors, and unavailable state. Keep built-in rows and explicit enabled entries supplied by background projection; add no format, time-zone, report, debug, export, reset, counter, or page controls.
- [x] **Step 4: Re-run focused UI gates.** Run `zsh -lic 'pnpm exec vitest run tests/options/app.test.tsx tests/popup/app.test.tsx tests/background/messages.test.ts tests/background/application.test.ts'`; expect both intent surfaces and all privacy/status/error behaviors to pass.

**Verification**: Sites consists solely of declared built-in adapter hosts and explicit retained exact-host entries, and edits remain available when global processing is off.

### [x] Task 9: Package a local-only Options page without weakening manifest or artifact validation

**Files:**

- Modify: `tests/build/chrome-artifact.test.ts`
- Create: `src/options/main.tsx`
- Create: `src/options/options.html`
- Create: `src/options/styles.css`
- Modify: `src/manifest/common.json`
- Modify: `rspack.config.mjs`
- Modify: `scripts/build/artifacts.mjs`

- [x] **Step 1: Write failing observable artifact tests.** For Chrome, Firefox, and Edge in both development and release modes, parse emitted manifests and require `options_ui.page === "options.html"`, `open_in_tab === true`, unchanged `scripting`/`storage` permissions, `<all_urls>` host permission, and existing popup. Require unpacked/ZIP `options.html`, `options.js`, and `options.css`; parse the emitted document for extension-local external resources and reject inline scripts/styles/handlers, remote/protocol-relative/data/blob/javascript references, missing references, and ZIP mismatches through the public artifact validator.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts'`; expect missing Options manifest metadata and emitted assets.
- [x] **Step 3: Implement the minimum packaged surface.** Add a local Mantine/React mount, external-only HTML, bounded Options CSS, common `options_ui`, an Options Rspack entry, and watched same-compilation HTML emission. Extend the existing artifact validator to validate both popup and Options documents through shared local-reference/CSP rules while preserving every browser variant, deterministic archive, selected publication, and existing popup resource.
- [x] **Step 4: Re-run artifact gates.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/build/commands.test.ts'`; expect browser/mode manifests, local resources, exact ZIP parity, existing public commands, and unchanged permission boundaries to pass.

**Verification**: Every supported unpacked/ZIP artifact contains an installable extension-local Options page without adding permissions, remote code, inline executable markup, or an automatic options launch.

### [x] Task 10: Prove emitted Options/popup behavior and V2 site messages under local CSP constraints

**Files:**

- Modify: `tests/build/chrome-artifact.test.ts`
- Modify: `src/background/chrome.ts`
- Modify: `src/background/messages.ts`

- [x] **Step 1: Write failing emitted-bundle behavior checks.** Convert every maintained emitted-background valid storage seed to exact V2 while retaining invalid-schema fail-closed coverage. For each browser/mode, fire deferred popup read/global write, early Sites read, and both surface-specific site writes while startup/install events are coalesced; track one callback per request, complete accepted revisions, persisted exact host entries, unchanged no-adapter runtime, GitHub unregister/teardown/register/injection, and retained V2 state. After readiness, send an otherwise well-shaped invalid hostname separately for `popup` and `sites`; assert both listener branches return `true`, each callback fires exactly once with its own typed `invalid-hostname`/authoritative state, and persistence/coordinator operation counts do not change. Boot both emitted `popup.js` and `options.js` from parsed HTML inside the existing VM with string/Wasm code generation disabled and fake background responses; assert the popup global/site controls and Options `Sites`/`github.com` row actually render.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/popup/app.test.tsx tests/options/app.test.tsx'`; expect any unconverted V1 seed, malformed new response, or unhandled emitted site message to fail observably.
- [x] **Step 3: Complete only emitted-boundary integration.** Correct surface-specific fallback responses, strict state guards, V2 fake/runtime message sequencing, and initialization ordering as required by emitted browser bundles. Preserve the existing cold-worker no-reinjection, disabled restart, invalid-storage unregister/teardown, popup CSP, single-response, and no-onboarding checks.
- [x] **Step 4: Re-run emitted and control gates.** Run `zsh -lic 'pnpm exec vitest run tests/build/chrome-artifact.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/popup/app.test.tsx tests/options/app.test.tsx'`; expect both extension documents and every supported emitted background to pass with dynamic code generation disabled.

**Verification**: Local executable-artifact behavior proves the new control paths without claiming real-browser compatibility or using browser automation/UI.

### [x] Task 11: Preserve selected-target watch and ZIP parity for all new maintained Options inputs

**Files:**

- Modify: `tests/build/watch.test.ts`
- Modify: `rspack.config.mjs`

- [x] **Step 1: Write failing public watch behavior checks.** Extend the existing representative isolated Chrome session to mutate Options TSX, CSS, and HTML immediately after preceding successful generations. For each mutation assert a strictly later success, changed selected unpacked artifact and ZIP, the corresponding externally emitted marker in `options.js`/`options.css`/`options.html`, exact archived bytes, a valid artifact pair, and byte-identical unselected browser/mode pairs. Keep the predecessor popup TSX/CSS/HTML, selected-source, metadata, icon, failure retention, cleanup, and rapid-coalescing cases intact.
- [x] **Step 2: Run the focused red gate.** Run `zsh -lic 'pnpm exec vitest run tests/build/watch.test.ts'`; expect any untracked Options HTML dependency or TSX/CSS generation gap to fail.
- [x] **Step 3: Complete maintained compilation dependencies.** Ensure Options HTML is registered in the same compilation file-dependency list as popup HTML, and Options TSX/CSS are reachable through the Rspack entry graph. Do not change watch re-arm timing, synchronous candidate publication, exact-PID cleanup, artifact safety, or launch behavior.
- [x] **Step 4: Re-run focused build gates.** Run `zsh -lic 'pnpm exec vitest run tests/build/watch.test.ts tests/build/chrome-artifact.test.ts tests/build/commands.test.ts'`; expect existing and new maintained-input generations, safe publication, and complete ZIP parity to pass.

**Verification**: Options source changes rebuild only the requested target and publish matching unpacked/ZIP bytes; no process-tree utility or browser launch is introduced.

### [x] Task 12: Run complete direct-pnpm behavioral, type, lint, and six-artifact gates

**Files:**

- No planned production files

- [x] **Step 1: Run the complete settings/runtime/control regression.** Run `zsh -lic 'pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/popup/app.test.tsx tests/options/app.test.tsx tests/integration/document-ownership.test.ts'`; expect exact-host persistence, generic effective policy, teardown/restart, latest revision models, privacy, failed-close, and predecessor restoration to pass.
- [x] **Step 2: Run the complete repository quality gate.** Run `zsh -lic 'pnpm check'`; expect ESLint, strict TypeScript, and every maintained unit/integration/build/watch test to pass without implementation-source-text assertions.
- [x] **Step 3: Build all browser development artifacts.** Run `zsh -lic 'pnpm dev'`; expect separate valid Chrome, Firefox, and Edge directories/ZIPs with both extension-local UI documents.
- [x] **Step 4: Build all browser release artifacts.** Run `zsh -lic 'pnpm release'`; expect separate valid Chrome, Firefox, and Edge release directories/ZIPs with identical unpacked/archive inventories and unchanged host/API permissions.
- [x] **Step 5: Run the final standalone lint gate.** Run `zsh -lic 'pnpm lint'`; expect no remaining source, configuration, or test lint violations.

**Verification**: All validation uses the existing Node 24 login-shell environment and direct pnpm; no Git, Corepack, browser automation/UI, website, network, external process-tree command, utility-provenance test, source-text assertion, or downstream feature is added.

## Acceptance Coverage

| Acceptance criterion | Planned observable evidence |
| --- | --- |
| 1. Disabling exact `github.com` persists the preference, restores current tabs, and stops future documents | Tasks 2-5 and 10: V2 explicit false, generic effective policy, removed exact registration, frame-0 teardown across matching existing tabs, deferred transaction convergence, emitted-background dispatch |
| 2. Reenabling exact `github.com` immediately processes existing tabs and retains its Sites row | Tasks 2-5 and 8-10: persistent own `"github.com": true`, exact `document_start` re-registration, top-frame one-shot injection, stable built-in/explicit row after response and restart |
| 3. No-adapter hostname switch remains usable with exact neutral wording | Tasks 4, 5, 7, 8, and 10: accessible popup `siteEnabled`, `hasAdapter: false`, `Rules are not available for example.test yet`, successful explicit persistence, and zero coordinator/DOM operations |
| 4. Parent, subdomain, and sibling preferences never inherit | Tasks 1-5, 7, and 8: one canonical `URL.hostname` identity across uppercase/IDN URLs, HTTP/HTTPS URL ports, IPv6, distinct trailing dots, safe own prototype-like keys, exact parent/subdomain/sibling values, and corresponding independent UI rows |
| 5. Passive browsing stores no visited hostname and `github.com` is always listed | Tasks 2, 4, 7, and 8: missing/default read performs zero writes, no-adapter popup read does not create an entry, Sites projection unions built-in exact host with explicit keys only |
| 6. Globally disabled site edits persist without runtime activation | Tasks 3-5, 7, 8, and 10: global false overrides per-site true, popup/Options switches remain editable, accepted revision and site map persist, existing relevant cleanup failures remain visible, unrelated failures stay isolated, and registration/injection/teardown/matching-tab queries do not run until a later global enable |

## Constraint Coverage

| Constraint | Planned enforcement |
| --- | --- |
| One background-owned versioned settings document | Tasks 1, 2, 5, and 6 use only the existing `settings` storage key and the sole background-owned Settings Service |
| No pre-public compatibility promise | Task 1 bumps explicitly to V2; an old unpublished V1 snapshot is rejected/fail-closed without migration or silent defaults |
| Full transaction serialization and truthful responses | Tasks 5-8 and 10 preserve deferred queue barriers, accepted revisions, structural-only hostname dispatch, exactly-one surface-specific typed invalid-host rejection with zero writes/runtime work, scoped failure retention before global-off status, genuine-only ambiguous rereads, and unavailable states |
| Generic adapter architecture | Tasks 3-5 derive effective policy and built-in rows from injected adapter hostname metadata; GitHub selectors/parsing remain untouched |
| MV3 initialization and fail-closed behavior | Tasks 4-6 and 10 keep one readiness flight, lifecycle coalescing, exact top-frame actions, invalid-schema cleanup, and exactly-one response |
| Cross-browser CSP, ZIP, publication, and watch behavior | Tasks 9-12 validate all six emitted artifact pairs, local-only documents, disabled-code-generation boots, selected publication, and Options TSX/CSS/HTML watch generations |
| Privacy and user-visible scope | Tasks 2, 4, 7, and 8 prohibit passive host persistence, URLs/page data, counters, host-page UI, reporting, display settings, diagnostics, reset, and additional permissions; URL ports/case/Unicode are used only for ephemeral canonical hostname derivation |
| Direct local observable verification only | Every command uses login-shell direct pnpm and behavior/artifact assertions; live browser/network/Git/Corepack/process-tree/provenance operations remain excluded |

## Review Attempt 1 Finding Disposition

| Rejected finding | Concrete resolution | Behavioral coverage |
| --- | --- | --- |
| Typed `invalid-hostname` was unreachable because the request guard rejected it before dispatch | The `SetSiteEnabledMessage` envelope guard accepts any string hostname with exact fields/types/surface; semantic canonical validation happens only in the sole background writer. The real MV3 listener returns `true`, sends exactly one correctly surfaced typed rejection with the unchanged authoritative model, and performs no write/runtime work. | Contracts; Research / Full transaction queue; Tasks 5-8 and 10 explicitly drive invalid messages for both popup and Sites through the registered/emitted listener, distinguish typed errors from genuine response loss, and assert callback/operation counts. |
| Canonical hostname identity omitted URL normalization, trailing dots, and contradictory special-key behavior | One shared identity is canonical HTTP/HTTPS `URL.hostname`: URL case/Unicode normalize to lowercase/punycode, URL ports/scheme disappear, canonical bracketed IPv6 is preserved, one trailing dot is retained as a separate exact identity and two are rejected. Intent/storage keys must already be canonical; own lowercase `__proto__`/`constructor`/`tostring` are safe; mixed-case `toString` is rejected. | Research / Explicit unpublished schema; Entities / Exact Site Preference; Tasks 1, 2, 4, 7, and 8 table-drive parser, writer, URL-to-popup state, independent Sites rows, prototype safety, and parent/subdomain/sibling/trailing-dot noninheritance. |
| Global-off status contradicted truthful unresolved cleanup failures | Status order is relevant current-adapter registration/unregister/query/current-tab teardown failure first, then clean global-off, then site-disabled/no-rules/active. Unrelated adapter failures stay isolated; an inactive site edit preserves a relevant existing failure without runtime activation. | Research / Full transaction queue; Entities / Host-Aware Popup State; Tasks 4, 5, and 7 exercise current-vs-unrelated failures under global-off, exact rendered status, retained failure after a globally off site edit, and zero new runtime calls. |

## Self-Review

- All six issue acceptance criteria map to concrete failing behavior tests before implementation and focused public/module/UI/artifact verification afterward.
- `6-AFK` is validated; its accepted-revision barriers, mutable multi-tab convergence, same-revision recovery, frame-zero contracts, fail-closed states, CSP popup, and maintained popup watch coverage are explicitly retained.
- The V2 document, canonical exact-host map, own-key explicit marker, typed write results, adapter hostname, scoped coordinator input, adapter-attributed failures, popup states, Sites states, message payloads, and surface-specific responses remain consistent across entities, contracts, tasks, and acceptance evidence.
- Structurally valid invalid-host intents reach the sole writer and receive one surfaced typed response; structural envelope failures remain undispatched; neither case creates a preference or starts runtime work.
- Tab URL case/Unicode/ports normalize to one canonical hostname; storage/intents reject noncanonical strings, canonical bracketed IPv6 is accepted, one trailing dot stays independent, safe own `__proto__`/`constructor` entries cannot alter prototypes, and mixed-case `toString` is rejected.
- Relevant current-adapter unregister/query/teardown failures outrank global-off; unrelated failures do not; a globally off site edit retains the existing relevant failure without activation.
- Missing storage remains enabled without a write; obsolete/corrupt stored schemas never silently activate defaults, and no unpublished-schema migration or backup/recovery feature is promised.
- Every positive and negative hostname behavior is verified through public parsers, service calls, fake browser APIs, rendered React controls, extension messages, emitted documents, artifact validators, or watch outputs rather than by asserting implementation text.
- Runtime work is excluded for no-adapter, no-effective-change, and globally disabled site edits; changed adapter policy alone causes scoped registration/top-frame injection or unregister/frame-zero restoration.
- Built-in hosts come from generic adapter metadata; explicit enabled entries remain until the separately owned reset slice; passive tab inspection never stores a hostname.
- Options includes only the Sites slice. Reporting, formats/time zones, custom patterns, diagnostics/export, backup/migration/recovery UI, reset, synthetic production adapters, and permissioned live browsers stay in their owning issues.
- Manifest API permissions, `<all_urls>` host permission, exact production GitHub registration, English-only UI, absence of counters/page UI, deterministic ZIP parity, and selected watch publication remain unchanged.
- No external network, website/browser UI, browser automation, Git operation, Corepack command, external process-tree utility, utility-provenance check, or implementation-source-text test is part of the plan.
- All three review-attempt-1 findings are resolved in the disposition matrix; the existing review report and issue `Reviewing` status remain untouched.
