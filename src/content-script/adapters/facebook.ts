/**
 * @file Maps Facebook Story payload timestamps to their obfuscated post timestamp links.
 */

import { isFacebookUrl } from '../../shared/url/facebook';
import { FACEBOOK_TRACKED_LINK_SELECTOR } from '../facebook/contracts';
import {
    getFacebookTimestampRecord,
    getFacebookTrackingToken,
} from '../facebook/timestamp-store';

import { discoverElements } from './discover-elements';
import {
    RELATIVE_PRESENTATION_PROFILE,
    createRelativePresentationClassifier,
} from './relative-presentation';
import {
    ADJACENT_TIME_PRESENTATION,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from './types';

/**
 * Stable identifier for the Facebook Story timestamp adapter.
 */
export const FACEBOOK_ADAPTER_ID = 'facebook' as const;

const FACEBOOK_OBFUSCATION_MARK = '\u034f' as const;

/**
 * Recognizes Facebook's SVG-sprite presentation used by dynamically loaded post timestamps.
 *
 * @param element - Tracking link whose descendant presentation is inspected.
 *
 * @returns - Whether the link has the narrow dynamic timestamp shape.
 */
function hasFacebookSvgTimestamp(element: Element): boolean {
    return element.textContent.trim() === ''
        && element.getAttribute('role') === 'link'
        && element.getAttribute('tabindex') === '0'
        && element.getAttribute('target') === '_blank'
        && !element.hasAttribute('aria-label')
        && element.querySelector('span[aria-labelledby] svg use') !== null;
}

/**
 * Checks for Facebook's current post-timestamp link shape without decoding its label.
 *
 * Comment, actor, media, and accessibility links may carry the same tracking token.
 * The post timestamp is distinguished by Facebook's obfuscation mark and payload proof.
 *
 * @param element - Candidate page-owned source.
 *
 * @returns - Whether the element can represent a Facebook Story timestamp.
 */
export function isFacebookTimestampElement(element: Element): boolean {
    return getFacebookTrackingToken(element) !== null
        && (
            element.textContent.includes(FACEBOOK_OBFUSCATION_MARK)
            || hasFacebookSvgTimestamp(element)
        )
        && getFacebookTimestampRecord(element) !== null;
}

/**
 * Facebook Story source rule backed by structured initial-page or GraphQL payloads.
 */
export const facebookAdapter: TimestampSourceRule = {
    id: FACEBOOK_ADAPTER_ID,
    mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.HREF],
    matches: isFacebookUrl,
    matchesElement: isFacebookTimestampElement,
    discover: (root) => discoverElements(
        root,
        FACEBOOK_TRACKED_LINK_SELECTOR,
        isFacebookTimestampElement,
    ),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
    ]),
    extract: (element) => {
        if (!isFacebookTimestampElement(element)) {
            return null;
        }
        const record = getFacebookTimestampRecord(element);
        if (!record) {
            return null;
        }
        return {
            ruleId: FACEBOOK_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.FACEBOOK_STORY_TIMESTAMP,
            rawDatetime: record.rawDatetime,
            presentation: ADJACENT_TIME_PRESENTATION,
            validationRule: TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        };
    },
};
