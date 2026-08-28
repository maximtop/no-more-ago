/**
 * @file Verifies reversible in-place ownership of page-owned timestamp text.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    capturePageOwnedTextChange,
    getOwnedSourceForText,
    getOwnedTextSourcesContainingNode,
    renderExactText,
    restoreExactText,
    restoreExactTexts,
} from "../../../../src/content-script/transformation/render-exact-text";

describe("renderExactText", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("changes only the existing text node and restores it exactly", () => {
        document.body.innerHTML = `<span class="age" data-kept="yes"
            title="2026-08-28T10:09:07Z">\n<a id="link" href="item?id=1"
            data-kept="yes"> 1 hour ago </a>\n</span>`;
        const source = document.querySelector("span.age");
        const link = document.getElementById("link");
        const target = link?.firstChild;
        if (!source || !link || !(target instanceof Text)) {
            throw new Error("Expected linked age text");
        }
        const listener = vi.fn();
        link.addEventListener("click", listener);
        const sourceHtml = source.outerHTML;

        expect(renderExactText(source, target, "2026-08-28 10:09")).toBe(target);
        expect(target.data).toBe("2026-08-28 10:09");
        expect(document.getElementById("link")).toBe(link);
        expect(source.getAttribute("title")).toBe("2026-08-28T10:09:07Z");
        expect(source.getAttribute("data-kept")).toBe("yes");
        expect(link.getAttribute("href")).toBe("item?id=1");
        expect(link.getAttribute("data-kept")).toBe("yes");
        expect(source.querySelector("[data-no-more-ago-source]")).toBeNull();
        expect(source.querySelector("[data-no-more-ago-output]")).toBeNull();
        expect(getOwnedSourceForText(target)).toBe(source);

        restoreExactText(source);
        expect(target.data).toBe(" 1 hour ago ");
        expect(document.getElementById("link")).toBe(link);
        link.dispatchEvent(new MouseEvent("click"));
        expect(listener).toHaveBeenCalledTimes(1);
        expect(source.outerHTML).toBe(sourceHtml);
        expect(getOwnedSourceForText(target)).toBeNull();
    });

    it("restores only records within the requested root", () => {
        document.body.innerHTML = `<section id="first"><span>one</span></section>
            <section id="second"><span>two</span></section>`;
        const firstRoot = document.getElementById("first");
        const sources = Array.from(document.querySelectorAll("span"));
        const targets = sources.map((source) => source.firstChild).filter(
            (node): node is Text => node instanceof Text,
        );
        if (!firstRoot || sources.length !== 2 || targets.length !== 2) {
            throw new Error("Expected two text sources");
        }
        renderExactText(sources[0] as Element, targets[0] as Text, "exact one");
        renderExactText(sources[1] as Element, targets[1] as Text, "exact two");

        restoreExactTexts(firstRoot);
        expect(targets[0]?.data).toBe("one");
        expect(targets[1]?.data).toBe("exact two");
        restoreExactTexts(document);
        expect(targets[1]?.data).toBe("two");
    });

    it("restores the latest page-authored label even when it equals rendered text", () => {
        const source = document.createElement("span");
        const target = document.createTextNode("1 hour ago");
        source.append(target);
        document.body.append(source);
        renderExactText(source, target, "2026");

        expect(capturePageOwnedTextChange(target, "2026")).toBe(source);
        restoreExactText(source);
        expect(target.data).toBe("2026");
    });

    it("releases a removed target and owns its page replacement", () => {
        const source = document.createElement("span");
        const first = document.createTextNode("1 hour ago");
        source.append(first);
        document.body.append(source);
        renderExactText(source, first, "2026");
        const second = document.createTextNode("page refreshed");
        source.replaceChildren(second);

        expect(renderExactText(source, second, "2027")).toBe(second);
        expect(first.data).toBe("1 hour ago");
        expect(getOwnedSourceForText(first)).toBeNull();
        restoreExactText(source);
        expect(second.data).toBe("page refreshed");
    });

    it("returns only owned sources containing a changed child-list target", () => {
        const source = document.createElement("span");
        const link = document.createElement("a");
        const target = document.createTextNode("1 hour ago");
        link.append(target);
        source.append(link);
        document.body.append(source);
        renderExactText(source, target, "2026");

        expect(getOwnedTextSourcesContainingNode(link)).toEqual([source]);
        expect(getOwnedTextSourcesContainingNode(document.body)).toEqual([]);
    });
});
