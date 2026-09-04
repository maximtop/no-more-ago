/**
 * @file Bounded document-local reader for loaded YouTube player publication data.
 */

import * as v from "valibot";

const PLAYER_RESPONSE_PREFIX = "var ytInitialPlayerResponse = ";
const PLAYER_RESPONSE_SUFFIX = ";";

/**
 * Maximum assignment text retained or parsed by the reader.
 */
export const YOUTUBE_PLAYER_RESPONSE_MAX_CHARACTERS = 2_000_000;

/**
 * Narrow JSON parsing capability used by the loaded-data reader.
 */
type JsonParser = (sourceText: string) => unknown;

/**
 * Minimal trusted shape retained from one parsed player response.
 */
interface ParsedPlayerPublication {
    /**
     * Primary video identity from loaded player details.
     */
    readonly videoId: string;

    /**
     * Microformat video identity paired with the publication value.
     */
    readonly externalVideoId: string;

    /**
     * Exact unvalidated publication value from the approved property.
     */
    readonly rawDatetime: string;
}

/**
 * One stable assignment record retained for a live document.
 */
interface CachedPlayerResponse {
    /**
     * Unique script element selected for the record.
     */
    readonly script: HTMLScriptElement;

    /**
     * Exact bounded assignment text used for parsing.
     */
    readonly sourceText: string;

    /**
     * Minimal parsed value or cached invalid outcome.
     */
    readonly parsed: ParsedPlayerPublication | null;
}

/**
 * Document-scoped reader for already-loaded player publication data.
 */
export interface YouTubePlayerResponseReader {
    /**
     * Reads and identity-checks one publication value.
     *
     * @param document - Current loaded page document.
     * @param expectedVideoId - Canonical ID from the current processing URL.
     * @returns - Exact publication string or null.
     */
    read(document: Document, expectedVideoId: string): string | null;
}

/**
 * Approved fields read from one parsed player response; everything else is dropped.
 */
const playerResponseSchema = v.object({
    videoDetails: v.object({ videoId: v.string() }),
    microformat: v.object({
        playerMicroformatRenderer: v.object({
            externalVideoId: v.string(),
            publishDate: v.pipe(v.string(), v.nonEmpty()),
        }),
    }),
});

/**
 * Enumerates scripts beginning with the recognized assignment prefix in one bounded root.
 *
 * @param root - Current document or bounded added root.
 * @returns - Matching scripts in DOM query order.
 */
export function findYouTubePlayerResponseScripts(
    root: ParentNode,
): readonly HTMLScriptElement[] {
    const scripts: HTMLScriptElement[] = [];
    if (
        root.nodeType === Node.ELEMENT_NODE
        && (root as Element).matches("script")
        && (root as HTMLScriptElement).textContent.startsWith(PLAYER_RESPONSE_PREFIX)
    ) {
        scripts.push(root as HTMLScriptElement);
    }
    for (const script of root.querySelectorAll("script")) {
        if (script.textContent.startsWith(PLAYER_RESPONSE_PREFIX)) {
            scripts.push(script);
        }
    }
    return scripts;
}

/**
 * Parses one exact bounded assignment and retains only approved string fields.
 *
 * @param sourceText - Exact candidate assignment text.
 * @param parseJson - Narrow JSON parser capability.
 * @returns - Minimal publication record or null when rejected.
 */
function parseAssignment(
    sourceText: string,
    parseJson: JsonParser,
): ParsedPlayerPublication | null {
    if (
        sourceText.length > YOUTUBE_PLAYER_RESPONSE_MAX_CHARACTERS
        || !sourceText.startsWith(PLAYER_RESPONSE_PREFIX)
        || !sourceText.endsWith(PLAYER_RESPONSE_SUFFIX)
    ) {
        return null;
    }
    let response: unknown;
    try {
        response = parseJson(sourceText.slice(
            PLAYER_RESPONSE_PREFIX.length,
            -PLAYER_RESPONSE_SUFFIX.length,
        ));
    } catch {
        return null;
    }
    const parsed = v.safeParse(playerResponseSchema, response);
    if (!parsed.success) {
        return null;
    }
    const { videoDetails, microformat } = parsed.output;
    const { externalVideoId, publishDate } = microformat.playerMicroformatRenderer;
    return { videoId: videoDetails.videoId, externalVideoId, rawDatetime: publishDate };
}

/**
 * Creates an isolated reader with one cached assignment record per document.
 *
 * @param parseJson - JSON parser used for new or changed assignment text.
 * @returns - Document-scoped publication reader.
 */
export function createYouTubePlayerResponseReader(
    parseJson: JsonParser = (sourceText) => JSON.parse(sourceText),
): YouTubePlayerResponseReader {
    const cache = new WeakMap<Document, CachedPlayerResponse>();
    return {
        read: (document, expectedVideoId) => {
            const scripts = findYouTubePlayerResponseScripts(document);
            const script = scripts.length === 1 ? scripts[0] : undefined;
            if (!script) {
                cache.delete(document);
                return null;
            }
            const sourceText = script.textContent;
            if (sourceText.length > YOUTUBE_PLAYER_RESPONSE_MAX_CHARACTERS) {
                cache.delete(document);
                return null;
            }
            const previous = cache.get(document);
            let parsed: ParsedPlayerPublication | null;
            if (
                previous?.script === script
                && previous.sourceText === sourceText
            ) {
                parsed = previous.parsed;
            } else {
                cache.delete(document);
                parsed = parseAssignment(sourceText, parseJson);
                cache.set(document, { script, sourceText, parsed });
            }
            return parsed?.videoId === expectedVideoId
                && parsed.externalVideoId === expectedVideoId
                ? parsed.rawDatetime
                : null;
        },
    };
}

const defaultPlayerResponseReader = createYouTubePlayerResponseReader();

/**
 * Reads one approved loaded publication value through the production cache.
 *
 * @param document - Current loaded page document.
 * @param expectedVideoId - Canonical ID from the current processing URL.
 * @returns - Exact publication string or null.
 */
export function readYouTubePlayerResponsePublication(
    document: Document,
    expectedVideoId: string,
): string | null {
    return defaultPlayerResponseReader.read(document, expectedVideoId);
}
