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
import { AdapterRegistry } from "../../../../src/content-script/adapters/registry";
import { genericTimeRule } from "../../../../src/content-script/adapters/generic-time";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
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

        const numericFailure = runTelegram("123456789", "numeric failure");
        expect(numericFailure).toHaveBeenCalledWith({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            count: 1,
            sourceTimestamp: "123456789",
        });

        const proseFailure = runTelegram("not-a-timestamp", "prose failure");
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
            .toBe("2026-05-14 16:08");
        expect(success.mock.calls.every(([value]) =>
            !("sourceTimestamp" in (value as Record<string, unknown>))
        )).toBe(true);
        expect(JSON.stringify(success.mock.calls)).not.toContain("1778774880");
        restoreTimestampPresentations(document);
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
      <relative-time id="first" datetime="2026-08-23T10:15:00Z">first</relative-time>
      <relative-time id="second" datetime="2026-08-23T11:15:00Z">second</relative-time>`;
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
      <relative-time id="first" datetime="2026-08-23T10:15:00Z">first</relative-time>
      <relative-time id="second" datetime="2026-08-23T11:15:00Z">second</relative-time>`;
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

        expect(first.textContent).toBe("first");
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
        ["hidden", '<time datetime="2026-08-23T10:15Z" hidden>hidden</time>'],
        ["aria", '<time datetime="2026-08-23T10:15Z" aria-hidden="true">aria</time>'],
        ["inert", '<time datetime="2026-08-23T10:15Z" inert>inert</time>'],
        ["style", '<time datetime="2026-08-23T10:15Z" style="display: none">style</time>'],
    ])("does not create output for a generic %s source", (_name, markup) => {
        document.body.innerHTML = markup;
        expect(processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        })).toEqual([]);
        expect(document.querySelector("time")?.textContent).toBe(_name);
    });

    it("prefers a resolved specialized candidate but falls back when it fails", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">time</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected overlap source");
        }
        let specializedValid = true;
        const specialized: TimestampSourceRule = {
            id: "specialized",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("time"),
            discover: (root) => [...root.querySelectorAll("time")],
            extract: (element) => ({
                ruleId: "specialized",
                source: element,
                sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                presentation: ADJACENT_TIME_PRESENTATION,
                rawDatetime: specializedValid ? "2026-08-24T10:15Z" : "invalid",
                validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
            }),
        };
        const registry = new AdapterRegistry([specialized], genericTimeRule);
        const first = processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry,
        });
        expect(first).toHaveLength(1);
        expect(first[0]?.dateTime).toBe("2026-08-24T10:15Z");
        restoreExactTimes(document);
        specializedValid = false;
        const fallback = processDocument({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry,
        });
        expect(fallback).toHaveLength(1);
        expect(fallback[0]?.dateTime).toBe("2026-08-23T10:15Z");
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
});
