/**
 * @file Verifies Facebook payload lifecycle and targeted reconciliation.
 */

import {
    afterEach, describe, expect, it, vi,
} from 'vitest';

import {
    FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE,
    FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
    FACEBOOK_PAYLOAD_SCRIPT_SELECTOR,
    createFacebookPayloadBridgeReadyMessage,
    createFacebookPayloadMessage,
    type FacebookTimestampRecord,
} from '../../../../src/content-script/facebook/contracts';
import {
    installFacebookPayloadRuntime,
    type FacebookPayloadRuntimeHandle,
} from '../../../../src/content-script/facebook/payload-runtime';
import {
    clearFacebookTimestampRecords,
    getFacebookTimestampRecord,
} from '../../../../src/content-script/facebook/timestamp-store';
import {
    DocumentTransformationController,
} from '../../../../src/content-script/transformation/document-transformation-controller';
import {
    restoreTimestampPresentations,
} from '../../../../src/content-script/transformation/render-timestamp-presentation';

const TRACKING_TOKEN = 'AZ-facebook-payload-runtime-token-1234567890';
const SECOND_TRACKING_TOKEN = 'AZ-facebook-second-runtime-token-0987654321';
const FACEBOOK_URL = new URL('https://www.facebook.com/home');
const RECORD = {
    trackingToken: TRACKING_TOKEN,
    rawDatetime: '1787933301',
} as const;
let activeHandle: FacebookPayloadRuntimeHandle | undefined;

/**
 * Creates one recognized or initially text-ineligible Facebook timestamp link.
 *
 * @param trackingToken - Opaque association stored in the URL.
 * @param label - Page-owned timestamp label.
 *
 * @returns - Connected timestamp source.
 */
function timestampSource(
    trackingToken = TRACKING_TOKEN,
    label = '1͏d͏',
): HTMLAnchorElement {
    const source = document.createElement('a');
    source.href = `https://www.facebook.com/story?__cft__[0]=${trackingToken}`;
    source.innerHTML = `<span>${label}</span>`;
    document.body.append(source);
    return source;
}

/**
 * Dispatches one same-window Facebook bridge message.
 *
 * @param data - Structurally valid or malformed bridge message payload.
 */
function dispatchBridgeMessage(data: unknown): void {
    window.dispatchEvent(new MessageEvent('message', {
        data,
        origin: window.location.origin,
        source: window,
    }));
}

/**
 * Dispatches records through the complete payload-update message.
 *
 * @param records - Minimal Story records to deliver.
 */
function dispatchRecords(records: readonly FacebookTimestampRecord[]): void {
    dispatchBridgeMessage(createFacebookPayloadMessage({
        records,
        invalidatedTrackingTokens: [],
        invalidateAll: false,
    }));
}

/**
 * Allows native mutation observers and queued reconciliation to complete.
 *
 * @returns - Promise resolved after pending tasks and microtasks.
 */
async function flushMutations(): Promise<void> {
    await Promise.resolve();
    await new Promise<void>((resolve) => {
        setTimeout(resolve, 10);
    });
    await Promise.resolve();
}

/**
 * Installs a payload runtime.
 *
 * @param onSourcesChanged - Targeted reconciliation callback.
 *
 * @returns - Installed lifecycle handle.
 */
function install(
    onSourcesChanged: (sources: readonly Element[]) => void = vi.fn(),
): FacebookPayloadRuntimeHandle {
    activeHandle = installFacebookPayloadRuntime({
        window,
        document,
        onSourcesChanged,
    });
    return activeHandle;
}

afterEach(() => {
    activeHandle?.teardown();
    activeHandle = undefined;
    vi.restoreAllMocks();
    restoreTimestampPresentations(document);
    clearFacebookTimestampRecords(document);
    document.body.replaceChildren();
});

describe('Facebook isolated payload runtime', () => {
    it('owns an idempotent enable, disable, re-enable, and teardown lifecycle', async () => {
        const source = timestampSource();
        const payload = document.createElement('script');
        payload.type = 'application/json';
        payload.dataset.sjs = '1';
        payload.textContent = JSON.stringify({
            __typename: 'Story',
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
        });
        document.body.prepend(payload);
        const postMessage = vi.spyOn(window, 'postMessage');
        const handle = install();

        expect(getFacebookTimestampRecord(source)).toBeNull();
        handle.setEnabled(true);
        await flushMutations();
        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        expect(postMessage).toHaveBeenCalledWith({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE,
            enabled: true,
        }, window.location.origin);

        handle.setEnabled(true);
        handle.setEnabled(false);
        expect(getFacebookTimestampRecord(source)).toBeNull();
        expect(postMessage).toHaveBeenLastCalledWith({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE,
            enabled: false,
        }, window.location.origin);

        handle.setEnabled(true);
        await flushMutations();
        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        handle.teardown();
        const replacement = install();
        expect(replacement).not.toBe(handle);
    });

    it('resends active control when the main-world bridge becomes ready', () => {
        const postMessage = vi.spyOn(window, 'postMessage');
        const handle = install();
        handle.setEnabled(true);
        postMessage.mockClear();

        dispatchBridgeMessage(createFacebookPayloadBridgeReadyMessage());

        expect(postMessage).toHaveBeenCalledWith({
            source: FACEBOOK_PAYLOAD_MESSAGE_SOURCE,
            type: FACEBOOK_PAYLOAD_BRIDGE_CONTROL_MESSAGE,
            enabled: true,
        }, window.location.origin);
    });

    it('reconciles when bounded evidence arrives before the source', async () => {
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        dispatchRecords([RECORD]);
        expect(callback).not.toHaveBeenCalled();

        const source = timestampSource();
        await flushMutations();

        expect(callback).toHaveBeenCalledWith([source]);
    });

    it('skips link searches when an unrelated mutation has no pending change', async () => {
        const handle = install();
        handle.setEnabled(true);
        await flushMutations();
        const querySelectorAll = vi.spyOn(document, 'querySelectorAll');

        const unrelated = document.createElement('div');
        unrelated.textContent = 'ordinary feed mutation';
        document.body.append(unrelated);
        await flushMutations();

        expect(querySelectorAll).not.toHaveBeenCalled();
    });

    it('ingests only a payload script populated through character data', async () => {
        const source = timestampSource();
        const payload = document.createElement('script');
        payload.type = 'application/json';
        payload.dataset.sjs = '1';
        const text = document.createTextNode('');
        payload.append(text);
        document.body.prepend(payload);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        await flushMutations();
        const querySelectorAll = vi.spyOn(document, 'querySelectorAll');

        text.data = JSON.stringify({
            __typename: 'Story',
            creation_time: 1_787_933_301,
            encrypted_click_tracking: TRACKING_TOKEN,
        });
        await flushMutations();

        expect(getFacebookTimestampRecord(source)).toEqual(RECORD);
        expect(callback).toHaveBeenCalledWith([source]);
        expect(querySelectorAll).not.toHaveBeenCalledWith(FACEBOOK_PAYLOAD_SCRIPT_SELECTOR);
    });

    it('reconciles one batch when several associations become available together', () => {
        const first = timestampSource();
        const second = timestampSource(SECOND_TRACKING_TOKEN);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);

        dispatchRecords([
            RECORD,
            { trackingToken: SECOND_TRACKING_TOKEN, rawDatetime: '1787933302' },
        ]);

        expect(callback).toHaveBeenCalledOnce();
        expect(callback).toHaveBeenCalledWith([first, second]);
    });

    it('ignores malformed page messages', () => {
        const source = timestampSource();
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);

        dispatchBridgeMessage({
            ...createFacebookPayloadMessage({
                records: [RECORD],
                invalidatedTrackingTokens: [],
                invalidateAll: false,
            }),
            records: [{ ...RECORD, rawDatetime: 'yesterday' }],
        });

        expect(getFacebookTimestampRecord(source)).toBeNull();
        expect(callback).not.toHaveBeenCalled();
    });

    it('retries a pending association after the link href becomes eligible', async () => {
        const source = document.createElement('a');
        source.innerHTML = '<span>1͏d͏</span>';
        document.body.append(source);
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        dispatchRecords([RECORD]);
        expect(callback).not.toHaveBeenCalled();

        source.href = `https://www.facebook.com/story?__cft__[0]=${TRACKING_TOKEN}`;
        await flushMutations();

        expect(callback).toHaveBeenCalledWith([source]);
    });

    it('routes newly eligible timestamp text through the shared controller', async () => {
        const source = timestampSource(TRACKING_TOKEN, '1d');
        const controller = new DocumentTransformationController({
            url: FACEBOOK_URL,
            root: document,
            locales: ['en-US'],
            display: {
                formatMode: 'custom',
                pattern: 'yyyy-MM-dd HH:mm:ss',
                timeZone: { mode: 'utc' },
            },
        });
        controller.start();
        const handle = install((sources) => {
            controller.reconcileSources(sources);
        });
        handle.setEnabled(true);
        dispatchRecords([RECORD]);
        expect(document.querySelector('[data-no-more-ago-output]')).toBeNull();

        const text = source.querySelector('span')?.firstChild;
        if (!(text instanceof Text)) {
            throw new Error('Expected timestamp text node');
        }
        text.data = '1͏d͏';
        await flushMutations();

        expect(source.hidden).toBe(true);
        expect(document.querySelector('[data-no-more-ago-output]')).not.toBeNull();
        controller.teardown();
    });

    it('drops dynamic evidence across disable and requires a fresh update', async () => {
        const callback = vi.fn<(sources: readonly Element[]) => void>();
        const handle = install(callback);
        handle.setEnabled(true);
        dispatchRecords([RECORD]);
        handle.setEnabled(false);
        handle.setEnabled(true);

        const source = timestampSource();
        await flushMutations();
        expect(callback).not.toHaveBeenCalled();

        dispatchRecords([RECORD]);
        expect(callback).toHaveBeenCalledWith([source]);
    });

    it('restores rendered output when later evidence conflicts', () => {
        const source = timestampSource();
        const controller = new DocumentTransformationController({
            url: FACEBOOK_URL,
            root: document,
            locales: ['en-US'],
            display: {
                formatMode: 'custom',
                pattern: 'yyyy-MM-dd HH:mm:ss',
                timeZone: { mode: 'utc' },
            },
        });
        const handle = install((sources) => {
            controller.reconcileSources(sources);
        });
        handle.setEnabled(true);
        dispatchRecords([RECORD]);
        controller.start();
        expect(source.hidden).toBe(true);

        dispatchRecords([{ ...RECORD, rawDatetime: '1787933302' }]);

        expect(source.hidden).toBe(false);
        expect(document.querySelector('[data-no-more-ago-output]')).toBeNull();
        controller.teardown();
    });

    it('restores every rendered source after a fail-closed invalidation', () => {
        const source = timestampSource();
        const controller = new DocumentTransformationController({
            url: FACEBOOK_URL,
            root: document,
            locales: ['en-US'],
            display: {
                formatMode: 'custom',
                pattern: 'yyyy-MM-dd HH:mm:ss',
                timeZone: { mode: 'utc' },
            },
        });
        const handle = install((sources) => {
            controller.reconcileSources(sources);
        });
        handle.setEnabled(true);
        dispatchRecords([RECORD]);
        controller.start();
        expect(source.hidden).toBe(true);

        dispatchBridgeMessage(createFacebookPayloadMessage({
            records: [],
            invalidatedTrackingTokens: [],
            invalidateAll: true,
        }));

        expect(source.hidden).toBe(false);
        expect(document.querySelector('[data-no-more-ago-output]')).toBeNull();
        controller.teardown();
    });
});
