/**
 * @file YouTube rules for trusted publication values on canonical watch pages.
 */

import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampCandidate,
    type TimestampSourceRule,
} from "./types";
import {
    YOUTUBE_ADAPTER_ID,
    YOUTUBE_PLAYER_RESPONSE_RULE_ID,
    getYouTubeWatchVideoId,
    matchesYouTubeWatchUrl,
} from "../../shared/adapters/youtube-contract";
import { readYouTubePlayerResponsePublication } from "./youtube-player-response";
import {
    RELATIVE_PRESENTATION_PROFILE,
    isRelativeTimestampPresentation,
} from "./relative-presentation";

const WATCH_PUBLICATION_SELECTOR =
    "ytd-watch-metadata #info-strings > yt-formatted-string";
const DATE_PUBLISHED_SELECTOR = 'meta[itemprop="datePublished"][content]';

/**
 * Discovers approved watch publication labels within one supplied root.
 *
 * @param root - Document or subtree whose approved labels may be processed.
 * @returns - Approved publication labels bounded to the supplied root.
 */
export function discoverYouTubeWatchPublicationSources(root: ParentNode): readonly Element[] {
    const sources: Element[] = [];
    if (root instanceof Element && root.matches(WATCH_PUBLICATION_SELECTOR)) {
        sources.push(root);
    }
    sources.push(...root.querySelectorAll(WATCH_PUBLICATION_SELECTOR));
    return sources;
}

/**
 * Checks whether an element is an approved canonical Watch publication label.
 *
 * @param element - Candidate page-owned source.
 * @returns - Whether the element matches the approved Watch label selector.
 */
export function isYouTubeWatchPublicationSource(element: Element): boolean {
    return element.matches(WATCH_PUBLICATION_SELECTOR);
}

/**
 * Creates one YouTube publication candidate without validating its raw value.
 *
 * @param ruleId - Rule that supplied the publication value.
 * @param source - Exact approved page-owned label to transform.
 * @param rawDatetime - Exact publication value supplied by the approved source.
 * @returns - Candidate carrying the combined YouTube publication semantic.
 */
function createPublicationCandidate(
    ruleId: string,
    source: Element,
    rawDatetime: string,
): TimestampCandidate {
    return {
        ruleId,
        source,
        sourceKind: TIMESTAMP_SOURCE_KIND.YT_FORMATTED_STRING,
        rawDatetime,
        validationRule: TIMESTAMP_VALIDATION_RULE.CALENDAR_OR_EXPLICIT_ISO_ZONE,
        visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        presentation: ADJACENT_TIME_PRESENTATION,
    };
}

/**
 * Preferred YouTube source for already-loaded, identity-bound player data.
 */
export const youtubePlayerResponseRule: TimestampSourceRule = {
    id: YOUTUBE_PLAYER_RESPONSE_RULE_ID,
    mutationAttributes: [],
    observesCharacterData: true,
    matches: matchesYouTubeWatchUrl,
    matchesElement: isYouTubeWatchPublicationSource,
    discover: discoverYouTubeWatchPublicationSources,
    isRelativePresentation: (candidate, context) =>
        isRelativeTimestampPresentation(candidate, context, [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ]),
    extract: (element, context) => {
        if (!isYouTubeWatchPublicationSource(element)) {
            return null;
        }
        const videoId = getYouTubeWatchVideoId(context.url);
        if (videoId === null) {
            return null;
        }
        const rawDatetime = readYouTubePlayerResponsePublication(
            element.ownerDocument,
            videoId,
        );
        return rawDatetime === null
            ? null
            : createPublicationCandidate(
                YOUTUBE_PLAYER_RESPONSE_RULE_ID,
                element,
                rawDatetime,
            );
    },
};

/**
 * YouTube fallback source for one explicit datePublished metadata value.
 */
export const youtubeAdapter: TimestampSourceRule = {
    id: YOUTUBE_ADAPTER_ID,
    mutationAttributes: [],
    observesCharacterData: true,
    matches: matchesYouTubeWatchUrl,
    matchesElement: isYouTubeWatchPublicationSource,
    discover: discoverYouTubeWatchPublicationSources,
    isRelativePresentation: (candidate, context) =>
        isRelativeTimestampPresentation(candidate, context, [
            RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        ]),
    extract: (element, context) => {
        if (
            !isYouTubeWatchPublicationSource(element)
            || getYouTubeWatchVideoId(context.url) === null
        ) {
            return null;
        }
        const metadata = element.ownerDocument.head.querySelectorAll(
            DATE_PUBLISHED_SELECTOR,
        );
        if (metadata.length !== 1) {
            return null;
        }
        const rawDatetime = metadata[0]?.getAttribute("content");
        if (rawDatetime === undefined || rawDatetime === null || rawDatetime === "") {
            return null;
        }
        return createPublicationCandidate(YOUTUBE_ADAPTER_ID, element, rawDatetime);
    },
};
