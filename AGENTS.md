# AGENTS.md

## Table of Contents

- [AGENTS.md](#agentsmd)
  - [Project Overview](#project-overview)
  - [Technical Context](#technical-context)
  - [Project Structure](#project-structure)
  - [Build And Test Commands](#build-and-test-commands)
  - [Contribution Instructions](#contribution-instructions)
  - [Code Guidelines](#code-guidelines)
    - [System Design](#system-design)
    - [Architecture](#architecture)
    - [Code Quality](#code-quality)
    - [Testing](#testing)
    - [Dependency Management](#dependency-management)
    - [Configuration & Documentation](#configuration--documentation)
    - [Markdown Formatting](#markdown-formatting)
    - [Other](#other)

## Project Overview

No More Ago is a Manifest V3 browser extension that replaces eligible standard
HTML and trusted specialized timestamps with exact, localized values only when
the current page-owned label is recognized as relative time. It ships a generic
instant-only `time[datetime]` source for HTTP(S) documents,
specialized sources for Facebook, GitHub, Hacker News, supported Stack Exchange
Q&A sites, Telegram Web K, TikTok, best-effort LinkedIn timestamps, and Bluesky,
plus a
best-effort canonical YouTube watch publication source for calendar dates or
explicitly zoned instants. Facebook uses a narrowly scoped main-world payload
bridge for selected Story-bearing GraphQL responses. The bridge is inert by
default, follows the shared content-runtime activity lifecycle, and transfers
only bounded tracking-token and Unix-seconds records. Instagram uses a
site-specific presentation rule for its standard timestamps. TikTok direct
pages use in-place presentation; profile grids have no specialized rule because
cards expose no existing timestamp label. Bluesky is remote-enriched through
anonymous public AppView lookups. Public `https://t.me/s/*` pages use the
generic source. Timestamp extraction remains separate from current-label
classification, semantic validation, presentation, and rendering.

The extension provides a global switch, a run mode (`All supported sites` or
`Selected sites only`) with independent Excluded sites and Allowed sites
lists, date format and time-zone settings, an Appearance choice (`System`,
`Light`, or `Dark`), and opt-in diagnostic logs. The UI ships 40 translated
locale catalogs and uses the browser-selected catalog, falling back to English.
Chrome, Firefox, and Edge are build targets; Safari is out of scope.

## Technical Context

- **Project type:** Client-only Manifest V3 browser extension.
- **Language:** TypeScript 6 with strict compiler settings and ES modules.
- **Runtime:** Node.js 24 for builds; browser extension contexts in production.
- **Package manager:** pnpm 10.34.5, pinned in `package.json`.
- **UI:** React 19 and Mantine 9 for popup and options pages; XState 5 with
  `@xstate/react` for stateful UI controllers.
- **Date handling:** date-fns 4 and `@date-fns/tz`.
- **Validation:** Domain validation for page-derived timestamps and
  user-authored date settings; internal extension data uses TypeScript
  contracts.
- **Bundling:** Rspack builds browser-specific extension artifacts.
- **Storage:** `chrome.storage.local` stores one versioned settings snapshot
  (`SettingsSnapshot`, schema version 1) with its previous-snapshot recovery
  copy, plus opt-in diagnostics. A stored snapshot of any other schema version
  is discarded rather than migrated, because nothing is published: defaults
  are written back to both the active and recovery keys, the load reports
  source `discarded`, and a `console.warn` is emitted.
- **Diagnostics:** Logging is opt-in and capped at 5,000,000 stored bytes.
- **Relative labels:** A conservative shared classifier covers 40 confirmed
  locales using current page language and browser locale evidence. Unknown,
  absolute, clock, and absent labels fail closed.
- **Interface language:** `src/shared/i18n/locales.ts` holds the 40-entry UI
  registry and the browser-language resolver; `src/shared/i18n/translator.ts`
  wraps `@adguard/translate` and exposes `t`, `tPlural` and
  `applyDocumentLocale`. Catalogs live in `src/_locales/<code>/messages.json`.
  Each catalog identifies its language through `catalog_locale`, so plural
  rules and document direction follow the browser-selected catalog even when
  Firefox selects a secondary UI language. Runtime bundles omit translator
  notes; the packaged catalogs retain them.
  This registry is deliberately independent of
  `CANONICAL_RELATIVE_TIME_LOCALES`; neither module imports the other, and the
  two 40-language sets differ. Placeholders carry only untranslated values —
  hostnames, numbers, format patterns — never another translated string.
- **Testing:** Vitest with JSDOM and offline HTML fixtures.
- **Static checks:** ESLint with type-aware TypeScript and JSDoc rules.
- **Browser targets:** Chrome, Firefox, and Edge.
- **Permissions:** `<all_urls>` is intentional so the universal HTTP(S)
  runtime can process standard timestamps and future specialized sources;
  `webNavigation` enumerates HTTP(S) frames for verified settings refreshes.
- **Current site support:** Generic HTTP(S) `time[datetime]` processing is
  available, including public `https://t.me/s/*` pages. The production registry
  contains Facebook, GitHub, Hacker News, Stack Exchange, Telegram Web K,
  direct TikTok, best-effort LinkedIn, and canonical desktop YouTube watch-page
  publication sources, plus an Instagram in-place presentation rule for
  standard timestamps. Exact `bsky.app` documents prepend a document-scoped
  Bluesky rule whose anonymous resolution is limited to the fixed public
  AppView origin. Every rule requires an existing recognized relative label
  before its trusted value can render.
- **Performance:** Keep content-script observation incremental and scoped.
- **Compatibility:** Site markup may change; adapter behavior is best-effort.

All direct dependencies and development dependencies are exactly pinned.
`.npmrc` enforces exact saves and strict peer dependencies. No current package
has an obvious, simpler standard-library replacement.

## Project Structure

~~~text
.
├── .github/
│   ├── actions/                # Composite toolchain setup shared by workflows
│   └── workflows/              # CI, release, and Chrome Web Store deployment
├── assets/
│   ├── store-listings/         # 40 ready-to-paste localized descriptions
│   └── store/                  # Finished Chrome listing images
├── docs/                      # Privacy, support, and Chrome materials handoff
├── src/
│   ├── assets/                 # Icon SVG master and exported PNGs
│   ├── background/             # Service-worker composition root
│   │   ├── application/        # Lifecycle and coordination
│   │   ├── diagnostics/        # Opt-in bounded diagnostic journal
│   │   ├── projection/         # UI read models
│   │   ├── runtime/            # Script and tab integration
│   │   └── settings/           # Settings persistence
│   ├── _locales/               # WebExtension message catalogs, one per UI locale
│   ├── content-script/         # Page-side timestamp processing
│   │   ├── adapters/           # Generic and specialized site sources
│   │   ├── facebook/           # Story payload parser, bridge, and record store
│   │   └── transformation/     # Resolve, format, render, and restore
│   ├── manifest/               # Common and browser-specific manifests
│   ├── options/                # Settings page and feature sections
│   ├── popup/                  # Toolbar popup
│   └── shared/                 # Cross-context contracts and boundary schemas
│       ├── diagnostics/        # Diagnostic contracts, events, archive, and download helper
│       ├── i18n/               # UI locale registry, resolver, and translation runtime
│       ├── settings/           # Snapshot, hostname, and site-scope contracts
│       └── ui/                 # Theme, brand mark, cross-surface copy, hooks, and browser download runtime
├── scripts/
│   ├── build.ts                # Build command entry point
│   ├── validate-locales.ts     # Catalog integrity check run by pnpm check
│   ├── audit-locales.ts        # Release-time hardcoded-copy and orphan-key audit
│   ├── build/                  # Build pipeline and artifacts
│   └── icons.ts                # Icon PNG export from the SVG master
├── tests/
│   ├── src/                    # Tests mirroring src/
│   └── scripts/                # Tests mirroring scripts/
├── .env.example                # Variable names for the local store commands
├── eslint.config.ts            # Lint, style, and JSDoc rules
├── rspack.config.ts            # Browser bundle entry points
├── tsconfig.json               # Strict TypeScript configuration
└── vitest.config.ts            # JSDOM test configuration
~~~

Keep `tests/src` and `tests/scripts` aligned with their production roots.
Place content-script fixtures under `tests/src/content-script/fixtures`.

## Build And Test Commands

Run commands from the repository root.

| Command | Purpose |
| --- | --- |
| `pnpm install` | Install the exactly pinned dependency graph. |
| `pnpm dev` | Build development artifacts for all browser targets. |
| `pnpm dev chrome --watch` | Watch and rebuild the Chrome development artifact. |
| `pnpm dev firefox --watch` | Watch and rebuild the Firefox development artifact. |
| `pnpm dev edge --watch` | Watch and rebuild the Edge development artifact. |
| `pnpm release` | Build release artifacts for all browser targets. |
| `pnpm release chrome` | Build the Chrome release artifact. |
| `pnpm release firefox` | Build the Firefox release artifact. |
| `pnpm release edge` | Build the Edge release artifact. |
| `pnpm lint` | Run ESLint, formatting rules, and JSDoc checks. |
| `pnpm typecheck` | Run TypeScript without emitting files. |
| `pnpm test` | Run the Vitest suite once. |
| `pnpm check` | Run lint, type checking, catalog validation, and tests. |

The Makefile provides optional compatibility wrappers for non-watch development
and release builds, plus `chrome_status`, `chrome_update`, and `chrome_publish`
fallbacks that drive the Chrome Web Store with `go-webext` and the gitignored
`.env`. Prefer the direct pnpm commands above, and the tagged release and
deployment workflows described in `DEVELOPMENT.md` for real releases. There is
no separate formatter or development server. Load the relevant artifact from
`dist/` as an unpacked or temporary extension when manual browser verification
is needed.

## Contribution Instructions

- Run `pnpm lint` and `pnpm typecheck` before submitting changes.
- Update focused unit or integration tests for changed observable behavior.
- Run `pnpm test` and ensure the complete test suite passes.
- Run the affected development or release build when build output can change.
- Update this `AGENTS.md` structure map when directories or major boundaries
  change.
- Extract a reusable code guideline into this file when a review or refactor
  prompt reveals a rule that should apply beyond the immediate change.
- Verify every change against all applicable rules in
  [Code Guidelines](#code-guidelines).
- Keep pull requests focused and avoid unrelated cleanup.
- Preserve user changes already present in the working tree.

## Code Guidelines

### System Design

- Keep browser permissions no broader than the product contract. `<all_urls>`
  is intentional for the universal HTTP(S) runtime; only the generic source
  and registered specialized rules may transform content.
- Register one universal HTTP(S) document runtime at `document_start` with
  `allFrames` enabled. Global policy controls registration; the top-level
  hostname's scope rule controls processing for every reachable frame in its
  tab: in `All supported sites` a hostname runs unless it is in Excluded
  sites, and in `Selected sites only` it runs only when it is in Allowed
  sites. Hydrate reachable frames on startup and policy refresh without
  duplicating runtimes.
- Keep the scope decision in `isSiteProcessingEnabled`; no consumer may
  inspect either hostname list directly. Both lists persist independently of
  the active mode, and a mode change never moves an entry. Each list is capped
  at `MAX_SITE_LIST_ENTRIES` (1000) hostnames; adding beyond the cap fails
  with a list-is-full notice.
- Announce every committed settings write to open extension pages through the
  background broadcast, and treat a delivery failure as normal, because no
  page has to be open. Surfaces refetch when the announced revision is newer
  than the one they render.
- Register the Facebook `MAIN`-world bridge at `document_start` in every
  matching Facebook frame, but keep it inert until the isolated runtime signals
  activity. For already-open tabs, inject it only into enumerated Facebook
  frame IDs. Disable must stop inspection and clear temporary associations.
- Keep site knowledge in adapters. Shared timestamp validation, formatting,
  restoration, settings, and diagnostics must remain site-agnostic.
- Require every `TimestampSourceRule` to keep trusted timestamp extraction
  separate from current-label classification. Use the shared 40-locale
  classifier where applicable, never derive the timestamp from the label, and
  fail closed when presentation evidence is absent or unknown.
- Keep the content script lightweight. Process matching mutations
  incrementally, avoid repeated whole-document scans, and release observers
  when the extension or domain is disabled.
- Keep the content-side rule order explicit. Extract and resolve values strictly
  in that order, skip lower extractors after one source resolves, and keep the
  generic `time[datetime]` fallback last.
- Keep Bluesky public enrichment in its document-local coordinator. Use only
  credential-free bounded GET requests to `https://public.api.bsky.app`, retain
  successful caches only while connected sources reference them, abort on a
  finite request deadline or teardown, and do not add polling, durable state,
  or presentation-text fallback parsing.
- Bound loaded page-data parsing. Reuse at most one YouTube player-response
  parse record per document, including invalid results, and invalidate it when
  the selected assignment element or exact text changes or becomes ambiguous.
- Scope dynamic-route provenance to the current URL and lifecycle generation.
  Identity-bound loaded data may remain live when its identity matches the
  current route, but unbound reused data must fail closed until a full-document
  boundary or another real identity relation exists. Sample the live URL before
  mutation processing. When a route change alters adapter provenance, advance
  the generation and restore verified ownership before producing current-route
  output; route-irrelevant changes must not tear down existing output. Accept
  queued route-observer work only for the exact current generation, URL,
  document, session, source, and trusted value.
- Qualify a third-party list shape from one provenance-backed capture that
  joins route and card identity, the visible source, and its loaded record.
  Keep eligibility inside that capture's evidenced loaded record set. Outer
  mixed renderer types, recursively found identities, and DOM identities
  outside that set remain unqualified until their own same-capture
  relationships are established. When a loaded publication field varies
  across array positions in identity-bound records, require one unique exact
  visible/loaded label relationship and validate every evidenced variant per
  record. Never choose one global array position or promote adjacent or
  continuation values. Preserve only minimal sanitized structure. Never
  create source trust from separate examples, array order, invented equality,
  or adversarial mutations.
- Treat every extension context as independent. Coordinate popup, options,
  background, and content scripts through typed messages and durable state.
- Assume the background service worker can stop between events. Do not rely on
  process memory as the sole source of durable state.
- Trust extension-owned storage values, internal runtime messages, and typed
  browser API results. Do not add runtime object-shape guards solely to defend
  against those values being tampered with or browser contracts changing.
- Validate page-derived candidates and user-authored values when domain rules
  cannot be expressed by TypeScript. Page markup is untrusted even when an
  adapter recognizes it.
- Preserve trusted value semantics. Zoned date-times resolve to absolute
  instants; strict adapter-approved `YYYY-MM-DD` values resolve to calendar
  dates and never enter instant or configured-time-zone formatting.
- Accept generic timestamps only from valid `<time datetime>` elements with a
  complete explicitly zoned global date-time. Accept calendar dates and other
  derived timestamps only from explicit approved adapter sources. Never infer
  a value from relative text or ambiguous data.
- Treat LinkedIn's accepted `activity`, `ugcPost`, `share`, and `comment` ID
  timestamps as best-effort ID creation/allocation time. Keep ID grammar,
  decoding, local association, nesting, and presentation delimiters in the
  LinkedIn adapter boundary.
- Never derive a LinkedIn instant from relative or display text. Reject missing,
  malformed, future, or ambiguous local ID evidence without a network fallback
  or page mutation.
- Keep async browser operations explicit and handle unavailable tabs, pages,
  storage, and workers without leaving partially applied UI state.
- Bound browser operations that gate background initialization or UI queries.
  A pending operation for one stale or discarded tab must become a contained
  runtime failure and must not block popup or settings availability.
- Restore original page text immediately when global or per-hostname
  processing is disabled, and reprocess the current document when it is
  enabled.
- Keep settings schema versions and forward migrations explicit. Before store
  publication, do not add backward compatibility unless a real persisted
  release requires it.
- Keep diagnostics opt-in, sanitized, bounded, and independent from normal
  timestamp processing. Disabling diagnostics must remove stored logs.

### Architecture

Apply these principles throughout the project:

- **Separation of concerns:** Separate browser integration, application
  coordination, domain transformation, persistence, and presentation.
- **Single responsibility:** Give each module one cohesive reason to change.
- **Dependency inversion:** Depend on narrow capabilities at orchestration
  boundaries instead of reaching directly into browser globals.
- **Interface segregation:** Expose only the operations each consumer needs.
- **Explicit dependencies:** Pass collaborators and capabilities visibly;
  avoid hidden mutable globals.
- **High cohesion and low coupling:** Keep related behavior together and
  communicate between features through small contracts.
- **DRY:** Centralize stable contracts and repeated domain behavior, not
  coincidental syntax.
- **KISS:** Prefer direct control flow and browser APIs over defensive
  frameworks or speculative infrastructure.
- **YAGNI:** Do not build unused adapters, compatibility layers, import/export,
  or other speculative features without a current requirement.

| Layer | Responsibilities | May depend on |
| --- | --- | --- |
| UI | Render popup/options and issue typed requests | Shared contracts |
| Background composition | Adapt Chrome APIs and create the application | Application and browser APIs |
| Application | Coordinate lifecycle, settings, activation, and projections | Focused background services |
| Content script | Observe documents and apply transformations | Shared contracts and adapters |
| Adapters | Apply generic fallback and site-specific sources | Content adapter contracts |
| Shared | Own schemas, messages, values, settings, and date contracts | General-purpose libraries |
| Shared UI | Provide the theme, brand mark, and subscription hook | Shared contracts, React, Mantine, and browser DOM |
| Build | Assemble manifests, bundles, and archives | Source contracts and build tooling |

The expected dependency flow is:

~~~text
popup/options
    -> shared message contracts
    -> background composition
    -> application and focused services
    -> browser APIs

content script
    -> adapter registry
    -> timestamp resolution and formatting
    -> page rendering and restoration

all browser contexts
    -> shared contracts
~~~

Do not import background implementations from popup, options, or content-script
code. `shared` must not depend on browser-context implementations.

Keep site route, selector, and source provenance in its adapter and shared
adapter contract. YouTube watch matching, loaded assignment properties, and
metadata knowledge belong to the YouTube modules; shared calendar and instant
parsing and presentation remain site-agnostic.

Known architectural exclusions to improve when their area changes:

- `src/shared/reporting/site-report.ts` contains both report composition and a
  browser implementation. Split the pure report model from browser execution
  when reporting behavior expands.
- Content processing keeps registry injection for tests and one content-side
  production registry. Keep generic processing as the final fallback after
  specialized rules so adding a source does not add site branches to shared
  transformation code.

### Code Quality

- Use strict TypeScript and preserve `noUncheckedIndexedAccess` and
  `exactOptionalPropertyTypes` guarantees.
- Parse genuinely external values once at their boundary with Valibot or a
  focused parser, then trust the parsed type downstream. Do not revalidate
  extension-owned storage, internal messages, or typed browser API results.
  Keep schemas in the modules that parse: page payloads, network responses, the
  Facebook cross-world bridge, and document-supplied diagnostic fields. Every
  other contract is a plain type, because a schema nothing parses is dead
  runtime code standing in for a type declaration.
- Never write hand-rolled type guards such as `isRecord` or
  `typeof value === "object" && value !== null && !Array.isArray(value)`
  chains. A guard over data the extension produced itself hides a producer bug
  instead of failing loudly, and a parameter typed `unknown` for such data is
  the usual root cause: type it with the owning contract instead.
- Messages between extension contexts are trusted. Dispatch by casting to the
  message union and reading its `type`. What still needs checking is whether an
  answer arrived at all, since a frame may hold no runtime and a worker may
  restart: acknowledgements must carry the exact revision that was sent, a
  mutation with no response rereads state, and a per-surface command takes only
  the response projected for the surface that asked.
- Use typed result objects for expected failures. Reserve exceptions for
  programmer errors and truly exceptional failures.
- Do not inline magic values that form a shared contract, including runtime
  message types, storage keys, adapter identifiers, artifact filenames, and
  operational limits.
- Declare each shared value once as a named constant in the module that owns
  the contract, then import and reuse it in production code and tests.
- Prefer precise imports and exports from owning modules; avoid export-star
  barrels that obscure a contract's source.
- Keep related finite value sets in readonly `as const` collections and derive
  their TypeScript unions and validators from those collections when practical.
- Do not inline discriminants that cross a module boundary. Use the owning
  contract's named constants in type declarations, result construction,
  narrowing, production code, and tests.
- Allow inline literals only for one-off user-facing copy, self-explanatory
  local test data, or a serialized value that is itself under test.
- Keep source modules focused on one responsibility. Do not place an entire
  application surface in one file.
- Extract independently renderable UI sections, feature-specific state
  coordination, and domain transformations into focused modules as they grow.
- Prefer cohesive feature boundaries over moving a large implementation
  unchanged into a generic helper or controller file.
- Document files, functions, classes, methods, interfaces, type properties,
  class properties, exported variables, and named arrow functions declared
  inside a function body according to the ESLint JSDoc rules. Describe every
  parameter and return value. Anonymous callbacks passed as arguments need no
  block.
- Model a controller that coordinates loading, committed state, drafts,
  in-flight commands, and notices as an XState machine (`setup().createMachine`
  driven by `useMachine`) so every legal combination and transition has one
  owner; keep plain `useState` for a single independent value.
- Use four-space indentation, braces for every control-flow body, and no
  single-line brace blocks. Keep code and comments at or below 100 characters.
- Prefer descriptive names and small functions over explanatory comments.
- Remove unused fields, parameters, branches, abstractions, and compatibility
  paths as soon as they stop serving observable behavior.

### Testing

- Mirror `src` under `tests/src` and `scripts` under `tests/scripts`.
- Test observable behavior through the closest public or runtime boundary.
- Keep tests to the minimum set that protects important behavior, failure
  handling, persistence, message routing, and build output.
- Prefer small behavior-level matrices and lifecycle tests at public
  boundaries; do not add structural tests merely to cover every requirement.
- Do not bypass TypeScript with casts to test impossible storage, message, or
  browser API shapes. Test domain constraints and observable failure modes.
- Do not read implementation files as text to assert formatting, command
  spelling, private symbols, source layout, or implementation structure.
- Use injected browser capabilities and focused doubles instead of reproducing
  browser internals.
- Use JSDOM for DOM behavior and offline fixtures for site markup.
- Inject a fake AppView capability for Bluesky tests; automated tests must not
  call the live public service.
- Keep fixture data deterministic and free of network dependencies.
- Cover a regression when fixing a user-visible failure that can reasonably
  recur.
- For every production timestamp rule, pair an eligible relative-label case
  with an absolute, unknown, ambiguous, or absent-label case. Assert observable
  transformation or non-transformation through the public processing boundary.
- Do not add test-only hooks or production events solely to inspect internal
  implementation steps.
- There is no required coverage threshold or end-to-end suite currently. Add
  either only when it protects a concrete risk.

### Dependency Management

- Pin every direct and development dependency to an exact version.
- Prefer the platform, standard library, or existing dependency when it solves
  the requirement clearly.
- Add a dependency only when it materially simplifies maintained production
  code or provides a difficult, well-tested capability.
- Choose reputable, actively maintained packages with healthy adoption.
- Avoid obscure or unpopular packages when a small local implementation or an
  established package is sufficient.
- Minimize overlapping packages and remove dependencies that no longer serve
  production or build behavior.
- Check the package registry for the latest stable compatible release before
  adding or upgrading a package.
- Keep `package.json`, `pnpm-lock.yaml`, and any affected imports in the same
  change.
- Do not use Corepack. Invoke the installed pnpm executable directly.

### Configuration & Documentation

- Treat `package.json` scripts, build CLI arguments, runtime message types,
  manifest fields, storage keys, and artifact names as public project
  contracts.
- Assemble manifests from `src/manifest/common.json` and one browser-specific
  variant. Keep browser differences declarative where possible.
- Treat the GitHub Release asset names (`no-more-ago-<version>-<browser>.zip`,
  `no-more-ago-<version>-source.zip`, and `SHA256SUMS.txt`) and the checksum
  file format (GNU `sha256sum` lines with bare asset names, generated and
  checked inside the directory holding the assets) as one contract shared by
  `release.yml`, `deploy-chrome-store.yml` (which selects the Chrome archive
  by its `-chrome.zip` suffix), `DEVELOPMENT.md`, and the README installation
  steps. Change them together.
- Keep settings in one typed, schema-versioned document and persist the current
  and previous snapshots together.
- Route settings writes through the background settings service so concurrent
  popup and options updates remain serialized. Validate only user-authored
  values with domain constraints that TypeScript cannot express.
- Keep diagnostic storage separate from settings storage. Diagnostic failures
  must never corrupt settings or block timestamp transformations.
- Store operational limits and cross-module identifiers in their owning
  contract modules rather than duplicating literals.
- Update comments and this file when behavior, commands, architecture, or
  supported targets change. Do not promise compatibility with third-party site
  markup.
- Never place secrets, page content, authentication data, or unnecessary
  personal data in logs, fixtures, documentation, or build artifacts.

### Markdown Formatting

- Wrap prose at 80 characters where practical.
- Use dashes for unordered lists and asterisks only for emphasis.
- Use one H1 heading per document and do not skip heading levels.
- Do not duplicate headings at the same level unless their generated anchors
  remain unambiguous.
- Use Markdown constructs instead of HTML. Use HTML only when Markdown cannot
  express the required result.
- Do not add trailing spaces or use two trailing spaces for hard line breaks.
- Bare URLs are acceptable when a label adds no useful context.
- Keep tables compact with one space around cell contents. A compact table may
  exceed 80 characters when wrapping would make it unreadable.

### Other

- Keep store materials as ready-to-paste text and finished images. Review
  translations with an independent agent. Do not add generators, dedicated
  validators, or review-tracking infrastructure for one-time preparation.
  Store field limits need dated official evidence; distinguish editorial
  budgets from store rules.

- Keep source copy and translator notes in the English catalog; translate
  user-facing copy through the shipped UI catalogs.
- Build for Chrome, Firefox, and Edge. Do not add Safari support without an
  explicit requirement.
- Keep GitHub-, Hacker News-, Stack Exchange-, Instagram-, Telegram Web K-, and
  TikTok-, LinkedIn-, Bluesky-, and YouTube-specific selectors, timestamp sources,
  presentation rules, and trusted evidence logic inside their respective
  adapters so adding or repairing a source changes minimal shared business
  logic. Keep TikTok URL, selector, hydration, and ID-decoding knowledge in
  `src/content-script/adapters/tiktok*.ts`. Public `t.me/s/*` support remains on
  the generic standard timestamp source. Keep Bluesky batching, caching, and
  stale-result state in its focused document-local coordinator.
- Keep adapter-specific relative-label profiles and retained delimiters inside
  their adapter boundary while using the shared classifier implementation.
  Sources without an existing page-owned timestamp label must remain unowned.
- Keep Facebook DOM recognition in its adapter and its main/isolated payload
  lifecycle under `src/content-script/facebook`.
- Keep YouTube route matching, selectors, loaded publication properties, and
  metadata provenance inside the YouTube contract and adapter. Treat its
  current watch markup as a best-effort source, not a compatibility promise.
- Treat third-party site support as best-effort because markup can change
  independently of the extension.
- Ship the mark as `src/assets/icons/icon.svg` with `icon-16.png`,
  `icon-32.png`, `icon-48.png`, and `icon-128.png` exported from it by
  `pnpm icons` (`scripts/icons.ts`), and as the inline brand mark on both
  surfaces. The build test asserts each emitted PNG's pixel dimensions. Both
  the popup and Settings take their colors from the shared theme in
  `src/shared/ui`, in light and dark, so neither surface may declare its own
  palette.
