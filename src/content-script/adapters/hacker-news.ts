/**
 * @file Hacker News adapter for trusted span.age title timestamps.
 */

import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "./types";

const AGE_SELECTOR = "span.age[title]" as const;
const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;

/**
 * Stable identifier for the Hacker News source rule.
 */
export const HACKER_NEWS_ADAPTER_ID = "hacker-news" as const;

/**
 * Canonical hostname handled by the Hacker News adapter.
 */
export const HACKER_NEWS_HOSTNAME = "news.ycombinator.com" as const;

/**
 * Checks whether a URL belongs to the supported HTTP(S) Hacker News origin.
 *
 * @param url - URL considered for adapter selection.
 * @returns - Whether the URL uses HTTP(S) and the canonical hostname.
 */
export function matchesHackerNewsUrl(url: URL): boolean {
    return (
        (url.protocol === "http:" || url.protocol === "https:")
        && url.hostname === HACKER_NEWS_HOSTNAME
    );
}

/**
 * Checks whether an element has the exact Hacker News age source shape.
 *
 * @param element - Candidate Hacker News timestamp element.
 * @returns - Whether the element can be extracted by this adapter.
 */
function isHackerNewsAgeElement(element: Element): boolean {
    return (
        element.namespaceURI === HTML_NAMESPACE
        && element.localName === "span"
        && element.classList.contains("age")
        && element.hasAttribute("title")
    );
}

/**
 * Finds the only meaningful text node in a container without element children.
 *
 * @param container - Link or no-link age widget whose label is inspected.
 * @returns - One unambiguous text target, or null for complex content.
 */
function findSimpleText(container: Element): Text | null {
    if (container.children.length > 0) {
        return null;
    }
    const targets = Array.from(container.childNodes).filter(
        (node): node is Text => node.nodeType === 3 && (node as Text).data.trim() !== "",
    );
    return targets.length === 1 ? targets[0] ?? null : null;
}

/**
 * Selects a simple linked or no-link label without replacing page-owned DOM.
 *
 * @param source - Hacker News age widget.
 * @returns - Existing date-label text node, or null for an ambiguous shape.
 */
function findPresentationTarget(source: Element): Text | null {
    const children = Array.from(source.children);
    if (children.length === 0) {
        return findSimpleText(source);
    }
    const link = children[0];
    if (
        children.length !== 1
        || !link
        || link.namespaceURI !== HTML_NAMESPACE
        || link.localName !== "a"
    ) {
        return null;
    }
    const outsideLabel = Array.from(source.childNodes).some(
        (node) => node.nodeType === 3 && (node as Text).data.trim() !== "",
    );
    return outsideLabel ? null : findSimpleText(link);
}

/**
 * Specialized Hacker News source using only the page-owned age title.
 */
export const hackerNewsAdapter: TimestampSourceRule = {
    id: HACKER_NEWS_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.CLASS,
        TIMESTAMP_SOURCE_ATTRIBUTE.TITLE,
    ],
    matches: matchesHackerNewsUrl,
    matchesElement: isHackerNewsAgeElement,
    discover: (root) => {
        const candidates: Element[] = [];
        if (root.nodeType === 1 && isHackerNewsAgeElement(root as Element)) {
            candidates.push(root as Element);
        }
        candidates.push(...root.querySelectorAll(AGE_SELECTOR));
        return candidates;
    },
    extract: (element) => {
        if (!isHackerNewsAgeElement(element)) {
            return null;
        }
        const rawDatetime = element.getAttribute("title");
        const target = findPresentationTarget(element);
        if (!rawDatetime || rawDatetime.trim() === "" || !target) {
            return null;
        }
        return {
            ruleId: HACKER_NEWS_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.HACKER_NEWS_AGE,
            rawDatetime,
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        };
    },
};
