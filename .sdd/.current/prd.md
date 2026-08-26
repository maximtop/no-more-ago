# PRD: No More Ago MVP

- **Created**: 2026-08-23
- **Status**: Draft
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Input**: Create the No More Ago cross-browser extension MVP: replace trusted relative timestamps with configurable exact dates, begin with all pages on `github.com`, and preserve an adapter architecture that can add future sites with minimal changes to shared business logic.

## Problem Statement

GitHub frequently presents event times as relative phrases such as “3 months ago.” These phrases are convenient for a quick sense of recency but are inadequate when a user needs the exact date and time of a commit, issue event, release, workflow run, or other activity. Finding the precise timestamp requires extra interaction, may depend on a tooltip, and is inconsistent across GitHub surfaces.

Existing userscripts and extensions demonstrate demand for absolute timestamps, but common approaches destructively rewrite GitHub-owned nodes, mutate implementation-specific shadow DOM, repeatedly rescan whole pages, or infer dates from ambiguous text. Those approaches can create incorrect dates, duplicated output, flicker, excessive work on dynamic pages, and incomplete restoration when disabled.

The user needs an extension that is useful immediately on GitHub, is conservative when a timestamp cannot be trusted, follows the user’s locale and time-zone preferences, can be disabled globally or per hostname without reloading, and does not create persistent background load. The first release must also establish a safe extension architecture so additional site adapters can be added later without moving site-specific parsing or selectors into the shared date-processing logic.

## Solution

No More Ago will run on every path of the exact hostname `github.com` and replace GitHub’s trusted relative-time elements with semantic exact dates. It will use the authoritative zoned timestamp exposed by GitHub rather than parsing the visible relative phrase. If the source is absent, invalid, ambiguous, already absolute, or no longer matches the adapter’s contract, the extension will leave the original page unchanged.

The displayed date will use the browser’s language, regional conventions, clock preference, and system time zone by default. Users may instead choose a custom date format and System, UTC, or a valid IANA time zone. Relative text is replaced completely; there is no combined exact-plus-relative mode.

The extension will provide an English popup and options page with a global switch, an exact-hostname switch, a site list, display preferences, diagnostics, and a user-controlled GitHub reporting flow. Disabling processing will immediately remove only extension-owned output and reveal GitHub’s live original text. The runtime will observe relevant dynamic changes incrementally and remain idle when the page is idle.

Chrome, Microsoft Edge, and Firefox will receive distinct development and release targets. The manifest will retain the `<all_urls>` host permission for future adapters, while the MVP will register page-processing code only for `github.com`. A stable adapter contract will keep candidate discovery and timestamp extraction site-specific while shared modules own validation, formatting, DOM ownership, restoration, scheduling, settings, and diagnostics.

## Assumptions

- This is a new repository with no existing production users or previously published settings schema.
- The product name is **No More Ago** and the public issue tracker will be the `maximtop/no-more-ago` GitHub repository.
- The MVP supports the exact hostname `github.com` on HTTP and HTTPS. It does not include `gist.github.com`, GitHub Enterprise hosts, `github.io`, or any other GitHub-related hostname.
- Every path on `github.com` is in scope, including commits, issues and pull requests, comments and timelines, releases and tags, profiles and activity, search, and GitHub Actions. A path is excluded only after a reproducible safety or compatibility problem is documented.
- The target browser policy is the current stable Chrome, Edge, and Firefox at release time. Legacy browser support is not promised.
- Users accept the declared host permission and separately control whether the extension is allowed in private/incognito windows. When the browser grants that access, the same processing and opt-in diagnostic behavior applies there.
- GitHub and other websites can change without notice. Compatibility is verified against the current DOM at release time, but continuous compatibility with future site changes is not promised.
- A simple temporary clock icon is sufficient for the MVP. Final branding and store assets are deferred.
- Browser locale and time-zone APIs expose conventions sufficient for localized output, but browsers do not expose an arbitrary user-defined operating-system date pattern. “System format” therefore means localized medium date plus short time.
- Opening a GitHub issue after an explicit user action is the only external navigation initiated by the extension. Normal processing, settings, and diagnostics require no remote service.

## User Stories

### User Story 1 - See exact GitHub dates (Priority: P1)

As a GitHub user, I want relative timestamps replaced with exact dates, so that I can determine precisely when activity occurred without hovering or opening another view.

**Why this priority**: Exact, trustworthy replacement is the primary product value; all other capabilities support or control it.

**Acceptance Scenarios**:

1. **Given** the extension is enabled and a `github.com` page contains a GitHub `relative-time`, `time-ago`, or `time-until` element whose `datetime` is a complete, explicitly zoned, date-fns-supported ISO 8601 instant, **When** the adapter processes the element, **Then** the visible relative phrase is fully replaced by an exact date formatted with the saved presentation settings.
2. **Given** an eligible timestamp is nested in a GitHub link or interactive container, **When** it is replaced, **Then** the surrounding link and interaction continue to work and no click or hover handler is intercepted by the extension.
3. **Given** a `local-time` element or an element already configured by GitHub to display `format="datetime"`, **When** the adapter scans the page, **Then** that element remains unchanged.
4. **Given** a candidate has no `datetime`, has an invalid value, lacks an explicit time zone, or contains an ambiguous value, **When** it is inspected, **Then** the original GitHub element remains visible and no date is inferred from its relative text.
5. **Given** any path on the exact hostname `github.com`, including GitHub Actions, **When** eligible GitHub relative-time elements appear, **Then** the same trusted replacement rules apply without a path allowlist.
6. **Given** a page on `gist.github.com`, a GitHub Enterprise hostname, `github.io`, or another hostname, **When** the page loads, **Then** the GitHub adapter does not process its DOM.

---

### User Story 2 - Handle dynamic GitHub pages (Priority: P1)

As a GitHub user, I want exact dates to remain correct during client-side navigation and live page updates, so that the extension works throughout a browsing session without manual reloads.

**Why this priority**: GitHub creates and replaces timestamp elements dynamically; initial-page-only processing would leave major product surfaces inconsistent.

**Acceptance Scenarios**:

1. **Given** GitHub processing is enabled before a new navigation, **When** a `github.com` document begins loading, **Then** the adapter runtime is registered for the earliest reliable `document_start` execution point in the top-level frame.
2. **Given** an eligible timestamp is added after initial load, **When** the relevant DOM mutation is delivered, **Then** that timestamp is processed without rescanning unrelated portions of the document.
3. **Given** the `datetime` of an already-owned candidate changes to another valid zoned timestamp, **When** the attribute mutation is delivered, **Then** the extension-owned exact output is updated to the new instant.
4. **Given** GitHub performs client-side navigation or replaces a timeline section, **When** new eligible candidates appear, **Then** each candidate receives one exact replacement and previously removed candidates leave no extension-owned orphan nodes.
5. **Given** a GitHub tab was already open when the extension was installed, updated, or re-enabled, **When** activation is reconciled, **Then** the runtime is injected into that existing tab and processes it without requiring a reload.
6. **Given** the runtime receives duplicate activation requests, **When** it is already active in the document, **Then** it remains a single controller with a single document observer and does not duplicate output.

---

### User Story 3 - Disable and restore safely (Priority: P1)

As an extension user, I want global and per-site controls to take effect immediately, so that I can stop processing and recover the original page without reloading.

**Why this priority**: Immediate, lossless reversal is essential for user trust and for recovery when GitHub changes.

**Acceptance Scenarios**:

1. **Given** one or more GitHub tabs contain extension-owned exact dates, **When** the global switch is turned off, **Then** every reachable active GitHub tab immediately removes extension-owned nodes and markers and reveals the untouched GitHub elements.
2. **Given** the extension is globally enabled, **When** the exact hostname `github.com` is turned off, **Then** `github.com` is saved as disabled, active GitHub tabs are restored immediately, and future GitHub documents do not start the adapter.
3. **Given** `github.com` is disabled, **When** its site switch is turned on, **Then** the preference is saved, future documents regain early registration, and already-open GitHub tabs are processed immediately.
4. **Given** the global switch is off, **When** the user edits a site switch, **Then** the site preference is saved while runtime processing remains inactive until the global switch is enabled again.
5. **Given** `github.com` is disabled, **When** a different exact hostname is visited, **Then** its preference is independent; parent domains and subdomains do not inherit one another’s setting.
6. **Given** another extension or GitHub modifies nearby DOM, **When** No More Ago is disabled or torn down, **Then** it removes only nodes, attributes, and styling that it owns.

---

### User Story 4 - Choose date presentation (Priority: P1)

As an extension user, I want exact dates formatted for my locale and preferred time zone, so that the replacement is immediately readable and personally useful.

**Why this priority**: A technically exact timestamp is not useful if its representation is unfamiliar or in the wrong time zone.

**Acceptance Scenarios**:

1. **Given** default settings, **When** a date is formatted, **Then** it uses the browser’s preferred language list, localized medium date, localized short time, system 12/24-hour convention, and system time zone, with a year and minutes but no seconds.
2. **Given** the browser locale is `en-US`, **When** default formatting is used, **Then** output follows the corresponding month-first and 12-hour conventions; **Given** an `en-GB`-style locale, **Then** output follows day-first and 24-hour conventions.
3. **Given** the user chooses `Custom format`, **When** they edit the pattern, **Then** a live preview updates without changing saved page output until `Save` succeeds.
4. **Given** a custom pattern is empty, malformed, or uses rejected legacy tokens, **When** the user attempts to save, **Then** saving is blocked and an English, actionable validation error appears next to the field.
5. **Given** a valid custom pattern contains localized month or weekday tokens, **When** it is formatted, **Then** the closest available locale to the browser’s primary language is used, with `en-US` as fallback.
6. **Given** the user chooses System, UTC, or a valid IANA time zone and saves, **When** existing and new owned dates are rendered, **Then** they use that selection and all open GitHub tabs update without reload.
7. **Given** an entered IANA time zone is invalid, **When** the user attempts to save, **Then** saving is blocked; **Given** a previously saved zone is unavailable at runtime, **Then** formatting safely falls back to the system zone and settings show an error requiring correction.
8. **Given** the operating-system locale or time zone changes while a tab stays open, **When** a new candidate is processed, **Then** it uses the newly resolved system values; existing output may wait until reload, re-enable, or settings save because the extension performs no polling.
9. **Given** any presentation mode, **When** a date is rendered, **Then** the relative phrase is not appended and no combined mode is offered.

---

### User Story 5 - Understand and manage current status (Priority: P1)

As an extension user, I want a concise popup and a persistent site list, so that I can understand what is happening and manage hostname preferences without confusion.

**Why this priority**: The extension has global, site, adapter, and error states that must be distinguishable without placing UI into GitHub pages.

**Acceptance Scenarios**:

1. **Given** the popup is opened on an HTTP/HTTPS tab, **When** its state loads, **Then** it displays the exact hostname, the global switch, the current-hostname switch, a concise status, `Report this site`, and a link to settings.
2. **Given** active GitHub processing, **When** the popup opens, **Then** it reports `Active on github.com` without a replacement counter.
3. **Given** the global switch or current-host switch is off, **When** the popup opens, **Then** it reports `Extension is off` or `Disabled on <hostname>` respectively.
4. **Given** an HTTP/HTTPS hostname has no adapter, **When** the popup opens, **Then** it displays the hostname, keeps the hostname switch usable, and reports `Rules are not available for <hostname> yet` rather than calling the site unsupported.
5. **Given** the current browser page cannot be accessed by extensions or has no HTTP/HTTPS hostname, **When** the popup opens, **Then** it reports `Cannot run on this page` and does not pretend that a site preference can be applied.
6. **Given** runtime activation failed on an otherwise eligible GitHub page, **When** the popup obtains status, **Then** it reports `Could not process this page`, retains access to reporting, and does not inject an error panel into the page.
7. **Given** the options page opens, **When** the `Sites` section loads, **Then** it always lists `github.com` and additionally lists only hostnames the user explicitly changed; ordinary browsing does not create stored site-history entries.
8. **Given** an explicitly managed hostname is switched back to enabled, **When** the `Sites` list refreshes, **Then** the row remains available until `Reset all settings` so it can be managed without revisiting the site.

---

### User Story 6 - Preserve accessibility and page ownership (Priority: P1)

As a keyboard or assistive-technology user, I want the replacement to remain semantic and non-duplicative, so that exact dates do not degrade GitHub’s accessibility or interactions.

**Why this priority**: Replacing visible content is unacceptable if it creates duplicate announcements, breaks links, or makes restoration incomplete.

**Acceptance Scenarios**:

1. **Given** an eligible GitHub custom element, **When** it is replaced, **Then** the original host remains intact but hidden and one extension-owned semantic `time` element with the authoritative `datetime` is inserted alongside it.
2. **Given** a screen reader traverses the replaced timestamp, **When** it reaches the date, **Then** it encounters the exact date once rather than both the original relative phrase and the replacement.
3. **Given** the timestamp is within a link, **When** a keyboard or pointer user activates the link, **Then** navigation behaves as it did before replacement.
4. **Given** the extension is disabled, the candidate becomes invalid, or the document controller tears down, **When** restoration occurs, **Then** the extension-owned semantic element and ownership markers are removed and the live GitHub host becomes visible again.
5. **Given** GitHub’s relative-time component uses an internal shadow root, **When** No More Ago operates, **Then** it does not mutate that shadow root and does not traverse arbitrary shadow roots or iframes.
6. **Given** any page state, **When** No More Ago operates, **Then** it injects no toolbar, panel, button, toast, or other UI into the GitHub document.

---

### User Story 7 - Keep settings valid and recoverable (Priority: P1)

As an extension user, I want settings changes to be durable and self-recovering, so that updates or concurrent UI actions do not silently corrupt behavior.

**Why this priority**: Settings control whether the extension changes pages; a corrupted or unexpectedly reset state could override an explicit user choice.

**Acceptance Scenarios**:

1. **Given** popup and options attempt changes close together, **When** the background Settings Service applies them, **Then** writes are serialized against the latest valid snapshot and no accepted field update is lost.
2. **Given** a proposed change contains an invalid format, time zone, hostname, or schema value, **When** it reaches the Settings Service, **Then** the whole change is rejected before persistence and the last valid snapshot remains active.
3. **Given** persistence fails during a write, **When** the caller receives the result, **Then** the UI reports that saving failed and prior settings and runtime behavior remain active.
4. **Given** the current settings snapshot is invalid on startup but the previous known-good snapshot is valid, **When** settings initialize, **Then** the previous snapshot is restored and activation follows it.
5. **Given** both current and previous snapshots are invalid, **When** settings initialize, **Then** the adapter remains inactive and the UI offers `Reset all settings`; defaults are not silently applied.
6. **Given** the user presses `Reset all settings`, **When** the action completes, **Then** it immediately enables the extension, clears explicitly managed hostnames, selects system format and system time zone, turns off debug logging, and deletes diagnostics, without a second confirmation dialog.
7. **Given** the extension updates after its first public store release, **When** an older released settings schema is encountered, **Then** a tested forward migration preserves supported user choices; an older extension reading a newer schema is not guaranteed.
8. **Given** a pre-publication development build changes schema incompatibly, **When** it starts, **Then** it may require a development reset rather than carrying a compatibility migration that has never shipped publicly.
9. **Given** settings are saved, **When** the browser account’s extension sync is inspected, **Then** No More Ago has not requested or used account synchronization for those settings.

---

### User Story 8 - Remain lightweight on dynamic pages (Priority: P1)

As a GitHub user, I want the extension to avoid noticeable system load, so that exact timestamps do not make complex GitHub pages slower or less responsive.

**Why this priority**: GitHub pages can generate many unrelated mutations, and a naïve observer can repeatedly scan the entire document or create feedback loops.

**Acceptance Scenarios**:

1. **Given** a processed GitHub document is idle, **When** no relevant DOM or settings event occurs, **Then** the content runtime performs no periodic scan, polling, or scheduled date update.
2. **Given** a mutation batch contains added subtrees and attribute changes, **When** it is handled, **Then** relevant work is coalesced and limited to candidate elements within the affected region.
3. **Given** an unrelated DOM mutation, **When** the observer callback runs, **Then** it does not trigger a whole-document rescan or a formatting pass over all owned timestamps.
4. **Given** the extension inserts, updates, or removes its own replacement nodes, **When** those mutations are observed, **Then** ownership guards prevent recursive processing and duplicate work.
5. **Given** many candidates appear in one dynamic update, **When** they are processed, **Then** the runtime uses one document-level observer rather than creating an observer or timer per timestamp.
6. **Given** no numeric performance budget has been committed for the MVP, **When** performance is evaluated, **Then** diagnostics and profiling are used to find regressions without treating an arbitrary elapsed-time threshold as a product promise.

---

### User Story 9 - Collect opt-in diagnostics (Priority: P2)

As a user troubleshooting a problem, I want to opt into useful local debug logs and download them, so that I can provide evidence without automatic telemetry.

**Why this priority**: Site adapters can break when websites change, but diagnostics must not impose ongoing collection or silently transmit browsing data.

**Acceptance Scenarios**:

1. **Given** a fresh install or reset state, **When** runtime events occur, **Then** `Debug logs` is off and no persistent diagnostic entries are created.
2. **Given** the user enables `Debug logs`, **When** activation, adapter decisions, mutation batches, formatting, skips, settings changes, timings, or errors occur, **Then** useful structured technical events are stored locally.
3. **Given** debug logging is enabled, **When** an event is recorded, **Then** it may include event time, exact hostname, GitHub page category, adapter and extension versions, browser details, counts, durations, reason codes, and sanitized stack traces, but not full URLs, query strings, hashes, DOM content, visible text, secrets, or source `datetime` values.
4. **Given** the browser has explicitly allowed the extension in private/incognito windows and debug logging is enabled, **When** a diagnostic event occurs there, **Then** it follows the same local sanitized logging policy.
5. **Given** the serialized journal would exceed 5 MB, **When** a new entry is added, **Then** the oldest entries are evicted and an individually excessive entry is safely truncated or discarded so the stored journal remains within 5 MB.
6. **Given** the user turns `Debug logs` off, **When** the setting is applied, **Then** collection stops and all previously stored diagnostic entries are deleted immediately.
7. **Given** diagnostics exist, **When** the user presses `Download logs`, **Then** the full current journal and environment metadata are downloaded as one ZIP file without being uploaded.
8. **Given** diagnostics exist, **When** the user presses `Clear logs`, **Then** stored entries are deleted while the debug toggle remains in its current state.
9. **Given** diagnostic persistence or ZIP generation fails, **When** the error occurs, **Then** the UI reports the diagnostic failure where relevant and timestamp processing continues.

---

### User Story 10 - Report a site or broken behavior (Priority: P2)

As an extension user, I want a simple path to report a missing or broken adapter, so that maintainers can investigate website changes or requests for future coverage.

**Why this priority**: A user-visible reporting path is the recovery mechanism for site drift and the intake mechanism for future adapters.

**Acceptance Scenarios**:

1. **Given** the popup is open on a hostname with no adapter, **When** the user chooses `Report this site`, **Then** the public GitHub `Site report` issue template opens with `Add support for this site` preselected.
2. **Given** the popup is open on `github.com`, **When** the user chooses `Report this site`, **Then** the same issue template opens with `Dates are not working correctly` preselected.
3. **Given** the report composer opens, **When** it is prefilled, **Then** it includes the hostname, current URL, extension version, browser details, and prompts for the observed relative date and expected result.
4. **Given** report data has been prepared, **When** GitHub displays the composer, **Then** the user can inspect, edit, or abandon it before submission; the extension never submits an issue automatically.
5. **Given** debug logs are available, **When** the user wants to share them, **Then** the user downloads the ZIP and attaches it manually; the extension does not upload or attach it.
6. **Given** a report is created, **When** diagnostic and page context are collected, **Then** no DOM snapshot or page content is captured automatically.

---

### User Story 11 - Protect local browsing data (Priority: P1)

As a privacy-conscious user, I want page processing to remain local and minimal, so that the extension does not turn timestamp replacement into browsing surveillance.

**Why this priority**: The requested `<all_urls>` permission is broad; explicit storage and network boundaries are required to maintain trust.

**Acceptance Scenarios**:

1. **Given** normal page processing, **When** the extension runs, **Then** it makes no network request and sends no telemetry, analytics, page content, or remote-rule request.
2. **Given** settings persistence, **When** data is stored, **Then** it contains only the versioned settings snapshots, explicitly managed hostname preferences, and the separate opt-in diagnostic journal.
3. **Given** a timestamp is processed, **When** persistence is inspected, **Then** the page URL, source timestamp, visible page text, and replacement text have not been stored as product data.
4. **Given** an HTTP/HTTPS site is merely visited, **When** no site switch is changed and no opted-in diagnostic event occurs, **Then** its hostname is not added to the `Sites` list or settings storage.
5. **Given** the user explicitly presses a reporting action, **When** the GitHub composer is opened, **Then** only that user-initiated navigation may carry the current URL and environment context outside the extension.
6. **Given** extension packages are inspected, **When** runtime dependencies are evaluated, **Then** all executable code is packaged with the extension and no remote code is loaded.

---

### User Story 12 - Build and run each browser target (Priority: P1)

As a maintainer, I want predictable development, watch, and release commands for every supported browser, so that the same feature can be built and verified without ad hoc steps.

**Why this priority**: A cross-browser MVP is incomplete unless each browser has a first-class, repeatable artifact and local development loop.

**Acceptance Scenarios**:

1. **Given** project dependencies are installed, **When** `make dev` runs, **Then** one-shot development builds for Chrome, Firefox, and Edge are produced; **When** `make dev chrome`, `make dev firefox`, or `make dev edge` runs, **Then** only the selected development target is produced.
2. **Given** project dependencies are installed, **When** `make release` runs, **Then** one-shot release builds for all three targets are produced; **When** a browser argument is supplied, **Then** only that release target is produced.
3. **Given** the maintainer runs `pnpm dev chrome --watch`, `pnpm dev firefox --watch`, or `pnpm dev edge --watch`, **When** source inputs change, **Then** the selected development target is rebuilt continuously without launching a browser or automatically reloading the installed extension.
4. **Given** an unknown browser target or incompatible command combination, **When** the build command runs, **Then** it exits unsuccessfully with a clear usage error and does not silently build a different target.
5. **Given** a successful target build, **When** outputs are inspected, **Then** that browser has a distinct unpacked directory and ZIP artifact for the requested mode, with a browser-appropriate manifest.
6. **Given** Chrome and Edge share Chromium behavior, **When** releases are built, **Then** they remain separate named targets and artifacts rather than treating Edge as an undocumented copy.
7. **Given** a package version, **When** manifests and release archives are generated, **Then** that single project-package version is used consistently without a second manually maintained version source.
8. **Given** a release candidate, **When** it is installed in current stable Chrome, Edge, and Firefox, **Then** the core replacement, immediate restore/re-enable, settings, and reporting smoke scenarios behave consistently.
9. **Given** the first installation completes, **When** browser UI returns to the user, **Then** the extension is enabled with default settings and no onboarding or options tab opens automatically.

---

### User Story 13 - Add future adapters without rewriting the core (Priority: P1)

As a future contributor, I want site-specific discovery isolated behind a stable adapter contract, so that adding a site changes minimal shared business logic.

**Why this priority**: The MVP is intentionally GitHub-only, but future multi-site growth is a defining architectural requirement rather than an afterthought.

**Acceptance Scenarios**:

1. **Given** a new site exposes a trusted timestamp source, **When** a contributor adds its hostname matcher, candidate selectors, extractor, eligibility rules, and fixtures, **Then** it can use the shared validation, formatting, DOM ownership, restoration, scheduling, settings, and diagnostics pipeline without copying those behaviors.
2. **Given** the GitHub adapter is reviewed, **When** site-specific selectors and parsing are located, **Then** they exist in the adapter rather than in the shared core.
3. **Given** an adapter lacks confidence in a candidate, **When** extraction returns no trusted timestamp, **Then** the shared pipeline performs a safe no-op rather than asking the adapter to mutate the DOM.
4. **Given** a future site needs a genuinely exceptional operation, **When** the adapter contract is extended, **Then** the extension uses a narrow, testable optional hook rather than allowing adapters to replace the common pipeline wholesale.
5. **Given** generic `title`, `aria-label`, or `data-*` values exist on an arbitrary page, **When** no official adapter or explicit future user rule defines their meaning, **Then** the shared core does not interpret them as timestamps.
6. **Given** an HTTP/HTTPS hostname has no adapter in the MVP, **When** its site preference is changed, **Then** the preference is retained for future activation but no DOM processing occurs today.

## Key Entities

### Settings Snapshot

- **Attributes**: schema version; revision; global enabled flag; display-mode selection; custom format; time-zone mode and optional IANA identifier; debug-enabled flag; map of explicitly managed exact-hostname preferences.
- **Relationships**: owned by the Settings Service; drives Adapter Activation, Date Presentation, Popup/Options, and Diagnostics; paired with one previous known-good snapshot.
- **Validation**: the snapshot is accepted as a whole; hostname keys are normalized exact HTTP/HTTPS hostnames; custom formats and IANA zones must pass their validators; unknown future schemas are not silently rewritten.
- **States**: proposed → validated → current; current → previous known-good on successful replacement; invalid current → restored previous; both invalid → recovery required.

### Site Preference

- **Attributes**: exact hostname; enabled flag; explicit-user-action marker.
- **Relationships**: contained in the Settings Snapshot; combined with the global switch and Adapter Definition to produce effective activation; displayed in `Sites` alongside built-in adapter hostnames.
- **Validation**: no wildcard, parent-domain inheritance, path, query, or scheme-specific variation; absence means enabled by default; passive visits do not create an entity.
- **States**: absent/default enabled → explicitly disabled or explicitly enabled → cleared by reset. Explicitly enabled entries remain visible until reset.

### Adapter Definition

- **Attributes**: stable identifier; exact hostname matcher; candidate selectors; trusted timestamp extractor; eligibility rules; optional narrowly scoped hooks; fixture set.
- **Relationships**: registered in the Adapter Registry; selected by Adapter Activation; supplies Timestamp Candidates to the shared DOM pipeline.
- **Validation**: one unambiguous adapter per URL; adapters cannot directly own formatting, settings, generic observation, or DOM replacement; unknown inputs return no candidate.
- **States**: registered → selected for matching URL → active when policy allows; registered → inactive when global/site policy blocks it.

### Timestamp Candidate

- **Attributes**: adapter identity; source host element; source kind; authoritative zoned instant held only in memory; eligibility result and optional skip-reason code.
- **Relationships**: discovered by an adapter; validated by the Trusted Timestamp Resolver; transformed into an Owned Replacement by the DOM Controller.
- **Validation**: the GitHub candidate must be one of the approved relative custom elements, not already absolute, and carry a complete, explicitly zoned, date-fns-supported ISO 8601 instant without omitted date or hour/minute components; relative visible text is never an input.
- **States**: discovered → rejected/no-op, or discovered → validated → represented; represented → updated, removed, or restored.

### Date Presentation

- **Attributes**: source instant; browser preferred locales; system/custom format mode; custom token pattern; system/UTC/IANA zone; formatted text or typed error.
- **Relationships**: consumes a validated Timestamp Candidate and Settings Snapshot; supplies text to the DOM Controller and preview to Options.
- **Validation**: formatting must produce a non-empty valid result; invalid custom tokens or entered zones block save; unavailable saved zones use a visible system-zone fallback.
- **States**: default system presentation or valid custom presentation; invalid draft remains unsaved.

### Owned Replacement

- **Attributes**: original GitHub host reference; extension-owned semantic `time` node; preserved authoritative `datetime`; ownership marker; last presentation revision.
- **Relationships**: created and removed only by the DOM Controller; associated one-to-one with an eligible source host inside a document.
- **Validation**: exactly one replacement per source host; no mutation of the host’s shadow root; ownership must be provable before update or removal.
- **States**: absent → inserted/host hidden → updated; inserted → removed/host revealed on teardown or invalidation.

### Runtime Activation

- **Attributes**: URL and exact hostname; browser tab and top-level document identity; global policy; site policy; selected adapter; dynamic-registration state; live-runtime status or failure.
- **Relationships**: reconciles Settings Snapshot and Adapter Registry with browser scripting APIs; controls start and teardown messages to document runtimes.
- **Validation**: only HTTP/HTTPS top-level documents; MVP registration only for exact `github.com`; repeated activation is idempotent.
- **States**: unavailable/no adapter, policy disabled, registered for future documents, injected into existing document, active, failed, or torn down.

### Diagnostic Journal

- **Attributes**: debug-enabled state; ordered structured entries; serialized byte size; environment metadata; sanitized errors; 5 MB maximum.
- **Relationships**: stored separately from Settings Snapshot; receives events from background and content runtimes; exported by Diagnostics as a ZIP.
- **Validation**: entries exclude full URLs, page content, secrets, visible timestamp text, and source `datetime`; oldest-first eviction enforces the limit; storage failure cannot disable date processing.
- **States**: disabled/empty → enabled/collecting → bounded by eviction; enabled → manually cleared; enabled → disabled and deleted.

### Build Target

- **Attributes**: browser (`chrome`, `firefox`, or `edge`); mode (`dev` or `release`); watch flag; manifest variant; unpacked artifact; ZIP artifact; package-derived version.
- **Relationships**: generated by the shared build pipeline from common application modules and browser-specific manifest data.
- **Validation**: browser and mode must be explicit supported values; watch is development-only; each output is installable in its target current stable browser.
- **States**: requested → validating → building → completed artifacts, or failed with actionable error; watch remains active and rebuilds until stopped.

## Module Design

### Settings Service

- **Responsibility**: Own the only write path for versioned settings, validation, serialized updates, current/previous snapshots, reset, subscriptions, and post-publication forward migrations.
- **Interface**: accepts validated intent-level changes from UI/runtime and returns the committed snapshot or a typed validation/persistence/recovery failure; exposes the latest valid snapshot and change notifications.
- **Tested**: yes

### Adapter Registry and Activation Coordinator

- **Responsibility**: Select an adapter for a URL and reconcile effective global/site policy with dynamic early registration, existing-tab injection, status, and teardown.
- **Interface**: accepts URL, settings changes, browser lifecycle events, and tab/document state; returns no-adapter, disabled, active, or typed failure status; never performs site parsing itself.
- **Tested**: yes

### GitHub Adapter

- **Responsibility**: Identify eligible GitHub relative-time hosts and extract their authoritative zoned `datetime` without changing DOM.
- **Interface**: accepts a URL, element, or affected subtree; returns validated candidate descriptions or explicit no-match/skip reasons; fails closed on unknown markup.
- **Tested**: yes

### Trusted Timestamp Resolver

- **Responsibility**: Convert adapter-provided source values into unambiguous instants while rejecting ambiguous or invalid input.
- **Interface**: accepts a source value plus adapter-declared source rules; returns a normalized instant or typed rejection; never parses visible relative prose.
- **Tested**: yes

### Date Presentation Service

- **Responsibility**: Validate display drafts and format normalized instants using browser locale, custom patterns, and selected time zones.
- **Interface**: accepts instant, settings, and preferred locales; returns formatted text or a typed format/time-zone error; separately provides live-preview validation.
- **Tested**: yes

### Document Transformation Controller

- **Responsibility**: Own one document’s initial discovery, semantic replacement, ownership tracking, idempotent updates, accessibility behavior, and complete restoration.
- **Interface**: supports start, process affected region, reformat owned nodes, report status/metrics, and teardown; returns typed element-level skips without converting them into page errors.
- **Tested**: yes

### Mutation Scheduler

- **Responsibility**: Observe one document, filter and coalesce relevant mutations, and send bounded affected regions to the Document Transformation Controller without polling or feedback loops.
- **Interface**: accepts start/stop and ownership/filter predicates; emits affected-region batches and diagnostic metrics; observer setup failure becomes a runtime activation failure.
- **Tested**: yes

### Popup and Options UI

- **Responsibility**: Present English status, global/site controls, `Sites`, saved display preferences, live preview, reset, debug controls, and actionable errors.
- **Interface**: reads status and snapshots and submits intent-level commands to background services; never writes browser storage directly; handles unavailable tabs and persistence failures explicitly.
- **Tested**: yes

### Diagnostics and Report Service

- **Responsibility**: Sanitize and store opt-in structured diagnostics, enforce the 5 MB journal, clear on disable, build a local ZIP, and compose user-reviewed GitHub report navigation.
- **Interface**: accepts structured events and environment context; supports enable, disable-and-delete, clear, download, and open-report actions; returns typed storage, compression, or navigation failures.
- **Tested**: yes

### Browser Runtime and Build Pipeline

- **Responsibility**: Provide browser-specific manifests and API adaptation while producing distinct Chrome, Edge, and Firefox dev/release artifacts from shared product modules.
- **Interface**: accepts browser, mode, and optional watch intent; returns installable artifacts or an actionable target/build error; exposes common scripting, tabs, storage, and lifecycle capabilities to product services.
- **Tested**: yes

## Implementation Decisions

- The application stack is TypeScript, React, Mantine, Rspack, ESLint, and pnpm. UI code remains extension-local and English-only in the MVP.
- Date formatting uses `date-fns` v4. Time-zone conversion uses the companion `@date-fns/tz` package. The user-facing UI calls the feature `Date format` or `Custom format` and does not expose the library name.
- Default presentation uses `date-fns`-backed international formatting equivalent to localized medium date plus short time. Custom formats use current Unicode date tokens, live preview, and browser-locale data when available.
- Browser-specific WebExtension manifests are generated from one common definition. Chrome, Edge, and Firefox are separate targets even when Chromium code is shared. Safari is not generated.
- The manifest retains `<all_urls>` host permission as explicitly requested, plus only the API permissions required for scripting and local settings. Product activation ignores non-HTTP/HTTPS pages and the MVP DOM runtime is scoped to exact `github.com`.
- GitHub processing is dynamically registered through the scripting API for top-level documents at `document_start`. It is registered only while the global and `github.com` policies allow it. No `webRequest.onResponseStarted` trigger or `webRequest` permission is used.
- Early registration is intended to minimize visible relative-text flicker, but zero transient appearance is not a compatibility promise. Correct output, safe no-op, and guaranteed restoration take precedence over hiding GitHub content before ownership is established.
- One-shot script execution remains the mechanism for already-open GitHub tabs after install/update and for immediate re-enable. Runtime guards make this safe to repeat.
- Dynamic registrations are reconciled from validated settings on installation, browser startup, extension update, and relevant setting change. Unregistering prevents future injection; a separate teardown message restores already-running documents.
- The GitHub adapter processes `relative-time`, `time-ago`, and `time-until` hosts with trusted zoned `datetime`. It skips `local-time`, already-absolute `format="datetime"`, and all ambiguous values.
- The original GitHub custom element is never rewritten or removed. The controller hides it using extension-owned state, adds an extension-owned semantic sibling, and restores by deleting only that owned state. It does not mutate GitHub shadow roots.
- Mutation handling is incremental and event-driven: one observer per document, coalesced relevant batches, no polling, no per-element observers, and no whole-document rescan for each mutation. No numeric runtime budget is promised in the MVP.
- Settings are one versioned, validated snapshot plus one previous known-good snapshot. Background Settings Service is the sole writer and serializes changes from all extension surfaces.
- Schema versions exist from the first development build. Pre-store development schemas may reset instead of maintaining compatibility. The first public store schema becomes the forward-migration baseline; downgrade compatibility is not required.
- The default state is global enabled, all exact hostnames enabled unless explicitly changed, system date format, system time zone, and debug logging off. Updates preserve valid settings.
- `Reset all settings` acts immediately without confirmation and restores every default, clears explicitly managed hostnames, disables debug logging, and deletes logs.
- Diagnostic entries are stored separately from settings and never synchronized. The journal is local, opt-in, sanitized, oldest-first bounded to 5 MB, and deleted when debug logging is turned off.
- Downloaded diagnostics use one ZIP containing the full current journal and environment metadata. Users attach it manually; the extension does not upload files.
- `Report this site` opens the public `maximtop/no-more-ago` GitHub issue composer with one `Site report` template and a preselected new-site or broken-site reason. Submission always remains a user action.
- The popup shows the hostname rather than a human-readable site name. It includes no replacement counter, and no controls are injected into the host page.
- Site preferences use exact hostnames. Registered adapter hosts are always listed; other hosts enter `Sites` only after explicit user action and remain listed until reset.
- `make dev` and `make release` produce all targets; an optional `chrome`, `firefox`, or `edge` argument selects one. These commands are one-shot.
- Development watch uses `pnpm dev <browser> --watch`. It rebuilds only that target and neither launches a browser nor reloads the extension.
- Every successful target/mode produces a separate unpacked build and ZIP. The project package version is the canonical source for all manifest and artifact versions.
- The MVP uses a temporary clock icon. Store publishing, release automation, final branding, and promotional assets remain separate work.

## Testing Decisions

- Tests assert observable behavior through public module boundaries, DOM behavior, browser APIs, build commands, and installable artifacts. They do not read implementation or configuration files as text and assert on source substrings.
- The GitHub adapter uses saved, minimal DOM fixtures covering commits, issues/pull requests, comments/timelines, releases/tags, profiles/activity, search, and GitHub Actions. Fixtures include valid, missing, malformed, zone-less, already-absolute, dynamically added, changed, and removed timestamps.
- CI does not depend on live `github.com`. Before an MVP release, manual smoke tests run against the current live versions of every listed GitHub area; failures update fixtures and adapter rules before release.
- The Trusted Timestamp Resolver has table-driven tests for complete, explicitly zoned, date-fns-supported ISO 8601 instants and rejection tests for reduced/defaulted components, ambiguous, zone-less, malformed, out-of-bounds-offset, padded, control-containing, trailing-text, or relative-text input.
- The Date Presentation Service has behavior tests across representative browser locales, 12/24-hour conventions, System/UTC/IANA zones, daylight-saving boundaries, valid custom tokens, invalid legacy tokens, missing locale fallback, and unavailable saved zones.
- The Document Transformation Controller and Mutation Scheduler have DOM integration tests for semantic output, one accessible date, link preservation, idempotent reinjection, attribute changes, added/removed subtrees, unrelated mutations, observer-loop prevention, and exact restoration.
- The Activation Coordinator has browser-API contract tests for dynamic `document_start` registration, exact-host matching, global/site precedence, startup/update reconciliation, already-open-tab injection, restricted pages, duplicate activation, failure status, and teardown.
- Popup and Options tests exercise user-visible states and actions: active, globally disabled, site disabled, no rules yet, inaccessible page, runtime failure, site-list persistence, live preview, save blocking, reset, and failed persistence. No popup counter is expected.
- Settings tests cover whole-snapshot validation, serialized concurrent patches, write failure, current-to-backup recovery, dual-corruption recovery mode, defaults, reset, and every migration from the eventual first public schema.
- Diagnostics tests verify default-off behavior, allowed and forbidden fields, stack sanitization, private-window events after permission, oldest-first 5 MB eviction, excessive-entry handling, delete-on-disable, manual clear, ZIP contents, and non-interference when diagnostic storage fails.
- Build smoke tests invoke the public dev, release, single-target, all-target, watch-start, and invalid-target interfaces. They validate produced manifests and install/load the resulting artifacts rather than asserting build-script text.
- Cross-browser acceptance is exercised in current stable Chrome, Edge, and Firefox. Automation covers common runtime behavior where browser harnesses permit; manual smoke fills browser-extension API gaps without weakening the common acceptance scenarios.
- Performance tests focus on structural invariants already observable at runtime: no periodic work while idle, one observer per document, no full scan for unrelated mutations, coalesced bursts, and no recursive ownership loop. Profiling data is diagnostic and has no arbitrary pass/fail time threshold in this MVP.
- Accessibility tests inspect semantic output and accessible representation, then exercise keyboard/pointer activation through a containing link and full restoration.
- Relevant adjacent-project prior art is used as reference, not copied blindly: Kode Injector for multi-browser React/Mantine build organization; Hide Gmail Upgrade Button for safe detection, idempotent mutation handling, ownership, teardown, and open-tab activation; Extensions Update Tracker for artifact validation.
- External timestamp prior art remains linked for fixture discovery and regression analysis: GitHub’s official [Relative Time Element](https://github.com/github/relative-time-element), Mottie’s [GitHub Static Time](https://github.com/Mottie/GitHub-userscripts/wiki/GitHub-static-time), the [GitHub Absolute Time extension implementation](https://github.com/pkid/github-absolute-time-chrome-plugin/blob/main/content.js), and the [non-destructive sibling-and-restore userscript](https://gist.github.com/UtmostCreator/a134d1eeaa0e8db2bad8ef52bb5120f2).

## Out of Scope

- Generic processing of arbitrary `time[datetime]` elements outside `github.com` in the MVP.
- Built-in adapters for GitLab, Stack Exchange, Reddit, Hacker News, Gist, GitHub Enterprise, `github.io`, or any other hostname.
- User-authored selector rules, filter-list syntax, remote rules, subscriptions, or import/export of settings and rules. Diagnostic ZIP download is the only export in this MVP.
- Generic timestamp extraction from `title`, `aria-label`, or `data-*` without a future official adapter or explicit user rule.
- Parsing or inferring timestamps from visible relative phrases, numeric guesses, date-only ambiguity, or values without an explicit time zone.
- A combined exact-plus-relative display mode.
- Reformatting GitHub elements that are already absolute, including `local-time` and `format="datetime"` cases.
- Arbitrary iframe processing, arbitrary shadow-DOM traversal, or direct mutation of GitHub component shadow roots.
- Any toolbar, panel, toast, or button inserted into GitHub pages.
- Replacement counts, badges, or periodic status notifications.
- Onboarding pages or automatically opening settings after installation.
- UI localization beyond English. Date output localization remains in scope.
- Browser-account settings sync, telemetry, analytics, automatic crash reporting, remote configuration, or storage of page content.
- Automatic GitHub issue submission, automatic log upload, automatic attachment, or DOM capture.
- Safari builds, legacy browser support, or a permanent compatibility promise for future GitHub DOM changes.
- Store publication, signing, store listings, release automation, project website, launch campaign, final branding, and promotional assets.
- A fixed numeric page-processing performance budget or compatibility benchmark before real usage data exists.

## Open Questions

| Question | Owner | Resolution Path |
| --- | --- | --- |
| Does dynamic `document_start` registration, update reconciliation, and teardown behave consistently in the current stable Chrome, Edge, and Firefox? | Implementation owner | Validate in the first end-to-end runtime slice using built artifacts and real browser smoke tests. Keep any browser discrepancy inside the Browser Runtime module without changing adapter or DOM business logic. |
| What exact minimum browser versions should each manifest declare? | Implementation owner | Derive the minimums from the scripting, internationalization, and time-zone APIs actually used; verify them during target build smoke and set them before MVP sign-off. |
| Which package version and settings schema establish the first public migration baseline? | Maxim | Declare both in the separate first-store-release task. Until that point, development builds may reset incompatible pre-release settings as agreed. |

## Success Criteria

### Measurable Outcomes

- **SC-001**: 100% of eligible candidates in the approved GitHub DOM fixture matrix render the expected exact instant in the selected locale, format, and time zone.
- **SC-002**: 0 elements with missing, malformed, ambiguous, zone-less, already-absolute, unsupported, or non-adapter sources are modified in the safety fixture matrix.
- **SC-003**: Across all DOM lifecycle tests, repeated activation produces exactly one owned replacement per source and every disable/teardown restores 100% of original hosts while removing 100% of extension-owned nodes and markers.
- **SC-004**: All tested initial-load, attribute-update, added-subtree, removed-subtree, client-navigation, install/update, and re-enable scenarios process without a page reload.
- **SC-005**: Every display-mode test passes for System and Custom format across System, UTC, and representative IANA zones; invalid drafts produce 0 persisted setting changes.
- **SC-006**: Global and exact-hostname switches update every reachable active GitHub tab in the acceptance suite immediately after the setting commit, and preferences survive browser/extension restart.
- **SC-007**: Chrome, Edge, and Firefox each produce installable dev and release unpacked artifacts and ZIPs; the common release smoke suite passes in all three current stable browsers.
- **SC-008**: Runtime instrumentation observes 0 periodic scans while an active document is idle, 0 full-document rescans caused by an unrelated mutation, and no more than one MutationObserver owned by No More Ago per document.
- **SC-009**: Automated network observation records 0 extension-originated requests during normal timestamp processing, settings, and diagnostics; only an explicit report action navigates to GitHub.
- **SC-010**: Persistent product data contains 0 page bodies, DOM snapshots, source `datetime` values, visible timestamp text, or passively collected browsing URLs; unmodified hostnames are not added to `Sites`.
- **SC-011**: With debug logging off, 0 persistent diagnostic entries are created. With it on, the serialized journal never exceeds 5 MB, and turning it off leaves 0 stored diagnostic entries.
- **SC-012**: Settings recovery tests restore the previous valid snapshot in 100% of single-corruption cases and keep the adapter inactive in 100% of dual-corruption cases until explicit reset.
- **SC-013**: The release-candidate manual smoke checklist passes on commits, issues/pull requests, comments/timelines, releases/tags, profiles/activity, search, and GitHub Actions against the then-current `github.com` DOM.
- **SC-014**: A synthetic second adapter passes the shared adapter contract and DOM pipeline test suite without modifying shared timestamp validation, presentation, ownership, mutation, settings, or diagnostics behavior.
