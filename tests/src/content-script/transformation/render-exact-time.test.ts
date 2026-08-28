/**
 * @file Exercises reversible ownership and rendering of exact timestamp elements.
 */

import { describe, expect, it, vi } from "vitest";

import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
    renderExactTime,
    getOwnedSourceForOutput,
    restoreExactTime,
    restoreExactTimes,
} from "../../../../src/content-script/transformation/render-exact-time";

const DATETIME = "2026-08-23T10:15:00+03:00";

/**
 * Creates a relative-time source element with optional preexisting visibility state.
 *
 * @param hidden - Whether the page source starts hidden.
 * @returns - Connected relative-time source element.
 */
function createSource(hidden = false): Element {
    document.body.innerHTML = `<div id="host"><relative-time${hidden ? " hidden" : ""}>`
        + "2 hours ago</relative-time></div>";
    const source = document.querySelector("relative-time");
    if (!source) {
        throw new Error("Expected source");
    }
    return source;
}

describe("renderExactTime", () => {
    it("keeps the source intact and creates one owned semantic sibling", () => {
        const source = createSource();
        const firstOutput = renderExactTime(source, DATETIME, "23 Aug 2026, 10:15");

        expect(firstOutput).not.toBeNull();
        if (!firstOutput) {
            throw new Error("Expected output");
        }
        expect(firstOutput.localName).toBe("time");
        expect(firstOutput.dateTime).toBe(DATETIME);
        expect(firstOutput.textContent).toBe("23 Aug 2026, 10:15");
        expect(source.isConnected).toBe(true);
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(source.nextElementSibling).toBe(firstOutput);
        const sourceMarker = source.getAttribute(OWNED_SOURCE_ATTRIBUTE);
        const outputMarker = firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE);
        expect(sourceMarker).toMatch(/^visible:.+/);
        expect(outputMarker).toBe(sourceMarker?.slice("visible:".length));

        const secondOutput = renderExactTime(source, DATETIME, "updated");
        expect(secondOutput).toBe(firstOutput);
        expect(secondOutput?.textContent).toBe("updated");
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(1);
    });

    it.each([false, true])(
        "repairs the same output after detachment (source hidden=%s)",
        (initiallyHidden) => {
            const source = createSource(initiallyHidden);
            const firstOutput = renderExactTime(source, DATETIME, "first");
            if (!firstOutput) {
                throw new Error("Expected output");
            }
            const token = firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE);
            firstOutput.remove();

            const repaired = renderExactTime(source, "2026-08-24T11:15:00+03:00", "repaired");
            expect(repaired).toBe(firstOutput);
            expect(source.nextElementSibling).toBe(firstOutput);
            expect(firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(token);
            expect(firstOutput.dateTime).toBe("2026-08-24T11:15:00+03:00");
            expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(1);

            const foreign = document.createElement("aside");
            document.body.append(foreign);
            foreign.append(firstOutput);
            restoreExactTimes(document);
            expect(source.isConnected).toBe(true);
            expect(source.hasAttribute("hidden")).toBe(initiallyHidden);
            expect(firstOutput.isConnected).toBe(false);
            expect(firstOutput.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(false);
            expect(source.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
            expect(
                document.querySelectorAll(
                    `[${OWNED_OUTPUT_ATTRIBUTE}], [${OWNED_SOURCE_ATTRIBUTE}]`,
                ),
            ).toHaveLength(0);
        },
    );

    it.each([false, true])(
        "repairs the same output after reparenting (source hidden=%s)",
        (initiallyHidden) => {
            const source = createSource(initiallyHidden);
            const firstOutput = renderExactTime(source, DATETIME, "first");
            if (!firstOutput) {
                throw new Error("Expected output");
            }
            const token = firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE);
            const foreign = document.createElement("aside");
            document.body.append(foreign);
            foreign.append(firstOutput);

            const repaired = renderExactTime(source, DATETIME, "repaired");
            expect(repaired).toBe(firstOutput);
            expect(source.nextElementSibling).toBe(firstOutput);
            expect(firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(token);
            expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(1);

            foreign.append(firstOutput);
            restoreExactTimes(document);
            expect(source.hasAttribute("hidden")).toBe(initiallyHidden);
            expect(firstOutput.isConnected).toBe(false);
            expect(firstOutput.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(false);
        },
    );

    it("fails closed for forged pairs, malformed markers, and orphan output", () => {
        document.body.innerHTML = `
      <div id="forged"><relative-time data-no-more-ago-source="visible:forged">
        old</relative-time><time data-no-more-ago-output="forged" datetime="old">
        old exact</time></div>
      <relative-time id="malformed" data-no-more-ago-source="visible:">relative</relative-time>
      <relative-time id="unknown" data-no-more-ago-source="other:token">relative</relative-time>
      <relative-time id="tokenless" data-no-more-ago-source="hidden:">relative</relative-time>
      <time id="orphan" data-no-more-ago-output="orphan" datetime="kept">kept text</time>
      <span id="foreign">foreign</span>`;
        const forged = document.querySelector("#forged relative-time");
        if (!forged) {
            throw new Error("Expected forged source");
        }
        const forgedSnapshot = document.querySelector("#forged")?.innerHTML;
        expect(renderExactTime(forged, DATETIME, "new")).toBeNull();
        expect(document.querySelector("#forged")?.innerHTML).toBe(forgedSnapshot);

        for (const id of ["malformed", "unknown", "tokenless"]) {
            const candidate = document.getElementById(id);
            if (!candidate) {
                throw new Error(`Expected ${id}`);
            }
            expect(renderExactTime(candidate, DATETIME, "new")).toBeNull();
        }
        const orphan = document.getElementById("orphan");
        if (!orphan) {
            throw new Error("Expected orphan");
        }
        const orphanParent = orphan.parentNode;
        restoreExactTimes(document);
        expect(orphan.parentNode).toBe(orphanParent);
        expect(orphan.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe("orphan");
        expect(orphan.getAttribute("datetime")).toBe("kept");
        expect(orphan.textContent).toBe("kept text");
        expect(document.getElementById("foreign")?.textContent).toBe("foreign");
    });

    it("restores the valid source when only the output marker is altered", () => {
        const source = createSource();
        const output = renderExactTime(source, DATETIME, "first");
        if (!output) {
            throw new Error("Expected output");
        }
        output.setAttribute(OWNED_OUTPUT_ATTRIBUTE, "other");
        expect(renderExactTime(source, DATETIME, "changed")).toBeNull();
        expect(output.textContent).toBe("first");
        restoreExactTimes(document);
        expect(source.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(output.isConnected).toBe(true);
        expect(output.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe("other");
    });

    it("removes the valid output when only the source marker is altered", () => {
        const source = createSource();
        const output = renderExactTime(source, DATETIME, "first");
        if (!output) {
            throw new Error("Expected output");
        }
        source.setAttribute(OWNED_SOURCE_ATTRIBUTE, "visible:other");
        expect(renderExactTime(source, DATETIME, "changed")).toBeNull();
        expect(output.textContent).toBe("first");
        restoreExactTimes(document);
        expect(source.getAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe("visible:other");
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(output.isConnected).toBe(false);
        expect(output.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(false);
    });

    it("looks up exact output identity and reports provenance before release", () => {
        const source = createSource();
        const output = renderExactTime(source, DATETIME, "first");
        if (!output) {
            throw new Error("Expected output");
        }
        const forged = document.createElement("time");
        forged.setAttribute(
            OWNED_OUTPUT_ATTRIBUTE,
            output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) ?? "",
        );
        expect(getOwnedSourceForOutput(output)).toBe(source);
        expect(getOwnedSourceForOutput(forged)).toBeNull();

        const sink = {
            beforeOwnedOutputRemoval: vi.fn(() => {
                expect(getOwnedSourceForOutput(output)).toBe(source);
                expect(source.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);
                expect(output.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(true);
            }),
            beforeOwnedSourceHiddenChange: vi.fn(),
        };
        restoreExactTime(source, sink);
        expect(sink.beforeOwnedOutputRemoval).toHaveBeenCalledWith(output);
        expect(getOwnedSourceForOutput(output)).toBeNull();
    });

    it("restores only the requested owned pair while preserving a disconnected pair", () => {
        document.body.innerHTML = `
      <relative-time id="first">first</relative-time>
      <relative-time id="second">second</relative-time>`;
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!first || !second) {
            throw new Error("Expected sources");
        }
        const firstOutput = renderExactTime(first, DATETIME, "first exact");
        const secondOutput = renderExactTime(second, DATETIME, "second exact");
        if (!firstOutput || !secondOutput) {
            throw new Error("Expected outputs");
        }
        firstOutput.remove();
        restoreExactTime(first);

        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(first.hasAttribute("hidden")).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(getOwnedSourceForOutput(secondOutput)).toBe(second);
        expect(second.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);
        expect(secondOutput.isConnected).toBe(true);
        restoreExactTimes(document);
    });

    it("restores only records scoped by a non-Document wrapper", () => {
        document.body.innerHTML = `
      <section id="first"><relative-time>first</relative-time></section>
      <section id="second"><relative-time>second</relative-time></section>`;
        const firstRoot = document.getElementById("first");
        const second = document.querySelector("#second relative-time");
        const first = document.querySelector("#first relative-time");
        if (!firstRoot || !first || !second) {
            throw new Error("Expected sources");
        }
        const firstOutput = renderExactTime(first, DATETIME, "first exact");
        const secondOutput = renderExactTime(second, DATETIME, "second exact");
        if (!firstOutput || !secondOutput) {
            throw new Error("Expected outputs");
        }

        restoreExactTimes(firstRoot);

        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(second.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);
        expect(secondOutput.isConnected).toBe(true);
        restoreExactTimes(document);
    });

    it("uses source provenance in disconnected scopes and ignores hostile output", () => {
        document.body.innerHTML =
            '<section id="scope"><relative-time>source</relative-time></section>';
        const scope = document.getElementById("scope");
        const source = scope?.querySelector("relative-time");
        if (!scope || !source) {
            throw new Error("Expected source");
        }
        const output = renderExactTime(source, DATETIME, "exact");
        if (!output) {
            throw new Error("Expected output");
        }
        const originalMarker = output.getAttribute(OWNED_OUTPUT_ATTRIBUTE);

        const detachedSource = document.createElement("div");
        detachedSource.append(source);
        document.body.append(output);
        const foreign = document.createElement("time");
        foreign.setAttribute(
            OWNED_OUTPUT_ATTRIBUTE,
            output.getAttribute(OWNED_OUTPUT_ATTRIBUTE) ?? "",
        );
        foreign.textContent = "page-owned";
        document.body.append(foreign);
        output.setAttribute(OWNED_OUTPUT_ATTRIBUTE, "altered");

        restoreExactTimes(detachedSource);

        expect(source.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(output.isConnected).toBe(true);
        expect(output.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe("altered");
        expect(foreign.isConnected).toBe(true);
        expect(foreign.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(originalMarker);

        const forgedSource = document.createElement("relative-time");
        forgedSource.setAttribute(OWNED_SOURCE_ATTRIBUTE, "visible:forged");
        const forgedOutput = document.createElement("time");
        forgedOutput.setAttribute(OWNED_OUTPUT_ATTRIBUTE, "forged");
        forgedOutput.textContent = "forged exact";
        scope.append(forgedSource, forgedOutput);
        restoreExactTimes(scope);
        expect(forgedSource.getAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe("visible:forged");
        expect(forgedOutput.isConnected).toBe(true);
        expect(forgedOutput.textContent).toBe("forged exact");
        restoreExactTimes(document);
    });

    it("removes connected output from a disconnected scope before release", () => {
        document.body.innerHTML = `
      <section id="scope"><relative-time id="first">first</relative-time></section>
      <section id="second"><relative-time id="second">second</relative-time></section>`;
        const scope = document.getElementById("scope");
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!scope || !first || !second) {
            throw new Error("Expected sources");
        }
        const firstOutput = renderExactTime(first, DATETIME, "first exact");
        const secondOutput = renderExactTime(second, DATETIME, "second exact");
        if (!firstOutput || !secondOutput) {
            throw new Error("Expected outputs");
        }

        const outputHost = document.createElement("aside");
        document.body.append(outputHost);
        outputHost.append(firstOutput);
        const detachedScope = document.createElement("div");
        detachedScope.append(scope);

        const sink = {
            beforeOwnedOutputRemoval: vi.fn((output: HTMLTimeElement) => {
                expect(output).toBe(firstOutput);
                expect(getOwnedSourceForOutput(output)).toBe(first);
                expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);
                expect(output.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(true);
                expect(output.isConnected).toBe(true);
            }),
            beforeOwnedSourceHiddenChange: vi.fn(),
        };

        restoreExactTimes(detachedScope, sink);

        expect(sink.beforeOwnedOutputRemoval).toHaveBeenCalledTimes(1);
        expect(sink.beforeOwnedOutputRemoval).toHaveBeenCalledWith(firstOutput);
        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(first.hasAttribute("hidden")).toBe(false);
        expect(firstOutput.isConnected).toBe(false);
        expect(firstOutput.hasAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(false);
        expect(getOwnedSourceForOutput(firstOutput)).toBeNull();
        expect(getOwnedSourceForOutput(secondOutput)).toBe(second);
        expect(second.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(true);
        expect(secondOutput.isConnected).toBe(true);
    });

    it("does not report or remove altered, forged, or cross-pair output evidence", () => {
        document.body.innerHTML = `
      <section id="scope"><relative-time id="first">first</relative-time>
        <relative-time id="second">second</relative-time></section>`;
        const scope = document.getElementById("scope");
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!scope || !first || !second) {
            throw new Error("Expected sources");
        }
        const firstOutput = renderExactTime(first, DATETIME, "first exact");
        const secondOutput = renderExactTime(second, DATETIME, "second exact");
        if (!firstOutput || !secondOutput) {
            throw new Error("Expected outputs");
        }
        const firstToken = firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE);
        const secondToken = secondOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE);
        if (!firstToken || !secondToken) {
            throw new Error("Expected output tokens");
        }

        const outputHost = document.createElement("aside");
        document.body.append(outputHost);
        outputHost.append(firstOutput, secondOutput);
        const forged = document.createElement("time");
        forged.setAttribute(OWNED_OUTPUT_ATTRIBUTE, firstToken);
        forged.textContent = "page-owned";
        outputHost.append(forged);
        firstOutput.setAttribute(OWNED_OUTPUT_ATTRIBUTE, "altered");
        secondOutput.setAttribute(OWNED_OUTPUT_ATTRIBUTE, firstToken);

        expect(getOwnedSourceForOutput(firstOutput)).toBeNull();
        expect(getOwnedSourceForOutput(secondOutput)).toBeNull();
        expect(getOwnedSourceForOutput(forged)).toBeNull();

        const detachedScope = document.createElement("div");
        detachedScope.append(scope);
        const sink = {
            beforeOwnedOutputRemoval: vi.fn(),
            beforeOwnedSourceHiddenChange: vi.fn(),
        };
        restoreExactTimes(detachedScope, sink);

        expect(sink.beforeOwnedOutputRemoval).not.toHaveBeenCalled();
        expect(first.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(second.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(firstOutput.isConnected).toBe(true);
        expect(secondOutput.isConnected).toBe(true);
        expect(forged.isConnected).toBe(true);
        expect(firstOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe("altered");
        expect(secondOutput.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(firstToken);
        expect(forged.getAttribute(OWNED_OUTPUT_ATTRIBUTE)).toBe(firstToken);
    });
});
