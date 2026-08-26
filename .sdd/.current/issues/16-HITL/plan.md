# Implementation Plan: [no-more-ago] Validate live GitHub across supported browsers

- **Created**: 2026-08-25
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/16-HITL/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex GPT-5.6
- **User Input**: Human-in-the-loop release smoke only after explicit current-task browser permission; no browser, network, installation, launch, or external account action before approval; keep fixes and compatibility declarations evidence-based and minimal.

## Summary

After independent plan approval, stop at the HITL gate and request explicit permission for browser use in this task, human participation, and the precise approved profiles, sites, and actions. Only after approval, have the human install each existing release artifact in current stable Chrome, Edge, and Firefox and execute the same GitHub category, lifecycle, settings, reporting, diagnostics, and privacy checklist. Record sanitized reproducible observations, correct only confirmed discrepancies in the existing browser-runtime or GitHub-adapter boundaries, derive conservative browser minimums from observed browser/API evidence, and rerun the full offline artifact gate. Never describe unexecuted browser checks as passing or promise continued compatibility with future GitHub changes.

All nine declared blockers and Issues 1–15 are independently Validated. The latest independently verified offline baseline is 32 files and 832 passing tests; it does not establish live-browser compatibility.

## Technical Context

- **Language/Version**: TypeScript 6, React 19, Node.js 24, ECMAScript modules.
- **Primary Dependencies**: Manifest V3 WebExtension APIs, Rspack 2, Mantine 9, `date-fns` 4, `@date-fns/tz`, and `fflate`.
- **Storage**: Existing local current/previous validated settings snapshots and separate opt-in bounded diagnostics journal; the smoke adds no extension storage, permission, telemetry, or network client.
- **Testing**: Vitest, JSDOM, offline sanitized GitHub fixtures, real generated-bundle/CSP execution, and explicitly human-approved current-stable browser smoke.
- **Target Platform**: Separate Chrome, Microsoft Edge, and Firefox development/release artifacts; live validation uses the three release candidates.

## Research

### Explicit HITL and browser boundaries

The issue is `HITL`: approving this plan does not authorize its implementation. The orchestrator must stop after review approval and ask for explicit permission to use browsers in the **current task**, plus the user's help or exact authorization for each browser, selected profile, installation, GitHub navigation, reporting navigation, private/incognito access, and any external compatibility-document lookup. Earlier general permission does not count. Without affirmative scoped permission, perform no browser launch, browser UI inspection, browser automation, website navigation, network request, extension installation, login, account mutation, repository creation, or issue submission. Offline observations are not substitutes for live evidence.

### Existing artifacts and release commands

Version `0.1.0` is derived from `package.json`. The existing installable unpacked release directories and separate ZIP archives are:

| Browser | Unpacked release artifact | ZIP release artifact |
| --- | --- | --- |
| Chrome | `/Volumes/dev/no-more-ago/dist/release/chrome` | `/Volumes/dev/no-more-ago/dist/release/chrome.zip` |
| Edge | `/Volumes/dev/no-more-ago/dist/release/edge` | `/Volumes/dev/no-more-ago/dist/release/edge.zip` |
| Firefox | `/Volumes/dev/no-more-ago/dist/release/firefox` | `/Volumes/dev/no-more-ago/dist/release/firefox.zip` |

`pnpm release` rebuilds all three release targets; `pnpm release chrome`, `pnpm release edge`, and `pnpm release firefox` rebuild individual targets. `pnpm dev` builds all three development counterparts and `pnpm check` runs lint, type checking, and the complete offline suite. Existing Chrome/Edge manifests use a background service worker; Firefox uses background scripts. All six existing manifests retain only `scripting`, `storage`, and `<all_urls>` and currently declare no minimum browser version.

### Existing offline and runtime coverage

`tests/fixtures/github/README.md` documents seven sanitized real-source category fixtures and their honest eligible/no-op outcomes; commits, timelines, and search may legitimately contain no eligible timestamp in the recorded unauthenticated samples. `tests/integration/github-fixtures.test.ts` covers all paths, link preservation, explicit zoned sources, safe no-op, mutation, and restoration offline. `src/runtime/register-github.ts` already registers only `http://github.com/*` and `https://github.com/*`, at top-frame `document_start`. Existing coordinator, content, Options, popup, diagnostics, reporting, and all-six-emitted-artifact tests cover observable contracts without driving a real browser. A test-only synthetic adapter must never enter any shipped artifact.

### Honest compatibility and reporting prerequisites

Do not invent a version from memory or infer support for older browsers from the current stable smoke. Record each human-confirmed stable browser version and successful actual use of dynamic content-script registration/update/unregistration, one-shot execution, extension messaging/local storage, locale formatting, and IANA time-zone formatting. A defensible conservative manifest floor is the observed working current stable major; Chrome and Edge must use their observed **Chromium engine** version for `minimum_chrome_version`, while Firefox uses its observed Gecko/Firefox version in `browser_specific_settings.gecko.strict_min_version`. A lower floor requires separately approved authoritative compatibility evidence; no web lookup occurs without explicit network/browser authorization. Check the approved floor against the installed release before final reinstallation.

The report flow targets `https://github.com/maximtop/no-more-ago/issues/new`. If the public repository, Issues feature, or committed `Site report` template is not yet published, a real composer may be inaccessible despite correct extension-generated navigation. Record this as an external reporting blocker and ask the human for a decision; do not create/publish a repository, log in, submit an issue, silently change the URL, fabricate a passing result, or treat an unapproved waiver as acceptance.

## Entities

### Human-reviewed release evidence

- **Fields**: Human-granted scope; browser family and observed browser/engine version; release package version; checked category/scenario; sanitized route/category; expected/observed result; timestamp; result `not-run`, `pass`, `fail`, or `blocked`; minimal reproducible failure; selected browser minimum and its evidence; human route/reporting decision when needed.
- **Relationships**: Written only to an issue-local Markdown evidence document after permission and observation; never inserted into extension settings, diagnostics, fixtures, or remote services.
- **Validation**: No credentials, cookies, tokens, private repository names, full private URLs, query/hash data, page bodies, screenshots, DOM snapshots, source timestamp values, or fabricated results. Private-window evidence records only sanitized hostname/category and the explicitly permitted action.
- **States**: `not-run` → `pass`, `fail`, or `blocked`; a corrected failure changes to `pass` only after an actual approved rerun.

## Contracts

- **Human authorization**: Plan `Approved` → orchestrator pauses → explicit current-task browser permission and approved scope/human participation → only then implementation/manual navigation. Missing permission leaves the issue unimplemented and visibly blocked on human input.
- **Runtime**: Preserve existing exact-host, top-level `document_start` dynamic registration, already-open-tab one-shot activation, SPA/mutation ownership, exact restoration, and production GitHub-only adapter registry.
- **Manifest**: Maintain Manifest V3, package-derived version, existing background variant and permissions. Set Chrome/Edge `minimum_chrome_version` and Firefox `browser_specific_settings.gecko.strict_min_version` only from recorded human-confirmed runtime/API evidence; verify the parsed generated manifests for both modes, never source-text formatting.
- **Network/privacy**: No extension-originated request during normal processing, settings, or local diagnostics; opening the issue composer only after a separately approved user click; no submission, upload, automatic ZIP attachment, DOM capture, or cross-incognito-window report leak.
- **Route safety**: Every exact-`github.com` path remains eligible. Any proposed exclusion requires an observed reproducible safety failure, sanitized regression fixture, and explicit human approval; an absent timestamp is a safe no-op, not a reason to exclude a route.
- **New API endpoints**: None.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `.sdd/.current/issues/16-HITL/evidence.md` | Create only during explicitly approved HITL work | Record human-approved scope, browser/API observations, sanitized category matrix, minimum-version rationale, failures, retests, and decisions. |
| `tests/build/chrome-artifact.test.ts` | Modify after real version evidence | Assert actual parsed dev/release manifests expose the correct approved target-specific minimum versions and retain existing executable six-artifact behavior. |
| `src/manifest/chrome.json` | Modify after real Chrome/Chromium evidence | Declare only the observed, justified Chrome `minimum_chrome_version`. |
| `src/manifest/edge.json` | Modify after real Edge Chromium-engine evidence | Declare only the observed, justified Edge `minimum_chrome_version`. |
| `src/manifest/firefox.json` | Modify after real Firefox/Gecko evidence | Declare only the observed, justified Firefox `browser_specific_settings.gecko.strict_min_version`. |
| `tests/runtime/register-github.test.ts`, `tests/runtime/adapter-activation.test.ts`, `tests/background/application.test.ts`, `tests/build/chrome-artifact.test.ts` | Conditional modify only for a confirmed browser discrepancy | First reproduce the exact browser-visible registration, lifecycle, messaging, or emitted-artifact failure at the closest public runtime boundary. |
| `src/background/chrome.ts`, `src/runtime/register-github.ts`, `src/runtime/scripting.ts`, `src/runtime/tabs.ts`, `src/runtime/adapter-activation.ts` | Conditional modify only for a confirmed browser discrepancy | Apply the smallest browser/API compatibility repair inside the existing Browser Runtime boundary; preserve core and adapter contracts. |
| `tests/fixtures/github/README.md`, `tests/fixtures/github/*.html`, `tests/integration/github-fixtures.test.ts`, `tests/adapters/github.test.ts` | Conditional modify only for an approved reproducible live-markup discrepancy | Add a minimal hand-sanitized public/no-secret fixture and observable extraction/ownership regression before changing adapter rules. |
| `src/adapters/github.ts` | Conditional modify only for a confirmed trusted-source GitHub markup discrepancy | Preserve exact hostname, explicit authorized source, strict zoned timestamps, safe no-op, and shared controller ownership. |

## Tasks

### [ ] Task 1: Stop at the approved HITL gate and obtain narrowly scoped human authorization

**Files:**

- Read: `.sdd/.current/issues/16-HITL/issue.md`
- Create only after authorization: `.sdd/.current/issues/16-HITL/evidence.md`

- [ ] **Step 1:** After independent plan approval, pause the automatic pipeline before any HITL implementation or browser work and ask the user explicitly which current-task Chrome, Edge, Firefox, profile, extension-installation, live GitHub navigation, reporting-navigation, and optional private-window actions are authorized; request their participation.
- [ ] **Step 2:** If permission, an installed target browser, a suitable account/profile, private-window access, or the issue-tracker prerequisite is missing, record the missing prerequisite only after general HITL work is approved, explain the limitation, and stop that scoped action. Never open a browser, inspect browser UI, navigate, request a site, install an extension, sign in, create a repository, or execute automation without its specific permission.
- [ ] **Step 3:** Once permission is affirmative, create the sanitized evidence document with explicit approved scope, browser/category/scenario cells initially marked `not-run`, observed-version fields completed only from real observations, and separate private-window/reporting authorization flags.

**Verification**: The user explicitly granted current-task browser/HITL permission before any browser/network action; all unexecuted cells remain `not-run`, unauthorized actions are absent, and no private data is persisted.

### [ ] Task 2: Confirm offline release preflight and human-install the three approved candidates

**Files:**

- Read: `package.json`, `dist/release/chrome/manifest.json`, `dist/release/edge/manifest.json`, `dist/release/firefox/manifest.json`
- Update: `.sdd/.current/issues/16-HITL/evidence.md`

- [ ] **Step 1:** Show the human the three exact unpacked release directories and ZIP paths in Research, package version `0.1.0`, existing target-specific background forms, current absence of manifest minimums, declared `scripting`/`storage`/`<all_urls>`, and the local-only `pnpm release`/`pnpm check` commands. Rebuild only if current artifacts are stale or the user requests it.
- [ ] **Step 2:** Ask the human to identify the installed **current stable** Chrome, Edge, and Firefox versions and approve their chosen test profiles; record the actual browser version and, for Edge/Chrome, the actual Chromium engine major. Never infer installed applications, launch browsers, or access account/session data before permission.
- [ ] **Step 3:** With the user's active approval, have the human load Chrome and Edge from their corresponding unpacked release directories and load Firefox's corresponding temporary add-on manifest or another user-approved local loading method; confirm no onboarding/options page opens automatically and fresh settings start enabled with System presentation and debug logging off.
- [ ] **Step 4:** If a browser, extension-loading capability, private-window entitlement, or user account is unavailable, mark that browser/scenario `blocked` and request a human decision; do not download a browser, install dependencies, alter device policy, or claim successful installation.

**Verification**: Each approved browser/package pair is identified with its real observed version and installation outcome, no installation or browser launch occurs outside approved human scope, and unavailable targets remain visibly `blocked`.

### [ ] Task 3: Execute the same human-approved live GitHub route and lifecycle matrix in every browser

**Files:**

- Update: `.sdd/.current/issues/16-HITL/evidence.md`
- Read: `tests/fixtures/github/README.md`

- [ ] **Step 1:** After explicit GitHub-navigation approval, choose public or human-approved repository examples and execute all seven categories separately in Chrome, Edge, and Firefox: commits; issues/pull requests; comments/timelines; releases/tags; profiles/activity; search; and Actions. Record a sanitized category/path and the visible initial exact-date result or truthful safe no-op. Seek another approved example when a category has no eligible zoned source; if none is available, record `blocked` rather than claiming that replacement was exercised or proposing an exclusion.
- [ ] **Step 2:** In each target, verify fresh top-level navigation activates the existing `document_start` registration; a GitHub tab opened before installation/re-enable is processed without reload; GitHub client-side navigation, added/removed timelines, and changed valid/invalid timestamps retain exactly one semantic replacement or restore the original; containing links still work. Do not promise zero visual flicker or invent a numeric performance threshold.
- [ ] **Step 3:** In each target, switch global processing and the exact `github.com` hostname off/on while one or more GitHub documents remain open; observe immediate original restoration, no owned leftovers, policy persistence and precedence, and immediate reprocessing without a page reload. Reopening/restarting the user-approved extension/browser session is allowed only if the user explicitly approves that action.
- [ ] **Step 4:** Check a separately approved non-GitHub HTTP(S) hostname only if the user permits it: popup shows the exact hostname and no-rules status; changing its site preference remains available without DOM processing; ordinary unmodified browsing adds no site-history entry. Do not browse `gist.github.com`, enterprise hosts, or another site without explicit authorization.

**Verification**: Every category × browser and lifecycle × browser has a real sanitized `pass`, `fail`, or `blocked` observation; no full private URL/query/hash/page body is recorded; unsupported hosts stay unprocessed and no unreviewed route exclusion is introduced.

### [ ] Task 4: Validate settings, reporting, diagnostics, private behavior, and compatibility evidence

**Files:**

- Update: `.sdd/.current/issues/16-HITL/evidence.md`
- Read: `src/manifest/chrome.json`, `src/manifest/edge.json`, `src/manifest/firefox.json`

- [ ] **Step 1:** In each approved browser, verify English popup hostname/status/global/site controls and Options Sites/display: localized System format/time zone, valid custom format and UTC/IANA updates across open GitHub tabs, rejected invalid draft, durable reload, and single-click `Reset all settings` restoring enabled/System defaults, clearing manually managed hosts, disabling debug, and removing stored diagnostics without confirmation.
- [ ] **Step 2:** Verify `Debug logs` stays off by default; opt in explicitly, trigger a GitHub event, inspect only the user-approved local extension view/download, confirm sanitized hostname/category/environment without page URLs/content/timestamps, use `Download logs` to produce one local ZIP, use `Clear logs` while debug remains enabled, then disable debug and observe deletion. Record no secrets or ZIP contents in the evidence document and observe no automatic upload/network request.
- [ ] **Step 3:** Only after separate explicit authorization to open the public GitHub issue composer, click the popup's `Report this site` and Options `Open GitHub issue`; inspect the expected user-editable target, hostname/current URL, environment, and reason without submitting or attaching anything. Use a non-sensitive public current URL. If `maximtop/no-more-ago`, Issues, or the published template does not yet exist, record `blocked` and ask the human instead of creating a repository or substituting a different destination.
- [ ] **Step 4:** Only when the browser and user separately grant private/incognito extension access, repeat a minimal GitHub processing and opted-in sanitized diagnostic check, and verify any explicitly approved private reporting stays in the same private window. Otherwise mark private checks `blocked` or `not-run`; never alter browser entitlement or open private windows without permission.
- [ ] **Step 5:** Record the real working stable browser/engine versions plus observed scripting registration/update/unregistration/execution, runtime messaging/storage, locale, and IANA-zone API behavior. Propose the conservative observed-stable-major floor for each target; request human agreement. Research a lower floor only if the human separately authorizes the necessary official-source/network access; otherwise make no older-browser compatibility claim.

**Verification**: Every approved cross-browser UI/privacy/report scenario has actual evidence; the reporting repository prerequisite is not silently waived; debug stays opt-in/local; private checks require separate explicit approval; each proposed minimum references a recorded working browser/API observation.

### [ ] Task 5: Reproduce and repair only confirmed runtime/adapter discrepancies and set evidenced manifest floors

**Files:**

- Modify: `tests/build/chrome-artifact.test.ts`, `src/manifest/chrome.json`, `src/manifest/edge.json`, `src/manifest/firefox.json`
- Conditional test: `tests/runtime/register-github.test.ts`, `tests/runtime/adapter-activation.test.ts`, `tests/background/application.test.ts`, `tests/adapters/github.test.ts`, `tests/integration/github-fixtures.test.ts`
- Conditional modify: `src/background/chrome.ts`, `src/runtime/register-github.ts`, `src/runtime/scripting.ts`, `src/runtime/tabs.ts`, `src/runtime/adapter-activation.ts`, `src/adapters/github.ts`, `tests/fixtures/github/README.md`, `tests/fixtures/github/*.html`
- Update: `.sdd/.current/issues/16-HITL/evidence.md`

- [ ] **Step 1:** After a real discrepancy is observed, add its minimal **failing observable-behavior** regression at the existing public browser-runtime, adapter, fixture, document, or emitted-artifact boundary; run `pnpm exec vitest run tests/runtime/register-github.test.ts tests/runtime/adapter-activation.test.ts tests/background/application.test.ts tests/adapters/github.test.ts tests/integration/github-fixtures.test.ts` and confirm the relevant new case fails for the documented reason. Do not add source-text, private-symbol, fixture-layout, or arbitrary browser-utility assertions.
- [ ] **Step 2:** Apply only the smallest confirmed browser/API fix inside the existing background/runtime adapters, or a trusted-source markup fix inside `src/adapters/github.ts` with an independently hand-sanitized approved fixture. Never move browser conditions into shared formatting/ownership logic, broaden host activation, parse relative text/title/ARIA/data generically, add permissions/network, or modify the synthetic production boundary. Rerun the affected focused public-behavior tests and repeat the approved failing live scenario in each impacted browser.
- [ ] **Step 3:** Extend `tests/build/chrome-artifact.test.ts` to parse all six generated manifests and assert the exact separately recorded human-approved Chrome Chromium, Edge Chromium, and Firefox Gecko minimums alongside unchanged permissions/background forms/package version; confirm this new behavior initially fails because the existing manifests contain no minimum declarations.
- [ ] **Step 4:** Add only the documented observed `minimum_chrome_version` values to `src/manifest/chrome.json`/`src/manifest/edge.json` and the documented observed `browser_specific_settings.gecko.strict_min_version` to `src/manifest/firefox.json`. Run `pnpm release` and `pnpm exec vitest run tests/build/chrome-artifact.test.ts`; confirm all target/mode emitted-manifest assertions and existing CSP/runtime behavior pass. Do not fabricate version literals before observation or imply older-browser support.
- [ ] **Step 5:** If a route exposes a reproducible safety failure that cannot be safely corrected, create a minimal sanitized offline reproduction and document the proposed narrow exclusion and consequences. Stop and request the user's explicit decision before making any exclusion; no human decision means the issue remains incomplete.

**Verification**: Every production change has a preceding observable regression and real smoke finding; fixes remain in their established boundary, both generated modes declare only evidenced target-specific minimums, unchanged normal features remain green, and every route exclusion has explicit human approval.

### [ ] Task 6: Reinstall final release artifacts, rerun approved smoke, and publish an honest offline/HITL verdict

**Files:**

- Update: `.sdd/.current/issues/16-HITL/evidence.md`
- Verify: `dist/release/chrome/manifest.json`, `dist/release/edge/manifest.json`, `dist/release/firefox/manifest.json`, `tests/build/chrome-artifact.test.ts`

- [ ] **Step 1:** Run `pnpm dev`, `pnpm release`, and `pnpm check` locally. Require all six generated dev/release artifacts, unchanged exact GitHub-only registration/CSP behavior, evidenced minimum declarations, sanitized fixture regressions, lint, type checking, and at least the existing 32-file/832-test behavioral baseline to pass without browser automation, network services, Git, or Corepack.
- [ ] **Step 2:** With the original still-valid explicit human approval, have the human reload/reinstall the **final** matching release candidate in each browser, confirm its declared minimum accepts that actual browser, rerun the seven-route and lifecycle matrix plus affected settings/reporting/privacy cases, and record the actual final package/browser versions and results. Ask again before any action outside the approved scope.
- [ ] **Step 3:** Audit the evidence for all acceptance criteria, browser/API floors, updated sanitized fixtures, route decisions, reporting prerequisites, and the complete automated gate. Mark release smoke successful only when Chrome, Edge, and Firefox and every required category/scenario have actual passing evidence or an explicit human-approved product decision; otherwise leave the issue incomplete and request the missing human action.

**Verification**: Fresh final artifacts and the full offline suite pass; all required live checks have honest human-observed evidence; unresolved permission, browser, route, reporting, privacy, or compatibility questions prevent HITL sign-off; no ongoing future-site compatibility is promised.
