/**
 * @file Exercises mutation batching, ownership restoration, and scheduler lifecycle.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
    DocumentMutationScheduler,
    type AffectedMutationBatch,
} from "../../../../src/content-script/transformation/document-mutation-scheduler";
import {
    renderExactTime,
    restoreExactTime,
} from "../../../../src/content-script/transformation/render-exact-time";
import {
    renderExactText,
    restoreExactText,
} from "../../../../src/content-script/transformation/render-exact-text";
import {
    TIMESTAMP_SOURCE_ATTRIBUTE,
} from "../../../../src/content-script/adapters/types";

/**
 * Callback accepted by the controllable MutationObserver test double.
 */
type ControllableMutationCallback = (records: readonly MutationRecord[]) => void;

/**
 * Replaces MutationObserver with a controllable lifecycle double.
 *
 * @returns - Callbacks in observer-construction order.
 */
function stubControllableMutationObserver(): ControllableMutationCallback[] {
    const callbacks: ControllableMutationCallback[] = [];

    /**
     * MutationObserver double that exposes lifecycle callbacks to tests.
     */
    class ControllableObserver {
        /**
         * Captures a callback for manual delivery.
         *
         * @param callback - Mutation callback registered by the scheduler.
         */
        constructor(callback: ControllableMutationCallback) {
            callbacks.push(callback);
        }

        /**
         * Accepts observation requests without installing a native observer.
         */
        observe(): void {}

        /**
         * Accepts disconnect requests while retaining callbacks for the test.
         */
        disconnect(): void {}

        /**
         * Returns no pending records.
         *
         * @returns - Empty pending record list.
         */
        takeRecords(): MutationRecord[] {
            return [];
        }
    }
    vi.stubGlobal("MutationObserver", ControllableObserver);
    return callbacks;
}

const flushMutations = async (): Promise<void> => {
    await Promise.resolve();
    await Promise.resolve();
};

describe("DocumentMutationScheduler", () => {
    beforeEach(() => {
        document.body.innerHTML = "";
    });

    it("coalesces overlapping additions and datetime targets without a document root", async () => {
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.start();
        scheduler.start();

        const wrapper = document.createElement("section");
        const source = document.createElement("relative-time");
        wrapper.append(source);
        document.body.append(wrapper);
        source.setAttribute("datetime", "2026-08-23T10:15:00Z");
        source.setAttribute("datetime", "2026-08-24T10:15:00Z");
        await flushMutations();

        expect(batches).toHaveLength(1);
        expect(batches[0]?.addedRoots).toEqual([wrapper]);
        expect(batches[0]?.sourceTargets).toEqual([]);
        expect(batches[0]?.removedRoots).toEqual([]);
        scheduler.stop();
    });

    it("normalizes nested and sibling roots from one delivery and ignores text work", () => {
        const callbacks = stubControllableMutationObserver();
        try {
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null,
            });
            scheduler.start();
            const outer = document.createElement("section");
            const nested = document.createElement("article");
            const sibling = document.createElement("aside");
            outer.append(nested);
            const removedOuter = document.createElement("div");
            const removedNested = document.createElement("span");
            removedOuter.append(removedNested);
            callbacks[0]?.([
                {
                    type: "childList",
                    target: document.body,
                    addedNodes: [outer, nested, sibling],
                    removedNodes: [removedOuter, removedNested, document.createTextNode("ignored")],
                } as unknown as MutationRecord,
                {
                    type: "characterData",
                    target: document.createTextNode("unrelated"),
                    addedNodes: [],
                    removedNodes: [],
                } as unknown as MutationRecord,
            ]);
            expect(batches).toHaveLength(1);
            expect(batches[0]?.addedRoots).toEqual([outer, sibling]);
            expect(batches[0]?.removedRoots).toEqual([removedOuter]);
            expect(batches[0]?.sourceTargets).toEqual([]);
            expect(batches[0]?.displacedOutputSources).toEqual([]);
            scheduler.stop();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("starts one observer with the exact bounded options and stays idle after stop", () => {
        const observe = vi.spyOn(MutationObserver.prototype, "observe");
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: () => undefined,
            getOwnedSourceForOutput: () => null,
            sourceAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
        });
        scheduler.start();
        scheduler.start();
        expect(observe).toHaveBeenCalledTimes(1);
        expect(observe).toHaveBeenCalledWith(document, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: [
                "datetime",
                "hidden",
                "aria-hidden",
                "inert",
                "style",
                "class",
            ],
            attributeOldValue: true,
        });
        scheduler.stop();
        document.body.append(document.createElement("section"));
        expect(observe).toHaveBeenCalledTimes(1);
        observe.mockRestore();
    });

    it("does not emit a batch for unrelated attributes or text nodes", async () => {
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.start();
        const unrelated = document.createElement("div");
        document.body.append(unrelated);
        await flushMutations();
        batches.length = 0;
        unrelated.setAttribute("class", "page-owned");
        unrelated.append(document.createTextNode("page text"));
        await flushMutations();
        expect(batches).toEqual([]);
        scheduler.stop();
    });

    it("observes page text only beneath an owned in-place source", async () => {
        document.body.innerHTML = `<span id="age"><a>1 hour ago</a></span>
            <p id="unrelated">unrelated</p>`;
        const source = document.getElementById("age");
        const target = source?.querySelector("a")?.firstChild;
        const unrelated = document.getElementById("unrelated")?.firstChild;
        if (!source || !(target instanceof Text) || !(unrelated instanceof Text)) {
            throw new Error("Expected owned and unrelated text");
        }
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.start();
        renderExactText(source, target, "2026", scheduler);
        await flushMutations();
        expect(batches).toEqual([]);

        unrelated.data = "unrelated changed";
        await flushMutations();
        expect(batches).toEqual([]);

        target.data = "page refreshed";
        await flushMutations();
        expect(batches).toHaveLength(1);
        expect(batches[0]?.sourceTargets).toEqual([source]);
        scheduler.stop();
        restoreExactText(source);
        expect(target.data).toBe("page refreshed");
    });

    it("stops character-data observation after an in-place source is released", async () => {
        const NativeObserver = MutationObserver;
        let characterDataDeliveries = 0;

        /**
         * Native observer wrapper that counts character-data deliveries.
         */
        class CharacterDataCountingObserver extends NativeObserver {
            /**
             * Counts native deliveries that contain character-data records.
             *
             * @param callback - Scheduler callback wrapped by the test observer.
             */
            constructor(callback: MutationCallback) {
                super((records, observer) => {
                    if (records.some((record) => record.type === "characterData")) {
                        characterDataDeliveries += 1;
                    }
                    callback(records, observer);
                });
            }
        }
        vi.stubGlobal("MutationObserver", CharacterDataCountingObserver);
        try {
            const firstSource = document.createElement("span");
            const firstTarget = document.createTextNode("first relative");
            const secondSource = document.createElement("span");
            const secondTarget = document.createTextNode("second relative");
            firstSource.append(firstTarget);
            secondSource.append(secondTarget);
            document.body.append(firstSource, secondSource);
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null,
            });
            scheduler.start();
            renderExactText(firstSource, firstTarget, "2026", scheduler);
            renderExactText(secondSource, secondTarget, "2027", scheduler);
            await flushMutations();
            characterDataDeliveries = 0;
            batches.length = 0;

            restoreExactText(firstSource, scheduler);
            firstTarget.data = "released page text";
            await flushMutations();
            expect(characterDataDeliveries).toBe(0);
            expect(batches).toEqual([]);

            secondTarget.data = "active page text";
            await flushMutations();
            expect(characterDataDeliveries).toBe(1);
            expect(batches[0]?.sourceTargets).toEqual([secondSource]);
            scheduler.stop();
            restoreExactText(secondSource);
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("captures an undelivered same-value page write before stopping", async () => {
        const source = document.createElement("span");
        const target = document.createTextNode("1 hour ago");
        source.append(target);
        document.body.append(source);
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: () => undefined,
            getOwnedSourceForOutput: () => null,
        });
        scheduler.start();
        renderExactText(source, target, "2026", scheduler);
        await flushMutations();

        target.data = "2026";
        scheduler.stop();
        restoreExactText(source);

        expect(target.data).toBe("2026");
    });

    it("ignores unrelated class/style changes and detached tracked sources", async () => {
        const wrapper = document.createElement("section");
        const source = document.createElement("time");
        const unrelated = document.createElement("aside");
        wrapper.append(source, unrelated);
        document.body.append(wrapper);
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.trackSource(source);
        scheduler.start();
        unrelated.classList.add("page-owned");
        unrelated.style.display = "block";
        await flushMutations();
        expect(batches).toEqual([]);

        source.remove();
        await flushMutations();
        batches.length = 0;
        wrapper.classList.add("page-hidden");
        wrapper.style.display = "block";
        await flushMutations();
        expect(batches).toEqual([]);
        scheduler.stop();
    });

    it("collapses nested visibility roots to their nearest common root", async () => {
        document.body.innerHTML = '<section><time datetime="2026-08-23T10:15Z">time</time>'
            + "</section>";
        const section = document.querySelector("section");
        const source = document.querySelector("time");
        if (!section || !source) {
            throw new Error("Expected visibility roots");
        }
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.trackSource(source);
        scheduler.start();
        section.setAttribute("aria-hidden", "true");
        source.setAttribute("inert", "");
        await flushMutations();
        expect(batches).toHaveLength(1);
        expect(batches[0]?.visibilityRoots).toEqual([source]);
        scheduler.stop();
    });

    it("routes an exact output displacement to its recorded source", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) {
            throw new Error("Expected output");
        }
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: (node) => (node === output ? source : null),
        });
        scheduler.start();
        output.remove();
        await flushMutations();
        expect(batches).toHaveLength(1);
        expect(batches[0]?.displacedOutputSources).toEqual([source]);
        expect(batches[0]?.addedRoots).toEqual([]);
        expect(batches[0]?.removedRoots).toEqual([]);
        scheduler.stop();
    });

    it("emits no work when output is displaced and restored before delivery", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) {
            throw new Error("Expected output");
        }
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: (node) => (node === output ? source : null),
        });
        scheduler.start();
        output.remove();
        source.after(output);
        await flushMutations();
        expect(batches).toEqual([]);
        scheduler.stop();
    });

    it("suppresses the observer delivery caused by owned restoration", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) {
            throw new Error("Expected output");
        }
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.start();
        restoreExactTime(source, scheduler);
        await flushMutations();
        expect(batches).toEqual([]);
        expect(output.isConnected).toBe(false);
        scheduler.stop();
    });

    it("receives one raw suppressed removal without a public batch", async () => {
        const NativeObserver = MutationObserver;
        let rawDeliveries = 0;

        /**
         * Native MutationObserver wrapper that counts raw deliveries.
         */
        class CountingObserver extends NativeObserver {
            /**
             * Wraps the scheduler callback with delivery counting.
             *
             * @param callback - Native mutation callback registered by the scheduler.
             */
            constructor(callback: MutationCallback) {
                super((records, observer) => {
                    rawDeliveries += 1;
                    callback(records, observer);
                });
            }
        }
        vi.stubGlobal("MutationObserver", CountingObserver);
        try {
            document.body.innerHTML =
                '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
            const source = document.querySelector("relative-time");
            if (!source) {
                throw new Error("Expected source");
            }
            const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
            if (!output) {
                throw new Error("Expected output");
            }
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null,
            });
            scheduler.start();
            restoreExactTime(source, scheduler);
            await flushMutations();
            expect(rawDeliveries).toBe(1);
            expect(batches).toEqual([]);
            scheduler.stop();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("ignores a child-list record targeted at an exact owned output", async () => {
        document.body.innerHTML =
            '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) {
            throw new Error("Expected source");
        }
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) {
            throw new Error("Expected output");
        }
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: (node) => (node === output ? source : null),
        });
        scheduler.start();
        output.append(document.createElement("relative-time"));
        await flushMutations();
        expect(batches).toEqual([]);
        scheduler.stop();
    });

    it("treats marker-shaped foreign output as ordinary page content", async () => {
        const forged = document.createElement("time");
        forged.setAttribute("data-no-more-ago-output", "forged");
        document.body.append(forged);
        const nested = document.createElement("relative-time");
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null,
        });
        scheduler.start();
        forged.append(nested);
        await flushMutations();
        expect(batches).toHaveLength(1);
        expect(batches[0]?.addedRoots).toEqual([nested]);
        expect(forged.getAttribute("data-no-more-ago-output")).toBe("forged");
        expect(forged.textContent).toBe("");
        scheduler.stop();
    });

    it("rejects a queued callback from a stopped lifecycle after restart", () => {
        const callbacks = stubControllableMutationObserver();
        try {
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null,
            });
            scheduler.start();
            scheduler.stop();
            scheduler.start();
            const candidate = document.createElement("relative-time");
            const record = {
                type: "childList",
                target: document.body,
                addedNodes: [candidate],
                removedNodes: [],
            } as unknown as MutationRecord;
            callbacks[0]?.([record]);
            expect(batches).toEqual([]);
            callbacks[1]?.([record]);
            expect(batches).toHaveLength(1);
            expect(batches[0]?.addedRoots).toEqual([candidate]);
            scheduler.stop();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("does not carry a suppression identity into a restarted lifecycle", () => {
        const callbacks = stubControllableMutationObserver();
        try {
            document.body.innerHTML =
                '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
            const source = document.querySelector("relative-time");
            if (!source) {
                throw new Error("Expected source");
            }
            const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
            if (!output) {
                throw new Error("Expected output");
            }
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: (node) => (node === output ? source : null),
            });
            scheduler.start();
            scheduler.beforeOwnedOutputRemoval(output);
            scheduler.stop();
            scheduler.start();
            output.remove();
            callbacks[1]?.([
                {
                    type: "childList",
                    target: source.parentNode,
                    addedNodes: [],
                    removedNodes: [output],
                } as unknown as MutationRecord,
            ]);
            expect(batches).toHaveLength(1);
            expect(batches[0]?.displacedOutputSources).toEqual([source]);
            scheduler.stop();
        } finally {
            vi.unstubAllGlobals();
        }
    });

    it("does not schedule work for active idle fake-timer advancement", () => {
        vi.useFakeTimers();
        try {
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null,
            });
            scheduler.start();
            vi.advanceTimersByTime(60_000);
            expect(batches).toEqual([]);
            scheduler.stop();
        } finally {
            vi.useRealTimers();
        }
    });
});
