/**
 * @file Verifies document transformation controller activation and reconciliation.
 */

import { describe, expect, it, vi } from "vitest";

import { genericTimeRule } from "../../../../src/content-script/adapters/generic-time";
import { hackerNewsAdapter } from "../../../../src/content-script/adapters/hacker-news";
import { AdapterRegistry } from "../../../../src/content-script/adapters/registry";
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "../../../../src/content-script/adapters/types";
import {
    DocumentTransformationController,
} from "../../../../src/content-script/transformation/document-transformation-controller";
import { formatDefaultDate } from "../../../../src/shared/date/format-default-date";
import type { DisplaySettings } from "../../../../src/shared/settings/snapshot";
import {
    DOCUMENT_ROUTE_HANDOFF_TRANSITION,
    type DocumentRouteHandoffPolicy,
    type DocumentRouteHandoffSession,
} from "../../../../src/content-script/transformation/route-handoff";

const noMatchRule: TimestampSourceRule = {
    id: "no-match",
    mutationAttributes: [],
    matches: () => false,
    matchesElement: () => false,
    discover: () => [],
    extract: () => null,
};

/**
 * Generic timestamp fixture shared by visibility lifecycle tests.
 */
interface GenericControllerFixture {
    /**
     * Generic source in the fixture document.
     */
    readonly source: HTMLTimeElement;

    /**
     * Controller attached to the fixture document.
     */
    readonly controller: DocumentTransformationController;
}

/**
 * Creates a generic source and controller for a visibility behavior test.
 *
 * @param markup - Body markup containing one generic HTML time source.
 * @returns - Source and controller sharing the fixture document.
 */
function createGenericControllerFixture(
    markup = '<time datetime="2026-08-23T10:15Z">relative</time>',
): GenericControllerFixture {
    document.body.innerHTML = markup;
    const source = document.querySelector("time");
    if (!(source instanceof HTMLTimeElement)) {
        throw new Error("Expected generic source");
    }
    return {
        source,
        controller: new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        }),
    };
}

describe("DocumentTransformationController", () => {
    const flushMutations = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
    };

    it("starts idempotently, tears down precisely, and can reactivate", () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">'
            + '2 hours ago</relative-time><span id="foreign">foreign</span>';
        const source = document.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });

        const first = controller.start();
        expect(first).toHaveLength(1);
        expect(first[0]?.isConnected).toBe(true);
        expect(controller.start()).toEqual(first);
        expect(document.querySelectorAll("time")).toHaveLength(1);
        controller.teardown();
        controller.teardown();
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(source.textContent).toBe("2 hours ago");
        expect(foreign.textContent).toBe("foreign");
        expect(document.querySelector("time")).toBeNull();

        const second = controller.start();
        expect(second).toHaveLength(1);
        expect(second[0]).not.toBe(first[0]);
        expect(document.querySelectorAll("time")).toHaveLength(1);
        controller.teardown();
    });

    it("reformats only its existing owned sources when presentation changes", () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">'
            + 'relative</relative-time><span id="foreign">foreign</span>';
        let display: DisplaySettings = {
            formatMode: "system",
            timeZone: { mode: "iana", identifier: "America/New_York" },
        };
        const source = document.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-GB"],
            displayProvider: () => display,
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        const before = output.textContent;
        display = { formatMode: "system", timeZone: { mode: "utc" } };
        controller.reformatOwned();
        expect(output.textContent).not.toBe(before);
        expect(output.textContent).toBe(
            new Intl.DateTimeFormat(["en-GB"], {
                dateStyle: "medium",
                timeStyle: "short",
                timeZone: "UTC",
            }).format(new Date("2026-08-23T10:15:00Z")),
        );
        expect(foreign.textContent).toBe("foreign");
        controller.teardown();
    });

    it("processes additions and restores removed subtrees", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">initial</relative-time>';
        const initial = document.querySelector("relative-time");
        if (!initial) {
            throw new Error("Expected initial source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const initialOutput = initial.nextElementSibling;
        if (!(initialOutput instanceof HTMLTimeElement)) {
            throw new Error("Expected initial output");
        }

        const wrapper = document.createElement("section");
        wrapper.innerHTML = '<relative-time datetime="2026-08-24T10:15:00Z">new</relative-time>'
            + '<relative-time datetime="2026-08-25T10:15:00Z">newer</relative-time>';
        document.body.append(wrapper);
        await flushMutations();
        expect(wrapper.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);

        initial.setAttribute("datetime", "2026-08-26T10:15:00Z");
        await flushMutations();
        expect(initial.nextElementSibling).toBe(initialOutput);
        expect(initialOutput.dateTime).toBe("2026-08-26T10:15:00Z");

        const initialHidden = initial.hasAttribute("hidden");
        document.body.removeChild(wrapper);
        await flushMutations();
        expect(
            wrapper.querySelectorAll("[data-no-more-ago-source], [data-no-more-ago-output]"),
        ).toHaveLength(0);
        expect(initial.hasAttribute("hidden")).toBe(initialHidden);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);

        initialOutput.remove();
        await flushMutations();
        expect(initial.nextElementSibling).toBe(initialOutput);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        controller.teardown();
    });

    it("does not diagnose ordinary non-time additions and removals", async () => {
        document.body.innerHTML = "<main></main>";
        const diagnosticSink = vi.fn();
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            diagnosticSink,
        });
        controller.start();
        diagnosticSink.mockClear();

        const ordinary = document.createElement("section");
        ordinary.textContent = "page content";
        document.body.append(ordinary);
        await flushMutations();
        ordinary.remove();
        await flushMutations();

        expect(diagnosticSink).not.toHaveBeenCalled();
        controller.teardown();
    });

    it.each([false, true])(
        "repairs moved outputs and preserves original hidden state (%s)",
        async (initiallyHidden) => {
            document.body.innerHTML = `<relative-time${initiallyHidden ? " hidden" : ""} `
                + 'datetime="2026-08-23T10:15:00Z">source</relative-time>';
            const source = document.querySelector("relative-time");
            if (!source) {
                throw new Error("Expected source");
            }
            const controller = new DocumentTransformationController({
                url: new URL("https://github.com/example/repo"),
                root: document,
                locales: ["en-US"],
            });
            controller.start();
            const output = source.nextElementSibling;
            if (!(output instanceof HTMLTimeElement)) {
                throw new Error("Expected output");
            }
            const token = output.getAttribute("data-no-more-ago-output");
            const foreign = document.createElement("aside");
            document.body.append(foreign);
            foreign.append(output);
            await flushMutations();

            expect(source.nextElementSibling).toBe(output);
            expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
            expect(source.hasAttribute("hidden")).toBe(true);
            expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
            controller.teardown();
            expect(source.hasAttribute("hidden")).toBe(initiallyHidden);
            expect(output.isConnected).toBe(false);
        },
    );

    it("does not restore a page-removed hidden state for an initially hidden source", async () => {
        document.body.innerHTML = '<relative-time hidden datetime="2026-08-23T10:15:00Z">'
            + "source</relative-time>";
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
        source.removeAttribute("hidden");
        await flushMutations();
        source.removeAttribute("datetime");
        await flushMutations();
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it("moves owned subtrees and creates fresh pairs after reinsertion", async () => {
        document.body.innerHTML = '<main id="one">'
            + '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>'
            + '</main><main id="two"></main>';
        const wrapper = document.getElementById("one");
        const destination = document.getElementById("two");
        const source = wrapper?.querySelector("relative-time");
        if (!wrapper || !destination || !source) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        destination.append(wrapper);
        await flushMutations();
        expect(source.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);

        wrapper.remove();
        await flushMutations();
        expect(
            wrapper.querySelector("[data-no-more-ago-source], [data-no-more-ago-output]"),
        ).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        document.body.append(wrapper);
        await flushMutations();
        const freshOutput = source.nextElementSibling;
        expect(freshOutput).toBeInstanceOf(HTMLTimeElement);
        expect(freshOutput).not.toBe(output);
        controller.teardown();
    });

    it("does not recurse when invalidation removes an owned output", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        source.removeAttribute("datetime");
        await flushMutations();
        expect(output.isConnected).toBe(false);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);
        controller.teardown();
    });

    it("reconciles combined ownership mutations once", async () => {
        document.body.innerHTML = `
      <relative-time id="moved" datetime="2026-08-23T10:15:00Z">moved</relative-time>
      <relative-time id="removed" datetime="2026-08-23T11:15:00Z">removed</relative-time>
      <relative-time id="outside" datetime="2026-08-23T12:15:00Z">outside</relative-time>`;
        const moved = document.getElementById("moved");
        const removed = document.getElementById("removed");
        if (!moved || !removed) {
            throw new Error("Expected sources");
        }
        const roots: ParentNode[] = [];
        const visits: Element[] = [];
        const adapter: TimestampSourceRule = {
            id: "combined-instrumented",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => {
                roots.push(root);
                const own = root instanceof Element && root.matches("relative-time") ? [root] : [];
                return [...own, ...Array.from(root.querySelectorAll("relative-time"))];
            },
            extract: (element) => {
                visits.push(element);
                const datetime = element.getAttribute("datetime");
                if (!datetime) {
                    return null;
                }
                return {
                    ruleId: "combined-instrumented",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: datetime,
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });
        controller.start();
        const movedOutput = moved.nextElementSibling;
        const removedOutput = removed.nextElementSibling;
        if (
            !(movedOutput instanceof HTMLTimeElement) ||
            !(removedOutput instanceof HTMLTimeElement)
        ) {
            throw new Error("Expected initial outputs");
        }
        const token = movedOutput.getAttribute("data-no-more-ago-output");
        roots.length = 0;
        visits.length = 0;
        const region = document.createElement("section");
        document.body.append(region);
        region.append(moved, movedOutput);
        moved.setAttribute("datetime", "2026-08-24T10:15:00Z");
        movedOutput.remove();
        region.append(movedOutput);
        removed.remove();
        removedOutput.remove();
        const added = document.createElement("section");
        added.innerHTML = '<relative-time datetime="2026-08-25T10:15:00Z">added</relative-time>';
        document.body.append(added);
        document.body.append(document.createTextNode("unrelated"));
        await flushMutations();

        expect(moved.nextElementSibling).toBe(movedOutput);
        expect(movedOutput.getAttribute("data-no-more-ago-output")).toBe(token);
        expect(movedOutput.dateTime).toBe("2026-08-24T10:15:00Z");
        expect(removed.hasAttribute("hidden")).toBe(false);
        expect(removedOutput.isConnected).toBe(false);
        expect(added.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        expect(roots).toEqual([region, added]);
        expect(visits).toEqual([moved, added.querySelector("relative-time")]);
        expect(visits).not.toContain(document.getElementById("outside"));
        controller.teardown();
    });

    it("rolls back observer setup and succeeds on a later start", () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        const error = new Error("observer setup failed");
        const observe = vi
            .spyOn(MutationObserver.prototype, "observe")
            .mockImplementationOnce(() => {
                throw error;
            });

        expect(() => controller.start()).toThrow(error);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        observe.mockRestore();

        const outputs = controller.start();
        expect(outputs).toHaveLength(1);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        controller.teardown();
    });

    it("restores a partial initial pass before retrying with the same adapter", () => {
        document.body.innerHTML = `
      <relative-time id="first" datetime="2026-08-23T10:15:00Z">first</relative-time>
      <relative-time id="second" datetime="2026-08-24T10:15:00Z">second</relative-time>`;
        const first = document.getElementById("first");
        const second = document.getElementById("second");
        if (!first || !second) {
            throw new Error("Expected sources");
        }
        let shouldThrow = true;
        const adapter: TimestampSourceRule = {
            id: "test",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => [
                ...(root instanceof Element && root.matches("relative-time") ? [root] : []),
                ...Array.from(root.querySelectorAll("relative-time")),
            ],
            extract: (element) => {
                if (shouldThrow && element === second) {
                    throw new Error("candidate extraction failed");
                }
                return {
                    ruleId: "test",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: element.getAttribute("datetime") ?? "",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });

        expect(() => controller.start()).toThrow("candidate extraction failed");
        expect(first.hasAttribute("hidden")).toBe(false);
        expect(second.hasAttribute("hidden")).toBe(false);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(0);

        shouldThrow = false;
        expect(controller.start()).toHaveLength(2);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        controller.teardown();
    });

    it("bounds dynamic discovery and batches exact-source datetime changes", async () => {
        document.body.innerHTML =
            '<relative-time id="outside" datetime="2026-08-23T10:15:00Z">outside</relative-time>';
        const roots: ParentNode[] = [];
        const visits: Element[] = [];
        const adapter: TimestampSourceRule = {
            id: "instrumented",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => {
                roots.push(root);
                const own = root instanceof Element && root.matches("relative-time") ? [root] : [];
                return [...own, ...Array.from(root.querySelectorAll("relative-time"))];
            },
            extract: (element) => {
                visits.push(element);
                return {
                    ruleId: "instrumented",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: element.getAttribute("datetime") ?? "",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });
        controller.start();
        roots.length = 0;
        visits.length = 0;
        const wrapper = document.createElement("section");
        wrapper.innerHTML = '<relative-time id="inside-one" '
            + 'datetime="2026-08-24T10:15:00Z">one</relative-time>'
            + '<relative-time id="inside-two" '
            + 'datetime="2026-08-25T10:15:00Z">two</relative-time>';
        document.body.append(wrapper);
        const insideOne = wrapper.querySelector("#inside-one");
        if (!insideOne) {
            throw new Error("Expected dynamic source");
        }
        await flushMutations();

        expect(roots).toEqual([wrapper]);
        expect(visits).toEqual(
            expect.arrayContaining([...wrapper.querySelectorAll("relative-time")]),
        );
        expect(visits).toHaveLength(2);
        expect(document.getElementById("outside")?.nextElementSibling).toBeInstanceOf(
            HTMLTimeElement,
        );
        const output = insideOne.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected owned output");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        roots.length = 0;
        visits.length = 0;
        insideOne.setAttribute("datetime", "2026-08-26T10:15:00Z");
        insideOne.setAttribute("datetime", "2026-08-27T10:15:00Z");
        insideOne.setAttribute("datetime", "2026-08-28T10:15:00Z");
        await flushMutations();

        expect(roots).toEqual([]);
        expect(visits).toEqual([insideOne]);
        expect(insideOne.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
        expect(output.dateTime).toBe("2026-08-28T10:15:00Z");
        expect(output.textContent).toBe(
            formatDefaultDate(new Date("2026-08-28T10:15:00Z"), ["en-US"]),
        );
        expect(document.getElementById("outside")?.nextElementSibling).not.toBeNull();
        controller.teardown();
    });

    it("leaves forged output detach and reparent operations untouched", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const forged = document.createElement("time");
        forged.setAttribute("data-no-more-ago-output", "forged");
        forged.textContent = "page exact";
        const parent = document.createElement("aside");
        document.body.append(parent);
        parent.append(forged);
        forged.remove();
        await flushMutations();
        const other = document.createElement("section");
        document.body.append(other);
        other.append(forged);
        await flushMutations();
        expect(forged.parentNode).toBe(other);
        expect(forged.getAttribute("data-no-more-ago-output")).toBe("forged");
        expect(forged.textContent).toBe("page exact");
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(2);
        controller.teardown();
    });

    it("performs one invalidation reconciliation after observer drains", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        let visits = 0;
        const adapter: TimestampSourceRule = {
            id: "counting",
            mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
            matches: () => true,
            matchesElement: (element) => element.matches("relative-time"),
            discover: (root) => [
                ...(root instanceof Element && root.matches("relative-time") ? [root] : []),
                ...Array.from(root.querySelectorAll("relative-time")),
            ],
            extract: (element) => {
                visits += 1;
                const datetime = element.getAttribute("datetime");
                if (!datetime) {
                    return null;
                }
                return {
                    ruleId: "counting",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: datetime,
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
                };
            },
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter], noMatchRule),
        });
        controller.start();
        visits = 0;
        source.removeAttribute("datetime");
        await flushMutations();
        await flushMutations();
        expect(visits).toBe(1);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it("reacquires extension-owned hidden state when a page removes it", async () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">relative</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected generic source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
        });
        controller.start();
        const output = source.nextElementSibling;
        if (!(output instanceof HTMLTimeElement)) {
            throw new Error("Expected output");
        }
        const token = output.getAttribute("data-no-more-ago-output");
        source.removeAttribute("hidden");
        await flushMutations();
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(source.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
        controller.teardown();
    });

    it.each([
        ["the trusted title is removed", "remove-title"],
        ["the trusted title becomes blank", "blank-title"],
        ["the trusted title becomes unzoned", "unzone-title"],
        ["the age class is removed", "remove-class"],
    ] as const)("restores an owned in-place source when %s", async (_name, mutation) => {
        document.body.innerHTML = `<span class="age"
            title="2026-08-28T10:09:07.000000Z"><a id="age-link"
            href="item?id=1">1 hour ago</a></span>`;
        const source = document.querySelector("span.age");
        const link = document.getElementById("age-link");
        if (!source || !link) {
            throw new Error("Expected Hacker News age source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: {
                formatMode: "custom",
                pattern: "yyyy",
                timeZone: { mode: "utc" },
            },
        });
        controller.start();
        expect(link.textContent).toBe("2026");

        if (mutation === "remove-title") {
            source.removeAttribute("title");
        } else if (mutation === "blank-title") {
            source.setAttribute("title", "   ");
        } else if (mutation === "unzone-title") {
            source.setAttribute("title", "2026-08-28T10:09:07");
        } else {
            source.classList.remove("age");
        }
        await flushMutations();
        expect(link.textContent).toBe("1 hour ago");
        expect(document.getElementById("age-link")).toBe(link);
        controller.teardown();
    });

    it.each([
        ["class is added after title", "class"],
        ["title is added after class", "title"],
    ] as const)("processes a staged Hacker News source when %s", async (_name, finalAttribute) => {
        const source = document.createElement("span");
        const link = document.createElement("a");
        link.textContent = "1 hour ago";
        source.append(link);
        if (finalAttribute === "class") {
            source.title = "2026-08-28T10:09:07Z";
        } else {
            source.className = "age";
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        controller.start();
        document.body.append(source);
        await flushMutations();
        expect(link.textContent).toBe("1 hour ago");

        if (finalAttribute === "class") {
            source.className = "age";
        } else {
            source.title = "2026-08-28T10:09:07Z";
        }
        await flushMutations();
        expect(link.textContent).toBe("2026");
        controller.teardown();
    });

    it("processes a Hacker News widget when complex content becomes a simple label", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07Z">
            <a id="age-link"><strong>1 hour ago</strong></a></span>`;
        const link = document.getElementById("age-link");
        if (!link) {
            throw new Error("Expected Hacker News label");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        controller.start();
        expect(link.textContent).toBe("1 hour ago");

        link.replaceChildren(document.createTextNode("updated relative label"));
        await flushMutations();
        expect(link.textContent).toBe("2026");
        controller.teardown();
    });

    it("restores an owned source covered by a broader added root", async () => {
        document.body.innerHTML = `<span class="age" title="2026-08-28T10:09:07Z">
            <a id="age-link">1 hour ago</a></span>`;
        const source = document.querySelector("span.age");
        const link = document.getElementById("age-link");
        if (!source || !link) {
            throw new Error("Expected Hacker News source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://news.ycombinator.com/item?id=1"),
            root: document,
            locales: ["en-US"],
            display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
        });
        controller.start();
        expect(link.textContent).toBe("2026");

        const region = document.createElement("section");
        document.body.append(region);
        source.classList.remove("age");
        region.append(source);
        await flushMutations();
        expect(link.textContent).toBe("1 hour ago");
        controller.teardown();
    });

    it("ignores unrelated title changes when no active rule uses title", async () => {
        const unrelated = document.createElement("div");
        document.body.append(unrelated);
        const diagnosticSink = vi.fn();
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            diagnosticSink,
        });
        controller.start();
        diagnosticSink.mockClear();

        unrelated.title = "page tooltip";
        await flushMutations();
        expect(diagnosticSink).not.toHaveBeenCalled();
        controller.teardown();
    });

    it(
        "handles dynamic Hacker News insertion, updates, replacement, movement, and idle",
        async () => {
            document.body.innerHTML = "<main><section id='one'></section>"
            + "<section id='two'></section></main>";
            const visits: Element[] = [];
            const instrumented: TimestampSourceRule = {
                ...hackerNewsAdapter,
                extract: (element, url) => {
                    visits.push(element);
                    return hackerNewsAdapter.extract(element, url);
                },
            };
            const controller = new DocumentTransformationController({
                url: new URL("https://news.ycombinator.com/item?id=1"),
                root: document,
                locales: ["en-US"],
                display: { formatMode: "custom", pattern: "yyyy", timeZone: { mode: "utc" } },
                registry: new AdapterRegistry([instrumented], genericTimeRule),
            });
            controller.start();
            const wrapper = document.createElement("span");
            wrapper.className = "age";
            wrapper.title = "2026-08-28T10:09:07Z";
            const link = document.createElement("a");
            link.href = "item?id=1";
            link.textContent = "new relative";
            wrapper.append(link);
            document.querySelector("#one")?.append(wrapper);
            await flushMutations();
            expect(link.textContent).toBe("2026");
            const originalLink = link;
            wrapper.title = "2027-08-28T10:09:07Z";
            await flushMutations();
            expect(link.textContent).toBe("2027");
            const target = link.firstChild;
            if (!(target instanceof Text)) {
                throw new Error("Expected dynamic text target");
            }
            target.data = "page refreshed label";
            await flushMutations();
            expect(link.textContent).toBe("2027");
            document.querySelector("#two")?.append(wrapper);
            await flushMutations();
            expect(document.querySelector("#two .age")).toBe(wrapper);
            expect(wrapper.querySelector("a")).toBe(originalLink);
            const replacement = document.createElement("a");
            replacement.id = "replacement-link";
            replacement.href = "item?id=2";
            replacement.textContent = "replacement relative";
            wrapper.replaceChildren(replacement);
            await flushMutations();
            expect(replacement.textContent).toBe("2027");
            expect(originalLink.textContent).toBe("page refreshed label");
            const replacementTarget = replacement.firstChild;
            if (!(replacementTarget instanceof Text)) {
                throw new Error("Expected replacement text target");
            }
            document.querySelector("#two")?.replaceChildren();
            await flushMutations();
            expect(replacement.textContent).toBe("replacement relative");
            wrapper.title = "2027-08-28T10:09:07";
            document.querySelector("#one")?.append(wrapper);
            await flushMutations();
            expect(replacement.textContent).toBe("replacement relative");
            wrapper.title = "2027-08-28T10:09:07Z";
            await flushMutations();
            for (const invalidTitle of ["   ", "not a timestamp"]) {
                wrapper.title = invalidTitle;
                await flushMutations();
                expect(replacement.textContent).toBe("replacement relative");
            }
            wrapper.removeAttribute("title");
            await flushMutations();
            expect(replacement.textContent).toBe("replacement relative");
            visits.length = 0;
            await flushMutations();
            await flushMutations();
            expect(visits).toEqual([]);
            controller.teardown();
        },
    );

    it("does not mistake extension-owned hidden styling for page suppression", async () => {
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
            (element) => ({
                display: element.hasAttribute("hidden") ? "none" : "inline",
                visibility: "visible",
            }) as CSSStyleDeclaration,
        );
        const { source, controller } = createGenericControllerFixture();
        try {
            controller.start();
            const output = source.nextElementSibling;
            if (!(output instanceof HTMLTimeElement)) {
                throw new Error("Expected output");
            }
            source.setAttribute("datetime", "2026-08-24T10:15Z");
            await flushMutations();
            expect(source.nextElementSibling).toBe(output);
            expect(output.dateTime).toBe("2026-08-24T10:15Z");
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("restores an owned source hidden by page CSS after its datetime changes", async () => {
        const { source, controller } = createGenericControllerFixture();
        const inspected: Element[] = [];
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation((element) => {
            inspected.push(element);
            return {
                display: element.hasAttribute("hidden") || element.classList.contains("page-hidden")
                    ? "none"
                    : "inline",
                visibility: "visible",
            } as CSSStyleDeclaration;
        });
        try {
            controller.start();
            inspected.length = 0;
            source.classList.add("page-hidden");
            source.setAttribute("datetime", "2026-08-24T10:15Z");
            await flushMutations();
            expect(inspected).toContain(source);
            expect(inspected.some((element) =>
                element === source && element.isConnected && !element.hasAttribute("hidden")
            )).toBe(true);
            expect(inspected.every((element) => element === source)).toBe(true);
            expect(source.hasAttribute("hidden")).toBe(false);
            expect(source.textContent).toBe("relative");
            expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("preserves a page-owned hidden state added to an owned source", async () => {
        const { source, controller } = createGenericControllerFixture();
        controller.start();
        source.removeAttribute("hidden");
        source.setAttribute("hidden", "");
        await flushMutations();
        expect(source.hasAttribute("hidden")).toBe(true);
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it.each([
        ["aria-hidden", "true"],
        ["inert", ""],
        ["style", "display: none"],
    ])("removes output while page suppresses generic source via %s", async (attribute, value) => {
        const { source, controller } = createGenericControllerFixture();
        controller.start();
        source.setAttribute(attribute, value);
        await flushMutations();
        expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
        expect(source.getAttribute(attribute)).toBe(value);
        controller.teardown();
    });

    it(
        "reconciles generic sources when ancestor accessibility suppression changes",
        async () => {
            const { controller } = createGenericControllerFixture(
                '<section><time datetime="2026-08-23T10:15Z">relative</time></section>',
            );
            const section = document.querySelector("section");
            if (!section) {
                throw new Error("Expected generic source and ancestor");
            }
            controller.start();
            section.setAttribute("aria-hidden", "true");
            await flushMutations();
            expect(document.querySelector("time[data-no-more-ago-output]")).toBeNull();
            section.removeAttribute("aria-hidden");
            await flushMutations();
            expect(document.querySelector("time[data-no-more-ago-output]")).not.toBeNull();
            controller.teardown();
        },
    );

    it("reconciles generic sources when a visibility class is added or removed", async () => {
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
            (element) => ({
                display: element.classList.contains("page-hidden") ? "none" : "inline",
                visibility: "visible",
            }) as CSSStyleDeclaration,
        );
        const { source, controller } = createGenericControllerFixture(
            '<time class="page-hidden" datetime="2026-08-23T10:15Z">relative</time>',
        );
        try {
            controller.start();
            expect(source.nextElementSibling).toBeNull();
            source.classList.remove("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
            source.classList.add("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeNull();
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("reconciles generic sources when an ancestor visibility class changes", async () => {
        const computedStyle = vi.spyOn(window, "getComputedStyle").mockImplementation(
            (element) => ({
                display: element.classList.contains("page-hidden") ? "none" : "block",
                visibility: "visible",
            }) as CSSStyleDeclaration,
        );
        const { source, controller } = createGenericControllerFixture(
            '<section class="page-hidden"><time datetime="2026-08-23T10:15Z">'
            + "relative</time></section>",
        );
        const section = source.parentElement;
        if (!section) {
            throw new Error("Expected source ancestor");
        }
        try {
            controller.start();
            expect(source.nextElementSibling).toBeNull();
            section.classList.remove("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
            section.classList.add("page-hidden");
            await flushMutations();
            expect(source.nextElementSibling).toBeNull();
        } finally {
            controller.teardown();
            computedStyle.mockRestore();
        }
    });

    it("applies no-op, clear, and replace as total route transitions", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">relative</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected route source");
        }
        const sessions: Array<{
            readonly session: DocumentRouteHandoffSession;
            readonly dispose: ReturnType<typeof vi.fn>;
        }> = [];
        const activate = vi.fn(() => {
            const dispose = vi.fn();
            const session = { noteStructure: vi.fn(), dispose };
            sessions.push({ session, dispose });
            return session;
        });
        const quarantine: DocumentRouteHandoffPolicy = {
            allowsRule: () => false,
            activate,
        };
        const classifier = vi.fn(({ currentUrl }: { readonly currentUrl: URL }) => {
            if (currentUrl.pathname === "/noop") {
                return { kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP } as const;
            }
            if (currentUrl.pathname === "/replace") {
                return {
                    kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE,
                    policy: quarantine,
                } as const;
            }
            return { kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR } as const;
        });
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/initial"),
            root: document,
            locales: ["en-US"],
            routeHandoffClassifier: classifier,
        });

        const initial = controller.start();
        expect(initial).toHaveLength(1);
        const initialOutput = initial[0];
        controller.reconcileRoute(new URL("https://example.test/noop"));
        expect(document.querySelector("[data-no-more-ago-output]")).toBe(initialOutput);
        expect(activate).not.toHaveBeenCalled();

        controller.reconcileRoute(new URL("https://example.test/replace"));
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(activate).toHaveBeenCalledOnce();

        controller.reconcileRoute(new URL("https://example.test/clear"));
        const clearedOutput = document.querySelector("[data-no-more-ago-output]");
        expect(clearedOutput).toBeInstanceOf(HTMLTimeElement);
        expect(sessions[0]?.dispose).toHaveBeenCalledOnce();
        expect(activate).toHaveBeenCalledOnce();

        const classifierCalls = classifier.mock.calls.length;
        controller.reconcileRoute(new URL("https://example.test/clear"));
        expect(classifier).toHaveBeenCalledTimes(classifierCalls);
        expect(document.querySelector("[data-no-more-ago-output]")).toBe(clearedOutput);

        controller.reconcileRoute(new URL("https://example.test/replace"));
        controller.teardown();
        const activationsBeforeRestart = activate.mock.calls.length;
        controller.start();
        expect(activate).toHaveBeenCalledTimes(activationsBeforeRestart + 1);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

    it("restores before activating and passing a replacement route", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">relative</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected route source");
        }
        const events: string[] = [];
        const firstPolicy: DocumentRouteHandoffPolicy = {
            allowsRule: () => true,
            activate: () => ({
                noteStructure: () => undefined,
                dispose: () => events.push("dispose"),
            }),
        };
        const secondPolicy: DocumentRouteHandoffPolicy = {
            allowsRule: () => true,
            activate: () => {
                events.push("activate");
                expect(source.hasAttribute("hidden")).toBe(false);
                expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
                return { noteStructure: () => undefined, dispose: () => undefined };
            },
        };
        const adapter: TimestampSourceRule = {
            id: "route-order",
            mutationAttributes: [],
            matches: () => true,
            matchesElement: (element) => element === source,
            discover: () => [source],
            extract: (element) => {
                events.push("pass");
                return {
                    ruleId: "route-order",
                    source: element,
                    sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
                    rawDatetime: "2026-08-23T10:15Z",
                    presentation: ADJACENT_TIME_PRESENTATION,
                    validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
                    visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
                };
            },
        };
        let transitionCount = 0;
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/initial"),
            root: document,
            registry: new AdapterRegistry([adapter], noMatchRule),
            routeHandoffClassifier: () => {
                events.push("classify");
                transitionCount += 1;
                return {
                    kind: DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE,
                    policy: transitionCount === 1 ? firstPolicy : secondPolicy,
                };
            },
        });
        controller.start();
        controller.reconcileRoute(new URL("https://example.test/one"));
        events.length = 0;

        controller.reconcileRoute(new URL("https://example.test/two"));

        expect(events).toEqual(["classify", "dispose", "activate", "pass"]);
        controller.teardown();
    });

    it("fails closed and restores ownership when changed-route classification throws", () => {
        document.body.innerHTML = '<time datetime="2026-08-23T10:15Z">relative</time>';
        const source = document.querySelector("time");
        if (!source) {
            throw new Error("Expected route source");
        }
        const failure = new Error("route classification failed");
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/initial"),
            root: document,
            locales: ["en-US"],
            routeHandoffClassifier: () => {
                throw failure;
            },
        });
        controller.start();

        expect(() => controller.reconcileRoute(new URL("https://example.test/next")))
            .toThrow(failure);
        expect(source.hasAttribute("hidden")).toBe(false);
        expect(document.querySelector("[data-no-more-ago-output]")).toBeNull();
        controller.teardown();
    });

});
