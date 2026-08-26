# Implementation Plan: [no-more-ago] Report missing or broken site support

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/14-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Keep reporting simple and user-controlled: one public GitHub Site report template, one Popup site-report button, one Options Diagnostics issue button, no automatic submission/upload, and no new background service, permission, or stored browsing history.

## Summary

Create exactly one public GitHub issue-form template and one small reusable, injectable extension-UI reporting helper. An explicit Popup `Report this site` click obtains the real current HTTP(S) tab only at invocation time, validates it against authoritative Popup hostname/adapter state, and opens the `maximtop/no-more-ago` GitHub composer with the correct broken-site or new-site reason, editable current hostname/URL, trusted extension version, and coarse browser context. An explicit Options Diagnostics `Open GitHub issue` click opens the same editable composer with intentionally blank site fields because Options itself is an extension page. Both flows use existing `chrome.tabs.create`, keep private reports in their existing private window, surface safe actionable failures, and perform no navigation, data collection, upload, storage, or network work before a user click.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, React 19.2.8, ECMAScript 2022, Node 24, pnpm 10.34.5.
- **Primary Dependencies**: Existing Mantine, browser `URL`/`URLSearchParams`, WebExtension `tabs.query`/`tabs.create`, `runtime.getManifest`, and browser user-agent family detection; no added dependency.
- **Storage**: None for reporting; existing atomic V5 settings/backup and opt-in diagnostic journal remain untouched.
- **Testing**: Vitest 4, fake user-invoked browser tab APIs, parsed public composer URLs, rendered Popup/Options user-click tests, and all six emitted CSP-constrained extension artifacts.
- **Target Platform**: Manifest V3 Chrome, Edge, and Firefox development/release extensions and one repository-level GitHub issue-form template.

## Research

### Existing boundaries already supply safe site and browser context

The only blocker, Issue 7, is validated. `PopupState` already contains canonical exact `hostname`, `hasAdapter`, accessibility/runtime status, and global/site state; do not add or persist a page URL. The extension already has `<all_urls>` host access and existing browser tab APIs, while its manifest grants only `scripting`/`storage`; an extension-owned UI can query the active current-window tab and call `chrome.tabs.create` after explicit interaction without requesting a broad `tabs` permission. Trusted extension version comes from `chrome.runtime.getManifest().version`; coarse Chrome/Edge/Firefox context comes from browser runtime user-agent data rather than page-supplied content. A tiny local browser-interface type avoids modifying the shared activation `TabsRuntime` and its many fixtures.

For Popup, resolve `{ active: true, currentWindow: true }` only after the report click, require one valid HTTP(S) tab with an own canonical hostname matching the background-provided Popup state, reject credentials/restricted schemes/missing or mismatched context, and derive reason exclusively from `hasAdapter`. If the tab is private, require a valid `windowId` and create the composer in that same window so the selected private URL cannot escape to a regular browsing window. `global-disabled`, `site-disabled`, and ready `runtime-failed` statuses must still permit reporting when eligible HTTP(S) context is available. Missing tab/runtime/manifest context or rejected tab creation produces an actionable English notice and no fallback navigation or retry.

Options opens in its own extension tab, so querying its current tab would incorrectly leak a `chrome-extension://`/`moz-extension://` URL and make the feature unusable. Its `Open GitHub issue` action instead opens the same generic `Site report` template with blank editable `hostname`/`current_url` and an unselected editable reason, plus available trusted version/coarse browser context; it does not query or persist site history. Keep reporting independent of whether `Debug logs` is enabled and never inspect, upload, attach, or implicitly download an existing diagnostics ZIP.

### One real issue form and one public URL contract

Add exactly `.github/ISSUE_TEMPLATE/site-report.yml` with `name: Site report`, one reason dropdown containing `Add support for this site` and `Dates are not working correctly`, editable IDs `hostname`, `current_url`, `extension_version`, and `browser`, and separate `observed`/`expected` text areas with human-readable prompts. Build the fixed destination `https://github.com/maximtop/no-more-ago/issues/new` using the browser `URL` API and `URLSearchParams`, selecting `template=site-report.yml` and the matching form field IDs. Encode the user-selected full current site URL only during the explicit navigation, never accept a caller-controlled destination origin/path, never include DOM/page text/source timestamps/log contents or attachments, and never submit the form. Assert URL/template semantics through parsed public `URLSearchParams`; do not add YAML-parser dependencies, source-substring assertions, network checks, or tests of external utilities.

Issue 13 concurrently updates `src/options/app.tsx` and Options/reset tests; implementation must preserve its shared ready/recovery reset button, stale-notice handling, full-state defaults, and one-shot recovery while adding only the reporting control inside the existing Diagnostics section.

## Entities

### Editable GitHub site-report context

- **Fields**: Optional trusted `hostname: string`, user-selected current HTTP(S) `current_url: string`, `reason: "Add support for this site" | "Dates are not working correctly"`, trusted `extension_version: string`, coarse `browser: string`, and editable `observed`/`expected` issue-form fields.
- **Relationships**: Popup state and freshly queried active tab produce a site-specific context; Options produces an environment-only context with blank site fields; both reference the same public issue template.
- **Validation**: Exact fixed `https://github.com/maximtop/no-more-ago/issues/new` destination, `template=site-report.yml`, canonical matching HTTP(S) hostname, trusted manifest version, recognized browser family, percent-encoded user-selected URL, no embedded URL credentials, and no untrusted inherited values.
- **States**: idle/uncollected → explicit click → validated editable composer navigation, or typed actionable failure with no navigation; submission is always external and manual.

### Minimal user-invoked browser reporter

- **Fields**: Existing narrow `tabs.query`, `tabs.create`, `runtime.getManifest`, coarse browser-family input, and optional trusted active-tab `windowId`/`incognito`.
- **Relationships**: Injected into Popup/Options components for behavioral testing; no background message, new runtime listener, settings service, diagnostics access, or persisted URL.
- **Validation**: No browser query/report navigation on mount, exactly one navigation per explicit click, pending duplicate suppression, exact private-window binding, and no navigation on restricted/missing/mismatched context or unavailable APIs.
- **States**: idle → user-requested → opened, or user-requested → reported failure; no retry, automatic report submission, upload, or ZIP attachment.

## Contracts

- **GitHub template**: One `.github/ISSUE_TEMPLATE/site-report.yml` public `Site report` issue form with matching editable `reason`, `hostname`, `current_url`, `extension_version`, `browser`, `observed`, and `expected` IDs; both supported reason labels are exact English text.
- **Public URL**: One fixed-origin `https://github.com/maximtop/no-more-ago/issues/new?template=site-report.yml&...` created via `URLSearchParams`; the adapter path selects `Dates are not working correctly`, the no-adapter path selects `Add support for this site`, and generic Options leaves site/reason fields editable and blank.
- **Popup intent**: Use the existing trusted ready Popup hostname/adapter status plus a newly queried active HTTP(S) tab; reject restricted, stale/mismatched, missing, malformed, credentialed, inaccessible, or unsafe private-window context before `tabs.create` and show actionable UI feedback.
- **Options intent**: Always make `Open GitHub issue` usable within a ready Diagnostics section regardless of the debug switch; do not query the active extension tab, expose its URL, require existing logs, or inspect/download/upload/attach a diagnostic archive.
- **Trusted environment/private boundary**: Validate the current extension manifest version, include only coarse browser family, and create an incognito-source composer in its originating `windowId`; if safe same-window placement cannot be established, fail without navigation.
- **Security/privacy**: No navigation, reporting-related query, context construction, `fetch`, network call, submit, tab creation, page/DOM/text capture, diagnostic read, settings write, analytics, or URL persistence before an explicit reporting action; no background report route, permission increase, or remote executable.
- **Error handling**: Missing/restricted/mismatched tab, invalid environment, unavailable browser APIs, private-window ambiguity, or failed `tabs.create` yields a concise actionable English notice and one attempted action; normal timestamp, popup policy, Options reset, and diagnostics behavior remain intact.

## File Structure

| File | Action | Responsibility / ownership |
| --- | --- | --- |
| `.github/ISSUE_TEMPLATE/site-report.yml` | Create | The sole public `Site report` issue form with matching field IDs, two reasons, and editable observed/expected prompts; reporting owner. |
| `src/reporting/site-report.ts` | Create | Small pure fixed-origin composer plus injectable user-invoked Popup/Options browser reporter with trusted environment and private-window safety; reporting owner. |
| `tests/reporting/site-report.test.ts` | Create | Parsed public URL semantics, exact template/field IDs/reasons, active-tab trust, restricted/mismatch/private failures, no pre-click work, and one local tab creation; reporting owner. |
| `src/popup/app.tsx` | Modify | One eligible `Report this site` action, injected reporter, pending guard, and truthful failure notice; Popup owner. |
| `tests/popup/app.test.tsx` | Modify | Replace the outdated no-report text assertion; validate adapter/no-adapter/disabled/runtime-failed user clicks and restricted/missing/error privacy; Popup owner. |
| `src/options/app.tsx` | Modify | Add one always-usable ready Diagnostics `Open GitHub issue` action while preserving concurrent Issue 13 reset and all Diagnostics controls; Options owner. |
| `tests/options/app.test.tsx` | Modify | Validate generic blank editable site context, debug-off/report behavior, manual-only ZIP handling, typed errors, and preserved full reset; Options owner. |
| `tests/build/chrome-artifact.test.ts` | Modify | Exercise actual emitted Popup and Options user clicks, trusted tab/browser metadata, exact GitHub URL, private safety, errors, no automatic navigation, and unchanged CSP/permissions across six artifacts; integration owner. |

## Tasks

### [x] Task 1: Define one editable public issue form and fixed-origin composer

**Files:** `.github/ISSUE_TEMPLATE/site-report.yml` (create), `src/reporting/site-report.ts` (create), `tests/reporting/site-report.test.ts` (create).

- [x] **Step 1: Add failing public-composer tests** that parse a generated `URL`/`URLSearchParams` and require exact GitHub HTTPS origin/path, `template=site-report.yml`, both precise reason values, editable matching `hostname`/`current_url`/`extension_version`/`browser` form IDs, separately editable observed/expected fields, full correctly encoded selected HTTP(S) URL, generic blank site fields, and rejection of destination injection, invalid host/context, inherited values, unsupported scheme, and embedded URL credentials.
- [x] **Step 2: Run** `pnpm exec vitest run tests/reporting/site-report.test.ts` **and confirm the composer module is missing.**
- [x] **Step 3: Create the one human-readable public GitHub issue-form YAML** with exact `Site report` name/reason dropdown and editable field IDs/prompts; implement one small pure fixed-origin URL composer using browser `URL`/`URLSearchParams` and canonical hostname validation without a YAML dependency, source-text assertion, storage, upload, or network access.
- [x] **Step 4: Rerun the reporting suite** and verify all user-visible composer semantics exclusively through parsed URL values and public helper behavior.

**Verification**: Both report reasons and generic blank-context reporting point to exactly one editable public Site report form without destination or data leakage.

### [x] Task 2: Add a tiny trusted, user-invoked tab reporter with private-window isolation

**Files:** `src/reporting/site-report.ts`, `tests/reporting/site-report.test.ts`.

- [x] **Step 1: Add failing injected-browser tests** for zero tab query/create or environment work before invocation, one on-click `{ active: true, currentWindow: true }` Popup query, exact hostname match against trusted Popup state, adapter/no-adapter reason selection, trusted manifest version/coarse Chrome/Edge/Firefox context, full selected URL, one `tabs.create({ url, windowId })`, private tab same-window enforcement, generic Options with blank site fields and zero tab query, typed restricted/missing/mismatched/invalid-manifest/private/create failures, and no storage/DOM/ZIP/fetch/submit access.
- [x] **Step 2: Run** `pnpm exec vitest run tests/reporting/site-report.test.ts` **and confirm active-tab/browser opening behavior is absent.**
- [x] **Step 3: Extend only the small shared UI reporter** with its own narrow injectable browser API, lazy trusted manifest/browser discovery, explicit Popup active-tab validation, optional same-window tab creation with mandatory private-window binding, generic no-tab-query Options reporting, and typed one-shot failures; do not modify background messages, `PopupState`, shared activation `TabsRuntime`, permissions, or storage.
- [x] **Step 4: Rerun reporting tests** and assert rejected contexts never navigate while successful clicks create exactly one reviewable GitHub composer tab.

**Verification**: Reporting uses existing extension UI/browser boundaries only after explicit intent, never exfiltrates a private URL across browsing windows, and remains independent of settings/diagnostics.

### [x] Task 3: Expose site-specific reporting from eligible Popup states

**Files:** `src/popup/app.tsx`, `tests/popup/app.test.tsx`.

- [x] **Step 1: Update the existing outdated `report this site` absence assertion** and add failing user-click tests for visible exact English `Report this site` on ready GitHub/no-adapter HTTP(S), both global/site-disabled states, and ready runtime failure; require adapter → `Dates are not working correctly`, no-adapter → `Add support for this site`, editable actual hostname/full current URL/trusted environment, no query/navigation before click, one create/no automatic submission, duplicate-click suppression, unavailable/restricted/mismatched/private failure notices with no navigation, and no DOM/ZIP upload or settings writes.
- [x] **Step 2: Run** `pnpm exec vitest run tests/popup/app.test.tsx tests/reporting/site-report.test.ts` **and confirm the eligible reporting control is missing.**
- [x] **Step 3: Add one accessible Popup action using the injected shared reporter**, derive eligibility/reason from the existing authoritative `PopupState`, keep restricted/no-host states safe, retain existing status/global/site controls/Settings link, and expose actionable English create/context errors without a new message, tab listener, counter, or page-injected UI.
- [x] **Step 4: Rerun Popup/reporting suites** and retain every existing hostname, status, save error, revision, and exact-site policy behavior.

**Verification**: Users can manually start the correct editable site-specific report from all eligible supported, missing-adapter, disabled, and runtime-failed Popup states.

### [x] Task 4: Expose useful generic reporting in Options Diagnostics

**Files:** `src/options/app.tsx`, `tests/options/app.test.tsx`.

- [x] **Step 1: Add failing Options click tests** for exactly one visible English `Open GitHub issue` button while Diagnostics is ready, usability with debug logging both off and on, the same public `Site report` template with blank editable hostname/current-URL/reason and trusted extension/browser context, zero active-tab query or leaked extension URL, no existing ZIP upload/attachment/download, no auto-navigation, duplicate suppression, actionable missing-context/open failure, and preservation of every Issue 13 healthy/recovery reset/default/error case.
- [x] **Step 2: Run** `pnpm exec vitest run tests/options/app.test.tsx tests/reporting/site-report.test.ts` **and confirm the Diagnostics issue action is absent.**
- [x] **Step 3: Add one independent Diagnostics button using the injected generic reporter**, retain `Debug logs`, `Download logs`, `Clear logs`, and the concurrently implemented shared reset action, allow manual reporting without log collection, and show concise local failure feedback without querying the active Options tab or accessing diagnostics/settings storage.
- [x] **Step 4: Rerun Options/reporting suites** and verify all reset, System/custom display, site-list, diagnostics ZIP/privacy, and one-shot recovery behavior remains unchanged.

**Verification**: Options opens a usable manually editable issue composer even though its active tab is an extension page; logs remain exclusively user-downloaded/manual attachments.

### [x] Task 5: Prove user-controlled reporting in all six emitted extension artifacts

**Files:** `tests/build/chrome-artifact.test.ts`.

- [x] **Step 1: Extend existing actual emitted Popup/Options CSP fixtures** across Chrome, Edge, and Firefox development/release with injected existing `tabs.query`/`tabs.create` and manifest version/browser user agents; assert zero reporting query/navigation before clicking, real Popup GitHub/no-adapter/disabled/runtime-failed click reasons and editable encoded site fields, generic Options blank site fields with no extension URL, private same-window creation, actionable restricted/missing/mismatched/create failures with no unwanted tab, one exact GitHub composer tab per successful explicit click, no automatic submit/network/DOM capture/ZIP attachment, unchanged `scripting`/`storage` permissions and `<all_urls>`, and preserved Issue 13 reset/diagnostics behavior.
- [x] **Step 2: Run** `pnpm exec vitest run tests/build/chrome-artifact.test.ts` **and confirm emitted reporting buttons/browser callbacks are absent before integration.**
- [x] **Step 3: Update only existing emitted fake browser/DOM wiring and public UI interaction**, validate all destinations through parsed `URL`/`URLSearchParams`, preserve existing extension sender checks/CSP/background no-navigation tests, and add no source-text template assertions, background routes, permission, account sync, fetch, browser automation, or external process checks.
- [x] **Step 4: Run** `pnpm check`, `pnpm dev`, `pnpm release`, **and** `pnpm lint`; require at least the inherited 752 tests plus all completed Issue 13/reporting cases and six development/release browser artifacts to pass with no Git, Corepack, network, live browser, or external-utility testing.

**Verification**: Every acceptance criterion holds for actual emitted Popup and Options clicks in all supported browsers while the only external navigation remains an explicit, private, editable, unsubmitted GitHub composer.
