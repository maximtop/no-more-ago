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
approved Stack Exchange title widgets, remain content-side rules and take
precedence when they accept the same source. GitHub uses the adjacent
generated-time presentation. Hacker News and Stack Exchange use in-place
presentation: they retain an existing simple timestamp label and own only that
text until restoration. Adding or changing a specialized source should not
require background adapter registration or site-policy logic.

Keep these boundaries best-effort: browser-restricted documents, non-HTTP(S)
frames, Shadow DOM, arbitrary page labels without a registered specialized
source, and unsupported timestamp forms remain outside the current scope.

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
5. Run `pnpm check` and a development build for the affected browser.

Do not add site-specific background activation or registration. The universal
runtime already reaches every accessible HTTP(S) document and frame.

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
- **A standard, GitHub, Hacker News, or Stack Exchange timestamp is no longer
  replaced:** check the page with Debug logs enabled. For specialized markup
  changes, update the matching offline fixture and its content-side rule;
  generic processing continues to accept only standard `time[datetime]`
  values. Stack Exchange title widgets render in place, so also verify that
  the source still contains one unambiguous text label.
- **Vitest reports JSDOM navigation warnings:** use the test result as the
  source of truth. JSDOM may print unsupported navigation messages while the
  tests still pass.
- **ESLint rejects a documented declaration:** add complete JSDoc descriptions
  for the declaration, properties, parameters, and return value.

## Additional Resources

- [README](README.md)
- [LLM agent rules and project architecture](AGENTS.md)
