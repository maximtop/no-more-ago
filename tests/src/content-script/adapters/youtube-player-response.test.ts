/**
 * @file Verifies bounded reading and reuse of loaded YouTube player assignments.
 */

import {
    beforeEach, describe, expect, it, vi,
} from 'vitest';

import {
    YOUTUBE_PLAYER_RESPONSE_MAX_CHARACTERS,
    createYouTubePlayerResponseReader,
} from '../../../../src/content-script/adapters/youtube-player-response';

import { youtubePlayerResponseAssignment } from './youtube-test-data';

const VIDEO_ID = 'testVID0001';

/**
 * Serializes one exact recognized player-response assignment.
 *
 * @param publication - Publication value placed in the approved property.
 * @param videoId - Primary embedded video identity.
 * @param externalVideoId - Microformat embedded video identity.
 *
 * @returns - Exact assignment text consumed by the reader.
 */
function playerAssignment(
    publication: unknown,
    videoId: unknown = VIDEO_ID,
    externalVideoId: unknown = VIDEO_ID,
): string {
    return youtubePlayerResponseAssignment(publication, videoId, externalVideoId);
}

/**
 * Serializes an arbitrary value inside the recognized assignment boundary.
 *
 * @param value - JSON-compatible payload value.
 *
 * @returns - Exact assignment text.
 */
function assignmentFromValue(value: unknown): string {
    return `var ytInitialPlayerResponse = ${JSON.stringify(value)};`;
}

/**
 * Appends one script assignment to a document.
 *
 * @param pageDocument - Document that owns the script.
 * @param sourceText - Exact script text.
 *
 * @returns - Appended script element.
 */
function appendAssignment(
    pageDocument: Document,
    sourceText: string,
): HTMLScriptElement {
    const script = pageDocument.createElement('script');
    pageDocument.head.append(script);
    script.textContent = sourceText;
    return script;
}

describe('YouTube player-response reader', () => {
    beforeEach(() => {
        document.head.innerHTML = '';
        document.body.innerHTML = '';
    });

    it.each([
        '2024-02-29',
        '2026-08-29T10:15:00+03:00',
        ' 2024-02-29 ',
    ])('returns publication value %j unchanged', (publication) => {
        appendAssignment(document, playerAssignment(publication));
        const reader = createYouTubePlayerResponseReader();

        expect(reader.read(document, VIDEO_ID)).toBe(publication);
    });

    it('rejects an absent or duplicate assignment', () => {
        const reader = createYouTubePlayerResponseReader();
        expect(reader.read(document, VIDEO_ID)).toBeNull();

        appendAssignment(document, playerAssignment('2024-02-29'));
        appendAssignment(document, playerAssignment('2026-08-29'));
        expect(reader.read(document, VIDEO_ID)).toBeNull();
    });

    it.each([
        'window.ytInitialPlayerResponse = {};',
        'var ytInitialPlayerResponse= {};',
        ' var ytInitialPlayerResponse = {};',
        'var ytInitialPlayerResponse = {}',
        'var ytInitialPlayerResponse = {invalid};',
        'var ytInitialPlayerResponse = {};\n',
    ])('rejects non-exact or malformed assignment %j', (sourceText) => {
        appendAssignment(document, sourceText);
        expect(createYouTubePlayerResponseReader().read(document, VIDEO_ID)).toBeNull();
    });

    it.each([
        null,
        [],
        {
            videoDetails: null,
            microformat: {
                playerMicroformatRenderer: {
                    externalVideoId: VIDEO_ID,
                    publishDate: '2024-02-29',
                },
            },
        },
        {
            videoDetails: { videoId: VIDEO_ID },
            microformat: [],
        },
        {
            videoDetails: { videoId: VIDEO_ID },
            microformat: { playerMicroformatRenderer: null },
        },
    ])('rejects non-object intermediate value %#', (value) => {
        appendAssignment(document, assignmentFromValue(value));
        expect(createYouTubePlayerResponseReader().read(document, VIDEO_ID)).toBeNull();
    });

    it.each([
        [
            'missing video ID',
            {
                videoDetails: {},
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: VIDEO_ID,
                        publishDate: '2024-02-29',
                    },
                },
            },
        ],
        [
            'non-string video ID',
            {
                videoDetails: { videoId: 123 },
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: VIDEO_ID,
                        publishDate: '2024-02-29',
                    },
                },
            },
        ],
        [
            'missing external video ID',
            {
                videoDetails: { videoId: VIDEO_ID },
                microformat: {
                    playerMicroformatRenderer: { publishDate: '2024-02-29' },
                },
            },
        ],
        [
            'non-string external video ID',
            {
                videoDetails: { videoId: VIDEO_ID },
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: 123,
                        publishDate: '2024-02-29',
                    },
                },
            },
        ],
        [
            'missing publication',
            {
                videoDetails: { videoId: VIDEO_ID },
                microformat: {
                    playerMicroformatRenderer: { externalVideoId: VIDEO_ID },
                },
            },
        ],
        [
            'non-string publication',
            {
                videoDetails: { videoId: VIDEO_ID },
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: VIDEO_ID,
                        publishDate: 123,
                    },
                },
            },
        ],
        [
            'empty publication',
            {
                videoDetails: { videoId: VIDEO_ID },
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: VIDEO_ID,
                        publishDate: '',
                    },
                },
            },
        ],
        [
            'uploadDate without publishDate',
            {
                videoDetails: { videoId: VIDEO_ID },
                microformat: {
                    playerMicroformatRenderer: {
                        externalVideoId: VIDEO_ID,
                        uploadDate: '2024-02-29',
                    },
                },
            },
        ],
    ])('rejects %s', (_name, value) => {
        appendAssignment(document, assignmentFromValue(value));
        expect(createYouTubePlayerResponseReader().read(document, VIDEO_ID)).toBeNull();
    });

    it.each([
        ['primary', 'testVID0002', VIDEO_ID],
        ['external', VIDEO_ID, 'testVID0002'],
        ['empty primary', '', VIDEO_ID],
        ['empty external', VIDEO_ID, ''],
    ])('rejects %s identity mismatch', (_name, videoId, externalVideoId) => {
        appendAssignment(
            document,
            playerAssignment('2024-02-29', videoId, externalVideoId),
        );
        expect(createYouTubePlayerResponseReader().read(document, VIDEO_ID)).toBeNull();
    });

    it('parses once per stable document assignment and invalidates explicitly', () => {
        const parseJson = vi.fn((text: string): unknown => JSON.parse(text));
        const reader = createYouTubePlayerResponseReader(parseJson);
        const script = appendAssignment(document, playerAssignment('2024-02-29'));

        expect(reader.read(document, VIDEO_ID)).toBe('2024-02-29');
        expect(reader.read(document, VIDEO_ID)).toBe('2024-02-29');
        expect(reader.read(document, 'testVID0002')).toBeNull();
        expect(parseJson).toHaveBeenCalledOnce();

        script.textContent = playerAssignment('2026-08-29T10:15:00+03:00');
        expect(reader.read(document, VIDEO_ID))
            .toBe('2026-08-29T10:15:00+03:00');
        expect(parseJson).toHaveBeenCalledTimes(2);

        const replacement = document.createElement('script');
        script.replaceWith(replacement);
        replacement.textContent = playerAssignment('2026-08-30');
        expect(reader.read(document, VIDEO_ID)).toBe('2026-08-30');
        expect(parseJson).toHaveBeenCalledTimes(3);

        const duplicate = appendAssignment(
            document,
            replacement.textContent,
        );
        expect(reader.read(document, VIDEO_ID)).toBeNull();
        expect(parseJson).toHaveBeenCalledTimes(3);

        duplicate.remove();
        expect(reader.read(document, VIDEO_ID)).toBe('2026-08-30');
        expect(parseJson).toHaveBeenCalledTimes(4);
    });

    it('caches a malformed JSON outcome for stable assignment text', () => {
        const parseJson = vi.fn((text: string): unknown => JSON.parse(text));
        const reader = createYouTubePlayerResponseReader(parseJson);
        appendAssignment(document, 'var ytInitialPlayerResponse = {invalid};');

        expect(reader.read(document, VIDEO_ID)).toBeNull();
        expect(reader.read(document, VIDEO_ID)).toBeNull();
        expect(parseJson).toHaveBeenCalledOnce();
    });

    it('invalidates the cached record when the assignment disappears', () => {
        const parseJson = vi.fn((text: string): unknown => JSON.parse(text));
        const reader = createYouTubePlayerResponseReader(parseJson);
        const script = appendAssignment(document, playerAssignment('2024-02-29'));

        expect(reader.read(document, VIDEO_ID)).toBe('2024-02-29');
        script.remove();
        expect(reader.read(document, VIDEO_ID)).toBeNull();
        document.head.append(script);
        expect(reader.read(document, VIDEO_ID)).toBe('2024-02-29');
        expect(parseJson).toHaveBeenCalledTimes(2);
    });

    it('rejects oversized input without invoking the JSON parser', () => {
        const parseJson = vi.fn((text: string): unknown => JSON.parse(text));
        const reader = createYouTubePlayerResponseReader(parseJson);
        appendAssignment(
            document,
            `var ytInitialPlayerResponse = ${
                'x'.repeat(YOUTUBE_PLAYER_RESPONSE_MAX_CHARACTERS)
            };`,
        );

        expect(reader.read(document, VIDEO_ID)).toBeNull();
        expect(parseJson).not.toHaveBeenCalled();
    });

    it('isolates cached assignments between documents', () => {
        const parseJson = vi.fn((text: string): unknown => JSON.parse(text));
        const reader = createYouTubePlayerResponseReader(parseJson);
        const otherDocument = document.implementation.createHTMLDocument('other');
        appendAssignment(document, playerAssignment('2024-02-29'));
        appendAssignment(otherDocument, playerAssignment('2026-08-30'));

        expect(reader.read(document, VIDEO_ID)).toBe('2024-02-29');
        expect(reader.read(otherDocument, VIDEO_ID)).toBe('2026-08-30');
        expect(reader.read(document, VIDEO_ID)).toBe('2024-02-29');
        expect(reader.read(otherDocument, VIDEO_ID)).toBe('2026-08-30');
        expect(parseJson).toHaveBeenCalledTimes(2);
    });
});
