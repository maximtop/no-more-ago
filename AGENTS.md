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
HTML and trusted specialized relative timestamps with exact, localized dates.
It ships a generic `time[datetime]` source for HTTP(S) documents and
site-specific specialized sources for GitHub, Hacker News, supported Stack
Exchange Q&A sites, and Telegram Web K, while keeping extraction separate from
shared timestamp validation and rendering. Public `https://t.me/s/*` pages use
the generic source.

The extension provides a global switch, per-domain switches, date format and
time-zone settings, and opt-in diagnostic logs. The UI is English-only.
Chrome, Firefox, and Edge are build targets; Safari is out of scope.

## Technical Context

- **Project type:** Client-only Manifest V3 browser extension.
- **Language:** TypeScript 6 with strict compiler settings and ES modules.
- **Runtime:** Node.js 24 for builds; browser extension contexts in production.
- **Package manager:** pnpm 10.34.5, pinned in `package.json`.
- **UI:** React 19 and Mantine 9 for popup and options pages.
- **Date handling:** date-fns 4 and `@date-fns/tz`.
- **Validation:** Domain validation for page-derived timestamps and
  user-authored date settings; internal extension data uses TypeScript
  contracts.
- **Bundling:** Rspack builds browser-specific extension artifacts.
- **Storage:** `chrome.storage.local` stores settings and opt-in diagnostics.
- **Diagnostics:** Logging is opt-in and capped at 5,000,000 stored bytes.
- **Testing:** Vitest with JSDOM and offline HTML fixtures.
- **Static checks:** ESLint with type-aware TypeScript and JSDoc rules.
- **Browser targets:** Chrome, Firefox, and Edge.
- **Permissions:** `<all_urls>` is intentional so the universal HTTP(S)
  runtime can process standard timestamps and future specialized sources;
  `webNavigation` enumerates HTTP(S) frames for verified settings refreshes.
- **Current site support:** Generic HTTP(S) `time[datetime]` processing is
  available, including public `https://t.me/s/*` pages. The production registry
  contains GitHub, Hacker News, Stack Exchange, and Telegram Web K as
  specialized sources.
- **Performance:** Keep content-script observation incremental and scoped.
- **Compatibility:** Site markup may change; adapter behavior is best-effort.

All direct dependencies and development dependencies are exactly pinned.
`.npmrc` enforces exact saves and strict peer dependencies. No current package
has an obvious, simpler standard-library replacement.

## Project Structure

~~~text
.
├── src/
│   ├── assets/                 # Extension icons
│   ├── background/             # Service-worker composition root
│   │   ├── application/        # Lifecycle and coordination
│   │   ├── diagnostics/        # Opt-in bounded diagnostic journal
│   │   ├── projection/         # UI read models
│   │   ├── runtime/            # Script and tab integration
│   │   └── settings/           # Settings persistence
│   ├── content-script/         # Page-side timestamp processing
│   │   ├── adapters/           # Generic fallback and site-specific sources
│   │   └── transformation/     # Resolve, format, render, and restore
│   ├── manifest/               # Common and browser-specific manifests
│   ├── options/                # Settings page and feature sections
│   ├── popup/                  # Toolbar popup
│   └── shared/                 # Cross-context schemas and contracts
├── scripts/
│   ├── build.ts                # Build command entry point
│   └── build/                  # Build pipeline and artifacts
├── tests/
│   ├── src/                    # Tests mirroring src/
│   └── scripts/                # Tests mirroring scripts/
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
| `pnpm check` | Run lint, type checking, and tests. |

The Makefile provides optional compatibility wrappers for non-watch development
and release builds. Prefer the direct pnpm commands above. There is no separate
formatter or development server. Load the relevant artifact from `dist/` as an
unpacked or temporary extension when manual browser verification is needed.

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
  hostname controls processing for every reachable frame in its tab. Hydrate
  reachable frames on startup and policy refresh without duplicating runtimes.
- Keep site knowledge in adapters. Shared timestamp validation, formatting,
  restoration, settings, and diagnostics must remain site-agnostic.
- Keep the content script lightweight. Process matching mutations
  incrementally, avoid repeated whole-document scans, and release observers
  when the extension or domain is disabled.
- Keep the content-side rule order explicit: specialized rules run before the
  generic `time[datetime]` fallback, and the generic rule is always last.
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
- Accept timestamps only from valid `<time datetime>` elements or an explicit
  adapter source. Never infer a timestamp from relative text or ambiguous
  values.
- Keep async browser operations explicit and handle unavailable tabs, pages,
  storage, and workers without leaving partially applied UI state.
- Restore original page text immediately when global or per-domain processing
  is disabled, and reprocess the current document when it is enabled.
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

Known architectural exclusions to improve when their area changes:

- `BackgroundApplicationOptions` exposes concrete `SettingsService` and
  `DiagnosticJournal` types. Prefer narrow capability interfaces when those
  collaborators next need meaningful changes.
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
  focused parser. Do not revalidate extension-owned storage, internal messages,
  or typed browser API results with generic record checks.
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
  class properties, and exported variables according to the ESLint JSDoc
  rules. Describe every parameter and return value.
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
- Keep fixture data deterministic and free of network dependencies.
- Cover a regression when fixing a user-visible failure that can reasonably
  recur.
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

- Keep all user-facing extension copy in English.
- Build for Chrome, Firefox, and Edge. Do not add Safari support without an
  explicit requirement.
- Keep GitHub-, Hacker News-, Stack Exchange-, and Telegram Web K-specific
  selectors and timestamp sources inside their respective adapters so adding
  another site changes minimal shared business logic. Public `t.me/s/*`
  support remains on the generic standard timestamp source.
- Treat third-party site support as best-effort because markup can change
  independently of the extension.
