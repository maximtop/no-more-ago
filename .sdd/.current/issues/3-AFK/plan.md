# Implementation Plan: [no-more-ago] Reject unsafe GitHub timestamps

- **Created**: 2026-08-24
- **Status**: Approved
- **Issue**: `.sdd/.current/issues/3-AFK/issue.md`
- **PRD**: `.sdd/.current/prd.md`
- **Model**: Codex (GPT-5; reasoning effort not exposed)
- **User Input**: Keep issue 3 simple: seven ordinary static source-derived GitHub fixtures, one hand-written README, one independent synthetic eligibility matrix, and offline table-driven tests. Add no automatic fixture updater in the MVP. Preserve strict timestamp eligibility, path-independent adapter behavior, existing renderer/runtime regressions, direct pnpm in the normal environment, and removal of both inherited Corepack call sites before any build test.

## Summary

Complete eligibility at the existing GitHub adapter and shared resolver boundaries. The adapter will discover `relative-time`, `time-ago`, and `time-until` on every exact-`github.com` path, reject already-absolute and unsupported elements, and return the raw `datetime` plus an explicit source rule. It uses `trim()` only to detect an empty attribute; padded nonempty input reaches the resolver unchanged and is rejected there.

The resolver will accept only the declared rule and the complete raw string. Before parsing, it will reject leading or trailing padding, control characters, trailing text, reduced or omitted date/time components, a missing terminal zone, malformed or out-of-range numeric offsets, and every negative-zero offset spelling. A small completeness guard requires a full calendar, ordinal, or ISO-week date and a time containing hours and minutes; seconds and fractional seconds remain optional. The supported terminal zones are uppercase `Z` and numeric `±HH`, `±HHMM`, or `±HH:MM`, with hour `00..23` and minute `00..59` when present. After those unambiguous guards, date-fns 4.4.0 `parseISO` plus `isValid` remains the calendar, time-range, and instant authority.

This avoids the prior GitHub-shaped precision cap without allowing date-fns to invent omitted components. The contract includes complete basic and extended calendar, ordinal, and week dates; uppercase `T` and ASCII-space date-time separators; basic and extended hour/minute times; optional seconds; arbitrarily long fractional seconds with period or comma; complete expanded years supported by date-fns; and valid `24:00` forms. Reduced dates and incomplete ordinal/week dates let the parser fill missing components; hour-only and fractional-hour forms lack the explicit minute field required by the completeness contract. All remain safe no-ops. Visible prose and `title`, `aria-*`, or `data-*` never become timestamp inputs.

During implementation, direct unauthenticated HTTP will be used once to obtain representative markup for commits, issues/pull requests, timelines, releases/tags, profiles/activity, search, and Actions. Each response becomes a small hand-sanitized HTML file under `tests/fixtures/github/`; if no approved custom element exists, the file preserves an honest negative snippet. A hand-written README records source URL, capture date, sanitization, and expected eligible/no-op behavior. Tests load these files offline through a small in-test case table. A separate static synthetic matrix supplies exhaustive positive and negative markup and proves path independence.

The saved files do not promise compatibility with future GitHub markup. Later changes to them require a separate issue.

Before any build-capable test, remove both inherited Corepack call sites. `scripts/build.mjs` will run the absolute project-local exported `@rspack/cli` JavaScript entry with `process.execPath`; the artifact test will run ordinary direct `pnpm dev chrome` and assert emitted artifacts.

## Technical Context

- **Language/Version**: TypeScript 6.0.3 targeting ES2022; Node.js 24
- **Primary Dependencies**: date-fns 4.4.0, Vitest 4.1.11, jsdom 30.0.1, Rspack CLI 2.1.10; no new dependency
- **Storage**: Ordinary repository-local HTML/Markdown test resources only; runtime timestamps stay in document memory
- **Testing**: Table-driven Vitest unit tests and jsdom integration tests through `SiteAdapter`, `resolveTrustedTimestamp`, `processDocument`, and existing renderer/runtime boundaries
- **Target Platform**: Exact `github.com` HTTP(S) pages in the current Chrome development tracer bullet; automated tests are offline

## Research

### Existing seams and dependencies

`1-AFK` and `2-AFK` are `Validated`. They established exact-host adapter selection, the shared pipeline, dynamic `document_start` registration, the Chrome artifact, reversible ownership, semantic output, link preservation, restoration, and content-runtime idempotence. Preserve those behaviors through regression tests.

Production changes are limited to `src/adapters/types.ts:1-15`, `src/adapters/github.ts:3-20`, and `src/core/resolve-trusted-timestamp.ts:5-24`. `src/core/process-document.ts:13-35` already has the correct registry → adapter → resolver → formatter → renderer flow and safe null behavior. Formatter, renderer, controller, content runtime, background, registration, messages, and browser manifest do not change.

### Adapter and resolver rules

`TimestampSourceKind` expands to the three approved elements. `TimestampCandidate` gains required literal `timestampRule: "datetime:iso8601-explicit-zone"`. Discovery includes approved elements even when `datetime` is absent so extraction owns the safe no-op. It excludes `local-time`, generic `time`, and generic attribute carriers.

Extraction rejects unsupported elements, missing/whitespace-only `datetime`, and approved elements whose trimmed, case-normalized `format` equals `datetime`. It reads `datetime` once and otherwise preserves it exactly. It never reads visible text, `title`, `aria-label`, other `aria-*`, or `data-*`.

The resolver first requires the exact rule and then applies only guards needed to make date-fns parsing unambiguous:

1. Keep `rawDatetime` unchanged and reject empty input, `rawDatetime !== rawDatetime.trim()`, or any C0/C1 control character (`U+0000..U+001F`, `U+007F..U+009F`). The ASCII space remains available as date-fns's supported internal date-time separator.
2. Extract one terminal zone using `Z` or numeric `±HH`, `±HHMM`, or `±HH:MM`. Uppercase `Z` is the only letter form. Because the suffix is anchored at the end, ordinary `Zjunk`, `+03:30junk`, incomplete offsets, offset seconds, and other trailing text are rejected.
3. Before that suffix, require one date-time separator supported by date-fns: uppercase `T` or ASCII space. Reject any additional `Z`, `+`, or `-` zone introducer in the time component before the terminal suffix; this closes date-fns 4.4.0's malformed-zone fallback for values such as `10:15+03:30junkZ`, `10:15Zjunk+03`, and `10:15+03Z`.
4. Apply this compact completeness shape only; it checks field presence and representation, not numeric or calendar validity:

   ```text
   year     = 4DIGIT / ("+" / "-") 6DIGIT
   date     = year-MM-DD / yearMMDD / year-DDD / yearDDD / year-Www-D / yearWwwD
   time     = HH:mm [fraction / ":" ss [fraction]] / HHmm [fraction / ss [fraction]]
   fraction = ("." / ",") 1*DIGIT
   ```

   This requires a complete calendar, ordinal, or week date and explicit hour and minute fields. It accepts optional seconds, arbitrarily long fractional seconds, and date-fns-supported fractional minutes, but rejects year/month-only dates, incomplete ordinal/week dates, hour-only/fractional-hour times, empty fractions, and any value whose missing date fields date-fns would default.
5. For numeric zones, require hour `00..23` and optional minute `00..59`. Reject `+24`, `+2400`, `+24:00`, the corresponding negative forms, `+99` variants, and minute overflow even though date-fns 4.4.0 fails to bound offset hours itself.
6. Reject all negative-zero unknown-offset spellings (`-00`, `-0000`, `-00:00`); accept `+00`, `+0000`, `+00:00`, and nonzero negative offsets such as `-00:01`.
7. Call `parseISO(rawDatetime)` and require `isValid(result)`. date-fns owns calendar correctness, ISO week/ordinal interpretation, hour/minute/second ranges, `24:00`, fractional conversion, and the final instant; the local completeness shape never fills or normalizes components.

The installed date-fns 4.4.0 behavior was checked through direct `pnpm exec node`. Positive tables must lock representative parser-supported forms rather than a narrower custom profile:

| Accepted form | Representative exact input |
| --- | --- |
| Extended calendar date and minute/second precision | `2026-08-23T10:15Z`, `2026-08-23T10:15:30Z` |
| Arbitrary parser-supported fraction length and decimal mark | `2026-08-23T10:15:30.123456789Z`, `2026-08-23T10:15:30,123456789Z` |
| Basic calendar/time and ASCII-space separator | `20260823T101530.123456789Z`, `20260823 101530Z`, `2026-08-23 10:15:30Z` |
| Ordinal and ISO-week dates, basic and extended | `2026-235T10:15Z`, `2026235T1015Z`, `2026-W34-7T10:15Z`, `2026W347T1015Z` |
| Complete expanded year | `+002026-08-23T10:15Z` |
| Fractional minute and end-of-day | `2026-08-23T10:15.5Z`, `2026-08-23T24:00Z` |
| Every supported numeric offset spelling | `2026-08-23T10:15+23`, `2026-08-23T10:15+2359`, `2026-08-23T10:15+23:59` |
| Known zero and small negative offsets | `2026-08-23T10:15+00`, `2026-08-23T10:15+0000`, `2026-08-23T10:15+00:00`, `2026-08-23T10:15-00:01` |

Negative tables cover every guard family and date-fns invalidity: empty/padded/control-containing input; reduced/defaulted `2026T10:15Z`, `2026-08T10:15Z`, `2026-W34T10:15Z`, and `2026W34T1015Z`; incomplete ordinal shapes such as `2026-23T10:15Z`; hour-only `2026-08-23T10Z`; fractional-hour `2026-08-23T10.5Z`; date-only and zone-less values; empty fractions; lowercase `t`/`z`; ordinary suffix junk and the date-fns malformed-zone traps `2026-08-23T10:15+03:30junkZ`, `2026-08-23T10:15Zjunk+03`, and `2026-08-23T10:15+03Z`; malformed `+3`, `+030`, `+03:`, and `+03:30:00`; `+24`, `+2400`, `+24:00`, `+99`, `+9959`, `+99:59`, `+2360`, and `+23:60`; all three negative-zero forms; impossible dates; and invalid hour/minute/second values. Preserve exact source identity and raw `sourceDatetime` without DOM reads or mutation.

### Static fixture sources

| Category | File | Direct source URL |
| --- | --- | --- |
| Commits | `tests/fixtures/github/commits.html` | `https://github.com/github/docs/commit/4f8c3170cea7f72cf41fc976f5dbf4e8a0b8567f` |
| Issues/pull requests | `tests/fixtures/github/issues-pull-requests.html` | `https://github.com/github/docs/pulls` |
| Timelines | `tests/fixtures/github/timelines.html` | `https://github.com/github/docs/issues/45593` |
| Releases/tags | `tests/fixtures/github/releases-tags.html` | `https://github.com/github/docs/releases` |
| Profiles/activity | `tests/fixtures/github/profiles-activity.html` | `https://github.com/github` |
| Search | `tests/fixtures/github/search.html` | `https://github.com/search?q=repo%3Agithub%2Fdocs+is%3Aissue+45593&type=issues` |
| Actions | `tests/fixtures/github/actions.html` | `https://github.com/github/docs/actions/runs/32653376977` |

Fetch raw pages to a task-specific temporary directory. Hand-retain one small representative fragment per category and remove scripts, serialized application state, styles, unrelated nodes, secrets, and irrelevant attributes. Do not invent or repair a custom element, `datetime`, `format`, text, or outcome. The README documents the exact URL, ISO capture date, sanitization, and observed eligible/no-op result.

`tests/fixtures/github/eligibility-matrix.html` is explicitly synthetic and independent. It contains valid examples for all three approved elements and controls for missing, empty, whitespace-only, padded, malformed, date-only, zone-less, prose-only, `local-time`, `format="datetime"`, unsupported elements, and `title`/`aria-label`/`data-*` traps. Resolver edge values remain in a readable `it.each` table.

`tests/integration/github-fixtures.test.ts` holds a small table of fixture path, representative URL, expected eligible sources/instants, and expected no-op selectors. It asserts parsed DOM and public adapter/process behavior; README prose is not a test oracle. Replaying the synthetic matrix at all seven URLs proves that a negative saved source does not become a production route restriction.

### Build prerequisite and scope

The prohibited call sites are `scripts/build.mjs:9-31` and `tests/build/chrome-artifact.test.ts:18-20`. Resolve exported `@rspack/cli/package.json`, validate its `bin.rspack` (`./bin/rspack.js` in 2.1.10) as an absolute contained regular JavaScript file, and spawn it with `process.execPath`. Change the artifact test to `execFileAsync("pnpm", ["dev", "chrome"], { cwd: process.cwd() })` and keep only observable artifact assertions.

All commands use direct pnpm in the normal environment. Add no isolated `PATH`, launcher acquisition/copy, executable provenance checks, external-utility tests, or source-text assertions. `4-AFK` owns dynamic mutation work; `5-AFK` owns full multi-browser builds; `15-AFK` owns a future synthetic adapter; `16-HITL` owns authorized live-browser validation and later manual fixture refresh.

## Entities

### Timestamp Candidate

- **Fields**: `adapterId`; exact `source`; approved `sourceKind`; raw `rawDatetime`; exact `timestampRule`
- **Relationships**: produced by `SiteAdapter.extract`, consumed by `resolveTrustedTimestamp`, rendered only after resolution
- **Validation**: approved kind, not already absolute, present non-whitespace-only `datetime`; padding preserved for resolver rejection; no generic fallback
- **States**: discovered → rejected, or discovered → extracted → resolved/rejected

### Resolved Timestamp

- **Fields**: exact `source`; preserved `sourceDatetime`; unambiguous `instant`
- **Relationships**: produced by the resolver and consumed by the existing formatter/renderer
- **Validation**: exact rule, whole raw string, padding/control/date-time-separation/terminal-zone guards, bounded known offset, and date-fns-valid ISO/calendar/instant result
- **States**: `TimestampCandidate` → no-op, or `TimestampCandidate` → formatted/rendered

### Static GitHub Fixture

- **Fields**: category, HTML file, representative URL, capture date/sanitization note, expected eligible/no-op result
- **Relationships**: source-derived examples cover current observed markup; the independent synthetic matrix covers exhaustive rules and paths
- **Validation**: tests load saved HTML offline and assert parsed-DOM/public-module behavior; negative source evidence remains negative
- **States**: ordinary static test input; no automatic lifecycle in this issue

## Contracts

No HTTP endpoint, browser message, persisted data schema, or fixture API/CLI is added, so no `contracts/` directory is needed. The one-time HTTP requests are implementation-only; runtime and automated tests remain offline.

```ts
export const EXPLICIT_ZONED_DATETIME_RULE =
  "datetime:iso8601-explicit-zone" as const;

export type TimestampSourceKind =
  | "relative-time"
  | "time-ago"
  | "time-until";

export interface TimestampCandidate {
  readonly adapterId: string;
  readonly source: Element;
  readonly sourceKind: TimestampSourceKind;
  readonly rawDatetime: string;
  readonly timestampRule: typeof EXPLICIT_ZONED_DATETIME_RULE;
}
```

`SiteAdapter`, `resolveTrustedTimestamp`, and `processDocument` keep their existing signatures and responsibilities. Static files and README are ordinary test resources, not callable contracts.

## File Structure

| File | Action | Responsibility |
| --- | --- | --- |
| `src/adapters/types.ts` | Modify | Add approved kinds and explicit source rule |
| `src/adapters/github.ts` | Modify | Discover approved kinds path-independently and preserve raw eligible `datetime` |
| `src/core/resolve-trusted-timestamp.ts` | Modify | Enforce the rule and unambiguous whole-string/zone guards, then delegate ISO/calendar/instant validity to date-fns |
| `scripts/build.mjs` | Modify | Invoke absolute project-local exported Rspack JS with `process.execPath` |
| `tests/build/chrome-artifact.test.ts` | Modify | Invoke direct pnpm and assert artifacts |
| `tests/adapters/github.test.ts` | Modify | Table-drive kinds, raw preservation, rejections, traps, and hosts |
| `tests/core/resolve-trusted-timestamp.test.ts` | Modify | Table-drive accepted instants and complete rejection behavior |
| `tests/integration/github-fixtures.test.ts` | Create | Load source fixtures/matrix offline through adapter/resolver/process behavior |
| `tests/fixtures/github/README.md` | Create | Hand-document sources, date, sanitization, and outcomes |
| `tests/fixtures/github/eligibility-matrix.html` | Create | Independent synthetic eligibility matrix |
| `tests/fixtures/github/{commits,issues-pull-requests,timelines,releases-tags,profiles-activity,search,actions}.html` | Create | Seven small source-derived positive or honest negative snippets |

`package.json`, the existing tracer fixture, `processDocument`, renderer/controller/content/runtime, registration, and browser manifest remain unchanged.

## Tasks

### [x] Prerequisite: Remove both inherited Corepack call sites before any build test

**Files:** `tests/adapters/github.test.ts`, `tests/core/resolve-trusted-timestamp.test.ts`, `scripts/build.mjs`, `tests/build/chrome-artifact.test.ts`

- [x] Add one adapter red assertion for the explicit rule and one resolver red assertion for absent/unknown rules. These tests import only adapter/registry/resolver modules.
- [x] Run `pnpm vitest run tests/adapters/github.test.ts tests/core/resolve-trusted-timestamp.test.ts`; expect product failures without loading a build file.
- [x] Update `scripts/build.mjs` to validate/execute the absolute exported Rspack JS with `process.execPath`. Update the artifact test to call direct `pnpm dev chrome`. Preserve build arguments, error/status behavior, and artifact assertions.
- [x] Only then run `pnpm vitest run tests/build/chrome-artifact.test.ts`; expect the Chrome artifact test to pass.

**Verification**: No prohibited command is reachable in the red phase, and both inherited paths are gone before the first build execution.

### [x] Task 1: Specify adapter eligibility

**Files:** `tests/adapters/github.test.ts`

- [x] Add an `it.each` table for all three kinds, exact source identity, adapter ID, explicit rule, and unmodified `datetime`, including padded nonempty input.
- [x] Add `local-time`, unknown, normalized `format="datetime"`, missing/empty/whitespace-only, and visible/title/aria/data trap cases.
- [x] Retain exact HTTP(S) `github.com` acceptance and reject Gist, subdomains, lookalikes, and non-HTTP(S).
- [x] Run `pnpm vitest run tests/adapters/github.test.ts`; expect failures for the new behavior before implementation.

**Verification**: Tests assert public discovery/extraction and DOM identity, never source text or selector spelling.

### [x] Task 2: Specify strict timestamp resolution

**Files:** `tests/core/resolve-trusted-timestamp.test.ts`

- [x] Add typed inputs with the explicit rule and runtime-shaped absent/unknown-rule inputs crossed from `unknown`.
- [x] Add the Research positive table with exact expected instants: complete extended calendar dates with minute/second precision; period/comma fractional seconds longer than three digits; complete basic calendar/time; uppercase `T` and ASCII-space separators; complete basic/extended ordinal and week dates; a complete expanded-year date; fractional minutes; `24:00`; `Z`; all three `+00` spellings; `+23`, `+2359`, `+23:59`; and `-00:01`. Assert the exact raw `sourceDatetime` and source identity as well as the normalized instant.
- [x] Add a numeric-zone boundary table accepting `±23`, `±2359`, and `±23:59`, then rejecting both signs of `24`, `2400`, `24:00`, `99`, `9959`, and `99:59`, plus minute `60`. Cover `+00`/`+0000`/`+00:00` as known zero and `-00`/`-0000`/`-00:00` as unknown negative zero.
- [x] Table-drive absent/unknown rules, empty/padded/control-containing input, prose, date-only with or without a zone, reduced calendar dates, incomplete ordinal/week dates, hour-only/fractional-hour times, empty fractions, missing date-time separation, zone-less values, lowercase `t`/`z`, malformed numeric offsets, offset seconds, impossible dates/times, ordinary text after `Z` or a numeric zone, and extra-zone traps before a valid-looking terminal suffix. Assert connected source DOM is unchanged.
- [x] Run `pnpm vitest run tests/core/resolve-trusted-timestamp.test.ts`; expect failures for rule enforcement and forms admitted by the current suffix-only check.

**Verification**: The public boundary is a compact completeness/safety guard followed by installed date-fns validity; tests prove complete basic/extended acceptance without allowing parser-defaulted instants or restoring the old precision cap.

### [x] Task 3: Add ordinary static fixtures and offline integration tests

**Files:** `tests/fixtures/github/README.md`, `tests/fixtures/github/eligibility-matrix.html`, the seven category HTML files, `tests/integration/github-fixtures.test.ts`

- [x] Fetch the seven Research URLs once to a task-specific temporary directory with unauthenticated `curl --fail-with-body --silent --show-error --location --compressed` and an HTML `Accept` header. Do not use a browser, package script, or repository path for raw pages.
- [x] Hand-sanitize one small representative fragment per category. Preserve observed source attributes/text and enclosing interaction; save an honest negative when no approved element exists. Do not invent or repair a positive case.
- [x] Hand-write README rows with exact URL, capture date, sanitization, and expected eligible/no-op outcome. State that fixtures are static/offline and future live compatibility is not promised.
- [x] Create the independent synthetic matrix described in Research.
- [x] Add the small in-test expected-case table. For each saved file, assert eligible semantic output/ownership or exact no-op DOM preservation through the adapter and `processDocument`; preserve link relationships. Do not use README or file substrings as assertions.
- [x] Replay a fresh matrix at all seven GitHub URLs and expect identical results; replay at Gist/lookalike hosts and expect unchanged DOM.
- [x] Run `pnpm vitest run tests/integration/github-fixtures.test.ts tests/integration/process-document.test.ts`; expect only not-yet-implemented adapter/resolver failures.

**Verification**: Source fixtures are readable static inputs, tests have no network dependency, and negative observations cannot become route restrictions.

### [x] Task 4: Implement adapter source rules

**Files:** `src/adapters/types.ts:1-15`, `src/adapters/github.ts:3-20`

- [x] Add the explicit rule and three approved source kinds without changing `SiteAdapter` signatures.
- [x] Discover all approved descendants irrespective of path or `datetime` presence; exclude other kinds.
- [x] Reject missing/whitespace-only `datetime` and normalized `format="datetime"`; otherwise preserve raw `datetime`, attach the rule, and use no fallback attributes/text.
- [x] Run `pnpm vitest run tests/adapters/github.test.ts`; expect all adapter cases to pass.

**Verification**: Site knowledge stays behind the adapter and production has no path list.

### [x] Task 5: Implement strict resolver rules

**Files:** `src/core/resolve-trusted-timestamp.ts:5-24`

- [x] Require the exact rule, keep `rawDatetime` unchanged, and reject empty input, unequal `trim()`, and C0/C1 controls.
- [x] Extract only terminal uppercase `Z`, `±HH`, `±HHMM`, or `±HH:MM`; require uppercase `T` or ASCII space before the terminal zone, and reject another `Z`, `+`, or `-` zone introducer in that time portion.
- [x] Enforce only the compact Research completeness shape: complete calendar/ordinal/week date, explicit hour and minute fields, optional fractional minute or seconds, and optional arbitrarily long fractional seconds. Do not check calendar or time-field ranges locally and never supply a missing component.
- [x] For numeric zones, bound hours to `00..23` and minutes to `00..59`; reject `-00`, `-0000`, and `-00:00` while accepting positive zero and nonzero negative offsets.
- [x] Pass the exact raw string to `parseISO`, require `isValid`, and retain exact `{ source, sourceDatetime, instant }` with no DOM mutation or normalization of `sourceDatetime`.
- [x] Run `pnpm vitest run tests/core/resolve-trusted-timestamp.test.ts tests/adapters/github.test.ts`; expect all accepted/rejected cases to pass.

**Verification**: Only adapter-declared, whole-string, complete, explicitly known-zoned date-fns-valid instants reach rendering; local logic checks completeness but date-fns owns validity and interpretation.

### [x] Task 6: Run offline and predecessor regressions

- [x] Run `pnpm vitest run tests/integration/github-fixtures.test.ts tests/integration/process-document.test.ts`; expect all source-derived/matrix/tracer cases to pass.
- [x] Run `pnpm vitest run tests/core/render-exact-time.test.ts tests/core/document-transformation-controller.test.ts tests/integration/document-ownership.test.ts tests/content/runtime.test.ts tests/content/main.test.ts tests/runtime/messages.test.ts tests/runtime/register-github.test.ts`; expect ownership, restoration, lifecycle, and registration behavior unchanged.
- [x] Run `pnpm typecheck`; expect every `TimestampCandidate` construction to declare the exact rule.

**Verification**: Eligibility changes only which trusted timestamps enter the validated reversible pipeline.

### [x] Task 7: Run the complete direct-pnpm gate

- [x] Run, in order, `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm lint`, and `pnpm dev chrome`, stopping on failure.
- [x] Confirm `dist/chrome-dev/manifest.json`, `background.js`, and `content.js` preserve the predecessor artifact behavior.
- [x] Review the saved snippets and README against the temporary HTTP responses. Do not perform browser smoke; `16-HITL` owns it.

**Verification**: Direct-pnpm quality, offline behavior, and artifacts pass without environment isolation, provenance tests, browser automation, or networked test helpers.

## Acceptance Coverage

| Criterion | Evidence |
| --- | --- |
| Approved kinds with complete, explicitly zoned, date-fns-supported ISO 8601 instants resolve | Tasks 1-6: three-kind adapter table, explicit rule, complete basic/extended resolver table, numeric-zone boundaries, matrix, semantic outputs |
| Missing/malformed/zone-less/ambiguous/prose input is a no-op | Tasks 1-6: structural/rejection tables, raw padded pipeline, static negatives, unchanged DOM |
| `local-time` and `format="datetime"` are rejected | Tasks 1, 3, 4, and 6: adapter/matrix rejection and unchanged DOM |
| Seven categories use path-independent rules | Task 3 loads seven static files and replays one matrix at every URL; Task 4 has no route branch |
| `title`/`aria-label`/`data-*` are not timestamps | Tasks 1, 3, 4, and 6: trap cases produce no extraction, output, ownership, or mutation |
| Build prerequisite | The prerequisite removes both inherited call sites before the first build test; Task 7 uses direct pnpm and artifact assertions |

## Static Review Attempt 1 Finding Disposition

- **Finding**: the custom extended-only, one-to-three-digit-fraction grammar rejected valid explicitly zoned ISO 8601 inputs required by AC1.
- **Resolution**: Research / Adapter and resolver rules removes the old extended-only, three-digit-fraction cap. Its compact completeness shape accepts complete calendar/ordinal/week dates, complete basic/extended times, and arbitrarily long fractional seconds while preventing date-fns from filling omitted fields. Task 2 positively locks those complete forms and negatively locks reduced/defaulted and unsafe parser cases. Task 5 uses the shape only for presence/completeness and delegates calendar, range, week/ordinal, fractional, and instant validity to `parseISO` plus `isValid`. The issue and three affected PRD statements now name the exact `complete, explicitly zoned, date-fns-supported ISO 8601 instant` contract.
- **Fixture scope**: unchanged. The revision adds no updater, generator, package script, fixture state machine, or other tooling.

## Pre-review Ambiguity Correction

- date-fns-supported reduced forms such as `2026T10:15Z`, `2026-08T10:15Z`, incomplete ordinal/week dates, and hour-only times are explicitly rejected because omitted components or absent minute fields do not identify a complete instant under the product contract.
- Complete basic/extended calendar, ordinal, and week dates remain accepted with minute-or-better times, optional seconds, and unbounded nonempty fractional seconds.
- The completeness guard never validates or reconstructs a calendar/time value; it only proves that all instant-defining components are present before date-fns validation.

## Self-Review

- All five issue criteria map to public/DOM tests before adapter/resolver implementation.
- Raw `datetime` is trimmed only for emptiness; padded nonempty input is preserved and rejected by the resolver.
- The only local ISO shape is the compact completeness guard; it prevents inferred components without restoring the old extended-only or fractional precision restriction. date-fns 4.4.0 remains the calendar/range/week/ordinal/fraction/instant authority.
- Uppercase `Z`, `±HH`, `±HHMM`, and `±HH:MM` are the exact supported terminal zone spellings; offset bounds and all negative-zero spellings are concrete and table-driven.
- Positive tests include long fractional seconds plus complete parser-supported basic, extended, ordinal, week, expanded-year, fractional-minute, space-separated, and `24:00` forms. Reduced calendar/ordinal/week forms, hour-only/fractional-hour times, and other parser-default cases are negative tests.
- Visible/title/aria/data prose, already-absolute elements, unsupported kinds, and unsafe syntax have observable no-op evidence.
- Seven source-derived files are small, static, hand-documented, and honest about negative results; the synthetic matrix independently proves rules on every path.
- No automatic fixture updater, related package script, or tool test is planned.
- `TimestampCandidate` remains only as the existing product domain object.
- Both inherited Corepack call sites are removed before build tests. No planned command invokes Corepack, isolates `PATH`, validates tool provenance, or tests source text.
- Dynamic mutation, multi-browser targets, future adapters, and live browser validation stay in their owning issues.
- No placeholder or deferred in-scope decision remains.
