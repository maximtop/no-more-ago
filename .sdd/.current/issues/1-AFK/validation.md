# Issue Validation Report: [no-more-ago] Replace the first trusted GitHub timestamp

- **Validated**: 2026-08-23
- **Model**: GPT-5 (reasoning effort not exposed)
- **Issue**: `.sdd/.current/issues/1-AFK/issue.md`
- **Plan**: `.sdd/.current/issues/1-AFK/plan.md`
- **Validation attempt**: 1

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 11 | 0 | 0 | 11 |
| Acceptance Criteria | 4 | 0 | 0 | 4 |
| Entities | 6 | 0 | 0 | 6 |
| Contracts | 3 | 0 | 0 | 3 |
| Guidelines | 1 | 0 | 0 | 1 |

**Overall Status**: COMPLETE

## Task Status

- [x] **Task 1: Pin the initial toolchain** - PASS: `package.json` pins version `0.1.0`, pnpm `10.34.5`, Node 24, and the planned exact dependencies; under Node v24.18.1, `corepack pnpm --version` reported `10.34.5` and `corepack pnpm install --frozen-lockfile` exited 0.
- [x] **Task 2: Establish strict compiler, lint, and test gates** - PASS: `tsconfig.json`, `eslint.config.mjs`, and `vitest.config.ts` implement the planned strict options and maintained-source scopes; the complete lint and typecheck gates exited 0.
- [x] **Task 3: Define the generic adapter boundary and exact GitHub adapter** - PASS: `tests/adapters/github.test.ts` passed exact `github.com` HTTP(S) selection, lookalike/subdomain rejection, discovery, and extraction through the public registry interface.
- [x] **Task 4: Resolve one explicitly zoned timestamp** - PASS: `tests/core/resolve-trusted-timestamp.test.ts` passed correct offset normalization and rejection of a zone-less value.
- [x] **Task 5: Format the instant with browser defaults** - PASS: `tests/core/format-default-date.test.ts` passed both explicit `en-GB` and empty/runtime-default locale paths against `Intl.DateTimeFormat` behavior.
- [x] **Task 6: Render a semantic exact time** - PASS: `tests/core/render-exact-time.test.ts` passed semantic `time` replacement, preserved authoritative `dateTime`, localized text, and containing-link behavior.
- [x] **Task 7: Join the shared pipeline** - PASS: `tests/integration/process-document.test.ts` passed the saved GitHub fixture end to end and proved identical non-GitHub markup remains unchanged.
- [x] **Task 8: Register the exact GitHub runtime at document start** - PASS: `tests/runtime/register-github.test.ts` passed missing-registration and existing-registration reconciliation with exact GitHub matches, `document_start`, top-frame-only execution, and persistent registration.
- [x] **Task 9: Wire Chrome background and content entrypoints** - PASS: strict typechecking passed; the public build compiled both entrypoints, and inspection confirmed GitHub selectors remain outside core and browser-runtime modules.
- [x] **Task 10: Produce and validate the Chrome development artifact** - PASS: `tests/build/chrome-artifact.test.ts` passed the public build boundary. A separate clean build exited 0; the artifact contains parseable `background.js` and `content.js` bundles plus a Manifest V3 manifest named `No More Ago`, versioned `0.1.0`, with `<all_urls>`, `scripting`, and `storage`.
- [x] **Task 11: Run the complete issue quality gate** - PASS: under the declared Node 24 toolchain, `corepack pnpm check` exited 0 with 7 test files and 11 tests passing; post-artifact `corepack pnpm lint` and a fresh `corepack pnpm dev chrome` both exited 0. The manual unpacked-extension smoke remains an explicitly documented human/separately authorized check and was not required by the approved automated gate.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | The Chrome development build produces an installable artifact with the agreed name, package-derived version, `<all_urls>`, and scripting/storage capabilities. | MET | The public artifact smoke passed; `dist/chrome-dev/manifest.json` reports Manifest V3, `No More Ago`, version `0.1.0`, `host_permissions: ["<all_urls>"]`, `permissions: ["scripting", "storage"]`, and references emitted `background.js`; both emitted bundles also passed `node --check`. |
| 2 | Default activation on exact `github.com` produces one exact date through the registered GitHub adapter and shared presentation path. | MET | `tests/runtime/register-github.test.ts` passed the exact-host `document_start` activation contract, and `tests/integration/process-document.test.ts` passed one GitHub fixture through registry selection, extraction, trusted resolution, browser-default formatting, and semantic output. |
| 3 | The same markup on a non-GitHub hostname selects no GitHub adapter and remains unchanged. | MET | The non-GitHub integration case returned no outputs and preserved the original `relative-time` markup; adapter tests also rejected `gist.github.com` and `github.example`. |
| 4 | GitHub discovery and extraction remain behind the public adapter interface. | MET | `AdapterRegistry` accepts `SiteAdapter` instances; `processDocument` consumes only registry/adapter methods, and source inspection found `githubAdapter` and the `relative-time` selector only in the adapter layer (plus registry composition), not in formatter, core pipeline, or browser runtime. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Adapter Definition | OK | OK | Exact HTTP(S) host selection verified | PASS |
| Timestamp Candidate | OK | OK | Nonempty `datetime` extraction verified | PASS |
| Resolved Timestamp | OK | OK | Explicit-zone and valid-instant rules verified | PASS |
| Rendered Exact Time | OK | OK | Semantic element, authoritative `dateTime`, and nonempty localized text verified | PASS |
| Runtime Registration | OK | OK | Missing and existing registration states verified | PASS |
| Chrome Development Build | OK | OK | Public build, manifest, referenced bundles, and syntax verified | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| `SiteAdapter` | PASS | Registry and GitHub adapter compile against the contract; public behavior tests exercise selection, discovery, and extraction. |
| `ScriptingRuntime` | PASS | Fake-runtime tests exercise lookup, registration, and update behavior through the interface. |
| `processDocument` | PASS | Integration tests exercise the public input/output contract on matching and nonmatching hosts. |

No external HTTP, GraphQL, or persisted-data contract exists in this issue.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Test observable behavior through public/runtime boundaries rather than source-text assertions | COMPLIANT | Tests invoke public adapters, resolver, formatter, renderer, runtime coordinator, document pipeline, and build command; the artifact test inspects emitted behavior and manifest data rather than implementation text. |

No project-local `AGENTS.md` exists; other supplied workflow rules were not applicable to the implementation itself.

## Issues Found

None.

## Recommendations

- No implementation changes are required for issue `1-AFK`.
- As the documented optional human smoke, load `/Volumes/dev/no-more-ago/dist/chrome-dev` as an unpacked extension in Chrome and compare an exact `github.com` timestamp with a non-GitHub control page when browser access is separately authorized.
