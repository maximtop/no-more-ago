# Issue Validation Report: [no-more-ago] Manage exact-host site preferences

- **Validated**: 2026-08-25
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Issue**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/7-AFK/issue.md`
- **Plan**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/7-AFK/plan.md`
- **Validation attempt**: 2

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 12 | 0 | 0 | 12 |
| Acceptance Criteria | 6 | 0 | 0 | 6 |
| Entities | 5 | 0 | 0 | 5 |
| Contracts | 7 | 0 | 0 | 7 |
| Guidelines | 6 | 0 | 0 | 6 |

**Overall Status**: COMPLETE

All twelve approved tasks, six acceptance criteria, five entities, seven contracts, and applicable guidelines pass. Every attempt-1 finding is repaired with durable observable regressions: truthful first-invalid-popup and post-Options state, generic two-adapter isolation, real two-tab transitions, persisted disabled-site restart, mixed global/popup/Options barriers, inactive failure retention, and site-specific popup/Options transport/revision failures. Independent focused/full gates, six fresh artifacts, exact ZIP parity, CSP-constrained emitted dispatch, and final lint all pass.

## Task Status

- [x] **Task 1: Define the strict unpublished V2 snapshot and canonical exact-host contract** - PASS: public snapshot tests accept lowercase/punycode, IPv4, bracketed IPv6, localhost, one trailing dot, and safe own prototype-like keys; reject obsolete V1, uppercase/Unicode intent keys, repeated dots, ports, paths, wildcards, malformed maps, unsafe revisions, and extra fields.
- [x] **Task 2: Persist only explicit exact-host intent without losing concurrent global fields** - PASS: one background-owned document retains explicit `true`/`false`, independent parent/subdomain/sibling/dotted keys, safely preserves own `__proto__`/`constructor`, merges global/site fields, survives restart, rejects failed writes/revision overflow, and never persists missing defaults/passive visits.
- [x] **Task 3: Reconcile generic adapters from exact-host effective policy** - PASS: `tests/runtime/adapter-activation.test.ts:195` installs two synthetic adapters, disables only the selected exact hostname, preserves the sibling registration/tab, and re-registers/reinjects only that adapter using actual `sitePreferences` and `affectedHostnames`; global override, cold behavior, exact frames, and attributed failures pass.
- [x] **Task 4: Add authoritative host-aware popup and privacy-preserving Sites read models** - PASS: read models derive canonical HTTP/HTTPS identity, own-key policy, adapter availability, relevant failure precedence, sorted built-in/explicit Sites rows, and failed-closed state; independent six-bundle probes show an already-ready Sites read adds zero tab/runtime calls.
- [x] **Task 5: Serialize site writes and reconcile only changed effective adapter policy** - PASS: `tests/background/application.test.ts:246`, `:271`, `:295`, and `:323` exercise actual two-tab disable/reenable, persisted disabled-site restart, deferred mixed global/popup/Options accepted revisions `1/2/3` and latest response revision `3`, and globally inactive edits preserving the current teardown failure without runtime calls.
- [x] **Task 6: Validate strict site/Sites messages and wire the single-response MV3 listener** - PASS: structural guards accept invalid string hostname envelopes for semantic validation; application regressions at lines 423, 435, and 452 prove exact authoritative popup/Sites invalid-host states without a prior popup read and after Sites-only commits, with zero attributable writes, reconciliation, or tab/runtime operations.
- [x] **Task 7: Make the popup exact-host switch usable and truthful on every accessible site** - PASS: rendered controls retain exact hostname/status/no-adapter/local-Settings behavior; tests at `tests/popup/app.test.tsx:158`, `:179`, `:203`, `:224`, `:241`, and `:264` now cover site-specific typed save failure, ambiguous reread, double loss/mixed disabled switch, actual stale revision, globally off editing, and relevant failure precedence.
- [x] **Task 8: Render only built-in and explicitly retained Sites rows in Options** - PASS: rendered Options exposes only background-provided built-in/explicit exact rows, trailing dots/punycode, usable global-off switches, invalid-host notice, and failed-closed state; `tests/options/app.test.tsx:127`, `:147`, and `:164` add typed save-failure retention, double-loss row removal, and real lower-revision rejection.
- [x] **Task 9: Package a local-only Options page without weakening manifest or artifact validation** - PASS: every fresh browser/mode pair contains local external-only popup/Options documents, browser-correct background, `options_ui: { page: "options.html", open_in_tab: true }`, exactly `scripting`/`storage`, `<all_urls>`, version `0.1.0`, valid icons, and byte-identical ZIP contents.
- [x] **Task 10: Prove emitted Options/popup behavior and V2 site messages under local CSP constraints** - PASS: maintained six-browser emitted tests assert complete authoritative popup/Sites invalid-host states, exactly-once callbacks, unchanged writes/runtime calls, real site transitions, and code-generation-restricted document boots; an independent six-bundle VM probe verifies first-invalid-popup and post-Options revision `10` responses.
- [x] **Task 11: Preserve selected-target watch and ZIP parity for all new maintained Options inputs** - PASS: the full quality gate executes maintained popup/Options TSX/CSS/HTML watch generations, later selected-only output, exact ZIP parity, unchanged unselected artifacts, failure retention, coalescing, and safe cleanup.
- [x] **Task 12: Run complete direct-pnpm behavioral, type, lint, and six-artifact gates** - PASS: focused gate passes 11 files/140 tests; `pnpm check` passes lint, typecheck, and 23 files/364 tests; fresh all-target dev/release builds, independent six-pair ZIP/VM validation, and standalone lint pass.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Disabling exact `github.com` persists policy, immediately restores current tabs, and prevents future registration. | MET | Real coordinator test persists false, unregisters the exact script, and sends frame-zero teardown to both matching tabs; emitted browser tests confirm unregister/teardown. |
| 2 | Re-enabling `github.com` immediately processes open tabs and retains its Sites row. | MET | The real two-tab transition persists explicit true, restores early registration, reinjects both top frames, and returns the retained enabled built-in row. |
| 3 | A no-adapter hostname has a usable switch and neutral `Rules are not available for <hostname> yet` wording. | MET | Rendered popup drives `example.test` without unsupported-site wording; public and all-six-bundle checks persist its exact preference without activation. |
| 4 | Parent, subdomain, sibling, and other distinct exact hostnames do not inherit. | MET | Public parser/service tests independently retain `example.test`, `sub.example.test`, `sibling.example.test`, and `example.test.`, preserving canonical punycode/IPv6 and safe own prototype-like keys. |
| 5 | Ordinary browsing stores no hostname and built-in `github.com` always appears. | MET | Missing storage remains in-memory; six emitted first Sites reads return only built-in GitHub with zero writes/additional runtime calls; further rows require explicit retained intent. |
| 6 | Global-off site edits persist without runtime activation. | MET | Real global-off Sites edit preserves selected teardown uncertainty and unchanged reconcile/tab counters; mixed writes and both rendered controls remain operable without reactivation. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Settings Snapshot V2 | Exact version/revision/global/site-map shape | Sole local background-owned document | Strict V2 parser, missing-only default, own keys, safe revisions, V1 rejection, merged fields | PASS |
| Exact Site Preference | Canonical exact hostname and retained own boolean | Embedded snapshot entry projected into Sites and adapter policy | Punycode, bracketed IPv6, distinct trailing dot, explicit true, sibling independence, prototype safety | PASS |
| Runtime Adapter Policy | Generic adapter identity, exact hostname, registration and effective global/site policy | Per-adapter registration and matching-tab fan-out | Maintained two-adapter isolation, selected disable/reenable, two-tab restoration, cold restart, exact frames | PASS |
| Sites View State | Availability/revision/global value and deterministic built-in/explicit rows | Snapshot plus adapter metadata only | Retained rows, global-off editing, unavailable state, zero already-ready tab lookup, authoritative typed rejection | PASS |
| Host-Aware Popup State | Availability/revision/global state/hostname/site policy/adapter/status | Ephemeral active-tab projection consumed by popup/site responses | Truthful first-invalid-popup state, Sites-commit refresh, relevant failure precedence, revision gating | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| `SettingsSnapshotV2` / `SettingsService` | PASS | One strict validated document, canonical own-key mutation, explicit retention, serialized writes, typed rejection, and no pre-public V1 migration. |
| `RuntimeAdapterDefinition` / scoped activation reconciliation | PASS | Maintained two-adapter execution proves exact-host metadata, effective policy, selected scope, untouched sibling, frame-zero teardown, and top-frame injection. |
| `SitesState` / `getSitesState()` | PASS | Sorted built-in/explicit union, retained enabled entries, global-off/unavailable state, authoritative typed rejection, and zero additional tab lookup after readiness. |
| Ordinary `PopupState` / `getPopupState()` | PASS | Canonical active hostname, active/off/site-disabled/no-rules/inaccessible/failure states and adapter-attributed failure precedence. |
| Structural site/list message envelope | PASS | Exact shape/type/surface validation allows noncanonical string hostname through to typed semantic writer rejection; emitted callbacks occur exactly once. |
| `SetSiteEnabledResponse` authoritative state / revision barrier | PASS | All six bundles return full current-revision popup/Sites invalid-host states with no previous popup read and no attributable side effects; mixed accepted revisions return latest response revision. |
| Preserved predecessor global/runtime/build contracts | PASS | Full suite preserves single readiness flight, fail-closed cleanup, exact frame targeting, cold no-reinjection, ownership/restoration, CSP boot, browser artifacts, and watch/ZIP parity. |

No HTTP/OpenAPI/GraphQL contract, issue-local contract file, migration, backup, diagnostics, reset, reporting action, or live-browser capability belongs to this issue.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Test observable public/runtime behavior | COMPLIANT | Public parsers, services, coordinators, rendered controls, emitted listeners, parsed manifests, ZIP bytes, and public build commands; no implementation-source-text assertions. |
| Use direct pnpm and the Node 24 login-shell toolchain | COMPLIANT | All gates and independent VM probes use login-shell Node and direct pnpm; Corepack was not invoked. |
| No browser automation, website UI, network, or Git operations | COMPLIANT | Local jsdom/fake WebExtension runtimes and restricted VM only; no browser, network, Git, process-tree utility, or utility-provenance operation. |
| Preserve privacy and permission boundaries | COMPLIANT | No passive host history, page content, URL persistence, extra document/permission, remote code, synchronization, page UI, or counter. |
| Respect downstream issue ownership | COMPLIANT | Display/time-zone/custom-format, backup/migration/recovery UI, diagnostics, reporting, reset, production extra adapters, and live-browser work remain outside this slice. |
| Non-destructive issue validation | COMPLIANT | Implementation, tests, fixtures, package/build files, and approved plan remain unchanged; only this report and justified issue status change. |

No project-local `AGENTS.md` exists; supplied workspace rules, PRD decisions, approved Issue 7 plan, and validated predecessor contracts were applied.

## Verification Evidence

- Focused settings/runtime/control gate: `pnpm exec vitest run tests/settings/snapshot.test.ts tests/settings/settings-service.test.ts tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/runtime/messages.test.ts tests/content/runtime.test.ts tests/background/messages.test.ts tests/background/application.test.ts tests/popup/app.test.tsx tests/options/app.test.tsx tests/integration/document-ownership.test.ts` — **11 files / 140 tests passed**.
- Complete quality gate: `pnpm check` — ESLint, strict TypeScript, and **23 files / 364 tests passed**, including browser artifacts and maintained popup/Options watch inputs.
- Fresh development build: `pnpm dev` — Chrome, Firefox, and Edge successfully compiled, packaged, and published.
- Fresh release build: `pnpm release` — Chrome, Firefox, and Edge successfully compiled, packaged, and published.
- Final standalone lint: `pnpm lint` — passed.
- Independent six-pair semantic/ZIP validation: all browser/mode unpacked and ZIP inventories/bytes match; manifest version `0.1.0`, browser-appropriate background, both local UI documents, unchanged `scripting`/`storage` and `<all_urls>` permissions; development pairs each contain **19 files**, release pairs **13 files**.
- Independent six-bundle emitted VM: initial valid V2 revision `9`; first Sites read returns only `github.com` with zero additional tab/runtime calls; an explicit no-adapter Options edit commits revision `10`; otherwise-well-formed invalid popup and Sites intents each receive exactly one complete ready revision-10 response with zero additional writes, registrations, injections, teardowns, active-tab queries, or status calls.
- Bounded initialization tradeoff: each cold background seeds one ephemeral authoritative popup projection via exactly one active-tab lookup and one status query before UI messages. This creates no polling, storage writes, visited-host history, injection, or additional already-ready Sites lookup, preserves cold no-reinjection, and allows the first malformed-popup intent to return truthful state without attributable tab work.
- Durable finding-1 closure: `tests/background/application.test.ts:435` covers no previous popup read; `:452` covers current popup/Sites states following an Options-only commit; `tests/build/chrome-artifact.test.ts:171` asserts full surfaced states and side-effect counters across every browser/mode.
- Durable finding-2 closure: `tests/runtime/adapter-activation.test.ts:195` proves real two-adapter scoped behavior; `tests/background/application.test.ts:246`, `:271`, `:295`, and `:323` prove two-tab site transitions, disabled restart, three-surface transaction barriers, and inactive failure retention.
- Durable finding-3 closure: rendered popup tests at lines 158, 179, 203, 224, 241, and 264 exercise the correct site switch and all approved failure/revision/global-off paths; rendered Options tests at lines 127, 147, and 164 cover typed failure, double loss, and actual lower revision.

## Issues Found

None. All three validation-attempt-1 finding groups are repaired and independently verified through maintained observable behavior.

## Recommendations

- Mark `7-AFK` as `Validated` and continue with the next dependency-ready issue.
- Preserve the approved plan and existing direct-pnpm, privacy, cross-surface revision, bounded initialization, CSP, artifact, and watch contracts.
