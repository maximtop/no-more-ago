# Issue Validation Report: [no-more-ago] Reject unsafe GitHub timestamps

- **Validated**: 2026-08-24
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **Issue**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/3-AFK/issue.md`
- **Plan**: `/Volumes/dev/no-more-ago/.sdd/.current/issues/3-AFK/plan.md`
- **Validation attempt**: 3

## Summary

| Category | Pass | Partial | Fail | Total |
| --- | --- | --- | --- | --- |
| Tasks | 8 | 0 | 0 | 8 |
| Acceptance Criteria | 5 | 0 | 0 | 5 |
| Entities | 3 | 0 | 0 | 3 |
| Contracts | 4 | 0 | 0 | 4 |
| Guidelines | 5 | 0 | 0 | 5 |

**Overall Status**: COMPLETE

The sole attempt-2 gap is closed. The repository resolver table now contains accepted cases for `2026-08-23T10:15-23`, `2026-08-23T10:15-2359`, and `2026-08-23T10:15-23:59`, with exact normalized instants and shared assertions for exact source identity and unchanged raw `sourceDatetime`. The focused and full Node 24 test runs pass, including every prior adapter, resolver, fixture, ownership, restoration, lifecycle, registration, and build regression. The direct-pnpm lint, typecheck, test, Chrome build, and post-build lint gates all exit successfully. No capped-attempt escalation is required because every approved plan task and acceptance criterion passes.

## Task Status

- [x] **Prerequisite: Remove both inherited Corepack call sites before any build test** - PASS: `scripts/build.mjs` retains resolved-realpath containment, regular local JavaScript-entry validation, and execution through `process.execPath`; `tests/build/chrome-artifact.test.ts` invokes direct `pnpm dev chrome` and asserts emitted behavior. The artifact test in the full suite and the explicit Chrome build pass. No validation command invoked Corepack.
- [x] **Task 1: Specify adapter eligibility** - PASS: public adapter tests cover all three approved kinds, exact source identity, raw padded preservation, the explicit rule, normalized `format="datetime"`, missing/empty input, prose and generic-attribute traps, exact `github.com`, and excluded protocols/hostnames.
- [x] **Task 2: Specify strict timestamp resolution** - PASS: the accepted table includes the complete basic/extended calendar, ordinal, week, expanded-year, fraction, separator, `24:00`, positive/zero/numeric-zone cases and both signs of the maximum numeric offsets. In particular, `-23` resolves to `2026-08-24T09:15:00.000Z`, while `-2359` and `-23:59` resolve to `2026-08-24T10:14:00.000Z`; the common body asserts exact source identity, exact raw `sourceDatetime`, and exact `instant.toISOString()`. The complete rejection/rule tables remain passing.
- [x] **Task 3: Add ordinary static fixtures and offline integration tests** - PASS: seven small static files, their handwritten README, and the independent synthetic matrix remain present. The exact representative URL table asserts positive raw/instant/semantic ownership and link relationships or exact no-op DOM preservation, then replays the matrix at all seven paths and rejects Gist/lookalike hosts. Automated validation remained offline as required.
- [x] **Task 4: Implement adapter source rules** - PASS: the unchanged `SiteAdapter` boundary discovers the three approved kinds path-independently, excludes unsupported kinds, rejects already-absolute/missing values, preserves padded raw input for resolver rejection, and never treats visible/title/aria/data prose as a timestamp.
- [x] **Task 5: Implement strict resolver rules** - PASS: exact-rule enforcement, source/raw preservation, padding and C0/C1 rejection, complete calendar/ordinal/week shapes, explicit minutes, terminal uppercase zones, malformed-zone traps, numeric bounds, negative-zero rejection, and date-fns calendar/time/instant validation all remain implemented and passing.
- [x] **Task 6: Run offline and predecessor regressions** - PASS: the focused adapter/resolver/fixture/pipeline run passed 4 files and 112 tests; the full suite passed 13 files and 133 tests. Typechecking passed, and predecessor ownership, restoration, controller, content, runtime-message, and registration tests remain green.
- [x] **Task 7: Run the complete direct-pnpm gate** - PASS: under login-shell Node v24.18.1 and pnpm 10.34.5, `pnpm lint`, `pnpm typecheck`, `pnpm test`, direct `pnpm dev chrome`, and post-build `pnpm lint` all exited 0. The Chrome build compiled successfully.

## Acceptance Criteria Status

| # | Criterion | Status | Evidence |
| --- | --- | --- | --- |
| 1 | Approved GitHub relative custom elements with complete, explicitly zoned, date-fns-supported ISO 8601 instants reach the shared pipeline without filled components | MET | Adapter tests cover all three kinds and preserve raw/source identity. The 81-test focused resolver run passes the broad complete-form table, including all three newly durable negative maximum-offset cases with exact expected instants and shared source/raw identity assertions. |
| 2 | Missing, malformed, zone-less, ambiguous, or prose-only input is an unchanged safe no-op | MET | Adapter, resolver, matrix, fixture, and pipeline tests pass. The adversarial table retains padding, C0/C1 controls, reduced/defaulted forms, impossible dates/weeks/times, malformed and overflowing offsets, negative zero, suffix junk, and extra-zone traps while preserving source DOM. |
| 3 | `local-time` and `format="datetime"` are rejected as already absolute | MET | Public adapter tests and the synthetic matrix produce no extraction, output, hidden state, ownership, or DOM change for these cases. |
| 4 | The same rules apply to commits, issues/pull requests, timelines, releases/tags, profiles/activity, search, and Actions without a path allowlist | MET | The seven exact representative URLs and static fixture expectations pass; the independent matrix replays identically across all seven paths. Gist and lookalike hosts remain exact no-ops. |
| 5 | Generic `title`, `aria-label`, or `data-*` values are never timestamp sources | MET | Adapter tests and the independent matrix leave generic attribute carriers unchanged with zero extraction, output, or ownership. |

## Entity Status

| Entity | Fields | Relationships | Validation | Status |
| --- | --- | --- | --- | --- |
| Timestamp Candidate | Adapter ID, exact source, three approved kinds, raw `datetime`, and exact rule are present | Produced by `SiteAdapter.extract`; consumed by the resolver | Kind/rule/raw/source identity and rejection tests pass | PASS |
| Resolved Timestamp | Exact source, preserved source string, and normalized `Date` instant are present | Produced only after resolver guards; consumed by formatter/renderer | Full accepted/rejected tables, including negative maximum offsets, pass exact identity and instant assertions | PASS |
| Static GitHub Fixture | Seven category files plus representative URL, capture/sanitization documentation, and exact positive/no-op expectation are present | Source-derived cases exercise adapter/resolver/process behavior; synthetic matrix owns exhaustive eligibility paths | Repository offline tests pass exact source/instant/ownership/link/no-op behavior | PASS |

## Contract Status

| Contract | Status | Notes |
| --- | --- | --- |
| `TimestampCandidate` / explicit datetime rule | PASS | Literal rule and approved source-kind union match the plan; public adapter tests exercise exact values and identity. |
| `SiteAdapter` | PASS | Signature remains stable; exact-host selection, discovery, extraction, and safe rejections pass through the public adapter/registry boundary. |
| `resolveTrustedTimestamp` | PASS | Signature remains stable; the resolver preserves exact raw/source identity, accepts complete known-zoned values, and rejects incomplete or unsafe values. |
| `processDocument` | PASS | The adapter → resolver → formatter → renderer pipeline produces one semantic owned output only after success and leaves rejected or unmatched DOM unchanged. |

No HTTP endpoint, browser message, persisted schema, GraphQL/OpenAPI contract, fixture updater, or fixture API/CLI is added by this issue.

## Guidelines Compliance

| Guideline | Status | Notes |
| --- | --- | --- |
| Test observable behavior through public/runtime boundaries | COMPLIANT | Tests and validation checks exercise adapter, resolver, DOM, public build command, emitted artifact, and bundle syntax behavior; no implementation-text assertion test was added. |
| Do not invoke Corepack; use ordinary direct pnpm | COMPLIANT | Every project gate used direct pnpm in the normal Node 24 login-shell environment. Corepack was never invoked. |
| Do not use browser automation without permission | COMPLIANT | No browser, Chrome control, website UI, or live-browser smoke was used. |
| Prefer simple local/structured access | COMPLIANT | Validation used only local files, static fixtures, public project commands, jsdom tests, and emitted artifacts; no network was used. |
| Non-destructive issue validation | COMPLIANT | No implementation, test, fixture, plan, package, or build configuration file was changed. Only this report and the issue validation status were updated. |

No project-local `AGENTS.md` exists; the supplied workspace instructions were applied.

## Verification Evidence

- Toolchain: login-shell Node `v24.18.1`; pnpm `10.34.5`.
- Focused issue gate: 4 files and 112 tests passed for adapter, resolver, static fixtures, and document processing.
- Focused resolver/adversarial gate: 1 file and 81 tests passed. The output explicitly includes the three negative maximum-offset acceptance cases and every retained rejection/rule case.
- Full gate: initial lint passed; typecheck passed; 13 files and 133 tests passed; direct Chrome build passed; post-build lint passed.
- Attempt-2 comparison: the full suite increased from 130 to 133 tests, exactly accounting for the three previously missing durable cases.
- Fresh artifact: `pnpm dev chrome` compiled successfully; `manifest.json` (311 bytes), `background.js` (3314 bytes), and `content.js` (43370 bytes) are nonempty. Manifest v3/name/package version/permissions/host permissions/service worker match the public contract, and both bundles pass `node --check`.
- Resolver rows: `tests/core/resolve-trusted-timestamp.test.ts:65-67`; shared source/raw/instant assertions: lines 69-74.
- Prior attempt fixes remain: both-sign overflow and minute-boundary rejection, C1 controls, incomplete week input, impossible calendar/week/time values, suffix and malformed-zone traps, exact fixture URL/outcome binding, and hardened direct build launching all remain present and passing.
- No browser, Git, network, Corepack, implementation edit, or external provenance operation was used.

## Issues Found

None.

## Recommendations

- No issue-level remediation remains. Proceed to the next dependency-ready issue or final cross-cutting PRD validation when the full issue set is implemented.
