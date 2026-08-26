/**
 * @file Exercises complete document processing against GitHub fixtures.
 */

import { readFile } from "node:fs/promises";

import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { processDocument, reconcileDocumentRegion } from "../../src/core/process-document";
import { OWNED_SOURCE_ATTRIBUTE } from "../../src/core/render-exact-time";
import type { DisplaySettings } from "../../src/settings/snapshot";

describe("processDocument", () => {
    let fixture = "";

    beforeAll(async () => {
        fixture = await readFile("tests/fixtures/github/one-relative-time.html", "utf8");
    });

    beforeEach(() => {
        document.body.innerHTML = fixture;
    });

    it("processes one trusted GitHub relative timestamp end to end", () => {
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"]
        });
        const expectedText = new Intl.DateTimeFormat(["en-GB"], {
            dateStyle: "medium",
            timeStyle: "short"
        }).format(new Date("2026-08-23T10:15:00Z"));

        expect(outputs).toHaveLength(1);
        expect(document.querySelectorAll('time[datetime="2026-08-23T10:15:00Z"]')).toHaveLength(1);
        expect(outputs[0]?.textContent).toBe(expectedText);
        expect(document.querySelector("relative-time")).not.toBeNull();
        expect(document.querySelector("relative-time")?.hasAttribute("hidden")).toBe(true);
        expect(document.querySelector("relative-time")?.getAttribute(OWNED_SOURCE_ATTRIBUTE)).toMatch(/^visible:/);
    });

    it("renders a valid custom display through the public document boundary", () => {
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
            display: { formatMode: "custom", pattern: "yyyy-MM-dd HH:mm", timeZone: { mode: "utc" } }
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
            timeZone: { mode: "system" }
        } as DisplaySettings;

        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"],
            display: hostileDisplay
        });

        const source = document.querySelector("relative-time");
        expect(outputs).toEqual([]);
        expect(source?.textContent).toBe("2 hours ago");
        expect(source?.hasAttribute("hidden")).toBe(false);
        expect(source?.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(source?.nextElementSibling).toBeNull();
    });

    it("excludes a renderer safe no-op from returned outputs", () => {
        document.body.innerHTML = '<relative-time data-no-more-ago-source="visible:foreign" datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>';
        const outputs = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"]
        });
        expect(outputs).toEqual([]);
        expect(document.querySelector("relative-time")?.textContent).toBe("2 hours ago");
    });

    it("leaves identical markup unchanged on a non-GitHub hostname", () => {
        const originalMarkup = document.body.innerHTML;
        const outputs = processDocument({
            url: new URL("https://example.com/"),
            root: document,
            locales: ["en-GB"]
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
            diagnosticSink
        });

        expect(outputs).toHaveLength(1);
        expect(diagnosticSink).toHaveBeenCalledWith({ category: "adapter", reason: "adapter-matched", count: 1 });
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
        expect(processDocument({
            url: new URL("https://unsupported.example/private"),
            root: document,
            locales: ["en-GB"],
            diagnosticSink: unsupported
        })).toEqual([]);
        expect(unsupported).toHaveBeenCalledOnce();
        expect(unsupported).toHaveBeenCalledWith({ category: "skip", reason: "adapter-missing", count: 1 });

        document.querySelector("relative-time")?.setAttribute("datetime", "not a real timestamp");
        const invalid = vi.fn();
        expect(processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago"),
            root: document,
            locales: ["en-GB"],
            diagnosticSink: invalid
        })).toEqual([]);
        expect(invalid).toHaveBeenCalledWith({ category: "skip", reason: "invalid-timestamp", count: 1 });
        expect(JSON.stringify(invalid.mock.calls)).not.toContain("not a real timestamp");
    });

    it("reconciles one owned source in a bounded region and restores invalid values", () => {
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const initial = processDocument({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: document,
            locales: ["en-GB"]
        });
        const output = initial[0];
        if (!output) {
            throw new Error("Expected output");
        }
        const sink = { beforeOwnedOutputRemoval: vi.fn() };

        source.setAttribute("datetime", "2026-08-24T10:15:00Z");
        expect(reconcileDocumentRegion({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: source,
            locales: ["en-GB"],
            ownedOutputMutations: sink
        })).toEqual([output]);
        expect(output.dateTime).toBe("2026-08-24T10:15:00Z");

        source.removeAttribute("datetime");
        expect(reconcileDocumentRegion({
            url: new URL("https://github.com/maximtop/no-more-ago/commit/abc"),
            root: source,
            locales: ["en-GB"],
            ownedOutputMutations: sink
        })).toEqual([]);
        expect(sink.beforeOwnedOutputRemoval).toHaveBeenCalledWith(output);
        expect(output.isConnected).toBe(false);
        expect(source.hasAttribute("hidden")).toBe(false);
    });

    it.each([
        ["missing datetime", (source: Element) => {
            source.removeAttribute("datetime");
        }],
        ["zone-less datetime", (source: Element) => {
            source.setAttribute("datetime", "2026-08-24T10:15:00");
        }]
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
            locales: ["en-GB"]
        });
        const firstOutput = first.nextElementSibling;
        const secondOutput = second.nextElementSibling;
        if (!(firstOutput instanceof HTMLTimeElement) || !(secondOutput instanceof HTMLTimeElement)) {
            throw new Error("Expected owned outputs");
        }

        invalidate(first);
        expect(reconcileDocumentRegion({
            url: new URL("https://github.com/example/repo"),
            root: first,
            locales: ["en-GB"]
        })).toEqual([]);

        expect(first.hasAttribute("hidden")).toBe(false);
        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(second.hasAttribute("hidden")).toBe(true);
        expect(second.nextElementSibling).toBe(secondOutput);
        expect(secondOutput.isConnected).toBe(true);
    });

    it("restores an owned source when custom formatting fails without touching unrelated ownership", () => {
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
            display: { formatMode: "custom", pattern: "yyyy-MM-dd", timeZone: { mode: "utc" } }
        });
        const firstOutput = first.nextElementSibling;
        const secondOutput = second.nextElementSibling;
        if (!(firstOutput instanceof HTMLTimeElement) || !(secondOutput instanceof HTMLTimeElement)) {
            throw new Error("Expected owned outputs");
        }
        const secondText = secondOutput.textContent;

        const hostileDisplay = {
            formatMode: "custom",
            pattern: "yyyy ff",
            timeZone: { mode: "system" }
        } as DisplaySettings;
        expect(reconcileDocumentRegion({
            url: new URL("https://github.com/example/repo"),
            root: first,
            locales: ["en-GB"],
            display: hostileDisplay
        })).toEqual([]);

        expect(first.textContent).toBe("first");
        expect(first.hasAttribute("hidden")).toBe(false);
        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(second.hasAttribute("hidden")).toBe(true);
        expect(second.nextElementSibling).toBe(secondOutput);
        expect(secondOutput.isConnected).toBe(true);
        expect(secondOutput.textContent).toBe(secondText);
    });
});
