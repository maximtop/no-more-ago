/**
 * @file Preserves Instagram timestamp styling through in-place standard-time presentation.
 */

import { isHttpUrl } from '../../shared/url/http';
import { OWNED_OUTPUT_ATTRIBUTE } from '../ownership-markers';

import { discoverElements } from './discover-elements';
import { isHtmlElement } from './html-element';
import {
    RELATIVE_PRESENTATION_PROFILE,
    createRelativePresentationClassifier,
} from './relative-presentation';
import { findSimpleTextTarget } from './simple-text-target';
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from './types';

/**
 * Stable identifier for the Instagram presentation rule.
 */
export const INSTAGRAM_ADAPTER_ID = 'instagram' as const;

/**
 * Canonical hostname handled by the Instagram presentation rule.
 */
export const INSTAGRAM_HOSTNAME = 'www.instagram.com' as const;

const INSTAGRAM_TIME_SELECTOR = 'time[datetime]' as const;

/**
 * Checks whether a URL belongs to the supported Instagram origin.
 *
 * @param url - URL considered for adapter selection.
 *
 * @returns - Whether the URL uses HTTP(S) and the canonical Instagram hostname.
 */
export function matchesInstagramUrl(url: URL): boolean {
    return isHttpUrl(url) && url.hostname === INSTAGRAM_HOSTNAME;
}

/**
 * Recognizes a page-owned standard Instagram time element.
 *
 * @param element - Candidate timestamp element.
 *
 * @returns - Whether the element has the supported standard-time shape.
 */
function isInstagramTimeElement(element: Element): boolean {
    return isHtmlElement(element)
        && element.localName === TIMESTAMP_SOURCE_KIND.STANDARD_TIME
        && element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME)
        && !element.hasAttribute(OWNED_OUTPUT_ATTRIBUTE);
}

/**
 * Instagram presentation rule that retains the page-owned element, classes, and inline styles.
 */
export const instagramAdapter = {
    id: INSTAGRAM_ADAPTER_ID,
    mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME],
    matches: matchesInstagramUrl,
    matchesElement: isInstagramTimeElement,
    discover: (root) => discoverElements(
        root,
        INSTAGRAM_TIME_SELECTOR,
        isInstagramTimeElement,
    ),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
    ]),
    extract: (element) => {
        if (!isInstagramTimeElement(element)) {
            return null;
        }
        const rawDatetime = element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME);
        const target = findSimpleTextTarget(element);
        if (!rawDatetime || rawDatetime.trim() === '' || !target) {
            return null;
        }
        return {
            ruleId: INSTAGRAM_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.STANDARD_TIME,
            rawDatetime,
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.HTML_GLOBAL,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        };
    },
} satisfies TimestampSourceRule;
