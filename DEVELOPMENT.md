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
  - [Releasing](#releasing)
    - [Cut a Release](#cut-a-release)
    - [Chrome Web Store Deployment](#chrome-web-store-deployment)
    - [Store Configuration](#store-configuration)
    - [Local Store Commands](#local-store-commands)
  - [Common Tasks](#common-tasks)
    - [Run a Focused Test](#run-a-focused-test)
    - [Add or Update a Site Adapter](#add-or-update-a-site-adapter)
    - [Verify Facebook Support](#verify-facebook-support)
    - [Debug the Extension](#debug-the-extension)
  - [Troubleshooting](#troubleshooting)
  - [Additional Resources](#additional-resources)

## Prerequisites

Install these tools before working on the project:

- Node.js 24.x. The supported engine range is `>=24 <25`.
- pnpm 10.34.5, installed directly. Do not use Corepack.
- Git with access to the private
  `git@github.com:maximtop/no-more-ago.git` repository.
- Chrome or Edge 102+, or Firefox 128+, for manual extension testing.
- GNU Make only if you want to use the optional Makefile aliases.
- Go 1.26+ with `go-webext` only for the optional
  [local store commands](#local-store-commands).

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
variable is needed for development. Settings and diagnostic data are stored by
the browser in `chrome.storage.local`. The optional gitignored `.env` described
in [Store Configuration](#store-configuration) is read only by the local Chrome
Web Store commands.

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

Facebook is the one current integration that also needs page-main-world data.
The background registers `facebook-payload-bridge.js` at `document_start` in
`MAIN`, with all frames enabled but Facebook match patterns only. During
refresh of already-open tabs, the universal `content.js` bundle is injected in
all reachable HTTP(S) frames while the bridge is injected only into enumerated
frames whose own URL is a Facebook URL. Registration comparison tolerates
browser APIs omitting optional returned fields but corrects every explicit
mismatch. The universal runtime and Facebook bridge registrations reconcile
independently, so a bridge-specific browser rejection does not prevent the core
runtime from registering. Chrome and Edge builds require version 102 or later,
and Firefox builds require version 128 or later, for registered `MAIN`-world
content scripts.

The Facebook bridge installs bounded page-transport wrappers in an inert state.
The isolated runtime uses the shared controller's activity lifecycle to send
same-window enable or disable coordination messages. The page world is not an
authentication boundary, so the bridge contains no secrets or privileged
operations. Lifecycle changes advance a local generation, making older request
completions inert; disposal restores only wrappers the bridge still owns.

On enable the isolated runtime parses initial payload scripts before the
controller's first discovery pass, then reconciles only sources affected by
dynamic token records. On disable it detaches temporary listeners and observers,
clears bounded document associations, and lets the shared controller restore
every owned source. Only bounded tracking-token and Unix-seconds pairs plus
bounded invalidation state cross worlds; payloads and page content are not
persisted or diagnosed. Cross-world records are structurally validated as
untrusted page-derived input. The adapter itself remains a pure source rule
backed by that temporary store.

Generic processing is the final rule in the content-side source precedence.
It discovers ordinary light-DOM `time[datetime]` elements and accepts only
complete global date-times with explicit known offsets. Every rule separately
proves that the current page-owned label is relative before resolution and
rendering; trusted timestamp data alone is not enough. Specialized sources,
including GitHub's relative-time widgets, Hacker News age widgets, approved
Stack Exchange title widgets, Telegram Web K message clocks, and TikTok
publications plus confirmed Bluesky relative labels, remain content-side rules
and take precedence when they accept
source. Rules extract and resolve values strictly in registry order; after one
source resolves, lower extractors are not called for that element. GitHub and
Facebook use the adjacent generated-time presentation. Hacker News, Stack
Exchange, Telegram Web K, direct TikTok pages, and Bluesky use in-place presentation:
they retain an existing simple timestamp label and own only that text until
restoration. Instagram applies the same in-place strategy to simple standard
timestamps. TikTok profile grids have no specialized rule because their cards
have no page-owned timestamp label. Public `https://t.me/s/*` pages stay on
generic `time[datetime]` processing.
Ordinary specialized sources should not require background registration or
site-policy branches. A page-main-world transport is an exceptional boundary
and must reuse the shared activity policy rather than create an independent
enablement model.

Bluesky is the only remote-enriched source. Its DOM adapter extracts only a
validated public post identity; a document-local coordinator batches and caches
successful work while a connected source references it, rejects stale DOM
results, and uses a narrow AppView capability. Production requests are
credential-free, no-store GETs with a finite deadline to the fixed
`https://public.api.bsky.app` origin. They contain only public actor identifiers
or public AT post URIs and never cookies, authorization, account tokens, post
content, settings, or unrelated page data. Failures are silent and are not
retried automatically.

The Telegram Web K adapter applies only below
`https://web.telegram.org/k/`. It reads the exact ten-digit Unix-seconds value
from the owning message bubble's `data-timestamp`, selects one direct ordinary
label, and observes `class`, `data-timestamp`, and label changes. The label must
independently match the shared relative classifier; ordinary clocks such as
`16:08` fail closed. It does not guess numeric units or parse visible/localized
Telegram text as the timestamp. Primary edit-time and ambiguous forwarded or
saved-message shapes fail closed. Web A remains outside the supported source
contract.

The TikTok adapter applies only to exact HTTPS `www.tiktok.com/@...` direct
`video` or `photo` paths. It obtains the publication ID from the current URL
and prefers a valid
same-record `createTime` from
`#__UNIVERSAL_DATA_FOR_REHYDRATION__[type="application/json"]`; otherwise it
decodes strict decimal IDs with `BigInt(id) >> 32n`. Both results are bounded
from 2016-01-01 through the current time plus 24 hours. Do not add visible-text
parsing, legacy hydration containers, page-world hooks, polling, or network
fallbacks without new evidence and a revised specification.

Direct TikTok sources use the shared in-place text presentation and transform
only a recognized relative label. A retained leading ` · ` separator remains
page-owned. Profile grids remain on the universal generic rule. Keep TikTok URL
rules, selectors, embedded state traversal, and post-ID semantics inside
`adapters/tiktok*.ts`; shared formatting, ownership, restoration, and mutation
code must remain site-agnostic.

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
zoned instant. The visible Watch label must separately match the relative
classifier; absolute and unknown labels remain unchanged. Same-document
changed-video handoffs admit only current dual-ID loaded data; unbound metadata
remains quarantined. The content script never requests YouTube data.

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
current settings without controller reconstruction. Ordinary specialized rules
remain content-side and take precedence over the final generic fallback, so
they need no site-specific background registration or policy logic. Facebook is
the explicit exception described above because its dynamic absolute evidence
exists in page-main-world response bodies.

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
tagged releases and store submission are described in [Releasing](#releasing).

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
The Makefile also provides the [local store commands](#local-store-commands).

## Releasing

Releases are produced by GitHub Actions from a version tag. `version` in
`package.json` is the single source of truth: the build writes it into every
generated manifest, and the release workflow refuses a tag that does not match
it. GitHub Releases are created only by that workflow; do not create one by
hand in the GitHub UI.

### Cut a Release

1. Bump `version` in `package.json` (semantic `X.Y.Z`) in a normal pull
   request and merge it to `master`.
2. Tag the merged commit and push the tag:

   ~~~sh
   git tag vX.Y.Z && git push origin vX.Y.Z
   ~~~

3. `.github/workflows/release.yml` rejects a tag that does not match
   `package.json`, is not reachable from `master`, or already has a release,
   then runs `pnpm check`, builds every browser target, verifies the manifest
   versions, and publishes a GitHub Release with:
   - `no-more-ago-<version>-chrome.zip`, `no-more-ago-<version>-edge.zip`,
     and `no-more-ago-<version>-firefox.zip`
   - `no-more-ago-<version>-source.zip`, the tagged repository state
   - `SHA256SUMS.txt`, GNU `sha256sum` lines with the bare asset names

Release notes are a fixed sentence followed by the notes GitHub generates from
the pull requests merged since the previous tag; there is no changelog file.
Edit them afterwards with `gh release edit vX.Y.Z --notes` when needed.

`gh release create` uploads the assets to a draft and publishes it last; a
failed upload deletes the draft again, so a failed run normally leaves no
release behind and can simply be re-run. If a draft survives a cancelled run,
or a release for the tag was created by hand, the tag run refuses to continue:
delete that release first; the tag stays:

~~~sh
gh release delete vX.Y.Z --yes
~~~

A manual run (**Actions → Release → Run workflow**, or the command below)
is a dry run: it checks that the `package.json` version is semantic, runs
`pnpm check`, builds, verifies the manifest versions, and uploads the archives
as a workflow artifact, but skips the tag gates and publishes nothing.
`gh workflow run` needs the workflow file on `master`; pass `--ref` to dry-run
the copy on a branch.

~~~sh
gh workflow run release.yml --ref <branch>
~~~

### Chrome Web Store Deployment

`.github/workflows/deploy-chrome-store.yml` submits the Chrome archive of an
already published GitHub Release to the Chrome Web Store. It runs
automatically after a tagged release when the `CHROME_AUTO_DEPLOY_ENABLED`
repository variable is `true`, and manually with a published release tag as
the retry path:

~~~sh
gh workflow run deploy-chrome-store.yml -f tag=vX.Y.Z
~~~

The workflow refuses to run when `CHROME_APP_ID` or any of the four secrets
below is unset, and rejects tags that do not match `vX.Y.Z`, draft and
pre-release releases, and release commits that are not reachable from
`master`. It downloads the release asset ending in `-chrome.zip` together
with `SHA256SUMS.txt`, never a fresh rebuild, and verifies the checksum and
the manifest version inside. It then uploads the archive through Chrome Web
Store API v2 with the `go-webext` version pinned by `GO_WEBEXT_VERSION` in
the workflow, refuses to continue unless the store confirms the upload of
that exact version, submits the draft for review with deferred (staged)
publishing, and writes the store status to the job summary. The status covers
the published and submitted state only; draft processing is visible in the
Developer Dashboard.

Nothing goes live automatically. When the review verdict arrives, publish the
approved version by hand in the Chrome Web Store Developer Dashboard. A staged
submission left unpublished expires back to a draft after about 30 days;
re-run the workflow with the same tag to submit it again. A green run proves a
successful submission, not approval.

Failure recovery:

- **`invalid_grant`:** the refresh token is dead and nothing was uploaded.
  Mint a new one for the existing OAuth client (OAuth Playground with the
  `https://www.googleapis.com/auth/chromewebstore` scope) or reuse the value
  the other extension repositories already use, update `CHROME_REFRESH_TOKEN`,
  and re-run.
- **`invalid_client`:** `CHROME_CLIENT_ID` or `CHROME_CLIENT_SECRET` is wrong;
  the refresh token is fine. Fix those two secrets and re-run.
- **A 5xx from the token endpoint:** transient on Google's side; re-run.
- **`deleted_client`:** the OAuth client itself is gone, so no token can be
  issued for it. Create a new Web application client in the Google Cloud
  project with `https://developers.google.com/oauthplayground` as an
  authorized redirect URI, update `CHROME_CLIENT_ID` and
  `CHROME_CLIENT_SECRET`, then mint and store a new refresh token.
- **Upload did not reach `SUCCEEDED`:** the store is still processing the
  draft. Wait, then re-run with the same tag; re-uploading the same version
  replaces the draft.
- **Submission failed after a successful upload:** the draft is still in
  place. Re-run with the same tag; the re-upload replaces it and the
  submission is repeated.
- **Upload rejected because the version is already published:** ship a new
  version.
- **Upload rejected because a submission is pending review:** the store
  refuses every package upload in that state regardless of version. Wait for
  the verdict or cancel the review in the Developer Dashboard, then re-run
  with the same tag.
- **Upload rejected because an approved submission is staged:** publish the
  staged version in the Developer Dashboard, or let the 30-day expiry return
  it to a draft, then re-run with the same tag.
- **Review rejected:** no workflow signal exists; the verdict arrives by
  e-mail. Address the feedback and ship a new version.

Edge Add-ons and Firefox Add-ons submissions remain manual uploads of the
release archives.

### Store Configuration

The store item must exist before any deployment: the API cannot create the
listing. One-time setup:

1. Create the item in the Chrome Web Store Developer Dashboard by uploading
   any release archive by hand, complete the listing, privacy, and
   distribution tabs there, and leave the item as an unsubmitted draft.
2. Copy the item ID from the Developer Dashboard item URL into the
   `CHROME_APP_ID` repository variable and into the local `.env`.
3. Add the four secrets below.
4. Cut a release with `CHROME_AUTO_DEPLOY_ENABLED` still unset (the deploy
   job shows as skipped, which is expected), then run the deploy workflow once
   by hand with that tag.
5. Set `CHROME_AUTO_DEPLOY_ENABLED` to `true` so later tagged releases deploy
   on their own.

Configure these in the GitHub repository under **Settings → Secrets and
variables → Actions**. Workflows reference them by name only; no value is ever
committed.

| Kind | Name | Description |
| --- | --- | --- |
| Variable | `CHROME_APP_ID` | Item ID from the Developer Dashboard item URL. |
| Variable | `CHROME_AUTO_DEPLOY_ENABLED` | `true` to deploy after every tagged release; unset keeps manual runs only. |
| Secret | `CHROME_CLIENT_ID` | OAuth 2.0 client ID from a Google Cloud project with the Chrome Web Store API enabled. |
| Secret | `CHROME_CLIENT_SECRET` | Secret of that OAuth client. |
| Secret | `CHROME_REFRESH_TOKEN` | Refresh token granted for the `https://www.googleapis.com/auth/chromewebstore` scope. |
| Secret | `CHROME_PUBLISHER_ID` | Publisher ID from the Developer Dashboard account page. |

The OAuth consent screen must be **In production**; refresh tokens issued while
it is in **Testing** expire after seven days. The four secrets belong to the
Google account and are shared by every extension it publishes; only
`CHROME_APP_ID` is specific to this extension. Set them from the command line
without leaving values in shell history:

~~~sh
gh variable set CHROME_APP_ID --body "<item-id>"
gh secret set CHROME_CLIENT_ID
~~~

`gh secret set` without `--body` prompts for the value. For the local store
commands, copy `.env.example` to `.env` and fill in the same values. `.env` is
gitignored; never commit it or print its values.

### Local Store Commands

The Makefile offers a local fallback for the same store operations. It needs
`go-webext`, which loads the credentials from `.env` by itself; the Makefile
reads only `CHROME_APP_ID` from that file and pins Chrome Web Store API v2 like
the workflow. Install the version the workflow pins:

~~~sh
go install github.com/adguardteam/go-webext@v0.4.2
~~~

| Command | Result |
| --- | --- |
| `make chrome_status` | Print the published and submitted (review) state of the store item. |
| `make chrome_update` | Build `dist/release/chrome.zip` with `pnpm release chrome` and upload it as the new draft. |
| `make chrome_publish` | Submit the uploaded draft for review with deferred publishing. |

When calling `go-webext` directly instead, set `CHROME_API_VERSION=v2`. Prefer
the workflow for real releases: it deploys the exact archive attached to the
GitHub Release, while the local upload ships a fresh build of the working
tree, including uncommitted changes.

## Common Tasks

### Run a Focused Test

Pass a test path through the pnpm script:

~~~sh
pnpm test tests/src/content-script/transformation/process-document.test.ts
~~~

Use focused tests while iterating, then run `pnpm check` before submitting the
change.

Bluesky's network-free contract suites can be run together with:

~~~sh
pnpm test tests/src/content-script/adapters/bluesky.test.ts \
  tests/src/content-script/adapters/bluesky-appview.test.ts \
  tests/src/content-script/adapters/bluesky-coordinator.test.ts \
  tests/src/content-script/adapters/bluesky-fixtures.test.ts
~~~

Inject a fake `BlueskyAppView` through the runtime or a generic participant
factory for controller tests. Tests must not contact the live public service.

### Add or Update a Site Adapter

To add or update a specialized source:

1. Prove a trusted machine-readable timestamp independently of display text.
2. Define how the rule proves that the current page-owned label is relative.
3. Add paired offline fixtures: relative changes; absolute or unknown stays.
4. Cover text and route changes that can revoke eligibility.
5. Never persist or report the page label through diagnostics.
6. Add or update its content-side rule under `src/content-script/adapters`.
7. Register it in the content-side precedence list before the generic rule.
8. Add an offline fixture under `tests/src/content-script/fixtures`.
9. Test trusted timestamp resolution, restoration, and dynamic page updates.
   When a source selects text-in-place presentation, also test retained element
   identity, exact page-owned restoration, target replacement, and page-authored
   label changes while owned.
10. For a derived-ID source, test the full ID grammar, unsafe and future values,
   local ambiguity, compound text preservation, and proof that relative text
   does not affect the instant.
11. Keep fixtures synthetic and offline; remove names, content, tracking data,
   authentication state, and real user or content IDs.
12. Run `pnpm check` and a development build for the affected browser.

Do not add site-specific background activation or registration when the
universal isolated runtime can obtain the trusted source. Facebook is the only
current exception because selected response bodies exist in the page main
world. Any similar exception must be narrowly matched, inert by default,
controlled by the shared lifecycle, and covered at emitted-artifact and frame
injection boundaries.

If a specialized source needs public enrichment, keep the capability narrow,
fixed-origin, credential-free, batch-bounded, and document-local. Use offline
response doubles and fixtures, cancel work on teardown, and do not add polling,
durable caches, or fallback parsing of presentation text.

For in-place numeric sources such as Telegram Web K, keep lexical validation
in shared timestamp resolution and keep site-specific source and target
knowledge in the adapter. Observe only attributes that can change extraction
or eligibility. Register discovered labels with the scheduler's targeted text
observer; never enable document-wide character-data observation. Reuse the
existing mutation scheduler rather than adding a site loop or polling path.

For TikTok fixture changes, keep handles, post IDs, labels, routes, and
hydration records synthetic. Cover matching and stale `createTime`, BigInt ID
fallback, URL exclusions, direct target simplicity, ambiguous cards, SPA
reconciliation, profile no-op behavior, and restoration through public adapter and
controller boundaries.

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

1. Open a canonical desktop Watch page with a relative publication label and
   confirm that it becomes an exact localized value; an absolute label should
   remain unchanged.
2. Navigate to another Watch video without a full reload and confirm that the
   first video's output is restored before identity-matched data for the second
   video can render.
3. Navigate to Home, Search, and a Channel Videos page and confirm that list
   publication labels remain unchanged.

New positive list support must begin with new representative evidence that
already binds DOM identity, visible label, loaded record, and an approved
explicit value. Keep fixture derivatives minimal, sanitized, and offline.

Follow the adapter and shared-contract rules in [AGENTS.md](AGENTS.md).

### Verify Facebook Support

Run the deterministic fixture and bridge suites before live verification:

~~~sh
pnpm test tests/src/content-script/facebook \
    tests/src/content-script/adapters/facebook.test.ts \
    tests/src/content-script/adapters/facebook-fixtures.test.ts
~~~

The fixtures cover initial and dynamic Story evidence, both evidence/source
arrival orders, conflicts, rejected actor/media/comment/Reel shapes, disable,
teardown, DOM repair, and repeated mutations without network access.

For a live compatibility pass, build and load the same revision in Chrome,
Firefox, and Edge. Use a UTC custom format with seconds, and record browser
version, public or signed-in session, tested surface, and observed result.
Verify an initially rendered post, a dynamically loaded older post, a normal
navigation, disable/restore, and re-enable. Confirm that actor/media links,
comments already exposing exact accessible labels, and Reels without proven
post timestamps remain unchanged. Do not save response payloads, account data,
or personal page content as test evidence.

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
- **A standard, Facebook, GitHub, Hacker News, Stack Exchange, Telegram Web K,
  TikTok, LinkedIn, Bluesky, or supported YouTube watch
  timestamp is no longer replaced:** check the page with Debug logs enabled.
  For specialized markup changes, update the matching offline fixture and its
  content-side rule; generic processing continues to accept only standard
  `time[datetime]` values. Every rule also requires an existing label recognized
  as relative; absolute dates, clocks, unknown wording, and absent labels are
  intentionally unchanged. In-place adapters require one unambiguous simple
  label. For Web K, also verify an HTML `div.bubble[data-timestamp]`, one
  bubble-owned `.time-inner`, one direct ordinary `span.i18n`, and a strict
  ten-digit seconds value. For Facebook, verify typed Story evidence, exact
  tracking-token correlation, a recognized post timestamp link, and active
  global/site policy. For dynamic Facebook evidence, also verify the exact
  `/api/graphql/` URL, a synchronously inspectable bounded request body, an
  anchored Story-bearing `fb_api_req_friendly_name`, and—for XHR—a POST request
  with an empty or `text` response type. If dynamic records stop arriving,
  verify main/isolated lifecycle coordination before treating it as selector
  drift. For best-effort LinkedIn support, verify the accepted local ID evidence
  and timestamp-label relationship before changing selectors. For Bluesky,
  verify the canonical public permalink and availability of the anonymous public
  AppView API. Do not recover
  from markup drift by parsing localized or relative UI text or adding a network
  fallback.
- **A supported TikTok publication is unchanged:** confirm the page uses HTTPS
  `www.tiktok.com`, an exact direct video/photo path, an unambiguous tested
  direct label shape, a recognized relative label, and a plausible 19-digit
  post ID. A universal hydration record is optional, but it is used only when
  its string-valued
  `id` matches the current post. Do not diagnose the issue by parsing visible
  text or adding a request; capture a privacy-safe minimized fixture instead.
- **Vitest reports JSDOM navigation warnings:** use the test result as the
  source of truth. JSDOM may print unsupported navigation messages while the
  tests still pass.
- **ESLint rejects a documented declaration:** add complete JSDoc descriptions
  for the declaration, properties, parameters, and return value.

## Additional Resources

- [README](README.md)
- [LLM agent rules and project architecture](AGENTS.md)
