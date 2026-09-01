/**
 * @file Exercises complete document processing against GitHub fixtures.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import {
    processDocument,
    reconcileDocumentRegion,
} from "../../../../src/content-script/transformation/process-document";
import {
    OWNED_SOURCE_ATTRIBUTE,
    restoreExactTimes,
} from "../../../../src/content-script/transformation/render-exact-time";
import {
    restoreTimestampPresentations,
} from "../../../../src/content-script/transformation/render-timestamp-presentation";
import {
    AdapterRegistry,
    defaultRegistry,
} from "../../../../src/content-script/adapters/registry";
import { genericTimeRule } from "../../../../src/content-script/adapters/generic-time";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "../../../../src/content-script/adapters/types";
import type { DisplaySettings } from "../../../../src/shared/settings/snapshot";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../../../src/shared/diagnostics/contracts";
import type { DiagnosticEventInput } from "../../../../src/shared/diagnostics/events";

describe("processDocument", () => {
    let fixture = "";

    beforeAll(async () => {
        fixture = await readFile(
            "tests/src/content-script/fixtures/github/one-relative-time.html",
            "utf8",
        );
    });

    beforeEach(() => {
        document.body.innerHTML = fixture;
    });

    it("keeps the production registry in explicit audit order", () => {
        expect(defaultRegistry.all().map(({ id }) => id)).toEqual([
            "facebook",
            "github",
            "hacker-news",
            "instagram",
            "linkedin",
            "stack-exchange",
            "tiktok-profile",
            "tiktok-legacy-direct",
            "tiktok-direct-feed",
            "telegram-web-k",
            "youtube-player-response",
            "youtube",
            "generic-time",
        ]);
    });

    it("keeps accepted and rejected visible labels out of diagnostics", () => {
        document.body.innerHTML = `
            <time id="unknown" datetime="2026-08-23T10:15:00Z">2 hrs</time>
            <time id="polish" lang="pl"
                datetime="2026-08-22T10:15:00Z">2 godz. temu</time>
        `;
        const diagnosticSink = vi.fn();

        const outputs = processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            diagnosticSink,
        });

        expect(outputs).toHaveLength(1);
        expect(document.getElementById("unknown")
            ?.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(document.getElementById("polish")?.nextElementSibling).toBe(outputs[0]);
        const diagnostics = JSON.stringify(diagnosticSink.mock.calls);
        expect(diagnostics).not.toContain("2 hrs");
        expect(diagnostics).not.toContain("2 godz. temu");
    });

    it("requires relative presentation before resolving a trusted candidate", () => {
        document.body.innerHTML =
            '<time datetime="2026-08-23T10:15:00Z">Aug 23, 2026</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected source");
        }
        const rule: TimestampSourceRule = {
            id: "eligibility-gate-test",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            extract: () => ({
                ruleId: "eligibility-gate-test",
                source,
                sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                rawDatetime: "2026-08-23T10:15:00Z",
                presentation: ADJACENT_TIME_PRESENTATION,
                validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
                visibilityPolicy:
                    TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
            }),
            isRelativePresentation: () => false,
        };
        const diagnosticSink = vi.fn();

        expect(processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([], rule),
            diagnosticSink,
        })).toEqual([]);
        expect(source.textContent).toBe("Aug 23, 2026");
        expect(diagnosticSink).toHaveBeenCalledWith({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.CANDIDATE_SKIPPED,
            count: 1,
        });
        expect(JSON.stringify(diagnosticSink.mock.calls))
            .not.toContain("Aug 23, 2026");
    });

    it("formats a derived LinkedIn instant through the public document boundary", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-08-30T00:00:00.000Z"));
        try {
            document.body.innerHTML = `
                <article>
                    <p componentkey="timestamp"><span>1w • Edited</span></p>
                    <a href="/feed/update/urn:li:activity:7147784590025818113/">
                        Post
                    </a>
                </article>
            `;

            const outputs = processDocument({
                url: new URL("https://www.linkedin.com/feed/"),
                root: document,
                locales: ["en-GB"],
                display: {
                    formatMode: "custom",
                    pattern: "yyyy-MM-dd HH:mm:ss.SSS",
                    timeZone: { mode: "utc" },
                },
            });

            expect(outputs).toEqual([]);
            expect(document.querySelector("p > span")?.textContent)
                .toBe("2024-01-02 03:04:05.678 • Edited");
        } finally {
            vi.useRealTimers();
        }
    });

    it("captures one current-time snapshot for a complete candidate batch", () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="timestamp-a"><span>1w</span></p>
                <div data-urn="urn:li:activity:7147784590025818113"></div>
            </article>
            <article>
                <p componentkey="timestamp-b"><span>2w</span></p>
                <div data-urn="urn:li:share:7170283349280292867"></div>
            </article>
        `;
        const now = vi.spyOn(Date, "now").mockReturnValue(
            Date.parse("2026-08-30T00:00:00.000Z"),
        );
        try {
            processDocument({
                url: new URL("https://www.linkedin.com/feed/"),
                root: document,
                locales: ["en-GB"],
            });

            expect(now).toHaveBeenCalledTimes(1);
        } finally {
            now.mockRestore();
        }
    });

    it("keeps generic time datetime available on LinkedIn", () => {
        document.body.innerHTML = `
            <time datetime="2026-08-23T10:15:00Z">1 week ago</time>
        `;

        const outputs = processDocument({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
        });

        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.dateTime).toBe("2026-08-23T10:15:00Z");
    });

    it("emits only bounded content-free diagnostics for LinkedIn", () => {
        document.body.innerHTML = `
            <article>
                <p componentkey="timestamp"><span>1w •</span></p>
                <div data-urn="urn:li:activity:17074629064821571590"></div>
            </article>
        `;
        const events: DiagnosticEventInput[] = [];

        processDocument({
            url: new URL("https://www.linkedin.com/feed/"),
            root: document,
            locales: ["en-GB"],
            diagnosticSink: (event) => events.push(event),
        });

        const serialized = JSON.stringify(events);
        expect(serialized).not.toContain("1w");
        expect(serialized).not.toContain("17074629064821571590");
        expect(events.length).toBeGreaterThan(0);
    });

    it("processes one trusted GitHub relative timestamp end to end", () => {
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
        });
        const expectedText = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeStyle: "short",
        }).format(new Date("2026-08-23T10:15:00Z"));

        expect(outputs).toHaveLength(1);
        expect(document.querySelectorAll('time[datetime="2026-08-23T10:15:00Z"]')).toHaveLength(1);
        expect(outputs[0]?.textContent).toBe(expectedText);
        expect(document.querySelector("relative-time")).not.toBeNull();
        expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(true);
        expect(
            document.querySelector("relative-time")?.getAttribute(OWNED_SOURCE_ATTRIBUTE),
        ).toMatch(/^visible:/);
    });

    it("renders a valid custom display through the public document boundary", () => {
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
        });

        expect(outputs).toHaveLength(1);
        expect(outputs[0]?.textContent).toBe("2026-08-23 10:15");
        expect(document.querySelector("relative-time")?.textContent).toBe("2 hours ago");
        expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(true);
    });

    it("keeps an initially visible source unchanged when custom formatting fails", () => {
        const hostileDisplay = {
            formatMode: "custom",
            pattern: "yyyy ff",
            timeZone: { mode: "system" },
        } as DisplaySettings;

        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
            display: hostileDisplay,
        });

        const source = document.querySelector("relative-time");
        expect(outputs).toEqual([]);
        expect(source?.textContent).toBe("2 hours ago");
        expect(source?.hasAttribute("hidden")).toBe(false);
        expect(source?.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(source?.nextElementSibling).toBeNull();
    });

    it("excludes a renderer safe no-op from returned outputs", () => {
        document.body.innerHTML = '<relative-time data-no-more-ago-source="visible:foreign" '
            + 'datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
        });
        expect(outputs).toEqual([]);
        expect(document.querySelector("relative-time")?.textContent).toBe("2 hours ago");
    });

    it("leaves identical markup unchanged on a non-GitHub hostname", () => {
        const originalMarkup = document.body.innerHTML;
        const outputs = processDocument({
            url: new URL("https://example.com/"),
            root: document,
            locales: ["en-GB"],
        });

        expect(outputs).toEqual([]);
        expect(document.body.innerHTML).toBe(originalMarkup);
        expect(document.querySelector("relative-time")?.textContent).toBe("2 hours ago");
    });

    it("emits only bounded adapter and timing diagnostics from the existing candidate pass", () => {
        const diagnosticSink = vi.fn();
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc?token=secret#private"),
            root: document,
            locales: ["en-GB"],
            diagnosticSink,
        });

        expect(outputs).toHaveLength(1);
        expect(diagnosticSink).toHaveBeenCalledWith({
            category: "adapter",
            reason: "adapter-matched",
            count: 1,
        });
        const timing = diagnosticSink.mock.calls
            .map(([value]) => value as { category?: string; count?: number; durationMs?: number })
            .find((event) => event.category === "timing");
        expect(timing).toMatchObject({ category: "timing", count: 1 });
        expect(typeof timing?.durationMs).toBe("number");
        const payload = JSON.stringify(diagnosticSink.mock.calls);
        expect(payload).not.toContain("2026-08-23");
        expect(payload).not.toContain("2 hours ago");
        expect(payload).not.toContain("token=secret");
        expect(payload).not.toContain("private");
    });

    it("reports unsupported adapters and invalid timestamps using finite safe reasons", () => {
        const unsupported = vi.fn();
        expect(
            processDocument({
                url: new URL("file:///unsupported.example/private"),
                root: document,
                locales: ["en-GB"],
                diagnosticSink: unsupported,
            }),
        ).toEqual([]);
        expect(unsupported).toHaveBeenCalledOnce();
        expect(unsupported).toHaveBeenCalledWith({
            category: "skip",
            reason: "adapter-missing",
            count: 1,
        });

        document.querySelector("relative-time")?.setAttribute("datetime", "not a real timestamp");
        const invalid = vi.fn();
        expect(
            processDocument({
                url: new URL("https://github.com/maximtop/no-more-ago"),
                root: document,
                locales: ["en-GB"],
                diagnosticSink: invalid,
            }),
        ).toEqual([]);
        expect(invalid).toHaveBeenCalledWith({
            category: "skip",
            reason: "invalid-timestamp",
            count: 1,
        });
        expect(JSON.stringify(invalid.mock.calls)).not.toContain("not a real timestamp");
    });

    it("emits bounded raw evidence only for failed Telegram timestamp resolution", () => {
        const runTelegram = (rawDatetime: string, label: string) => {
            document.body.innerHTML = `<div class="bubble" data-timestamp="${rawDatetime}">`
                + `<span class="time-inner"><span id="telegram-diagnostic-clock" `
                + `class="i18n">${label}</span></span></div>`;
            const diagnosticSink = vi.fn();
            processDocument({
                url: new URL("https://web.telegram.org/k/?private=query#fragment"),
                root: document,
                locales: ["en-US"],
                display: {
                    formatMode: "custom",
                    pattern: "yyyy-MM-dd HH:mm",
                    timeZone: { mode: "utc" },
                },
                diagnosticSink,
            });
            return diagnosticSink;
        };

        const numericFailure = runTelegram("123456789", "2 hours ago");
        expect(numericFailure).toHaveBeenCalledWith({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            count: 1,
            sourceTimestamp: "123456789",
        });

        const proseFailure = runTelegram("not-a-timestamp", "2 hours ago");
        const proseSkip = proseFailure.mock.calls
            .map(([value]) => value as Record<string, unknown>)
            .find((event) => event.reason === DIAGNOSTIC_REASON.INVALID_TIMESTAMP);
        expect(proseSkip).toEqual({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            count: 1,
        });

        const success = runTelegram("1778774880", "16:08");
        expect(document.getElementById("telegram-diagnostic-clock")?.textContent)
            .toBe("16:08");
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(success.mock.calls.every(([value]) =>
            !("sourceTimestamp" in (value as Record<string, unknown>))
        )).toBe(true);
        expect(JSON.stringify(success.mock.calls)).not.toContain("1778774880");
        restoreTimestampPresentations(document);
    });

    it("omits rejected numeric values from generic source diagnostics", () => {
        document.body.innerHTML = '<time datetime="123456789">2 hours ago</time>';
        const diagnosticSink = vi.fn();

        processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            diagnosticSink,
        });

        expect(diagnosticSink).toHaveBeenCalledWith({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            count: 1,
        });
        expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain("123456789");
        expect(JSON.stringify(diagnosticSink.mock.calls)).not.toContain("2 hours ago");
    });

    it("reconciles one owned source in a bounded region and restores invalid values", () => {
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const initial = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
        });
        const output = initial[0];
        if (!output) {
            throw new Error("Expected output");
        }
        const sink = {
            beforeOwnedOutputRemoval: vi.fn(),
            beforeOwnedSourceHiddenChange: vi.fn(),
        };

        source.setAttribute("datetime", "2026-08-24T10:15:00Z");
        expect(
            reconcileDocumentRegion({
                url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
                root: source,
                locales: ["en-GB"],
                ownedDomMutations: sink,
            }),
        ).toEqual([output]);
        expect(output.dateTime).toBe("2026-08-24T10:15:00Z");

        source.removeAttribute("datetime");
        expect(
            reconcileDocumentRegion({
                url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
                root: source,
                locales: ["en-GB"],
                ownedDomMutations: sink,
            }),
        ).toEqual([]);
        expect(sink.beforeOwnedOutputRemoval).toHaveBeenCalledWith(output);
        expect(output.isConnected).toBe(false);
        expect(source.hasAttribute("hidden")).toBe(false);
    });

    it.each([
        [
            "missing datetime",
            (source: Element) => {
                source.removeAttribute("datetime");
            },
        ],
        [
            "zone-less datetime",
            (source: Element) => {
                source.setAttribute("datetime", "2026-08-24T10:15:00");
            },
        ],
    ])("restores an invalid owned source without a mutation sink (%s)", (_label, invalidate) => {
        document.body.innerHTML = `
      <relative-time id="first" datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>
      <relative-time id="second" datetime="2026-08-23T11:15:00Z">3 hours ago</relative-time>`;
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!first || !second) {
            throw new Error("Expected sources");
        }
        processDocument({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-GB"],
        });
        const firstOutput = first.nextElementSibling;
        const secondOutput = second.nextElementSibling;
        if (
            !(firstOutput instanceof HTMLTimeElement) ||
            !(secondOutput instanceof HTMLTimeElement)
        ) {
            throw new Error("Expected owned outputs");
        }

        invalidate(first);
        expect(
            reconcileDocumentRegion({
                url: new URL("https://github.com/example/repo"),
                root: first,
                locales: ["en-GB"],
            }),
        ).toEqual([]);

        expect(first.hasAttribute("hidden")).toBe(false);
        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(second.hasAttribute("hidden")).toBe(true);
        expect(second.nextElementSibling).toBe(secondOutput);
        expect(secondOutput.isConnected).toBe(true);
    });

    it("restores an owned source after formatting fails without touching others", () => {
        document.body.innerHTML = `
      <relative-time id="first" datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>
      <relative-time id="second" datetime="2026-08-23T11:15:00Z">3 hours ago</relative-time>`;
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!first || !second) {
            throw new Error("Expected sources");
        }

        processDocument({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-GB"],
            display: { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } },
        });
        const firstOutput = first.nextElementSibling;
        const secondOutput = second.nextElementSibling;
        if (
            !(firstOutput instanceof HTMLTimeElement) ||
            !(secondOutput instanceof HTMLTimeElement)
        ) {
            throw new Error("Expected owned outputs");
        }
        const secondText = secondOutput.textContent;

        const hostileDisplay = {
            formatMode: "custom",
            pattern: "yyyy ff",
            timeZone: { mode: "system" },
        } as DisplaySettings;
        expect(
            reconcileDocumentRegion({
                url: new URL("https://github.com/example/repo"),
                root: first,
                locales: ["en-GB"],
                display: hostileDisplay,
            }),
        ).toEqual([]);

        expect(first.textContent).toBe("2 hours ago");
        expect(first.hasAttribute("hidden")).toBe(false);
        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(second.hasAttribute("hidden")).toBe(true);
        expect(second.nextElementSibling).toBe(secondOutput);
        expect(secondOutput.isConnected).toBe(true);
        expect(secondOutput.textContent).toBe(secondText);
    });

    it("processes standard time markup without changing page attributes", () => {
        document.body.innerHTML = '<a href="/post"><time datetime="2026-08-23T10:15Z" '
            + 'aria-label="2 hours ago">2 hours ago</time></a>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected generic source");
        }
        const outputs = processDocument({
            url: new URL("https://x.example/post"),
            root: document,
            locales: ["en-US"],
        });
        expect(outputs).toHaveLength(1);
        expect(source.textContent).toBe("2 hours ago");
        expect(source.getAttribute("aria-label")).toBe("2 hours ago");
        expect(source.nextElementSibling).toBe(outputs[0]);
        expect(source.parentElement?.tagName).toBe("A");
        restoreExactTimes(document);
    });

    it.each([
        ["hidden", '<time datetime="2026-08-23T10:15Z" hidden>2 hours ago</time>'],
        ["aria", '<time datetime="2026-08-23T10:15Z" aria-hidden="true">2 hours ago</time>'],
        ["inert", '<time datetime="2026-08-23T10:15Z" inert>2 hours ago</time>'],
        [
            "style",
            '<time datetime="2026-08-23T10:15Z" style="display: none">2 hours ago</time>',
        ],
    ])("does not create output for a generic %s source", (_name, markup) => {
        document.body.innerHTML = markup;
        expect(processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        })).toEqual([]);
        expect(document.querySelector("time")?.textContent).toBe("2 hours ago");
    });

    it("does not extract a lower source after a higher source resolves", () => {
        document.body.innerHTML =
            '<time datetime="2026-08-23T10:15Z">2 hours ago</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected overlap source");
        }
        const url = new URL("https://example.test/");
        let higherRaw = "2026-08-24T10:15Z";
        const higherExtract = vi.fn((element: Element) => ({
            ruleId: "higher",
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime: higherRaw,
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy:
                TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        }));
        const lowerExtract = vi.fn((element: Element) => ({
            ruleId: "lower",
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime: "2026-08-23T10:15Z",
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy:
                TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        }));
        const higher: TimestampSourceRule = {
            id: "higher",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: higherExtract,
        };
        const lower: TimestampSourceRule = {
            id: "lower",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: lowerExtract,
        };
        const registry = new AdapterRegistry([higher], lower);

        expect(processDocument({ url, root: document, registry })[0]?.dateTime)
            .toBe("2026-08-24T10:15Z");
        expect(higherExtract).toHaveBeenCalledWith(
            source,
            expect.objectContaining({ url }),
        );
        expect(lowerExtract).not.toHaveBeenCalled();

        restoreExactTimes(document);
        higherRaw = "invalid";
        expect(processDocument({ url, root: document, registry })[0]?.dateTime)
            .toBe("2026-08-23T10:15Z");
        expect(lowerExtract).toHaveBeenCalledOnce();
        restoreExactTimes(document);
    });

    it("formats an in-place candidate without creating or hiding DOM", () => {
        document.body.innerHTML = `<span id="age" title="2026-08-28T10:09:07Z">
            <a id="link" href="item?id=1">1 hour ago</a></span>`;
        const source = document.getElementById("age");
        const link = document.getElementById("link");
        const target = link?.firstChild;
        if (!source || !link || !(target instanceof Text)) {
            throw new Error("Expected in-place source");
        }
        const rule: TimestampSourceRule = {
            id: "in-place-test",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            isRelativePresentation: () => true,
            extract: () => ({
                ruleId: "in-place-test",
                source,
                sourceKind: TIMESTAMP_SOURCE_KIND.HACKER_NEWS_AGE,
                rawDatetime: "2026-08-28T10:09:07Z",
                presentation: {
                    kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                    target,
                },
                validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
            }),
        };

        const outputs = processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy-MM-dd HH:mm",
                timeZone: { mode: "utc" },
            },
            registry: new AdapterRegistry([rule], genericTimeRule),
        });

        expect(outputs).toEqual([]);
        expect(target.data).toBe("2026-08-28 10:09");
        expect(document.getElementById("link")).toBe(link);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });

    it(
        "quarantines a blocked source without extraction or invalid diagnostics",
        () => {
            document.body.innerHTML = '<span id="source">2 hours ago</span>';
            const source = document.getElementById("source");
            if (!source) {
                throw new Error("Expected policy source");
            }
            const higherExtract = vi.fn(() => null);
            const lowerExtract = vi.fn((element: Element) => ({
                ruleId: "lower",
                source: element,
                sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                rawDatetime: "2026-08-23T10:15Z",
                presentation: ADJACENT_TIME_PRESENTATION,
                validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
            }));
            const matchingRule = (id: string, extract: TimestampSourceRule["extract"]):
            TimestampSourceRule => ({
                id,
                mutationAttributes: [],
                matches: () => true,
                matchesElement: (element) => element === source,
                discover: () => [source],
                isRelativePresentation: () => true,
                extract,
            });
            const registry = new AdapterRegistry(
                [matchingRule("higher", higherExtract)],
                matchingRule("lower", lowerExtract),
            );
            const url = new URL("https://example.test/");

            expect(processDocument({ url, root: document, registry })).toHaveLength(1);
            restoreExactTimes(document);
            higherExtract.mockClear();
            lowerExtract.mockClear();
            const diagnosticSink = vi.fn();

            expect(processDocument({
                url,
                root: document,
                registry,
                extractionPolicy: {
                    allowsRule: (ruleId) => ruleId !== "lower",
                },
                diagnosticSink,
            })).toEqual([]);

            expect(higherExtract).toHaveBeenCalledOnce();
            expect(lowerExtract).not.toHaveBeenCalled();
            expect(source.hasAttribute("hidden")).toBe(false);
            expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
            expect(diagnosticSink.mock.calls.flat()).not.toContainEqual({
                category: "skip",
                reason: "invalid-timestamp",
                count: 1,
            });
        },
    );

    it("keeps an allowed valid higher source lazy under extraction policy", () => {
        document.body.innerHTML = '<span id="source">2 hours ago</span>';
        const source = document.getElementById("source");
        if (!source) {
            throw new Error("Expected policy source");
        }
        const higherExtract = vi.fn((element: Element) => ({
            ruleId: "higher",
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime: "2026-08-24T10:15Z",
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        }));
        const lowerExtract = vi.fn(() => null);
        const registry = new AdapterRegistry(
            [{
                id: "higher",
                mutationAttributes: [],
                matches: () => true,
                matchesElement: (element) => element === source,
                discover: () => [source],
                isRelativePresentation: () => true,
                extract: higherExtract,
            }],
            {
                id: "lower",
                mutationAttributes: [],
                matches: () => true,
                matchesElement: (element) => element === source,
                discover: () => [source],
                isRelativePresentation: () => true,
                extract: lowerExtract,
            },
        );
        expect(processDocument({
            url: new URL("https://example.test/"),
            root: document,
            registry,
            extractionPolicy: {
                allowsRule: () => true,
            },
        })[0]?.dateTime).toBe("2026-08-24T10:15Z");
        expect(lowerExtract).not.toHaveBeenCalled();
        restoreExactTimes(document);
    });

    it("rejects a candidate for a different discovered source", () => {
        document.body.innerHTML = '<time id="discovered">discovered</time>'
            + '<time id="foreign">foreign</time>';
        const discovered = document.getElementById("discovered");
        const foreign = document.getElementById("foreign");
        if (!discovered || !foreign) {
            throw new Error("Expected candidate identity sources");
        }
        const mismatched: TimestampSourceRule = {
            id: "mismatched",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === discovered,
            discover: () => [discovered],
            isRelativePresentation: () => true,
            extract: () => ({
                ruleId: "mismatched",
                source: foreign,
                sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                rawDatetime: "2026-08-24T10:15Z",
                presentation: ADJACENT_TIME_PRESENTATION,
                validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
                visibilityPolicy:
                    TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
            }),
        };
        const unused: TimestampSourceRule = {
            id: "unused",
            mutationAttributes: [],
            matches: () => false,
            matchesElement: () => false,
            discover: () => [],
            isRelativePresentation: () => true,
            extract: () => null,
        };

        expect(processDocument({
            url: new URL("https://example.test/"),
            root: document,
            registry: new AdapterRegistry([mismatched], unused),
        })).toEqual([]);
        expect(discovered.hasAttribute("hidden")).toBe(false);
        expect(foreign.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
    });
});
