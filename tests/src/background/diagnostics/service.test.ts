/**
 * @file Verifies top-level authorization for frame diagnostics.
 */

import {
    describe, expect, it, vi,
} from 'vitest';

import { DiagnosticsService } from '../../../../src/background/diagnostics/service';
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from '../../../../src/shared/diagnostics/contracts';
import { DIAGNOSTICS_ERROR } from '../../../../src/shared/messaging/contracts';
import { SITE_SCOPE_MODE } from '../../../../src/shared/settings/site-scope';
import { createSettingsSnapshot } from '../../../../src/shared/settings/snapshot';

import type { ApplicationStateView } from '../../../../src/background/application/state';
import type {
    DiagnosticJournal,
    DiagnosticJournalStore,
} from '../../../../src/background/diagnostics/journal';
import type { DiagnosticEvent } from '../../../../src/shared/diagnostics/events';

/**
 * Creates a diagnostics service and observable journal.
 *
 * @param excludedSites - Top-level hostnames excluded from processing.
 *
 * @returns - Service, state, and journal append spy.
 */
function fixture(excludedSites: readonly string[] = []) {
    const append = vi.fn(async () => undefined);
    const journal = { append } as unknown as DiagnosticJournal;
    const service = new DiagnosticsService(journal, { browserFamily: 'other' });
    const snapshot = createSettingsSnapshot({
        revision: 1,
        globalEnabled: true,
        siteScope: { mode: SITE_SCOPE_MODE.ALL_EXCEPT_EXCLUDED, excludedSites, allowedSites: [] },
        debugEnabled: true,
    });
    const state = { phase: 'ready' as const, snapshot, failure: undefined };
    return { append, service, state };
}

describe('DiagnosticsService frame authorization', () => {
    it('accepts a child frame using the top-level tab policy', async () => {
        const fixtureValue = fixture();
        const accepted = await fixtureValue.service.record(
            { category: 'timing', count: 1 },
            {
                url: 'https://frame.example/path',
                tab: { url: 'https://top.example/path', incognito: false },
            },
            fixtureValue.state,
        );

        expect(accepted).toBe(true);
        expect(fixtureValue.append).toHaveBeenCalledTimes(1);
        expect(fixtureValue.append).toHaveBeenCalledWith(
            expect.objectContaining({ hostname: 'frame.example' }),
        );
    });

    it('rejects frames when the top-level site is disabled', async () => {
        const fixtureValue = fixture(['top.example']);
        const accepted = await fixtureValue.service.record(
            { category: 'timing', count: 1 },
            {
                url: 'https://frame.example/path',
                tab: { url: 'https://top.example/path' },
            },
            fixtureValue.state,
        );

        expect(accepted).toBe(false);
        expect(fixtureValue.append).not.toHaveBeenCalled();
    });

    it('passes sanitized invalid timestamp evidence to the enabled journal', async () => {
        const fixtureValue = fixture();
        const accepted = await fixtureValue.service.record(
            {
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                count: 1,
                sourceTimestamp: '123456789',
            },
            {
                url: 'https://web.telegram.org/k/?private=query#fragment',
                tab: { url: 'https://web.telegram.org/k/', incognito: false },
            },
            fixtureValue.state,
        );

        expect(accepted).toBe(true);
        expect(fixtureValue.append).toHaveBeenCalledWith(expect.objectContaining({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
            hostname: 'web.telegram.org',
            sourceTimestamp: '123456789',
        }));
        expect(JSON.stringify(fixtureValue.append.mock.calls))
            .not.toMatch(/private|query|fragment/u);
    });
});

describe('DiagnosticsService recovery reads', () => {
    it('reads retained entries while settings are unavailable', async () => {
        const entries = [{
            category: 'lifecycle',
            timestamp: 1,
            hostname: 'github.com',
            pageCategory: 'repository',
            incognito: false,
        }];
        const readSnapshot = vi.fn(async () => ({ ok: false, error: 'disabled' } as const));
        const readStored = vi.fn(async () => ({ ok: true, entries } as const));
        const journal = { readSnapshot, readStored } as unknown as DiagnosticJournal;
        const service = new DiagnosticsService(journal, { browserFamily: 'other' });

        await expect(service.readSnapshot({
            phase: 'failed-closed' as const,
            snapshot: undefined,
            failure: 'settings-load',
        })).resolves.toMatchObject({ ok: true, snapshot: { entries } });
        expect(readSnapshot).not.toHaveBeenCalled();
    });

    it('still reports disabled logging while settings are available', async () => {
        const readStored = vi.fn();
        const journal = { readSnapshot: vi.fn(), readStored } as unknown as DiagnosticJournal;
        const service = new DiagnosticsService(journal, { browserFamily: 'other' });
        const snapshot = createSettingsSnapshot({ revision: 1, globalEnabled: true });

        await expect(
            service.readSnapshot({ phase: 'ready' as const, snapshot, failure: undefined }),
        ).resolves.toEqual({ ok: false, error: 'disabled' });
        expect(readStored).not.toHaveBeenCalled();
    });
});

/**
 * Creates a typed in-memory journal that records what the service asks of it.
 *
 * @param overrides - Behavior a test needs to replace.
 *
 * @returns - Journal store with its appended events.
 */
function fakeJournal(overrides: Partial<DiagnosticJournalStore> = {}): DiagnosticJournalStore & {
    readonly appended: DiagnosticEvent[];
} {
    const appended: DiagnosticEvent[] = [];
    return {
        appended,
        setEnabled: () => Promise.resolve(),
        append: (event) => {
            appended.push(event);
            return Promise.resolve();
        },
        clear: () => Promise.resolve(),
        readSnapshot: () => Promise.resolve({ ok: false, error: DIAGNOSTICS_ERROR.EMPTY }),
        readStored: () => Promise.resolve({ ok: false, error: DIAGNOSTICS_ERROR.EMPTY }),
        clearEntries: () => Promise.resolve({ ok: true }),
        ...overrides,
    };
}

/**
 * Builds a lifecycle state around a settings snapshot.
 *
 * @param overrides - Snapshot fields and lifecycle phase.
 * @param overrides.debugEnabled - Whether diagnostic collection is on.
 * @param overrides.globalEnabled - Whether the extension is on.
 * @param overrides.phase - Lifecycle phase.
 *
 * @returns - State view.
 */
function stateOf(overrides: {
    readonly debugEnabled?: boolean;
    readonly globalEnabled?: boolean;
    readonly phase?: ApplicationStateView['phase'];
} = {}): ApplicationStateView {
    return {
        phase: overrides.phase ?? 'ready',
        snapshot: createSettingsSnapshot({
            revision: 4,
            globalEnabled: overrides.globalEnabled ?? true,
            debugEnabled: overrides.debugEnabled ?? true,
        }),
        failure: undefined,
    };
}

const failedClosed: ApplicationStateView = {
    phase: 'failed-closed',
    snapshot: undefined,
    failure: 'settings-load',
};

describe('DiagnosticsService debug state', () => {
    it('reports the persisted opt-in with its revision once ready', () => {
        const service = new DiagnosticsService(fakeJournal(), { browserFamily: 'other' });
        expect(service.debugState(stateOf({ debugEnabled: true })))
            .toEqual({ availability: 'ready', revision: 4, enabled: true });
        expect(service.debugState(stateOf({ debugEnabled: false })))
            .toEqual({ availability: 'ready', revision: 4, enabled: false });
    });

    it.each([
        ['while initializing', stateOf({ phase: 'initializing' })],
        ['after a failed-closed start', failedClosed],
    ])('reports unavailable %s', (_name, state) => {
        const service = new DiagnosticsService(fakeJournal(), { browserFamily: 'other' });
        expect(service.debugState(state)).toEqual({
            availability: 'unavailable',
            revision: null,
            enabled: null,
            failure: state.failure ?? 'settings-load',
        });
    });
});

describe('DiagnosticsService clearEntries', () => {
    it('delegates to the journal only when ready and collecting', async () => {
        const clearEntries = vi.fn(() => Promise.resolve({ ok: true } as const));
        const service = new DiagnosticsService(fakeJournal({ clearEntries }), { browserFamily: 'other' });
        await expect(service.clearEntries(stateOf())).resolves.toEqual({ ok: true });
        expect(clearEntries).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['settings are unavailable', failedClosed, DIAGNOSTICS_ERROR.UNAVAILABLE],
        ['the application is still starting', stateOf({ phase: 'initializing' }), DIAGNOSTICS_ERROR.UNAVAILABLE],
        ['collection is off', stateOf({ debugEnabled: false }), DIAGNOSTICS_ERROR.DISABLED],
    ])('refuses without touching the journal when %s', async (_name, state, error) => {
        const clearEntries = vi.fn(() => Promise.resolve({ ok: true } as const));
        const service = new DiagnosticsService(fakeJournal({ clearEntries }), { browserFamily: 'other' });
        await expect(service.clearEntries(state)).resolves.toEqual({ ok: false, error });
        expect(clearEntries).not.toHaveBeenCalled();
    });

    it('reports unavailable when no journal exists', async () => {
        const service = new DiagnosticsService(undefined, { browserFamily: 'other' });
        await expect(service.clearEntries(stateOf()))
            .resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.UNAVAILABLE });
        await expect(service.readSnapshot(stateOf()))
            .resolves.toEqual({ ok: false, error: DIAGNOSTICS_ERROR.UNAVAILABLE });
    });
});

describe('DiagnosticsService journal lifecycle', () => {
    it('forwards the collection policy and reset to the journal', async () => {
        const setEnabled = vi.fn(() => Promise.resolve());
        const clear = vi.fn(() => Promise.resolve());
        const service = new DiagnosticsService(fakeJournal({ setEnabled, clear }), { browserFamily: 'other' });
        await service.setEnabled(true);
        expect(setEnabled).toHaveBeenLastCalledWith(true);
        await service.setEnabled(false);
        expect(setEnabled).toHaveBeenLastCalledWith(false);
        await service.reset();
        expect(clear).toHaveBeenCalledTimes(1);
    });

    it('never lets a journal failure block enabling, disabling, or reset', async () => {
        const failing = fakeJournal({
            setEnabled: () => Promise.reject(new Error('storage down')),
            clear: () => Promise.reject(new Error('storage down')),
        });
        const service = new DiagnosticsService(failing, { browserFamily: 'other' });
        await expect(service.setEnabled(true)).resolves.toBeUndefined();
        await expect(service.reset()).resolves.toBeUndefined();
    });

    it('does nothing without a journal', async () => {
        const service = new DiagnosticsService(undefined, { browserFamily: 'other' });
        await expect(service.setEnabled(true)).resolves.toBeUndefined();
        await expect(service.reset()).resolves.toBeUndefined();
    });
});

describe('DiagnosticsService background logging', () => {
    it('records an internal event under the reserved hostname while collecting', () => {
        const journal = fakeJournal();
        new DiagnosticsService(journal, { browserFamily: 'chromium', extensionVersion: '1.2.3' })
            .log({ category: 'error', count: 1, reason: 'processing-failed' }, stateOf());
        expect(journal.appended).toEqual([expect.objectContaining({
            category: 'error',
            hostname: 'no-more-ago.invalid',
            pageCategory: 'other',
            incognito: false,
            reason: 'processing-failed',
            browserFamily: 'chromium',
            extensionVersion: '1.2.3',
        })]);
    });

    it.each([
        ['collection is off', stateOf({ debugEnabled: false })],
        ['settings never loaded', failedClosed],
    ])('records nothing when %s', (_name, state) => {
        const journal = fakeJournal();
        new DiagnosticsService(journal, { browserFamily: 'other' })
            .log({ category: 'error', count: 1, reason: 'processing-failed' }, state);
        expect(journal.appended).toEqual([]);
    });

    it('records nothing without a journal, and swallows an append failure', async () => {
        expect(() => new DiagnosticsService(undefined, { browserFamily: 'other' })
            .log({ category: 'error', count: 1 }, stateOf())).not.toThrow();
        const failing = fakeJournal({ append: () => Promise.reject(new Error('storage down')) });
        new DiagnosticsService(failing, { browserFamily: 'other' }).log({ category: 'error', count: 1 }, stateOf());
        await Promise.resolve();
    });
});

describe('DiagnosticsService document events', () => {
    const sender = { url: 'https://github.com/acme/project', tab: { url: 'https://github.com/acme/project' } };

    it('overwrites document-supplied environment fields with trusted ones', async () => {
        const journal = fakeJournal();
        const service = new DiagnosticsService(journal, { browserFamily: 'firefox', extensionVersion: '9.9.9' });
        await service.record({
            category: 'timing',
            count: 1,
            extensionVersion: '0.0.1',
            browserFamily: 'chromium',
        }, sender, stateOf());
        expect(journal.appended[0]).toMatchObject({ extensionVersion: '9.9.9', browserFamily: 'firefox' });
    });

    it('drops document-supplied environment fields when none are trusted', async () => {
        const journal = fakeJournal();
        const service = new DiagnosticsService(journal, undefined);
        await service.record({
            category: 'timing', count: 1, extensionVersion: '0.0.1', browserFamily: 'chromium',
        }, sender, stateOf());
        expect(journal.appended[0]).not.toHaveProperty('extensionVersion');
        expect(journal.appended[0]).not.toHaveProperty('browserFamily');
    });

    it('ignores a trusted version that is not a safe version string', async () => {
        const journal = fakeJournal();
        const service = new DiagnosticsService(journal, { browserFamily: 'other', extensionVersion: '1.0 <script>' });
        await service.record({ category: 'timing', count: 1 }, sender, stateOf());
        expect(journal.appended[0]).not.toHaveProperty('extensionVersion');
    });

    it.each([
        ['settings are not ready', stateOf({ phase: 'initializing' })],
        ['collection is off', stateOf({ debugEnabled: false })],
        ['the extension is globally off', stateOf({ globalEnabled: false })],
        ['settings failed to load', failedClosed],
    ])('does not record when %s', async (_name, state) => {
        const journal = fakeJournal();
        const service = new DiagnosticsService(journal, { browserFamily: 'other' });
        await expect(service.record({ category: 'timing', count: 1 }, sender, state)).resolves.toBe(false);
        expect(journal.appended).toEqual([]);
    });

    it('does not record when the sender has no top-level URL or the payload is invalid', async () => {
        const journal = fakeJournal();
        const service = new DiagnosticsService(journal, { browserFamily: 'other' });
        await expect(service.record({ category: 'timing', count: 1 }, { url: sender.url }, stateOf()))
            .resolves.toBe(false);
        await expect(service.record({ category: 'not-a-category' }, sender, stateOf())).resolves.toBe(false);
        expect(journal.appended).toEqual([]);
    });

    it('still reports acceptance when the journal write fails', async () => {
        const failing = fakeJournal({ append: () => Promise.reject(new Error('storage down')) });
        const service = new DiagnosticsService(failing, { browserFamily: 'other' });
        await expect(service.record({ category: 'timing', count: 1 }, sender, stateOf())).resolves.toBe(true);
    });
});
