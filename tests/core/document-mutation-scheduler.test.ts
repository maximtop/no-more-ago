import { beforeEach, describe, expect, it, vi } from "vitest";

import { DocumentMutationScheduler, type AffectedMutationBatch } from "../../src/core/document-mutation-scheduler";
import { renderExactTime, restoreExactTime } from "../../src/core/render-exact-time";

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
            getOwnedSourceForOutput: () => null
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
        expect(batches[0]?.datetimeTargets).toEqual([]);
        expect(batches[0]?.removedRoots).toEqual([]);
        scheduler.stop();
    });

    it("normalizes nested and sibling roots from one delivery and ignores text work", () => {
        type Callback = (records: readonly MutationRecord[]) => void;
        const callbacks: Callback[] = [];
        class ControllableObserver {
            constructor(callback: Callback) { callbacks.push(callback); }
            observe(): void {}
            disconnect(): void {}
        }
        vi.stubGlobal("MutationObserver", ControllableObserver);
        try {
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null
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
                    removedNodes: [removedOuter, removedNested, document.createTextNode("ignored")]
                } as unknown as MutationRecord,
                {
                    type: "characterData",
                    target: document.createTextNode("unrelated"),
                    addedNodes: [],
                    removedNodes: []
                } as unknown as MutationRecord
            ]);
            expect(batches).toHaveLength(1);
            expect(batches[0]?.addedRoots).toEqual([outer, sibling]);
            expect(batches[0]?.removedRoots).toEqual([removedOuter]);
            expect(batches[0]?.datetimeTargets).toEqual([]);
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
            getOwnedSourceForOutput: () => null
        });
        scheduler.start();
        scheduler.start();
        expect(observe).toHaveBeenCalledTimes(1);
        expect(observe).toHaveBeenCalledWith(document, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ["datetime"]
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
            getOwnedSourceForOutput: () => null
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

    it("routes an exact output displacement to its recorded source", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) throw new Error("Expected source");
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) throw new Error("Expected output");
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: (node) => node === output ? source : null
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

    it("does not emit work when an exact output is displaced and restored before delivery", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) throw new Error("Expected source");
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) throw new Error("Expected output");
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: (node) => node === output ? source : null
        });
        scheduler.start();
        output.remove();
        source.after(output);
        await flushMutations();
        expect(batches).toEqual([]);
        scheduler.stop();
    });

    it("suppresses the observer delivery caused by owned restoration", async () => {
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) throw new Error("Expected source");
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) throw new Error("Expected output");
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: () => null
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
        class CountingObserver extends NativeObserver {
            constructor(callback: MutationCallback) {
                super((records, observer) => {
                    rawDeliveries += 1;
                    callback(records, observer);
                });
            }
        }
        vi.stubGlobal("MutationObserver", CountingObserver);
        try {
            document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
            const source = document.querySelector("relative-time");
            if (!source) throw new Error("Expected source");
            const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
            if (!output) throw new Error("Expected output");
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null
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
        document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
        const source = document.querySelector("relative-time");
        if (!source) throw new Error("Expected source");
        const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
        if (!output) throw new Error("Expected output");
        const batches: AffectedMutationBatch[] = [];
        const scheduler = new DocumentMutationScheduler({
            document,
            onBatch: (batch) => batches.push(batch),
            getOwnedSourceForOutput: (node) => node === output ? source : null
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
            getOwnedSourceForOutput: () => null
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
        type Callback = (records: readonly MutationRecord[]) => void;
        const callbacks: Callback[] = [];
        class ControllableObserver {
            constructor(callback: Callback) {
                callbacks.push(callback);
            }
            observe(): void {}
            disconnect(): void {}
        }
        vi.stubGlobal("MutationObserver", ControllableObserver);
        try {
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: () => null
            });
            scheduler.start();
            scheduler.stop();
            scheduler.start();
            const candidate = document.createElement("relative-time");
            const record = {
                type: "childList",
                target: document.body,
                addedNodes: [candidate],
                removedNodes: []
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
        type Callback = (records: readonly MutationRecord[]) => void;
        const callbacks: Callback[] = [];
        class ControllableObserver {
            constructor(callback: Callback) { callbacks.push(callback); }
            observe(): void {}
            disconnect(): void {}
        }
        vi.stubGlobal("MutationObserver", ControllableObserver);
        try {
            document.body.innerHTML = '<relative-time datetime="2026-08-23T10:15:00Z">ago</relative-time>';
            const source = document.querySelector("relative-time");
            if (!source) throw new Error("Expected source");
            const output = renderExactTime(source, "2026-08-23T10:15:00Z", "exact");
            if (!output) throw new Error("Expected output");
            const batches: AffectedMutationBatch[] = [];
            const scheduler = new DocumentMutationScheduler({
                document,
                onBatch: (batch) => batches.push(batch),
                getOwnedSourceForOutput: (node) => node === output ? source : null
            });
            scheduler.start();
            scheduler.beforeOwnedOutputRemoval(output);
            scheduler.stop();
            scheduler.start();
            output.remove();
            callbacks[1]?.([{
                type: "childList",
                target: source.parentNode,
                addedNodes: [],
                removedNodes: [output]
            } as unknown as MutationRecord]);
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
                getOwnedSourceForOutput: () => null
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
