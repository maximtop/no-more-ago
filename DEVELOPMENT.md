# Development

## Table of Contents

- [Development](#development)
  - [Table of Contents](#table-of-contents)
  - [Prerequisites](#prerequisites)
  - [Getting Started](#getting-started)
    - [Clone and Install](#clone-and-install)
    - [Configure the Environment](#configure-the-environment)
    - [Run the Extension](#run-the-extension)
  - [Development Workflow](#development-workflow)
    - [Branches and Pull Requests](#branches-and-pull-requests)
    - [Development Builds](#development-builds)
    - [Quality Checks](#quality-checks)
    - [Runtime Architecture](#runtime-architecture)
    - [Release Builds](#release-builds)
    - [Makefile Aliases](#makefile-aliases)
  - [Common Tasks](#common-tasks)
    - [Run a Focused Test](#run-a-focused-test)
    - [Add or Update a Site Adapter](#add-or-update-a-site-adapter)
    - [Debug the Extension](#debug-the-extension)
  - [Troubleshooting](#troubleshooting)
  - [Additional Resources](#additional-resources)

## Prerequisites

Install these tools before working on the project:

- Node.js 24.x. The supported engine range is `>=24 <25`.
- pnpm 10.34.5, installed directly. Do not use Corepack.
- Git with access to the private
  `git@github.com:maximtop/no-more-ago.git` repository.
- Chrome, Firefox, or Edge for manual extension testing.
- GNU Make only if you want to use the optional Makefile aliases.

Confirm the active versions:

~~~sh
node --version
pnpm --version
~~~

The expected pnpm version is `10.34.5`. Use a Node version manager when the
active Node version is outside the supported 24.x range.

## Getting Started

### Clone and Install

Clone the repository and install the exactly pinned dependency graph:

~~~sh
git clone git@github.com:maximtop/no-more-ago.git
cd no-more-ago
pnpm install
~~~

`.npmrc` saves exact versions and treats peer dependency problems as errors.
Commit `package.json` and `pnpm-lock.yaml` together when dependencies change.

### Configure the Environment

No environment file, service, database, API token, or required environment
variable is needed. Settings and diagnostic data are stored by the browser in
`chrome.storage.local`.

The build command recognizes one optional variable:

| Variable | Effect |
| --- | --- |
| `NO_MORE_AGO_BUILD_EVENTS=1` | Suppress JSON progress events from watch mode. |

No editor configuration is checked in. Use an editor with TypeScript and ESLint
support. There is no separate formatter; the ESLint style rules are
authoritative.

### Run the Extension

Start a watch build for one browser:

~~~sh
pnpm dev chrome --watch
~~~

Replace `chrome` with `firefox` or `edge` when needed. Watch mode accepts
exactly one development browser. A successful initial build reports a
`build` event with `"status":"success"`.

Load the generated extension:

- Chrome: open the extension management page, enable Developer mode, choose
  **Load unpacked**, and select `dist/dev/chrome`.
- Edge: open the extension management page, enable Developer mode, choose
  **Load unpacked**, and select `dist/dev/edge`.
- Firefox: open `about:debugging#/runtime/this-firefox`, choose
  **Load Temporary Add-on**, and select `dist/dev/firefox/manifest.json`.

Rspack updates the files and matching ZIP after each successful watch build.
Reload the extension and the page under test when browser state does not update
automatically. Stop watch mode with Ctrl+C.

## Development Workflow

### Branches and Pull Requests

Start focused work from `master`:

~~~sh
git switch master
git pull --ff-only
git switch -c <focused-branch-name>
~~~

Keep the change scoped, preserve unrelated working-tree changes, and update
tests for changed observable behavior. Before opening a pull request:

1. Run `pnpm check`.
2. Build the affected browser target.
3. Perform the browser interaction affected by the change.
4. Push the branch and open a pull request against `master`.

Refer to [AGENTS.md](AGENTS.md) for code, architecture, testing, dependency, and
documentation rules.

### Development Builds

The development build includes source maps.

| Command | Result |
| --- | --- |
| `pnpm dev` | Build Chrome, Firefox, and Edge. |
| `pnpm dev chrome` | Build Chrome once. |
| `pnpm dev firefox` | Build Firefox once. |
| `pnpm dev edge` | Build Edge once. |
| `pnpm dev chrome --watch` | Watch Chrome. |
| `pnpm dev firefox --watch` | Watch Firefox. |
| `pnpm dev edge --watch` | Watch Edge. |
| `pnpm dev --help` | Show browser choices and watch syntax. |

Unpacked builds are written to `dist/dev/<browser>`. Matching ZIP files are
written to `dist/dev/<browser>.zip`.

### Quality Checks

| Command | Result |
| --- | --- |
| `pnpm lint` | Check TypeScript, style, and required JSDoc. |
| `pnpm typecheck` | Run strict TypeScript checking without output. |
| `pnpm test` | Run all Vitest tests in JSDOM. |
| `pnpm check` | Run lint, type checking, and the full test suite. |

Tests live under `tests/src` and `tests/scripts`, mirroring `src` and
`scripts`. Site fixtures live under
`tests/src/content-script/fixtures`.
Keep tests minimal and behavior-level: prefer focused matrices and lifecycle
checks at public boundaries over tests of source structure or implementation
details.

### Runtime Architecture

The background registers one universal content runtime for HTTP and HTTPS
documents at `document_start`, with `allFrames` enabled. It is controlled by
global processing policy; a per-site preference affects the current
top-level hostname and all reachable frames in that tab. Each frame uses its
own URL to select applicable content rules.

Generic processing is the final rule in the content-side source precedence.
It discovers ordinary light-DOM `time[datetime]` elements and accepts only
complete global date-times with explicit known offsets. Specialized sources,
including GitHub's relative-time widgets, Hacker News age widgets, and
approved Stack Exchange title widgets and Telegram Web K message clocks,
remain content-side rules and take precedence when they accept the same
source. Rules extract and resolve values strictly in registry order; after one
source resolves, lower extractors are not called for that element. GitHub uses
the adjacent generated-time presentation. Hacker News,
Stack Exchange, and Telegram Web K use in-place presentation: they retain an
existing simple timestamp label and own only that text until restoration.
Public `https://t.me/s/*` pages stay on generic `time[datetime]` processing.
Adding or changing a specialized source should not require background adapter
registration or site-policy logic.

The Telegram Web K adapter applies only below
`https://web.telegram.org/k/`. It reads the exact ten-digit Unix-seconds value
from the owning message bubble's `data-timestamp`, selects one direct ordinary
clock, and observes `class` and `data-timestamp` changes. It does not guess
numeric units or parse visible/localized Telegram text. Primary edit-time and
ambiguous forwarded or saved-message shapes fail closed. Web A remains outside
the supported source contract.

LinkedIn is a best-effort specialized in-place source with a different value
provenance: its adapter accepts one strict local content ID and emits a derived
Unix-millisecond candidate rather than a page-authored datetime. Treat that
value as ID creation/allocation time, never as guaranteed official creation or
publication time. ID parsing, DOM association, nesting rules, and presentation
delimiters stay inside the LinkedIn adapter modules. Shared resolution validates
the derived epoch, while shared rendering owns and restores only the selected
page Text node.

The canonical YouTube watch rules pair one approved visible label with local
page data. Recognized loaded player-response data is preferred, with exactly
one approved `datePublished` metadata value as an initial-document fallback.
Either source may provide a strict calendar date or a complete explicitly
zoned instant. Same-document changed-video handoffs admit only current dual-ID
loaded data; unbound metadata remains quarantined. The content script never
requests YouTube data.

YouTube history-state updates produce a strict payload-free command for the
exact frame, coalesced to one in-flight and one pending-latest delivery per
tab/frame. `popstate` supplies the equivalent content-side signal. The content
runtime samples its URL lazily; route or identity values never cross the
message boundary. The controller also samples the live URL before every
page-authored mutation batch, closing the DOM-before-signal race. It classifies
changed hrefs as `noop`, `preserve`, `clear`, or `replace` and retains route
policy through active, waiting, and stopped phases. No-op changes update the
retained URL without tearing down output. Active semantic transitions
invalidate prior work and restore verified ownership before any current-route
output is considered.

Before hydrating a stopped runtime, including global or per-host re-enablement,
sample the current URL exactly once and reconcile it through the same total
route classifier. This activation-time sample precedes state hydration so a
document stopped on Watch video A can restart on the current Watch video B
without depending on an earlier history signal. If URL sampling or
classification fails, restore ownership and fail closed without starting
hydration.

A changed-video Watch policy blocks unbound metadata for the life of that
same-document route. Its active session observes only
exact recognized player-assignment script nodes and coalesces relevant
replacement or text changes into a current-generation pass. Route replacement,
failure, or teardown disposes the session and makes queued callbacks inert.

Trusted resolution preserves these semantic kinds. Instants use the existing
display format and configured time zone. Calendar dates use the separate
locale-aware date-only formatter, never receive a configured time zone, and
cannot acquire a fabricated time. System mode uses the localized medium date.
Custom mode tokenizes the validated pattern, retains only bounded calendar
fields and their owned literals, removes time fields and orphaned separators,
and uses the localized medium date when no usable date projection remains.
The controller receives one stable lazy display provider backed by the
runtime's latest hydrated or message-updated snapshot, so reformatting observes
current settings without controller reconstruction. All specialized rules
remain content-side and take precedence over the final generic fallback; no
site-specific background registration or policy logic is needed.

Keep these boundaries best-effort: browser-restricted documents, non-HTTP(S)
frames, Shadow DOM, unapproved page labels, generic date-only values, and
unsupported timestamp forms remain outside the current scope.

### Release Builds

Release builds omit source maps and produce both unpacked directories and ZIP
archives.

| Command | Result |
| --- | --- |
| `pnpm release` | Build Chrome, Firefox, and Edge release artifacts. |
| `pnpm release chrome` | Build the Chrome release artifact. |
| `pnpm release firefox` | Build the Firefox release artifact. |
| `pnpm release edge` | Build the Edge release artifact. |
| `pnpm release --help` | Show the supported browser choices. |

Outputs are written to `dist/release/<browser>` and
`dist/release/<browser>.zip`. Release builds are local packaging operations;
publication and store submission are outside this guide.

### Makefile Aliases

The Makefile wraps one-shot pnpm builds and does not support watch mode.

| Command | Equivalent command |
| --- | --- |
| `make` or `make dev` | `pnpm dev` |
| `make dev chrome` | `pnpm dev chrome` |
| `make dev firefox` | `pnpm dev firefox` |
| `make dev edge` | `pnpm dev edge` |
| `make release` | `pnpm release` |
| `make release chrome` | `pnpm release chrome` |
| `make release firefox` | `pnpm release firefox` |
| `make release edge` | `pnpm release edge` |

Prefer the direct pnpm commands in scripts, documentation, and troubleshooting.

## Common Tasks

### Run a Focused Test

Pass a test path through the pnpm script:

~~~sh
pnpm test tests/src/content-script/transformation/process-document.test.ts
~~~

Use focused tests while iterating, then run `pnpm check` before submitting the
change.

### Add or Update a Site Adapter

To add or update a specialized source:

1. Add or update its content-side rule under `src/content-script/adapters`.
2. Register it in the content-side precedence list before the generic rule.
3. Add an offline fixture under `tests/src/content-script/fixtures`.
4. Test trusted timestamp resolution, restoration, and dynamic page updates.
   When a source selects text-in-place presentation, also test retained element
   identity, exact page-owned restoration, target replacement, and page-authored
   label changes while owned.
5. For a derived-ID source, test the full ID grammar, unsafe and future values,
   local ambiguity, compound text preservation, and proof that relative text
   does not affect the instant.
6. Keep fixtures synthetic and offline; remove names, content, tracking data,
   authentication state, and real user or content IDs.
7. Run `pnpm check` and a development build for the affected browser.

Do not add site-specific background activation or registration. The universal
runtime already reaches every accessible HTTP(S) document and frame.

For in-place numeric sources such as Telegram Web K, keep lexical validation
in shared timestamp resolution and keep site-specific source and target
knowledge in the adapter. Observe only attributes that can change extraction
or eligibility; reuse the existing mutation scheduler rather than adding a
site loop or polling path.

For canonical YouTube watch pages, keep URL matching and DOM provenance in the
YouTube contract and adapter. The loaded boundary is exactly one script whose
text is `var ytInitialPlayerResponse = <JSON>;`. Retain only
`videoDetails.videoId`,
`microformat.playerMicroformatRenderer.externalVideoId`, and
`microformat.playerMicroformatRenderer.publishDate`; both IDs must match the
canonical URL ID. Reject missing, duplicate, malformed, or assignments above
2,000,000 characters, then fall back to exactly one
`meta[itemprop="datePublished"]` value.

The reader stores one record per `Document` in a `WeakMap`: selected script
identity, exact source text, and the minimal parsed result or invalid outcome.
Reuse a stable record and recheck the requested video ID on every read.
Invalidate the record when the assignment is missing, duplicated, oversized,
replaced, or text-changed. Recording-parser tests must prove reuse and each
invalidation transition.

Maintain `watch-calendar-date.html` and `watch-local-sources.html` as sanitized
offline fixtures with their evidence note. Fixture tests replace `fetch` with
a synchronously throwing fake and assert zero calls after every case. Never
install a successful response or refresh fixtures from a live page during the
test run. Route tests use invented video IDs and both signal/data orderings.
This path does not cover list surfaces, general YouTube SPA behavior, mobile,
Music, Shorts, embeds, fallback, or player/API lookup.

Run its focused source and public-boundary tests with:

~~~sh
pnpm test tests/src/content-script/adapters/youtube.test.ts \
  tests/src/content-script/adapters/youtube-player-response.test.ts \
  tests/src/content-script/transformation/process-document.test.ts \
  tests/src/content-script/adapters/youtube-fixtures.test.ts
~~~

#### Qualify a YouTube list shape

List qualification starts with one provenance-backed capture that joins the
route and rendered card identity, visible publication label, and corresponding
loaded record. A positive source additionally requires an approved explicit
calendar date or explicitly zoned instant in that same joined record. Separate
examples, array position, or inferred equality do not establish provenance.

The sanitized `home-modern-relative-only.html` fixture is a minimal derivative
of the Home evidence ledger: six aliased cards joined by `contentId` to six
loaded lockup records whose synthetic relative labels also match. The captured
records contain no approved absolute publication value, so production behavior
is intentionally unchanged. Relative text, arbitrary date-looking fields, and
the unrelated `replicateAsTimestamp` boolean are not approved sources.

The list fixture test replaces `fetch` with a synchronously throwing fake and
asserts that this page remains unchanged through the public document boundary.

The sanitized `search-legacy-relative-only.html` fixture independently records
one captured legacy Search main-result shape. It traverses only:

~~~text
contents.twoColumnSearchResultsRenderer.primaryContents
  .sectionListRenderer.contents[]
  .itemSectionRenderer.contents[].videoRenderer
~~~

Each of its six aliased `ytd-video-renderer` cards joins its sole
`a#video-title` watch identity to `videoRenderer.videoId`. The direct second
`#metadata-line` span has the captured class tokens, and its visible label
must equal `publishedTimeText.simpleText` from that same record. The fixture
also retains two empty `gridShelfViewModel` shapes, one empty loaded
`shelfRenderer`, and one empty DOM shelf. Those outer mixed shapes, recursively
found nested identities, and DOM identities outside the evidenced direct main
set are not eligible records.

Every captured Search publication value was relative. Relative `simpleText`,
synthetic absolute-looking values, watch-only data, arbitrary DOM attributes,
and values inserted into mixed outer shapes are not approved sources. Search
fixture tests exercise the document only through the existing public processing
boundary.

The sanitized `channel-videos-modern-relative-only.html` fixture records one
captured modern Channel Videos grid. Its selected-tab loaded boundary is:

~~~text
contents.twoColumnBrowseResultsRenderer.tabs[]
  .tabRenderer.content.richGridRenderer.contents[]
  .richItemRenderer.content.lockupViewModel
~~~

Six aliased cards encode the already-established one-to-one identity equality
with a minimal fixture-only watch anchor. That anchor is not a captured
production selector. Each alias selects exactly one loaded record by
`contentId`; one visible last-part label must then equal exactly one
`metadataParts[1].text.content` value in that same record.

The publication part occurred at `metadataRows[0]` for three retained examples
and `metadataRows[1]` for three others. Validate the row variant independently
for every identity-bound record. Never choose one global row index. The
fixture also retains one empty loaded continuation outer and one empty DOM
continuation shell; neither establishes adjacent or nested eligibility.

Every captured Channel publication value was relative. Relative text,
synthetic absolute-looking values, the unrelated `replicateAsTimestamp`
boolean, and values injected into a continuation outer are not approved
sources. Channel fixture tests exercise only the public document boundary. Run
the compact no-output and zero-network checks for all three list captures with:

~~~sh
pnpm test tests/src/content-script/adapters/youtube-list-fixtures.test.ts
~~~

All three representative list captures contain only relative publication data.
Production support therefore remains Watch-only, and no request, provider,
permission, persistence rule, or fallback implementation exists for list pages.

For manual verification, load a built artifact from `dist/dev/<browser>`, then:

1. Open a canonical desktop Watch page and confirm that its publication label
   becomes an exact localized value.
2. Navigate to another Watch video without a full reload and confirm that the
   first video's output is restored before identity-matched data for the second
   video can render.
3. Navigate to Home, Search, and a Channel Videos page and confirm that list
   publication labels remain unchanged.

New positive list support must begin with new representative evidence that
already binds DOM identity, visible label, loaded record, and an approved
explicit value. Keep fixture derivatives minimal, sanitized, and offline.

Follow the adapter and shared-contract rules in [AGENTS.md](AGENTS.md).

### Debug the Extension

- Inspect popup and options errors in their page developer tools.
- Inspect content-script behavior in the developer tools for the active site.
- Inspect the background worker from the browser extension management page.
- Enable **Debug logs** in the options page only when persistent diagnostic
  events are needed.
- Download the diagnostic archive before clearing logs when it is needed for a
  report.
- Disable **Debug logs** to remove retained diagnostic entries.
- Use development source maps from `dist/dev/<browser>` when tracing bundled
  code.

Diagnostic failures are intentionally isolated from timestamp processing. A
missing diagnostic event does not by itself mean the content script failed.
Invalid timestamp diagnostics may retain only a one-to-twenty-digit rejected
source value. Successful events never retain raw source timestamps.

## Troubleshooting

- **pnpm reports an unsupported Node engine:** switch to Node 24.x. Node 25 is
  outside the declared `>=24 <25` range even if a command appears to work.
- **Watch mode says that one browser is required:** use
  `pnpm dev <browser> --watch`. Watch mode cannot build all browsers.
- **Ctrl+C prints an `ELIFECYCLE` message:** confirm the watcher process has
  stopped. pnpm may report the interrupt as a non-zero exit even after the
  compiler closes.
- **The browser still runs an old bundle:** reload the extension from its
  management page, then reload the page under test.
- **The extension cannot run on a browser-internal page:** open an HTTP or
  HTTPS page. Browser-internal and otherwise restricted pages cannot accept the
  content script.
- **A standard, GitHub, Hacker News, Stack Exchange, Telegram Web K, LinkedIn,
  or supported YouTube watch
  timestamp is no longer replaced:** check the page with Debug logs enabled.
  For specialized markup changes, update the matching offline fixture and its
  content-side rule; generic processing continues to accept only standard
  `time[datetime]` values. In-place adapters require one unambiguous simple
  label. For Web K, also verify an HTML `div.bubble[data-timestamp]`, one
  bubble-owned `.time-inner`, one direct ordinary `span.i18n`, and a strict
  ten-digit seconds value. For best-effort LinkedIn support, verify the
  accepted local ID evidence and timestamp-label relationship before changing
  selectors. Do not recover from markup drift by parsing localized or relative
  UI text or adding a network fallback.
- **Vitest reports JSDOM navigation warnings:** use the test result as the
  source of truth. JSDOM may print unsupported navigation messages while the
  tests still pass.
- **ESLint rejects a documented declaration:** add complete JSDoc descriptions
  for the declaration, properties, parameters, and return value.

## Additional Resources

- [README](README.md)
- [LLM agent rules and project architecture](AGENTS.md)
