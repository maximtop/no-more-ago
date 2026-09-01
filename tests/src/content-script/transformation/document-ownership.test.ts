/**
 * @file Verifies document ownership isolation across complete processing flows.
 */

import { describe, expect, it, vi } from "vitest";

import { processDocument } from "../../../../src/content-script/transformation/process-document";
import { restoreExactTimes } from "../../../../src/content-script/transformation/render-exact-time";

describe("document ownership integration", () => {
    it("preserves link interaction and exposes one visible semantic date", () => {
        document.body.innerHTML = '<a id="link" href="/activity">'
            + '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>'
            + "</a>";
        const link = document.getElementById("link");
        const source = link?.querySelector("relative-time");
        if (!link || !source) {
            throw new Error("Expected link source");
        }
        let clicks = 0;
        let keys = 0;
        link.addEventListener("click", () => {
            clicks += 1;
        });
        link.addEventListener("keydown", (event) => {
            if (event.key === "Enter") {
                keys += 1;
            }
        });

        const outputs = processDocument({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        expect(outputs).toHaveLength(1);
        expect(source.isConnected).toBe(true);
        expect(outputs[0]?.parentElement).toBe(link);
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(link.querySelectorAll("time:not([hidden])")).toHaveLength(1);
        link.dispatchEvent(new MouseEvent("click", { bubbles: true }));
        link.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }));
        expect(clicks).toBe(1);
        expect(keys).toBe(1);

        restoreExactTimes(document);
        expect(source.isConnected).toBe(true);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(link.querySelector("time")).toBeNull();
    });

    it("does not mutate an open shadow root or inject page controls", () => {
        document.body.innerHTML = '<relative-time id="source" '
            + 'datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time>'
            + '<span id="foreign">nearby</span>';
        const source = document.getElementById("source");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const shadow = source.attachShadow({ mode: "open" });
        const shadowChild = document.createElement("span");
        shadowChild.textContent = "shadow content";
        shadow.append(shadowChild);
        const foreignSnapshot = foreign.outerHTML;

        processDocument({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        expect(source.shadowRoot?.firstChild).toBe(shadowChild);
        expect(source.shadowRoot?.innerHTML).toBe("<span>shadow content</span>");
        expect(foreign.outerHTML).toBe(foreignSnapshot);
        expect(
            document.querySelectorAll(
                "button, input, a, [role=button], [role=toolbar], [role=dialog], [role=alert]",
            ),
        ).toHaveLength(0);

        restoreExactTimes(document);
        expect(source.shadowRoot?.firstChild).toBe(shadowChild);
        expect(source.shadowRoot?.innerHTML).toBe("<span>shadow content</span>");
        expect(foreign.outerHTML).toBe(foreignSnapshot);
    });

    it("keeps ownership and nearby content unchanged with safe diagnostics", () => {
        document.body.innerHTML = '<a id="link" href="/private">'
            + '<relative-time datetime="2026-08-23T10:15:00Z">'
            + "2 hours ago</relative-time></a>"
            + '<span id="foreign">private nearby text</span>';
        const link = document.getElementById("link");
        const source = link?.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!link || !source || !foreign) {
            throw new Error("Expected document sources");
        }
        const diagnostics = vi.fn();
        const foreignBefore = foreign.outerHTML;

        const outputs = processDocument({
            url: new URL("https://github.com/example/repository?token=secret#private"),
            root: document,
            locales: ["en-US"],
            diagnosticSink: diagnostics,
        });

        expect(outputs).toHaveLength(1);
        expect(link.querySelectorAll("time:not([hidden])")).toHaveLength(1);
        expect(source.textContent).toBe("2 hours ago");
        expect(foreign.outerHTML).toBe(foreignBefore);
        expect(diagnostics).toHaveBeenCalled();
        const payload = JSON.stringify(diagnostics.mock.calls);
        expect(payload).not.toContain("2 hours ago");
        expect(payload).not.toContain("private nearby text");
        expect(payload).not.toContain("2026-08-23");
        expect(payload).not.toContain("token=secret");
        expect(
            document.querySelectorAll(
                "button, input, [role=button], [role=toolbar], [role=dialog], [role=alert]",
            ),
        ).toHaveLength(0);

        restoreExactTimes(document);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(link.querySelector("time")).toBeNull();
        expect(foreign.outerHTML).toBe(foreignBefore);
    });
});
