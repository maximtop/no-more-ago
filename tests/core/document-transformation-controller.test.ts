import { describe, expect, it, vi } from "vitest";

import { AdapterRegistry } from "../../src/adapters/registry";
import { EXPLICIT_ZONED_DATETIME_RULE, type SiteAdapter } from "../../src/adapters/types";
import { DocumentTransformationController } from "../../src/core/document-transformation-controller";
import { formatDefaultDate } from "../../src/core/format-default-date";
import type { DisplaySettings } from "../../src/settings/snapshot";

describe("DocumentTransformationController", () => {
    const flushMutations = async (): Promise<void> => {
        await Promise.resolve();
        await Promise.resolve();
    };

    it("starts idempotently, tears down precisely, and can reactivate", () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">2 hours ago</relative-time><span id="foreign">foreign</span>';
        const source = document.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
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
    });

    it("reformats only its existing owned sources when presentation changes", () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">relative</relative-time><span id="foreign">foreign</span>';
        let display: DisplaySettings = { formatMode: "system", timeZone: { mode: "system" } };
        const source = document.querySelector("relative-time");
        const foreign = document.getElementById("foreign");
        if (!source || !foreign) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-GB"],
            displayProvider: () => display
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
        expect(output.textContent).toBe(new Intl.DateTimeFormat(["en-GB"], { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }).format(new Date("2026-08-23T10:15:00Z")));
        expect(foreign.textContent).toBe("foreign");
        controller.teardown();
    });

    it("processes bounded additions and final datetime values, then restores removed subtrees", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">initial</relative-time>';
        const initial = document.querySelector("relative-time");
        if (!initial) {
            throw new Error("Expected initial source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
        });
        controller.start();
        const initialOutput = initial.nextElementSibling;
        if (!(initialOutput instanceof HTMLTimeElement)) {
            throw new Error("Expected initial output");
        }

        const wrapper = document.createElement("section");
        wrapper.innerHTML = '<relative-time datetime="2026-08-24T10:15:00Z">new</relative-time><relative-time datetime="2026-08-25T10:15:00Z">newer</relative-time>';
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
        expect(wrapper.querySelectorAll("[data-no-more-ago-source], [data-no-more-ago-output]")).toHaveLength(0);
        expect(initial.hasAttribute("hidden")).toBe(initialHidden);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);

        initialOutput.remove();
        await flushMutations();
        expect(initial.nextElementSibling).toBe(initialOutput);
        expect(document.querySelectorAll("time[data-no-more-ago-output]")).toHaveLength(1);
        controller.teardown();
    });

    it.each([false, true])("repairs moved outputs and preserves original hidden state (%s)", async (initiallyHidden) => {
        document.body.innerHTML = `<relative-time${initiallyHidden ? " hidden" : ""} datetime="2026-08-23T10:15:00Z">source</relative-time>`;
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
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
    });

    it("moves a processed subtree without releasing its pair and creates a fresh pair after reinsertion", async () => {
        document.body.innerHTML = '<main id="one"><relative-time datetime="2026-08-23T10:15:00Z">source</relative-time></main><main id="two"></main>';
        const wrapper = document.getElementById("one");
        const destination = document.getElementById("two");
        const source = wrapper?.querySelector("relative-time");
        if (!wrapper || !destination || !source) {
            throw new Error("Expected fixture");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
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
        expect(wrapper.querySelector("[data-no-more-ago-source], [data-no-more-ago-output]")).toBeNull();
        expect(source.hasAttribute("hidden")).toBe(false);
        document.body.append(wrapper);
        await flushMutations();
        const freshOutput = source.nextElementSibling;
        expect(freshOutput).toBeInstanceOf(HTMLTimeElement);
        expect(freshOutput).not.toBe(output);
        controller.teardown();
    });

    it("does not recurse when invalidation removes an owned output", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
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

    it("reconciles a combined move, removal, final update, displacement, and addition once", async () => {
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
        const adapter: SiteAdapter = {
            id: "combined-instrumented",
            matches: () => true,
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
                    adapterId: "combined-instrumented",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: datetime,
                    timestampRule: EXPLICIT_ZONED_DATETIME_RULE
                };
            }
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter])
        });
        controller.start();
        const movedOutput = moved.nextElementSibling;
        const removedOutput = removed.nextElementSibling;
        if (!(movedOutput instanceof HTMLTimeElement) || !(removedOutput instanceof HTMLTimeElement)) {
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
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
        });
        const error = new Error("observer setup failed");
        const observe = vi.spyOn(MutationObserver.prototype, "observe").mockImplementationOnce(() => {
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
        const adapter: SiteAdapter = {
            id: "test",
            matches: () => true,
            discover: (root) => [
                ...(root instanceof Element && root.matches("relative-time") ? [root] : []),
                ...Array.from(root.querySelectorAll("relative-time"))
            ],
            extract: (element) => {
                if (shouldThrow && element === second) {
                    throw new Error("candidate extraction failed");
                }
                return {
                    adapterId: "test",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: element.getAttribute("datetime") ?? "",
                    timestampRule: EXPLICIT_ZONED_DATETIME_RULE
                };
            }
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter])
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

    it("bounds dynamic discovery and coalesces repeated final datetime changes", async () => {
        document.body.innerHTML = '<relative-time id="outside" datetime="2026-08-23T10:15:00Z">outside</relative-time>';
        const roots: ParentNode[] = [];
        const visits: Element[] = [];
        const adapter: SiteAdapter = {
            id: "instrumented",
            matches: () => true,
            discover: (root) => {
                roots.push(root);
                const own = root instanceof Element && root.matches("relative-time") ? [root] : [];
                return [...own, ...Array.from(root.querySelectorAll("relative-time"))];
            },
            extract: (element) => {
                visits.push(element);
                return {
                    adapterId: "instrumented",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: element.getAttribute("datetime") ?? "",
                    timestampRule: EXPLICIT_ZONED_DATETIME_RULE
                };
            }
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter])
        });
        controller.start();
        roots.length = 0;
        visits.length = 0;
        const wrapper = document.createElement("section");
        wrapper.innerHTML = '<relative-time id="inside-one" datetime="2026-08-24T10:15:00Z">one</relative-time><relative-time id="inside-two" datetime="2026-08-25T10:15:00Z">two</relative-time>';
        document.body.append(wrapper);
        const insideOne = wrapper.querySelector("#inside-one");
        if (!insideOne) {
            throw new Error("Expected dynamic source");
        }
        await flushMutations();

        expect(roots).toEqual([wrapper]);
        expect(visits).toEqual(expect.arrayContaining([...wrapper.querySelectorAll("relative-time")]));
        expect(visits).toHaveLength(2);
        expect(document.getElementById("outside")?.nextElementSibling).toBeInstanceOf(HTMLTimeElement);
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

        expect(roots).toEqual([insideOne]);
        expect(visits).toEqual([insideOne]);
        expect(insideOne.nextElementSibling).toBe(output);
        expect(output.getAttribute("data-no-more-ago-output")).toBe(token);
        expect(output.dateTime).toBe("2026-08-28T10:15:00Z");
        expect(output.textContent).toBe(formatDefaultDate(new Date("2026-08-28T10:15:00Z"), ["en-US"]));
        expect(document.getElementById("outside")?.nextElementSibling).not.toBeNull();
        controller.teardown();
    });

    it("leaves forged output detach and reparent operations untouched", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const controller = new DocumentTransformationController({
            url: new URL("https://github.com/example/repo"),
            root: document,
            locales: ["en-US"]
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

    it("performs exactly one bounded invalidation reconciliation after observer drains", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">source</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        let visits = 0;
        const adapter: SiteAdapter = {
            id: "counting",
            matches: () => true,
            discover: (root) => [
                ...(root instanceof Element && root.matches("relative-time") ? [root] : []),
                ...Array.from(root.querySelectorAll("relative-time"))
            ],
            extract: (element) => {
                visits += 1;
                const datetime = element.getAttribute("datetime");
                if (!datetime) {
                    return null;
                }
                return {
                    adapterId: "counting",
                    source: element,
                    sourceKind: "relative-time",
                    rawDatetime: datetime,
                    timestampRule: EXPLICIT_ZONED_DATETIME_RULE
                };
            }
        };
        const controller = new DocumentTransformationController({
            url: new URL("https://example.test/"),
            root: document,
            locales: ["en-US"],
            registry: new AdapterRegistry([adapter])
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
});
