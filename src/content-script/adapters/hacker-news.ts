/**
 * @file Hacker News adapter for trusted span.age title timestamps.
 */

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

const AGE_SELECTOR = 'span.age[title]' as const;
const UNZONED_UTC_DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/;

/**
 * Stable identifier for the Hacker News source rule.
 */
export const HACKER_NEWS_ADAPTER_ID = 'hacker-news' as const;

/**
 * Canonical hostname handled by the Hacker News adapter.
 */
export const HACKER_NEWS_HOSTNAME = 'news.ycombinator.com' as const;

/**
 * Checks whether a URL belongs to the supported HTTP(S) Hacker News origin.
 *
 * @param url - URL considered for adapter selection.
 *
 * @returns - Whether the URL uses HTTP(S) and the canonical hostname.
 */
export function matchesHackerNewsUrl(url: URL): boolean {
    return (
        (url.protocol === 'http:' || url.protocol === 'https:')
        && url.hostname === HACKER_NEWS_HOSTNAME
    );
}

/**
 * Checks whether an element has the exact Hacker News age source shape.
 *
 * @param element - Candidate Hacker News timestamp element.
 *
 * @returns - Whether the element can be extracted by this adapter.
 */
function isHackerNewsAgeElement(element: Element): boolean {
    return (
        isHtmlElement(element)
        && element.localName === 'span'
        && element.classList.contains('age')
        && element.hasAttribute('title')
    );
}

/**
 * Selects a simple linked or no-link label without replacing page-owned DOM.
 *
 * @param source - Hacker News age widget.
 *
 * @returns - Existing date-label text node, or null for an ambiguous shape.
 */
function findPresentationTarget(source: Element): Text | null {
    const children = Array.from(source.children);
    if (children.length === 0) {
        return findSimpleTextTarget(source);
    }
    const link = children[0];
    if (
        children.length !== 1
        || !link
        || !isHtmlElement(link)
        || link.localName !== 'a'
    ) {
        return null;
    }
    const outsideLabel = Array.from(source.childNodes).some(
        (node) => node.nodeType === 3 && (node as Text).data.trim() !== '',
    );
    return outsideLabel ? null : findSimpleTextTarget(link);
}

/**
 * Converts Hacker News's page-owned UTC datetime shape to explicit ISO UTC.
 *
 * Hacker News emits second-precision UTC values without a zone suffix. Other
 * unzoned shapes remain ambiguous and fail the shared explicit-zone parser.
 *
 * @param value - Datetime copied from the Hacker News age title.
 *
 * @returns - Explicitly zoned datetime for the evidenced UTC shape.
 */
function normalizeHackerNewsDatetime(value: string): string {
    return UNZONED_UTC_DATETIME.test(value) ? `${value}Z` : value;
}

/**
 * Specialized Hacker News source using only the page-owned age title.
 */
export const hackerNewsAdapter = {
    id: HACKER_NEWS_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.CLASS,
        TIMESTAMP_SOURCE_ATTRIBUTE.TITLE,
    ],
    matches: matchesHackerNewsUrl,
    matchesElement: isHackerNewsAgeElement,
    discover: (root) => discoverElements(root, AGE_SELECTOR, isHackerNewsAgeElement),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
    ]),
    extract: (element) => {
        if (!isHackerNewsAgeElement(element)) {
            return null;
        }
        const rawDatetime = element.getAttribute('title');
        const target = findPresentationTarget(element);
        if (!rawDatetime || rawDatetime.trim() === '' || !target) {
            return null;
        }
        return {
            ruleId: HACKER_NEWS_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.HACKER_NEWS_AGE,
            rawDatetime: normalizeHackerNewsDatetime(rawDatetime),
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        };
    },
} satisfies TimestampSourceRule;
