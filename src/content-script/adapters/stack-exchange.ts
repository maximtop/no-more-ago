/**
 * @file Stack Exchange adapter for trusted title-based timestamp widgets.
 */

import { findSimpleTextTarget } from "./simple-text-target";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceRule,
} from "./types";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;
const RELATIVE_TIME_SELECTOR = "span.relativetime[title]" as const;
const CLEAN_RELATIVE_TIME_SELECTOR = "span.relativetime-clean[title]" as const;
const USER_CARD_TIME_SELECTOR = "time.s-user-card--time[title]:not([datetime])" as const;
const LAST_ACTIVITY_SELECTOR = 'a[href="?lastactivity"][title]' as const;
const STACK_EXCHANGE_TIMESTAMP_SELECTOR = [
    RELATIVE_TIME_SELECTOR,
    CLEAN_RELATIVE_TIME_SELECTOR,
    USER_CARD_TIME_SELECTOR,
    LAST_ACTIVITY_SELECTOR,
].join(", ");
const LICENSED_TITLE_PATTERN = /^(.+Z), License: CC BY-SA (?:2\.5|3\.0|4\.0)$/;
const LAST_ACTIVITY_HREF = "?lastactivity" as const;

const STACK_EXCHANGE_HOST_ROOTS = [
    "stackexchange.com",
    "stackoverflow.com",
    "serverfault.com",
    "superuser.com",
    "askubuntu.com",
    "mathoverflow.net",
    "stackapps.com",
] as const;

const EXCLUDED_STACK_EXCHANGE_HOSTNAMES = new Set([
    "blog.serverfault.com",
    "blog.stackoverflow.com",
]);

/**
 * Stable identifier for the Stack Exchange source rule.
 */
export const STACK_EXCHANGE_ADAPTER_ID = "stack-exchange" as const;

/**
 * Checks whether a hostname is one allowed root or one of its subdomains.
 *
 * @param hostname - Canonical URL hostname.
 * @param root - Allowed Stack Exchange network root.
 * @returns - Whether the hostname belongs to the root without lookalike suffixes.
 */
function belongsToHostnameRoot(hostname: string, root: string): boolean {
    return hostname === root || hostname.endsWith(`.${root}`);
}

/**
 * Checks whether a URL belongs to a supported Stack Exchange network site.
 *
 * @param url - URL considered for adapter selection.
 * @returns - Whether the URL uses HTTP(S) on an approved Q&A hostname.
 */
export function matchesStackExchangeUrl(url: URL): boolean {
    if (
        (url.protocol !== "http:" && url.protocol !== "https:")
        || EXCLUDED_STACK_EXCHANGE_HOSTNAMES.has(url.hostname)
    ) {
        return false;
    }
    return STACK_EXCHANGE_HOST_ROOTS.some(
        (root) => belongsToHostnameRoot(url.hostname, root),
    );
}

/**
 * Checks whether an element is a standard HTML element in light DOM.
 *
 * @param element - Candidate Stack Exchange timestamp source.
 * @returns - Whether the element uses the HTML namespace.
 */
function isHtmlElement(element: Element): boolean {
    return element.namespaceURI === HTML_NAMESPACE;
}

/**
 * Checks whether an element is a trusted Stack Exchange title-based timestamp source.
 *
 * @param element - Candidate Stack Exchange timestamp source.
 * @returns - Whether the element has one approved source shape.
 */
function isStackExchangeTimestampElement(element: Element): boolean {
    if (!isHtmlElement(element) || !element.hasAttribute("title")) {
        return false;
    }
    if (element.localName === "span") {
        return element.classList.contains("relativetime")
            || element.classList.contains("relativetime-clean");
    }
    if (element.localName === "time") {
        return element.classList.contains("s-user-card--time")
            && !element.hasAttribute("datetime");
    }
    return element.localName === "a"
        && element.getAttribute("href") === LAST_ACTIVITY_HREF;
}

/**
 * Reads the strict timestamp portion from one approved Stack Exchange title shape.
 *
 * @param element - Approved Stack Exchange timestamp source.
 * @returns - Raw explicit-zone timestamp, or null for an unsupported title contract.
 */
function readStackExchangeDatetime(element: Element): string | null {
    const title = element.getAttribute("title");
    if (!title) {
        return null;
    }
    if (!element.classList.contains("relativetime-clean")) {
        return title;
    }
    return title.match(LICENSED_TITLE_PATTERN)?.[1] ?? null;
}

/**
 * Specialized Stack Exchange source using only approved title-bearing widgets.
 */
export const stackExchangeAdapter: TimestampSourceRule = {
    id: STACK_EXCHANGE_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.CLASS,
        TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
        TIMESTAMP_SOURCE_ATTRIBUTE.TITLE,
    ],
    matches: matchesStackExchangeUrl,
    matchesElement: isStackExchangeTimestampElement,
    discover: (root) => {
        const candidates: Element[] = [];
        if (
            root.nodeType === Node.ELEMENT_NODE
            && isStackExchangeTimestampElement(root as Element)
        ) {
            candidates.push(root as Element);
        }
        candidates.push(...root.querySelectorAll(STACK_EXCHANGE_TIMESTAMP_SELECTOR));
        return candidates;
    },
    extract: (element) => {
        if (!isStackExchangeTimestampElement(element)) {
            return null;
        }
        const rawDatetime = readStackExchangeDatetime(element);
        const target = findSimpleTextTarget(element);
        if (!rawDatetime || !target) {
            return null;
        }
        return {
            ruleId: STACK_EXCHANGE_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.STACK_EXCHANGE_TIMESTAMP,
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
