/**
 * @file Exercises the complete offline Facebook eligibility and lifecycle matrix.
 */

import { readFileSync } from 'node:fs';

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import {
    createFacebookPayloadMessage,
    type FacebookTimestampRecord,
} from '../../../../src/content-script/facebook/contracts';
import { extractFacebookTimestampUpdate } from
    '../../../../src/content-script/facebook/payload-parser';
import {
    installFacebookPayloadRuntime,
    type FacebookPayloadRuntimeHandle,
} from '../../../../src/content-script/facebook/payload-runtime';
import { clearFacebookTimestampRecords } from
    '../../../../src/content-script/facebook/timestamp-store';
import {
    OWNED_OUTPUT_ATTRIBUTE,
    OWNED_SOURCE_ATTRIBUTE,
} from '../../../../src/content-script/ownership-markers';
import {
    DOCUMENT_RUNTIME_SLOT,
    installContentRuntime,
    type ContentRuntimeHandle,
} from '../../../../src/content-script/runtime';
import {
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
} from '../../../../src/shared/messaging/document-messages';
import { STATE_AVAILABILITY } from
    '../../../../src/shared/messaging/view-state-values';

const FACEBOOK_URL = new URL('https://www.facebook.com/fixture-feed');
const INITIAL_TIMESTAMP = '1787933301' as const;
const DYNAMIC_TIMESTAMP = '1787343300' as const;
const INITIAL_TEXT = '2026-08-28 16:08:21' as const;
const OWNED_SELECTOR = `[${OWNED_SOURCE_ATTRIBUTE}], [${OWNED_OUTPUT_ATTRIBUTE}]`;

let contentRuntime: ContentRuntimeHandle | undefined;
let payloadRuntime: FacebookPayloadRuntimeHandle | undefined;

/**
 * Reads one deterministic Facebook fixture adjacent to this test directory.
 *
 * @param name - Fixture filename.
 *
 * @returns - Fixture contents.
 */
function fixture(name: string): string {
    return readFileSync(`tests/src/content-script/fixtures/facebook/${name}`, 'utf8');
}

/**
 * Loads the DOM eligibility matrix and optionally its initial payload script.
 *
 * @param includeInitialPayload - Whether initial Story evidence is present.
 */
function loadFixture(includeInitialPayload = true): void {
    document.body.innerHTML = fixture('eligibility-matrix.html');
    if (!includeInitialPayload) {
        return;
    }
    const payload = document.createElement('script');
    payload.type = 'application/json';
    payload.dataset.sjs = '1';
    payload.textContent = fixture('initial-payload.json');
    document.body.prepend(payload);
}

/**
 * Returns one required fixture element.
 *
 * @param id - Fixture element identifier.
 *
 * @returns - Connected fixture element.
 *
 * @throws If the element is missing.
 */
function requiredElement(id: string): HTMLElement {
    const element = document.getElementById(id);
    if (!element) {
        throw new Error(`Missing Facebook fixture element: ${id}`);
    }
    return element;
}

/**
 * Creates a controllable extension message source.
 *
 * @returns - Message source with a synchronous dispatch helper.
 */
function messages() {
    let listener: (
        (message: unknown, sender?: unknown, respond?: (value: unknown) => void) => unknown
    ) | undefined;
    return {
        onMessage: {
            addListener: vi.fn((next: typeof listener) => {
                listener = next;
            }),
        },
        dispatch(message: unknown): unknown {
            let response: unknown;
            listener?.(message, undefined, (value) => {
                response = value;
            });
            return response;
        },
    };
}

/**
 * Creates one ready document state for the fixture runtime.
 *
 * @param enabled - Effective global and site policy.
 * @param revision - Settings revision.
 *
 * @returns - Ready state with deterministic UTC formatting.
 */
function state(enabled: boolean, revision: number) {
    return {
        availability: STATE_AVAILABILITY.READY,
        revision,
        enabled,
        display: {
            formatMode: 'custom' as const,
            pattern: 'yyyy-MM-dd HH:mm:ss',
            timeZone: { mode: 'utc' as const },
        },
        debugEnabled: false,
    };
}

/**
 * Creates one revisioned effective-policy command.
 *
 * @param revision - Settings revision carried by the command.
 * @param enabled - Effective document activation policy.
 *
 * @returns - Complete document-policy command.
 */
function policy(revision: number, enabled: boolean) {
    return { type: RECONCILE_DOCUMENT_POLICY_MESSAGE, revision, enabled } as const;
}

/**
 * Creates the expected acknowledgement for one policy revision.
 *
 * @param revision - Retained settings revision.
 *
 * @returns - Complete policy acknowledgement.
 */
function policyAcknowledgement(revision: number) {
    return { type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision } as const;
}

/**
 * Installs the real isolated payload consumer and shared content runtime.
 *
 * @param source - Controllable extension messages.
 * @param loadState - Current effective policy loader.
 * @param reportDiagnostic - Optional diagnostic transport spy.
 */
function installRuntimes(
    source: ReturnType<typeof messages>,
    loadState: () => Promise<unknown>,
    reportDiagnostic: (event: Record<string, unknown>) => Promise<unknown>
        = () => Promise.resolve(undefined),
): void {
    payloadRuntime = installFacebookPayloadRuntime({
        window,
        document,
        onSourcesChanged: (sources) => {
            contentRuntime?.reconcileSources(sources);
        },
    });
    contentRuntime = installContentRuntime({
        document,
        url: FACEBOOK_URL,
        locales: ['en-US'],
        loadDocumentState: loadState,
        reportDiagnostic,
        onActivityChanged: (active) => {
            payloadRuntime?.setEnabled(active);
        },
        messages: source,
    });
}

/**
 * Dispatches trusted records parsed from one response fixture.
 *
 * @param name - Response fixture filename.
 *
 * @returns - Minimal parsed records sent across the bridge boundary.
 */
function dispatchFixtureRecords(
    name: string,
): Promise<readonly FacebookTimestampRecord[]> {
    const update = extractFacebookTimestampUpdate(fixture(name));
    window.dispatchEvent(new MessageEvent('message', {
        data: createFacebookPayloadMessage(update),
        origin: window.location.origin,
        source: window,
    }));
    return Promise.resolve(update.records);
}

/**
 * Allows hydration, native mutation delivery, and queued reconciliation to finish.
 *
 * @returns - Promise settled after pending microtasks.
 */
async function flushRuntime(): Promise<void> {
    for (let index = 0; index < 6; index += 1) {
        await Promise.resolve();
    }
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 0);
    });
}

/**
 * Returns the generated output adjacent to a required source.
 *
 * @param source - Page-owned timestamp source.
 *
 * @returns - Extension-owned exact time output.
 *
 * @throws If the source has no generated output.
 */
function outputFor(source: Element): HTMLTimeElement {
    const output = source.nextElementSibling;
    if (!(output instanceof HTMLTimeElement)) {
        throw new Error(`Expected output for Facebook source: ${source.id}`);
    }
    return output;
}

afterEach(() => {
    contentRuntime?.teardown();
    payloadRuntime?.teardown();
    contentRuntime = undefined;
    payloadRuntime = undefined;
    const runtimeDocument = document as Document & Record<symbol, unknown>;
    Reflect.deleteProperty(runtimeDocument, DOCUMENT_RUNTIME_SLOT);
    clearFacebookTimestampRecords(document);
    document.body.replaceChildren();
    vi.restoreAllMocks();
});

describe('Facebook offline fixture matrix', () => {
    it('renders only proven Story sources and preserves rejected look-alikes', async () => {
        loadFixture();
        vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
        const fetchSpy = vi.spyOn(globalThis, 'fetch');
        const diagnostics = vi.fn<
            (event: Record<string, unknown>) => Promise<unknown>
        >(() => Promise.resolve(undefined));
        const source = messages();
        const actor = requiredElement('actor-link');
        const rejectedIds = [
            'actor-link',
            'media-link',
            'comment-link',
            'reel-link',
            'nested-story-timestamp',
            'empty-token',
        ] as const;
        const rejected = rejectedIds.map(requiredElement);
        const originalMarkup = rejected.map((element) => element.outerHTML);
        const actorClick = vi.fn((event: Event) => {
            event.preventDefault();
        });
        actor.addEventListener('click', actorClick);

        installRuntimes(source, () => Promise.resolve(state(true, 1)), diagnostics);
        await flushRuntime();

        const initial = requiredElement('initial-timestamp');
        await vi.waitFor(() => {
            expect(outputFor(initial).dateTime).toBe(INITIAL_TIMESTAMP);
        });
        expect(outputFor(initial).textContent).toBe(INITIAL_TEXT);
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(2);

        await expect(dispatchFixtureRecords('dynamic-response.txt')).resolves.toEqual([{
            trackingToken: 'dynamic-story-token-000000000002',
            rawDatetime: DYNAMIC_TIMESTAMP,
        }]);
        await flushRuntime();

        const dynamic = requiredElement('dynamic-timestamp');
        expect(dynamic.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        expect(dynamic.nextElementSibling?.hasAttribute(OWNED_OUTPUT_ATTRIBUTE))
            .not.toBe(true);
        expect(document.querySelectorAll(
            `[${OWNED_OUTPUT_ATTRIBUTE}][datetime^="178"]`,
        )).toHaveLength(1);
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(2);

        for (const [index, element] of rejected.entries()) {
            expect(document.getElementById(element.id)).toBe(element);
            expect(element.outerHTML).toBe(originalMarkup[index]);
            expect(element.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        }
        actor.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        expect(actorClick).toHaveBeenCalledOnce();
        expect(fetchSpy).not.toHaveBeenCalled();
        expect(diagnostics).not.toHaveBeenCalled();
    });

    it.each(['evidence-first', 'source-first'] as const)(
        'keeps a textless dynamic source unowned in %s order',
        async (order) => {
            loadFixture(false);
            vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
            const source = messages();
            const dynamicPost = requiredElement('dynamic-post');
            if (order === 'evidence-first') {
                dynamicPost.remove();
            }
            installRuntimes(source, () => Promise.resolve(state(true, 1)));
            await flushRuntime();
            await dispatchFixtureRecords('dynamic-response.txt');
            if (order === 'evidence-first') {
                requiredElement('fixture-feed').prepend(dynamicPost);
            }
            await flushRuntime();

            const dynamic = requiredElement('dynamic-timestamp');
            expect(dynamic.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
            expect(document.querySelectorAll(
                `[${OWNED_OUTPUT_ATTRIBUTE}][datetime="${DYNAMIC_TIMESTAMP}"]`,
            )).toHaveLength(0);
        },
    );

    it('keeps batches, re-renders, repairs, and repeated mutations idempotent', async () => {
        document.body.innerHTML = '<main id="batch-feed"></main><main id="moved-feed"></main>';
        vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
        const feed = requiredElement('batch-feed');
        const records: FacebookTimestampRecord[] = [];
        const batchSize = 24;
        for (let index = 0; index < batchSize; index += 1) {
            const indexText = String(index);
            const token = `older-story-token-${String(index).padStart(12, '0')}`;
            const article = document.createElement('article');
            article.innerHTML = `<a id="older-${indexText}" href="/older?__cft__[0]=${token}"`
                + '><span>1͏d͏</span></a>';
            feed.append(article);
            records.push({
                trackingToken: token,
                rawDatetime: String(1_787_000_000 - index),
            });
        }
        const source = messages();
        installRuntimes(source, () => Promise.resolve(state(true, 1)));
        await flushRuntime();
        window.dispatchEvent(new MessageEvent('message', {
            data: createFacebookPayloadMessage({
                records,
                invalidatedTrackingTokens: [],
                invalidateAll: false,
            }),
            origin: window.location.origin,
            source: window,
        }));
        await flushRuntime();
        await vi.waitFor(() => {
            expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`))
                .toHaveLength(batchSize);
        });

        const first = requiredElement('older-0');
        const firstArticle = first.closest('article');
        if (!firstArticle) {
            throw new Error('Expected older Story article');
        }
        requiredElement('moved-feed').append(firstArticle);
        await flushRuntime();
        expect(outputFor(first).dateTime).toBe(records[0]?.rawDatetime);

        first.innerHTML = '<span>1͏d͏</span>';
        await flushRuntime();
        outputFor(first).remove();
        await flushRuntime();
        for (let index = 0; index < 100; index += 1) {
            const noise = document.createElement('i');
            first.append(noise);
            noise.remove();
        }
        await flushRuntime();

        expect(outputFor(first).dateTime).toBe(records[0]?.rawDatetime);
        expect(firstArticle.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(1);
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(batchSize);
    });

    it('restores on disable, conflict, removal, and global teardown', async () => {
        loadFixture();
        vi.spyOn(window, 'postMessage').mockImplementation(() => undefined);
        let enabled = true;
        let revision = 1;
        const source = messages();
        installRuntimes(source, () => Promise.resolve(state(enabled, revision)));
        await flushRuntime();
        await dispatchFixtureRecords('dynamic-response.txt');
        await flushRuntime();
        await vi.waitFor(() => {
            expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(2);
        });

        enabled = false;
        revision = 2;
        expect(source.dispatch(policy(revision, false)))
            .toEqual(policyAcknowledgement(revision));
        expect(document.querySelectorAll(OWNED_SELECTOR)).toHaveLength(0);
        await flushRuntime();

        enabled = true;
        revision = 3;
        expect(source.dispatch(policy(revision, true)))
            .toEqual(policyAcknowledgement(revision));
        await flushRuntime();
        await dispatchFixtureRecords('dynamic-response.txt');
        await flushRuntime();
        await vi.waitFor(() => {
            expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(2);
        });

        await dispatchFixtureRecords('conflicting-response.txt');
        await flushRuntime();
        const initial = requiredElement('initial-timestamp');
        await vi.waitFor(() => {
            expect(initial.hasAttribute(OWNED_SOURCE_ATTRIBUTE)).toBe(false);
        });
        expect(initial.hasAttribute('hidden')).toBe(false);
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(1);

        const dynamicPost = requiredElement('dynamic-post');
        dynamicPost.remove();
        await flushRuntime();
        expect(dynamicPost.querySelectorAll(OWNED_SELECTOR)).toHaveLength(0);
        expect(document.querySelectorAll(`[${OWNED_OUTPUT_ATTRIBUTE}]`)).toHaveLength(1);

        enabled = false;
        revision = 4;
        expect(source.dispatch(policy(revision, false)))
            .toEqual(policyAcknowledgement(revision));
        expect(document.querySelectorAll(OWNED_SELECTOR)).toHaveLength(0);
        expect(requiredElement('generic-timestamp').textContent).toBe('yesterday');
    });
});
