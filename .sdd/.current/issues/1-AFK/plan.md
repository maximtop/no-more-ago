# Implementation Plan: [no-more-ago] Replace the first trusted GitHub timestamp

- **Created**: 2026-08-23
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/1-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: None (no additional constraints)

## Summary

Create the empty repository's first Chrome Manifest V3 development artifact and a narrow end-to-end timestamp path. A persistent dynamic content-script registration will target only HTTP(S) pages on exact `github.com` at `document_start`. The content runtime will select the GitHub adapter through a generic registry, extract the `datetime` from `relative-time`, resolve only a valid explicitly zoned ISO value, format it with the browser's locale and system time zone, and replace the source with a semantic `time` element.

This is deliberately a static-document tracer bullet. Safe ownership/restoration, the full GitHub eligibility matrix, incremental mutations, cross-browser artifacts, settings, and already-open-tab reconciliation remain in issues 2-AFK through 6-AFK.

## Technical Context

- **Language/Version**: TypeScript 6.0.3, ECMAScript 2022 output, Node.js 24 LTS
- **Primary Dependencies**: React 19.2.8, Mantine 9.5.2, Rspack 2.1.10, date-fns 4.4.0, `@date-fns/tz` 1.5.0, pnpm 10.34.5
- **Storage**: No settings data is written in this slice; the Chrome manifest declares `storage` for the agreed runtime seam used by later settings slices
- **Testing**: Vitest 4.1.11 with jsdom 30.0.1, fake browser API contracts, and a built-artifact smoke test
- **Target Platform**: Current stable Chrome, Manifest V3, unpacked development output at `dist/chrome-dev/`

## Research

### Repository baseline and scope boundaries

The repository contains only `.sdd/.current/`; there is no production source, package metadata, `AGENTS.md`, `DEVELOPMENT.md`, or `README.md` in the project tree. The PRD is therefore the source of project conventions. Neighboring issues reserve reversible DOM ownership (2-AFK), comprehensive rejection and GitHub fixtures (3-AFK), mutation scheduling (4-AFK), Firefox/Edge/release/ZIP/watch targets (5-AFK), and settings/open-tab reconciliation (6-AFK). This plan establishes seams for those slices without implementing them.

The first renderer may use `source.replaceWith(output)` because restoration and extension-owned sibling state belong to 2-AFK. The limitation is explicit and isolated inside `renderExactTime`, so 2-AFK can replace that implementation without changing adapters, resolution, presentation, or registration.

### Chrome activation

Chrome's `scripting.registerContentScripts` supports persistent registrations, `runAt: "document_start"`, and top-frame-only execution with `allFrames: false`. The registration uses only `http://github.com/*` and `https://github.com/*`; the manifest keeps the PRD-required `<all_urls>` host permission but does not register a generic page script. The shared coordinator receives a narrow `ScriptingRuntime` interface, while `src/background/chrome.ts` is the only module that touches the global `chrome` API.

### Build and manifest

Rspack builds two fixed TypeScript entries, `background.js` and `content.js`, into one unpacked Chrome development directory. Its resolver explicitly includes `.ts` so the planned extensionless imports cross module boundaries, and one `builtin:swc-loader` rule parses TypeScript and emits ES2022 JavaScript before bundling. TypeScript separately checks the same graph with `isolatedModules: true`, keeping the compiler gate compatible with Rspack's per-file SWC transform. `CopyRspackPlugin` parses the Chrome manifest template and replaces its noncanonical placeholder version with `package.json.version` during compilation. The smoke test invokes the public build over this real multi-module TypeScript graph and then inspects only emitted artifacts and referenced entry files. ZIP and non-Chrome outputs remain in 5-AFK.

### Trusted timestamp and presentation

The adapter supplies source metadata but does not parse or format it. The shared resolver requires an explicit trailing `Z` or `±HH:MM` before calling `date-fns/parseISO`; invalid input returns `null`. The shared formatter uses `date-fns/intlFormat` with `dateStyle: "medium"`, `timeStyle: "short"`, `navigator.languages`, and no time-zone override, which preserves the browser's system time zone and 12/24-hour convention while omitting seconds. Because the three-argument `intlFormat` overload requires a locale, an empty browser locale list uses the two-argument overload and lets the runtime select its default locale.

### Maintained-source lint boundary

The public `eslint .` command covers maintained TypeScript in `src/`, `tests/`, and the root TypeScript configuration, plus the Node-based `.mjs` build/configuration files. The flat config owns explicit global ignores for `dist/**`, `coverage/**`, and `node_modules/**`; it does not rely on ESLint importing `.gitignore`. This keeps generated Rspack bundles out of linting even when a previous build already populated `dist/chrome-dev/`.

### Test boundary

Unit tests exercise exported interfaces and observable DOM/API behavior. The integration fixture enters through `processDocument`, not private helpers, and proves adapter selection, trusted resolution, localized formatting, and semantic output in one call. The build smoke invokes `pnpm dev chrome`, parses `dist/chrome-dev/manifest.json`, and verifies each manifest-referenced script exists; it does not inspect source/configuration text.

## Entities

### Adapter Definition

- **Fields**: `id: string`; `matches(url: URL): boolean`; `discover(root: ParentNode): readonly Element[]`; `extract(element: Element): TimestampCandidate | null`
- **Relationships**: Registered in `AdapterRegistry`; the document pipeline uses only this interface and never imports GitHub selectors
- **Validation**: The registry returns at most one adapter; the GitHub adapter matches HTTP(S) and exact hostname `github.com`
- **States**: registered -> selected for a matching URL, or registered -> not selected

### Timestamp Candidate

- **Fields**: `source: Element`; `rawDatetime: string`; `sourceKind: "relative-time"`; `adapterId: string`
- **Relationships**: Created by a site adapter and consumed by the shared trusted resolver
- **Validation**: Extraction requires a `relative-time` host with a nonempty `datetime`; visible text is never copied into the entity
- **States**: discovered -> extracted -> resolved, or extracted -> rejected/no-op

### Resolved Timestamp

- **Fields**: `source: Element`; `sourceDatetime: string`; `instant: Date`
- **Relationships**: Produced from `TimestampCandidate`; consumed by presentation and the semantic renderer
- **Validation**: `sourceDatetime` ends in `Z` or `±HH:MM`, and `instant` is valid
- **States**: valid -> formatted -> rendered

### Rendered Exact Time

- **Fields**: semantic `HTMLTimeElement`; authoritative `dateTime`; localized text content
- **Relationships**: Replaces one source host in the initial tracer bullet; ownership metadata is deferred to 2-AFK
- **Validation**: Element name is `time`, `dateTime` preserves the source value, text is nonempty
- **States**: absent -> rendered

### Runtime Registration

- **Fields**: stable ID `no-more-ago-github`; exact GitHub match patterns; `content.js`; `document_start`; top-frame-only; persistent
- **Relationships**: Reconciled by `ensureGitHubRuntime` through `ScriptingRuntime`; starts the document pipeline
- **Validation**: Existing ID is updated, missing ID is registered, and no generic host match is registered
- **States**: missing -> registered; existing -> updated

### Chrome Development Build

- **Fields**: target `chrome`; mode `development`; package-derived version; `manifest.json`; `background.js`; `content.js`
- **Relationships**: Produced by Rspack from package metadata, manifest template, and two runtime entries
- **Validation**: Manifest V3, name `No More Ago`, `<all_urls>`, `scripting` and `storage`, and every referenced script exists
- **States**: requested -> compiled -> installable unpacked artifact, or failed with nonzero exit

## Contracts

No HTTP, GraphQL, or other external API endpoint is required, so no `contracts/` files are created. The internal TypeScript contracts are:

```ts
export interface SiteAdapter {
  readonly id: string;
  matches(url: URL): boolean;
  discover(root: ParentNode): readonly Element[];
  extract(element: Element): TimestampCandidate | null;
}

export interface ScriptingRuntime {
  getRegisteredContentScripts(filter: { ids: string[] }): Promise<readonly { id: string }[]>;
  registerContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;
  updateContentScripts(scripts: RegisteredContentScriptSpec[]): Promise<void>;
}

export function processDocument(input: {
  url: URL;
  root: Document;
  locales: readonly string[];
  registry?: AdapterRegistry;
}): readonly HTMLTimeElement[];
```

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `package.json` | Create | Pin the stack, canonical `0.1.0` version, pnpm engine, and public quality/build commands |
| `pnpm-lock.yaml` | Generate | Lock exact dependency graph |
| `.npmrc` | Create | Enforce exact dependency saves and strict peers |
| `.gitignore` | Create | Keep dependency, generated build, and coverage output out of version control |
| `tsconfig.json` | Create | Strict ES2022 browser TypeScript checking with isolated-transpilation compatibility |
| `eslint.config.mjs` | Create | Flat ESLint rules for maintained TypeScript and Node tooling, with explicit generated-output ignores |
| `vitest.config.ts` | Create | jsdom test environment and test include pattern |
| `scripts/build.mjs` | Create | Accept the `chrome` development target and invoke Rspack with a nonzero failure exit |
| `rspack.config.mjs` | Create | Resolve and SWC-transform TypeScript background/content entries, then emit the package-versioned manifest into `dist/chrome-dev/` |
| `src/manifest/chrome.json` | Create | Chrome MV3 manifest template with permissions and background entry |
| `src/adapters/types.ts` | Create | Generic adapter and candidate contracts |
| `src/adapters/github.ts` | Create | Exact-host matcher and GitHub `relative-time` discovery/extraction |
| `src/adapters/registry.ts` | Create | Adapter injection and URL selection |
| `src/core/resolve-trusted-timestamp.ts` | Create | Explicit-zone validation and ISO-to-instant conversion |
| `src/core/format-default-date.ts` | Create | Browser-localized medium-date/short-time presentation |
| `src/core/render-exact-time.ts` | Create | Initial semantic `time` replacement boundary |
| `src/core/process-document.ts` | Create | Shared adapter-to-DOM orchestration |
| `src/runtime/scripting.ts` | Create | Browser-neutral dynamic registration types |
| `src/runtime/register-github.ts` | Create | Idempotent exact-GitHub `document_start` registration |
| `src/background/chrome.ts` | Create | Chrome API adapter and startup registration call |
| `src/content/main.ts` | Create | One initial document pipeline execution after DOM readiness |
| `tests/fixtures/github/one-relative-time.html` | Create | Minimal saved trusted GitHub fixture |
| `tests/adapters/github.test.ts` | Create | Exact host, public discovery, extraction, and registry behavior |
| `tests/core/resolve-trusted-timestamp.test.ts` | Create | Valid zoned timestamp resolution |
| `tests/core/format-default-date.test.ts` | Create | Browser-equivalent default formatting |
| `tests/core/render-exact-time.test.ts` | Create | Semantic output behavior |
| `tests/runtime/register-github.test.ts` | Create | Dynamic registration contract and reconciliation |
| `tests/integration/process-document.test.ts` | Create | GitHub end-to-end and non-GitHub no-op behavior |
| `tests/build/chrome-artifact.test.ts` | Create | Public Chrome build and emitted artifact validation |

## Tasks

### [x] Task 1: Pin the initial toolchain

**Files:**

- Create: `package.json`
- Create: `.npmrc`
- Create: `.gitignore`
- Generate: `pnpm-lock.yaml`

- [x] **Step 1: Create canonical package metadata and commands**

Use version `0.1.0`, `packageManager: "pnpm@10.34.5"`, Node `>=24 <25`, and these public scripts:

```json
{
  "scripts": {
    "dev": "node scripts/build.mjs",
    "lint": "eslint .",
    "typecheck": "tsc --noEmit",
    "test": "vitest run",
    "check": "pnpm lint && pnpm typecheck && pnpm test"
  }
}
```

Create `.gitignore` with `node_modules/`, `dist/`, and `coverage/`. These version-control ignores are mirrored by explicit flat-config ignores in Task 2 because ESLint does not consume `.gitignore` automatically.

Pin the versions listed in Technical Context. Include `@mantine/core`, `@mantine/hooks`, React, React DOM, date-fns, and `@date-fns/tz` as runtime dependencies; include Rspack CLI/core, TypeScript, ESLint 10, `typescript-eslint` 8.67.0, Vitest, jsdom, and Chrome/Node/React type packages as development dependencies.

- [x] **Step 2: Install and verify the lockfile**

Run: `corepack pnpm install`

Expected: exit 0; `pnpm-lock.yaml` is created and `corepack pnpm install --frozen-lockfile` subsequently exits 0.

**Verification**: `corepack pnpm --version` prints `10.34.5`, and `corepack pnpm install --frozen-lockfile` succeeds.

### [x] Task 2: Establish strict compiler, lint, and test gates

**Files:**

- Create: `tsconfig.json`
- Create: `eslint.config.mjs`
- Create: `vitest.config.ts`

- [x] **Step 1: Add strict browser compilation**

Configure `target: "ES2022"`, `module: "ESNext"`, `moduleResolution: "Bundler"`, `lib: ["ES2022", "DOM", "DOM.Iterable"]`, `strict: true`, `isolatedModules: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, `noEmit: true`, and types for Chrome and Vitest. `tsc --noEmit` remains the semantic type checker, while `isolatedModules` rejects constructs that the per-file Rspack SWC transform cannot safely emit; use `import type` for type-only imports where required by the checked source.

- [x] **Step 2: Scope linting to maintained source and tooling**

Make the first flat-config object a global ignore with `ignores: ["dist/**", "coverage/**", "node_modules/**"]`; do not depend on `.gitignore` being imported. Apply `typescript-eslint` strict type-checked rules to `src/**/*.ts`, `tests/**/*.ts`, and `vitest.config.ts`. Apply `@eslint/js` recommended rules with module syntax and the required read-only Node globals only to `eslint.config.mjs`, `rspack.config.mjs`, and `scripts/**/*.mjs`. No configuration should select emitted JavaScript under `dist/`. Configure Vitest with `environment: "jsdom"`, `restoreMocks: true`, and `include: ["tests/**/*.test.ts"]`.

- [x] **Step 3: Verify the empty gates**

Run: `corepack pnpm lint && corepack pnpm typecheck && corepack pnpm exec vitest run --passWithNoTests`

Expected: all three commands exit 0 before behavior files are added.

**Verification**: strict compilation, including isolated-module compatibility, and linting are active without source-text assertion tests; `eslint .` has explicit maintained TypeScript/Node-tooling scopes and globally excludes dependency, coverage, and generated artifact directories.

### [x] Task 3: Define the generic adapter boundary and exact GitHub adapter

**Files:**

- Create: `src/adapters/types.ts`
- Create: `src/adapters/github.ts`
- Create: `src/adapters/registry.ts`
- Create: `tests/adapters/github.test.ts`

- [x] **Step 1: Write failing public adapter tests**

```ts
expect(defaultRegistry.select(new URL("https://github.com/org/repo"))?.id).toBe("github");
expect(defaultRegistry.select(new URL("https://gist.github.com/org/1"))).toBeNull();
expect(defaultRegistry.select(new URL("https://github.example/org/repo"))).toBeNull();
document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
const adapter = defaultRegistry.select(new URL("https://github.com/org/repo"));
const [element] = adapter!.discover(document);
expect(adapter!.extract(element!)).toMatchObject({
  adapterId: "github",
  rawDatetime: "2026-08-23T10:15:00Z",
  sourceKind: "relative-time"
});
```

- [x] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run tests/adapters/github.test.ts`

Expected: FAIL because the adapter modules do not exist.

- [x] **Step 3: Implement the contracts, adapter, and injectable registry**

```ts
export const githubAdapter: SiteAdapter = {
  id: "github",
  matches: (url) => (url.protocol === "https:" || url.protocol === "http:") && url.hostname === "github.com",
  discover: (root) => [...root.querySelectorAll("relative-time[datetime]")],
  extract: (element) => {
    if (element.localName !== "relative-time") return null;
    const rawDatetime = element.getAttribute("datetime")?.trim();
    return rawDatetime
      ? { adapterId: "github", source: element, sourceKind: "relative-time", rawDatetime }
      : null;
  }
};

export class AdapterRegistry {
  constructor(private readonly adapters: readonly SiteAdapter[]) {}
  select(url: URL): SiteAdapter | null {
    return this.adapters.find((adapter) => adapter.matches(url)) ?? null;
  }
}
```

- [x] **Step 4: Run the focused test**

Run: `corepack pnpm vitest run tests/adapters/github.test.ts`

Expected: PASS for exact `github.com`; non-GitHub hostnames remain unmatched.

**Verification**: Neither the formatter nor browser runtime imports `githubAdapter` or knows its selector.

### [x] Task 4: Resolve one explicitly zoned timestamp

**Files:**

- Create: `src/core/resolve-trusted-timestamp.ts`
- Create: `tests/core/resolve-trusted-timestamp.test.ts`

- [x] **Step 1: Write the failing resolver test**

```ts
const result = resolveTrustedTimestamp({
  adapterId: "github",
  source: document.createElement("relative-time"),
  sourceKind: "relative-time",
  rawDatetime: "2026-08-23T10:15:00+03:00"
});
expect(result?.instant.toISOString()).toBe("2026-08-23T07:15:00.000Z");
expect(result?.sourceDatetime).toBe("2026-08-23T10:15:00+03:00");
```

- [x] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run tests/core/resolve-trusted-timestamp.test.ts`

Expected: FAIL because `resolveTrustedTimestamp` is missing.

- [x] **Step 3: Implement the minimal shared resolver**

```ts
const EXPLICIT_ZONE = /(?:Z|[+-]\d{2}:\d{2})$/i;

export function resolveTrustedTimestamp(candidate: TimestampCandidate): ResolvedTimestamp | null {
  if (!EXPLICIT_ZONE.test(candidate.rawDatetime)) return null;
  const instant = parseISO(candidate.rawDatetime);
  if (!isValid(instant)) return null;
  return { source: candidate.source, sourceDatetime: candidate.rawDatetime, instant };
}
```

- [x] **Step 4: Run the focused test**

Run: `corepack pnpm vitest run tests/core/resolve-trusted-timestamp.test.ts`

Expected: PASS; the offset is normalized to the correct instant without reading relative text.

**Verification**: Resolution accepts the issue fixture's trusted value and returns `null` for a zone-less control case. The exhaustive rejection matrix remains in 3-AFK.

### [x] Task 5: Format the instant with browser defaults

**Files:**

- Create: `src/core/format-default-date.ts`
- Create: `tests/core/format-default-date.test.ts`

- [x] **Step 1: Write the failing presentation test**

```ts
const instant = new Date("2026-08-23T07:15:00.000Z");
const expectedEnGb = new Intl.DateTimeFormat(["en-GB"], {
  dateStyle: "medium",
  timeStyle: "short"
}).format(instant);
const expectedRuntimeDefault = new Intl.DateTimeFormat(undefined, {
  dateStyle: "medium",
  timeStyle: "short"
}).format(instant);

expect(formatDefaultDate(instant, ["en-GB"])).toBe(expectedEnGb);
expect(formatDefaultDate(instant, [])).toBe(expectedRuntimeDefault);
```

- [x] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run tests/core/format-default-date.test.ts`

Expected: FAIL because the presentation module is missing.

- [x] **Step 3: Implement date-fns-backed default presentation**

```ts
export function formatDefaultDate(instant: Date, locales: readonly string[]): string {
  const formatOptions = { dateStyle: "medium", timeStyle: "short" } as const;
  if (locales.length === 0) return intlFormat(instant, formatOptions);
  return intlFormat(instant, formatOptions, { locale: [...locales] });
}
```

- [x] **Step 4: Run the focused test**

Run: `corepack pnpm vitest run tests/core/format-default-date.test.ts`

Expected: PASS for both an explicit `en-GB` locale list and an empty list that delegates to the runtime default locale.

**Verification**: Output includes the year and minutes, has no seconds, and no explicit time-zone override is passed. The empty-locale branch calls the type-safe two-argument `intlFormat` overload, while the nonempty branch supplies the locale required by the three-argument overload.

### [x] Task 6: Render a semantic exact time

**Files:**

- Create: `src/core/render-exact-time.ts`
- Create: `tests/core/render-exact-time.test.ts`

- [x] **Step 1: Write the failing DOM behavior test**

```ts
document.body.innerHTML = '<a href="/org/repo"><relative-time>2 hours ago</relative-time></a>';
const source = document.querySelector("relative-time")!;
const output = renderExactTime(source, "2026-08-23T10:15:00+03:00", "23 Aug 2026, 10:15");
expect(output.localName).toBe("time");
expect(output.dateTime).toBe("2026-08-23T10:15:00+03:00");
expect(output.textContent).toBe("23 Aug 2026, 10:15");
expect(document.querySelector("a")?.contains(output)).toBe(true);
expect(document.querySelector("relative-time")).toBeNull();
```

- [x] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run tests/core/render-exact-time.test.ts`

Expected: FAIL because the renderer is missing.

- [x] **Step 3: Implement the isolated tracer-bullet renderer**

```ts
export function renderExactTime(source: Element, datetime: string, text: string): HTMLTimeElement {
  const output = source.ownerDocument.createElement("time");
  output.dateTime = datetime;
  output.textContent = text;
  source.replaceWith(output);
  return output;
}
```

- [x] **Step 4: Run the focused test**

Run: `corepack pnpm vitest run tests/core/render-exact-time.test.ts`

Expected: PASS; the containing link remains the parent interaction and output is semantic.

**Verification**: All destructive behavior is confined to this function for replacement by 2-AFK's owned sibling/restoration implementation.

### [x] Task 7: Join adapter, resolver, formatter, and renderer through one public pipeline

**Files:**

- Create: `src/core/process-document.ts`
- Create: `tests/fixtures/github/one-relative-time.html`
- Create: `tests/integration/process-document.test.ts`

- [x] **Step 1: Save the fixture and write failing end-to-end tests**

Fixture:

```html
<a href="/maximtop/no-more-ago/commit/abc">
  <relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>
</a>
```

Tests call only `processDocument` and assert one `time[datetime="2026-08-23T10:15:00Z"]` with text equal to the same browser `Intl.DateTimeFormat` options. A second test installs identical markup but passes `https://example.com/`; it asserts an empty result and unchanged `relative-time` markup.

- [x] **Step 2: Run the integration test to verify it fails**

Run: `corepack pnpm vitest run tests/integration/process-document.test.ts`

Expected: FAIL because `processDocument` is missing.

- [x] **Step 3: Implement generic orchestration**

```ts
export function processDocument({ url, root, locales, registry = defaultRegistry }: ProcessInput): readonly HTMLTimeElement[] {
  const adapter = registry.select(url);
  if (!adapter) return [];
  const outputs: HTMLTimeElement[] = [];
  for (const element of adapter.discover(root)) {
    const candidate = adapter.extract(element);
    const resolved = candidate ? resolveTrustedTimestamp(candidate) : null;
    if (!resolved) continue;
    outputs.push(renderExactTime(
      resolved.source,
      resolved.sourceDatetime,
      formatDefaultDate(resolved.instant, locales)
    ));
  }
  return outputs;
}
```

- [x] **Step 4: Run the focused integration test**

Run: `corepack pnpm vitest run tests/integration/process-document.test.ts`

Expected: PASS for the GitHub fixture and PASS for the non-GitHub no-op.

**Verification**: The integration enters through the registry/public adapter interface and spans all shared stages without importing GitHub logic into core modules.

### [x] Task 8: Register the exact GitHub runtime at document start

**Files:**

- Create: `src/runtime/scripting.ts`
- Create: `src/runtime/register-github.ts`
- Create: `tests/runtime/register-github.test.ts`

- [x] **Step 1: Write the failing fake-runtime tests**

```ts
await ensureGitHubRuntime(fakeRuntimeWithNoRegistrations);
expect(fakeRuntimeWithNoRegistrations.registerContentScripts).toHaveBeenCalledWith([{
  id: "no-more-ago-github",
  matches: ["http://github.com/*", "https://github.com/*"],
  js: ["content.js"],
  runAt: "document_start",
  allFrames: false,
  persistAcrossSessions: true
}]);
await ensureGitHubRuntime(fakeRuntimeWithExistingRegistration);
expect(fakeRuntimeWithExistingRegistration.updateContentScripts).toHaveBeenCalledTimes(1);
```

- [x] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run tests/runtime/register-github.test.ts`

Expected: FAIL because the runtime contracts and coordinator are missing.

- [x] **Step 3: Implement the browser-neutral reconciliation**

```ts
export const GITHUB_REGISTRATION: RegisteredContentScriptSpec = {
  id: "no-more-ago-github",
  matches: ["http://github.com/*", "https://github.com/*"],
  js: ["content.js"],
  runAt: "document_start",
  allFrames: false,
  persistAcrossSessions: true
};

export async function ensureGitHubRuntime(runtime: ScriptingRuntime): Promise<void> {
  const existing = await runtime.getRegisteredContentScripts({ ids: [GITHUB_REGISTRATION.id] });
  if (existing.length === 0) await runtime.registerContentScripts([GITHUB_REGISTRATION]);
  else await runtime.updateContentScripts([GITHUB_REGISTRATION]);
}
```

- [x] **Step 4: Run the focused test**

Run: `corepack pnpm vitest run tests/runtime/register-github.test.ts`

Expected: PASS for missing and existing registration states.

**Verification**: No wildcard subdomain or non-GitHub content-script match appears in the registration payload.

### [x] Task 9: Wire Chrome background and content entrypoints

**Files:**

- Create: `src/background/chrome.ts`
- Create: `src/content/main.ts`

- [x] **Step 1: Add the Chrome scripting adapter**

```ts
const scriptingRuntime: ScriptingRuntime = {
  getRegisteredContentScripts: (filter) => chrome.scripting.getRegisteredContentScripts(filter),
  registerContentScripts: (scripts) => chrome.scripting.registerContentScripts(scripts),
  updateContentScripts: (scripts) => chrome.scripting.updateContentScripts(scripts)
};

void ensureGitHubRuntime(scriptingRuntime).catch((error: unknown) => console.error("Runtime registration failed", error));
```

- [x] **Step 2: Add one DOM-ready content execution**

```ts
const run = () => processDocument({
  url: new URL(window.location.href),
  root: document,
  locales: navigator.languages
});

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", run, { once: true });
else run();
```

- [x] **Step 3: Verify entrypoint types**

Run: `corepack pnpm typecheck`

Expected: PASS; the Chrome global is contained in the background adapter and content code imports only the public pipeline.

**Verification**: The background starts reconciliation whenever its MV3 worker loads; the dynamically registered content entry performs one initial scan and schedules no polling or observer.

### [x] Task 10: Produce and validate the Chrome development artifact

**Files:**

- Create: `scripts/build.mjs`
- Create: `rspack.config.mjs`
- Create: `src/manifest/chrome.json`
- Create: `tests/build/chrome-artifact.test.ts`

- [x] **Step 1: Write the failing public build smoke**

The test runs `corepack pnpm dev chrome`, parses only `dist/chrome-dev/manifest.json`, and asserts:

```ts
expect(manifest).toMatchObject({
  manifest_version: 3,
  name: "No More Ago",
  version: packageMetadata.version,
  permissions: expect.arrayContaining(["scripting", "storage"]),
  host_permissions: expect.arrayContaining(["<all_urls>"]),
  background: { service_worker: "background.js" }
});
await expect(stat("dist/chrome-dev/background.js")).resolves.toBeDefined();
await expect(stat("dist/chrome-dev/content.js")).resolves.toBeDefined();
```

- [x] **Step 2: Run the test to verify it fails**

Run: `corepack pnpm vitest run tests/build/chrome-artifact.test.ts`

Expected: FAIL because the public build command and artifact do not exist.

- [x] **Step 3: Implement the Chrome-only development wrapper**

`scripts/build.mjs` accepts exactly `chrome`, invokes `corepack pnpm exec rspack build --config rspack.config.mjs --mode development --env target=chrome`, forwards stdio, and exits with the child status. Any other argument prints `Usage: pnpm dev chrome` and exits 2.

- [x] **Step 4: Configure TypeScript resolution/transformation and the manifest**

Use entries `{ background: "./src/background/chrome.ts", content: "./src/content/main.ts" }`, fixed filenames `[name].js`, output `dist/chrome-dev`, clean output before compilation, and source maps. Add explicit extension resolution and the TypeScript transform before any build is expected to pass:

```js
resolve: {
  extensions: [".ts", ".js", ".mjs", ".json"]
},
module: {
  rules: [{
    test: /\.ts$/,
    exclude: /node_modules/,
    type: "javascript/auto",
    use: [{
      loader: "builtin:swc-loader",
      options: {
        jsc: {
          parser: { syntax: "typescript" },
          target: "es2022"
        },
        module: { type: "es6" }
      }
    }]
  }]
}
```

The `.ts` entry paths and their extensionless imports are therefore resolved as TypeScript, and SWC removes their type syntax before Rspack bundles them. The manifest template contains the name, description, Manifest V3, `permissions: ["scripting", "storage"]`, `host_permissions: ["<all_urls>"]`, and background service worker. In the copy transform, parse the template, assign `manifest.version = packageJson.version`, and emit formatted JSON.

- [x] **Step 5: Run the focused build smoke**

Run: `corepack pnpm vitest run tests/build/chrome-artifact.test.ts`

Expected: PASS; Rspack resolves the actual extensionless TypeScript module graph, transforms it through `builtin:swc-loader`, and the unpacked directory contains a parseable manifest plus both referenced JavaScript bundles with package version `0.1.0`.

**Verification**: A successful public build is the runtime-boundary proof that `.ts` imports resolve and TypeScript syntax is transformed; the smoke then proves that the emitted manifest references both resulting bundles. Loading `/Volumes/dev/no-more-ago/dist/chrome-dev` as an unpacked Chrome extension is the documented manual smoke target. Browser UI automation is not part of this AFK task and must not be started without explicit permission.

### [x] Task 11: Run the complete issue quality gate

**Files:**

- Modify: none

- [x] **Step 1: Run all automated checks and re-lint emitted-artifact state**

Run: `corepack pnpm check && corepack pnpm lint`

Expected: lint, strict typecheck (including `isolatedModules` and both `intlFormat` branches), adapter/resolver/formatter/renderer/runtime tests, GitHub/non-GitHub integration tests, and the public build smoke over the extensionless TypeScript graph all PASS. The second lint runs after the build smoke has emitted `dist/chrome-dev/` and still checks only maintained TypeScript and Node tooling because generated output is globally ignored.

- [x] **Step 2: Rebuild from a clean artifact directory**

Run: `corepack pnpm dev chrome`

Expected: exit 0 with no TypeScript resolution or parse errors and a fresh `dist/chrome-dev/` containing only the Chrome development artifact.

- [x] **Step 3: Record manual smoke instructions**

Load `/Volumes/dev/no-more-ago/dist/chrome-dev` through Chrome's unpacked-extension flow, open a public exact `github.com` page containing `relative-time`, and compare it with the same markup on a non-GitHub fixture page. This step is executed by a human or under separately granted browser permission.

**Verification**: Automated acceptance is green; the artifact is ready for the issue's manual Chrome check without adding a browser dependency to the AFK flow.

## Acceptance Coverage

| Acceptance criterion | Planned evidence |
| --- | --- |
| 1. Installable Chrome development artifact with name, package version, `<all_urls>`, scripting, and storage | Tasks 1, 2, and 10; `tests/build/chrome-artifact.test.ts` |
| 2. Default activation on `github.com` produces one localized exact date through the registered adapter/shared presentation path | Tasks 3 through 9; runtime contract plus `tests/integration/process-document.test.ts` |
| 3. Identical markup on another hostname remains unchanged | Tasks 3 and 7; non-GitHub integration case |
| 4. GitHub selection/extraction stay behind the public adapter interface | Tasks 3 and 7; injectable `AdapterRegistry`, adapter test, and core pipeline imports |

## Self-Review

- Every acceptance criterion maps to an automated test or emitted-artifact check above.
- All later-slice work is explicitly excluded: reversible ownership, comprehensive unsafe inputs, mutations, multiple browser targets, release/ZIP/watch builds, settings, and existing-tab injection.
- Type and property names are consistent from `TimestampCandidate` through `ResolvedTimestamp`, `processDocument`, and renderer output.
- Tests exercise public behavior and emitted artifacts; none assert implementation source text, command spelling, or private symbols.
- The plan contains no unresolved placeholders or deferred technical choices within issue 1-AFK.
- Review attempt 1 Correctness finding is resolved in Task 5: observable tests cover explicit and empty locale lists, the empty branch uses the two-argument `intlFormat` overload, and Task 11 runs strict typechecking.
- Review attempt 1 Maintainability finding is resolved in Tasks 1, 2, and 11: `.gitignore` records generated paths, flat config independently ignores them and declares maintained TypeScript/Node-tooling scopes, and lint is rerun after the artifact smoke creates `dist/chrome-dev/`.
- Review attempt 2 Correctness finding is resolved in Tasks 2, 10, and 11: `isolatedModules` aligns semantic checking with per-file transpilation; Rspack explicitly resolves `.ts` and applies `builtin:swc-loader` with the TypeScript parser and ES2022 target; and both the public artifact smoke and clean rebuild compile the real extensionless TypeScript graph.
