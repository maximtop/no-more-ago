/**
 * @file Verifies the diagnostic journal's observable persistence policy.
 */

import { describe, expect, it, vi } from "vitest";
import type { DiagnosticEvent } from "../../../../src/shared/diagnostics/events";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../../../src/shared/diagnostics/contracts";
import {
    DIAGNOSTICS_MAX_BYTES,
    DIAGNOSTICS_STORAGE_KEY,
    DiagnosticJournal,
    type DiagnosticStorage,
} from "../../../../src/background/diagnostics/journal";

const event = (timestamp: number): DiagnosticEvent => ({
    category: "mutation",
    timestamp,
    hostname: "github.com",
    pageCategory: "repository",
    incognito: false,
    count: timestamp,
});

const failedTimestampEvent = (timestamp: number): DiagnosticEvent => ({
    category: DIAGNOSTIC_CATEGORY.SKIP,
    timestamp,
    hostname: "web.telegram.org",
    pageCategory: "other",
    incognito: false,
    reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
    sourceTimestamp: "123456789",
});

/**
 * Creates an observable in-memory storage implementation.
 *
 * @param initial - Initial diagnostic envelope.
 * @returns - Storage implementation and its current value.
 */
function createStorage(initial?: unknown): DiagnosticStorage & {
    readonly calls: string[];
    readonly value: unknown;
} {
    const state = { value: initial, calls: [] as string[] };
    return {
        get: vi.fn(() => {
            state.calls.push("get");
            return Promise.resolve(state.value === undefined
                ? {}
                : { [DIAGNOSTICS_STORAGE_KEY]: state.value });
        }),
        set: vi.fn((items: Record<string, unknown>) => {
            state.calls.push("set");
            state.value = items[DIAGNOSTICS_STORAGE_KEY];
            return Promise.resolve();
        }),
        remove: vi.fn(() => {
            state.calls.push("remove");
            state.value = undefined;
            return Promise.resolve();
        }),
        get calls() {
            return state.calls;
        },
        get value() {
            return state.value;
        },
    };
}

describe("DiagnosticJournal", () => {
    it("uses the agreed five-megabyte storage limit", () => {
        expect(DIAGNOSTICS_MAX_BYTES).toBe(5_000_000);
    });

    it("writes only while enabled and deletes entries when disabled", async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage);
        await journal.append(event(1));
        expect(storage.calls).toEqual([]);
        await journal.setEnabled(true);
        await journal.append(event(1));
        expect(storage.value).toEqual({ entries: [event(1)] });
        await journal.setEnabled(false);
        expect(storage.value).toBeUndefined();
    });

    it("keeps ordered entries within the serialized byte limit", async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage, 250);
        await journal.setEnabled(true);
        await Promise.all([
            journal.append(event(1)),
            journal.append(event(2)),
            journal.append(event(3)),
        ]);
        const envelope = storage.value as { readonly entries: readonly DiagnosticEvent[] };
        expect(envelope.entries.at(-1)).toEqual(event(3));
        expect(new TextEncoder().encode(JSON.stringify(envelope)).byteLength)
            .toBeLessThanOrEqual(250);
    });

    it("round-trips bounded invalid timestamp evidence through snapshots", async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage);
        const failed = failedTimestampEvent(2);
        await journal.setEnabled(true);
        await journal.append(failed);

        await expect(journal.readSnapshot()).resolves.toEqual({
            ok: true,
            entries: [failed],
        });
    });

    it("validates stored data once when a snapshot is read", async () => {
        const journal = new DiagnosticJournal(createStorage({
            entries: [{ ...event(1), currentUrl: "https://github.com/private" }],
        }));
        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({
            ok: false,
            error: "invalid-journal",
        });
    });

    it("clears entries without disabling future collection", async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        await journal.append(event(1));
        await expect(journal.clearEntries()).resolves.toEqual({ ok: true });
        expect(journal.enabled).toBe(true);
        await journal.append(event(2));
        await expect(journal.readSnapshot()).resolves.toEqual({
            ok: true,
            entries: [event(2)],
        });
    });

    it("does not restore a pending entry after logging is disabled", async () => {
        const storage = createStorage();
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        storage.get = vi.fn(async () => {
            await gate;
            return {};
        });
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        const pending = journal.append(event(1));
        const disabled = journal.setEnabled(false);
        release?.();
        await Promise.all([pending, disabled]);
        expect(storage.value).toBeUndefined();
    });
});
