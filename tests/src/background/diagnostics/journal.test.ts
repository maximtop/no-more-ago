/**
 * @file Verifies the diagnostic journal's observable persistence policy.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import {
    DIAGNOSTICS_MAX_BYTES,
    DIAGNOSTICS_STORAGE_KEY,
    DiagnosticJournal,
    type DiagnosticStorage,
} from '../../../../src/background/diagnostics/journal';
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from '../../../../src/shared/diagnostics/contracts';
import { DIAGNOSTICS_ERROR } from '../../../../src/shared/messaging/contracts';

import type { DiagnosticEvent } from '../../../../src/shared/diagnostics/events';

const event = (timestamp: number): DiagnosticEvent => ({
    category: 'mutation',
    timestamp,
    hostname: 'github.com',
    pageCategory: 'repository',
    incognito: false,
    count: timestamp,
});

const failedTimestampEvent = (timestamp: number): DiagnosticEvent => ({
    category: DIAGNOSTIC_CATEGORY.SKIP,
    timestamp,
    hostname: 'web.telegram.org',
    pageCategory: 'other',
    incognito: false,
    reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
    sourceTimestamp: '123456789',
});

/**
 * Creates an observable in-memory storage implementation.
 *
 * @param initial - Initial diagnostic envelope.
 *
 * @returns - Storage implementation and its current value.
 */
function createStorage(initial?: unknown): DiagnosticStorage & {
    readonly calls: string[];
    readonly value: unknown;
} {
    const state = { value: initial, calls: [] as string[] };
    return {
        get: vi.fn(() => {
            state.calls.push('get');
            return Promise.resolve(state.value === undefined
                ? {}
                : { [DIAGNOSTICS_STORAGE_KEY]: state.value });
        }),
        set: vi.fn((items: Record<string, unknown>) => {
            state.calls.push('set');
            state.value = items[DIAGNOSTICS_STORAGE_KEY];
            return Promise.resolve();
        }),
        remove: vi.fn(() => {
            state.calls.push('remove');
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

describe('DiagnosticJournal', () => {
    it('uses the agreed five-megabyte storage limit', () => {
        expect(DIAGNOSTICS_MAX_BYTES).toBe(5_000_000);
    });

    it('writes only while enabled and deletes entries when disabled', async () => {
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

    it('keeps ordered entries within the serialized byte limit', async () => {
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

    it('round-trips bounded invalid timestamp evidence through snapshots', async () => {
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

    it('clears entries without disabling future collection', async () => {
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

    it('does not restore a pending entry after logging is disabled', async () => {
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

    it.each([0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY])('rejects the size limit %s', (limit) => {
        expect(() => new DiagnosticJournal(createStorage(), limit)).toThrow('Invalid diagnostics limit');
    });

    it('writes nothing when the event alone exceeds the size limit', async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage, 10);
        await journal.setEnabled(true);
        await journal.append(event(1));
        expect(storage.set).not.toHaveBeenCalled();
    });

    it('contains a failed read while appending and keeps accepting events', async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        vi.mocked(storage.get).mockRejectedValueOnce(new Error('storage down'));
        await expect(journal.append(event(1))).resolves.toBeUndefined();
        expect(storage.set).not.toHaveBeenCalled();
        await journal.append(event(2));
        expect(storage.value).toEqual({ entries: [event(2)] });
    });

    it('contains a failed write while appending and keeps accepting events', async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        vi.mocked(storage.set).mockRejectedValueOnce(new Error('quota exceeded'));
        await expect(journal.append(event(1))).resolves.toBeUndefined();
        expect(storage.value).toBeUndefined();
        await journal.append(event(2));
        expect(storage.value).toEqual({ entries: [event(2)] });
    });

    it('contains a failed removal when disabling or clearing', async () => {
        const storage = createStorage({ entries: [event(1)] });
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        vi.mocked(storage.remove).mockRejectedValue(new Error('storage down'));
        await expect(journal.setEnabled(false)).resolves.toBeUndefined();
        expect(journal.enabled).toBe(false);
        await expect(journal.clear()).resolves.toBeUndefined();
        expect(journal.enabled).toBe(false);
    });

    it('stops collecting and removes entries on clear', async () => {
        const storage = createStorage();
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        await journal.append(event(1));
        await journal.clear();
        expect(journal.enabled).toBe(false);
        expect(storage.value).toBeUndefined();
        await journal.append(event(2));
        expect(storage.value).toBeUndefined();
    });

    it('answers snapshot reads by policy and storage state', async () => {
        const storage = createStorage({ entries: [event(1)] });
        const journal = new DiagnosticJournal(storage);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.DISABLED });
        expect(storage.get).not.toHaveBeenCalled();

        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: true, entries: [event(1)] });

        vi.mocked(storage.get).mockRejectedValueOnce(new Error('storage down'));
        await expect(journal.readSnapshot()).resolves.toEqual({
            ok: false, error: DIAGNOSTICS_ERROR.STORAGE_FAILED,
        });
    });

    it.each([
        ['no stored envelope', undefined],
        ['an empty stored journal', { entries: [] }],
    ])('reports an empty journal for %s', async (_name, initial) => {
        const journal = new DiagnosticJournal(createStorage(initial));
        await journal.setEnabled(true);
        await expect(journal.readSnapshot()).resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.EMPTY });
        await expect(journal.readStored()).resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.EMPTY });
    });

    it('reads retained entries for recovery views even while collection is off', async () => {
        const storage = createStorage({ entries: [event(1), event(2)] });
        const journal = new DiagnosticJournal(storage);
        expect(journal.enabled).toBe(false);
        await expect(journal.readStored()).resolves.toEqual({ ok: true, entries: [event(1), event(2)] });
        vi.mocked(storage.get).mockRejectedValueOnce(new Error('storage down'));
        await expect(journal.readStored()).resolves.toEqual({
            ok: false, error: DIAGNOSTICS_ERROR.STORAGE_FAILED,
        });
    });

    it('drops a snapshot read that was queued before logging was disabled', async () => {
        const storage = createStorage({ entries: [event(1)] });
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        let release: (() => void) | undefined;
        const gate = new Promise<void>((resolve) => {
            release = resolve;
        });
        vi.mocked(storage.get).mockImplementationOnce(async () => {
            await gate;
            return {};
        });
        const blocker = journal.append(event(2));
        const snapshot = journal.readSnapshot();
        const disabled = journal.setEnabled(false);
        release?.();
        await Promise.all([blocker, disabled]);
        await expect(snapshot).resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.DISABLED });
    });

    it('answers clearEntries by policy and storage state', async () => {
        const storage = createStorage({ entries: [event(1)] });
        const journal = new DiagnosticJournal(storage);
        await expect(journal.clearEntries()).resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.DISABLED });
        expect(storage.remove).not.toHaveBeenCalled();
        expect(storage.value).toEqual({ entries: [event(1)] });

        await journal.setEnabled(true);
        vi.mocked(storage.remove).mockRejectedValueOnce(new Error('storage down'));
        await expect(journal.clearEntries()).resolves.toEqual({
            ok: false, error: DIAGNOSTICS_ERROR.STORAGE_FAILED,
        });
        expect(journal.enabled).toBe(true);
        expect(storage.value).toEqual({ entries: [event(1)] });
    });

    it('leaves nothing behind for an append queued before clearEntries, and accepts later ones', async () => {
        const storage = createStorage({ entries: [event(1)] });
        const journal = new DiagnosticJournal(storage);
        await journal.setEnabled(true);
        const pending = journal.append(event(2));
        const cleared = journal.clearEntries();
        await Promise.all([pending, cleared]);
        expect(storage.value).toBeUndefined();
        await journal.append(event(3));
        expect(storage.value).toEqual({ entries: [event(3)] });
    });
});
