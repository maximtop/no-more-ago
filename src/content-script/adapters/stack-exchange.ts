/**
 * @file Stack Exchange adapter for trusted title-based timestamp widgets.
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

const RELATIVE_TIME_SELECTOR = 'span.relativetime[title]' as const;
const CLEAN_RELATIVE_TIME_SELECTOR = 'span.relativetime-clean[title]' as const;
const USER_CARD_TIME_SELECTOR = 'time.s-user-card--time[title]:not([datetime])' as const;
const LAST_ACTIVITY_SELECTOR = 'a[href="?lastactivity"][title]' as const;
const STACK_EXCHANGE_TIMESTAMP_SELECTOR = [
    RELATIVE_TIME_SELECTOR,
    CLEAN_RELATIVE_TIME_SELECTOR,
    USER_CARD_TIME_SELECTOR,
    LAST_ACTIVITY_SELECTOR,
].join(', ');
const LICENSED_TITLE_PATTERN = /^(.+Z), License: CC BY-SA (?:2\.5|3\.0|4\.0)$/;
const STACK_EXCHANGE_NETWORK_SUFFIX = '.stackexchange.com' as const;
const STACK_EXCHANGE_SERVICE_LABELS = new Set([
    'api',
    'area51',
    'blog',
    'chat',
    'contests',
    'data',
    'openid',
    'status',
]);
const BRANDED_QA_HOSTNAMES = new Set([
    'askubuntu.com',
    'mathoverflow.net',
    'meta.askubuntu.com',
    'meta.mathoverflow.net',
    'meta.serverfault.com',
    'meta.stackoverflow.com',
    'meta.superuser.com',
    'serverfault.com',
    'stackapps.com',
    'stackoverflow.com',
    'superuser.com',
]);
const STACK_OVERFLOW_QA_SITE_LABELS = new Set([
    'agents',
    'es',
    'ja',
    'pt',
    'ru',
]);

/**
 * Stable identifier for the Stack Exchange source rule.
 */
export const STACK_EXCHANGE_ADAPTER_ID = 'stack-exchange' as const;

/**
 * Checks whether a hostname uses a Stack Exchange network Q&A shape.
 *
 * @param hostname - Canonical URL hostname.
 *
 * @returns - Whether the hostname is a network meta, site, or per-site meta host.
 */
function matchesStackExchangeNetworkHostname(hostname: string): boolean {
    if (!hostname.endsWith(STACK_EXCHANGE_NETWORK_SUFFIX)) {
        return false;
    }
    const prefix = hostname.slice(0, -STACK_EXCHANGE_NETWORK_SUFFIX.length);
    const labels = prefix.split('.');
    if (labels.length === 1) {
        const site = labels[0];
        return site === 'meta' || Boolean(site && !STACK_EXCHANGE_SERVICE_LABELS.has(site));
    }
    const [site, meta] = labels;
    return labels.length === 2
        && meta === 'meta'
        && Boolean(site && !STACK_EXCHANGE_SERVICE_LABELS.has(site));
}

/**
 * Checks whether a hostname is one known localized Stack Overflow Q&A host.
 *
 * @param hostname - Canonical URL hostname.
 *
 * @returns - Whether the hostname is a localized main or meta Q&A site.
 */
function matchesLocalizedStackOverflowHostname(hostname: string): boolean {
    const labels = hostname.split('.');
    if (labels.length === 3) {
        return labels[1] === 'stackoverflow'
            && labels[2] === 'com'
            && STACK_OVERFLOW_QA_SITE_LABELS.has(labels[0] ?? '');
    }
    return labels.length === 4
        && labels[1] === 'meta'
        && labels[2] === 'stackoverflow'
        && labels[3] === 'com'
        && STACK_OVERFLOW_QA_SITE_LABELS.has(labels[0] ?? '');
}

/**
 * Checks whether a URL belongs to a supported Stack Exchange network site.
 *
 * @param url - URL considered for adapter selection.
 *
 * @returns - Whether the URL uses HTTP(S) on an approved Q&A hostname.
 */
export function matchesStackExchangeUrl(url: URL): boolean {
    if (url.protocol !== 'http:' && url.protocol !== 'https:') {
        return false;
    }
    return BRANDED_QA_HOSTNAMES.has(url.hostname)
        || matchesLocalizedStackOverflowHostname(url.hostname)
        || matchesStackExchangeNetworkHostname(url.hostname);
}

/**
 * Checks whether an element is a trusted Stack Exchange title-based timestamp source.
 *
 * @param element - Candidate Stack Exchange timestamp source.
 *
 * @returns - Whether the element has one approved source shape.
 */
function isStackExchangeTimestampElement(element: Element): boolean {
    return isHtmlElement(element) && element.matches(STACK_EXCHANGE_TIMESTAMP_SELECTOR);
}

/**
 * Extracts raw title text from one approved Stack Exchange source shape.
 *
 * @param element - Approved Stack Exchange timestamp source.
 *
 * @returns - Raw text for downstream strict validation, or null for an unsupported license.
 */
function readStackExchangeDatetime(element: Element): string | null {
    const title = element.getAttribute('title');
    if (!title) {
        return null;
    }
    if (!element.classList.contains('relativetime-clean')) {
        return title;
    }
    return title.match(LICENSED_TITLE_PATTERN)?.[1] ?? null;
}

/**
 * Specialized Stack Exchange source using only approved title-bearing widgets.
 */
export const stackExchangeAdapter = {
    id: STACK_EXCHANGE_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.CLASS,
        TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME,
        TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
        TIMESTAMP_SOURCE_ATTRIBUTE.TITLE,
    ],
    matches: matchesStackExchangeUrl,
    matchesElement: isStackExchangeTimestampElement,
    discover: (root) => discoverElements(
        root,
        STACK_EXCHANGE_TIMESTAMP_SELECTOR,
        isStackExchangeTimestampElement,
    ),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
    ], ['Over a year ago', '1 min ago']),
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
} satisfies TimestampSourceRule;
