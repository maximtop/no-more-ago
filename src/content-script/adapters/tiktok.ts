/**
 * @file Discovers trusted TikTok direct-publication timestamps.
 */

import { discoverElements } from './discover-elements';
import { isHtmlElement } from './html-element';
import {
    RELATIVE_PRESENTATION_PROFILE,
    createRelativePresentationClassifier,
} from './relative-presentation';
import { findSimpleTextTarget } from './simple-text-target';
import {
    isTikTokHydrationScript,
    isTikTokPostId,
    invalidateTikTokHydrationCache,
    resolveTikTokPublicationDatetime,
    TIKTOK_HYDRATION_SELECTOR,
} from './tiktok-timestamp';
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampPresentation,
    type TimestampSourceAttribute,
    type TimestampSourceRule,
} from './types';

const LEGACY_DIRECT_MARKER = 'browser-nickname' as const;
const DIRECT_FEED_MARKER = 'recommend-list-item-container' as const;
const LEGACY_DIRECT_SOURCE_SELECTOR = `[data-e2e="${LEGACY_DIRECT_MARKER}"]` as const;
const DIRECT_FEED_SOURCE_SELECTOR = `article[data-e2e="${DIRECT_FEED_MARKER}"]` as const;
const AUTHOR_PROFILE_PATH = /^\/@[^/]+\/?$/u;
const PUBLICATION_PATH = /^\/(@[^/]+)\/(video|photo)\/([^/]+)\/?$/u;
const DIRECT_FEED_WRAPPER_ID = /^xgwrapper-\d+-(.+)$/u;
const MAXIMUM_HYDRATION_RECONCILIATION_SOURCES = 2_000;
const MAXIMUM_HYDRATION_RECONCILIATION_VISITS = 100_000;

/**
 * Stable identifier for legacy TikTok direct-page metadata.
 */
export const TIKTOK_LEGACY_DIRECT_ADAPTER_ID = 'tiktok-legacy-direct' as const;

/**
 * Stable identifier for current TikTok direct-feed metadata.
 */
export const TIKTOK_DIRECT_FEED_ADAPTER_ID = 'tiktok-direct-feed' as const;

/**
 * Canonical hostname handled by the TikTok adapters.
 */
export const TIKTOK_HOSTNAME = 'www.tiktok.com' as const;

/**
 * Supported publication identity parsed from a TikTok path.
 */
interface TikTokPublication {
    /**
     * Exact profile pathname segment owning the publication.
     */
    readonly authorPath: string;

    /**
     * Strict decimal post ID.
     */
    readonly id: string;

}

/**
 * Checks the exact supported TikTok origin.
 *
 * @param url - URL considered by the adapter.
 *
 * @returns - Whether the URL is HTTPS on the canonical hostname.
 */
function hasTikTokOrigin(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === TIKTOK_HOSTNAME;
}

/**
 * Parses one supported direct publication URL.
 *
 * @param url - Candidate TikTok URL.
 *
 * @returns - Publication identity, or null outside direct video/photo paths.
 */
function parsePublication(url: URL): TikTokPublication | null {
    if (!hasTikTokOrigin(url)) {
        return null;
    }
    const match = url.pathname.match(PUBLICATION_PATH);
    const author = match?.[1];
    const kind = match?.[2];
    const id = match?.[3];
    return author && (kind === 'video' || kind === 'photo') && id && isTikTokPostId(id)
        ? { authorPath: `/${author}`, id }
        : null;
}

/**
 * Extracts a strict TikTok post ID from one direct-feed wrapper ID.
 *
 * @param value - Candidate wrapper ID.
 *
 * @returns - Supported post ID, or null for another wrapper shape.
 */
function getDirectFeedPostId(value: string): string | null {
    const id = value.match(DIRECT_FEED_WRAPPER_ID)?.[1];
    return id && isTikTokPostId(id) ? id : null;
}

/**
 * Checks one serialized link destination against the exact TikTok profile shape.
 *
 * @param href - Current or prior serialized link destination.
 *
 * @returns - Whether the destination is an exact canonical TikTok profile.
 */
function isProfileHref(href: string | null): boolean {
    if (href === null) {
        return false;
    }
    try {
        const url = new URL(href, `https://${TIKTOK_HOSTNAME}/`);
        return hasTikTokOrigin(url) && AUTHOR_PROFILE_PATH.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * Checks whether a URL belongs to a confirmed TikTok publication surface.
 *
 * @param url - URL considered for adapter selection.
 *
 * @returns - Whether the URL is a direct video or photo surface.
 */
export function matchesTikTokUrl(url: URL): boolean {
    return parsePublication(url) !== null;
}

/**
 * Checks the observed direct-page metadata source shape.
 *
 * @param element - Candidate direct publication source.
 *
 * @returns - Whether the element owns the observed metadata marker.
 */
function isLegacyDirectSource(element: Element): boolean {
    return isHtmlElement(element)
        && element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E)
            === LEGACY_DIRECT_MARKER;
}

/**
 * Checks the observed direct feed-article source shape.
 *
 * @param element - Candidate direct publication source.
 *
 * @returns - Whether the element is one TikTok feed article.
 */
function isDirectFeedSource(element: Element): boolean {
    return isHtmlElement(element)
        && element.localName === 'article'
        && element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E)
            === DIRECT_FEED_MARKER;
}

/**
 * Selects the last simple direct span as the page-owned publication date.
 *
 * @param source - Observed direct metadata source.
 *
 * @returns - Simple date text node, or null for ambiguous markup.
 */
function findLegacyDirectDateTarget(source: Element): Text | null {
    const spans = Array.from(source.children).filter(
        (child) => isHtmlElement(child) && child.localName === 'span',
    );
    if (spans.length < 2) {
        return null;
    }
    const container = spans.at(-1);
    return container ? findSimpleTextTarget(container) : null;
}

/**
 * Checks whether one link points to the publication author's exact profile.
 *
 * @param link - Candidate author link.
 * @param publication - Current direct publication identity.
 *
 * @returns - Whether the link owns the expected exact profile path.
 */
function isPublicationAuthorLink(link: Element, publication: TikTokPublication): boolean {
    const href = link.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF);
    if (!isHtmlElement(link) || link.localName !== 'a' || href === null) {
        return false;
    }
    try {
        const url = new URL(href, `https://${TIKTOK_HOSTNAME}/`);
        return hasTikTokOrigin(url)
            && url.pathname.replace(/\/$/u, '') === publication.authorPath;
    } catch {
        return false;
    }
}

/**
 * Finds one unambiguous simple date beside the current feed publication's author link.
 *
 * @param source - Candidate direct feed article.
 * @param publication - Current direct publication identity.
 *
 * @returns - Exact page-owned date text, or null for another or ambiguous article.
 */
function findDirectFeedDateTarget(
    source: Element,
    publication: TikTokPublication,
): Text | null {
    const ownsPublication = Array.from(source.querySelectorAll('[id]')).some(
        (element) => getDirectFeedPostId(element.id) === publication.id,
    );
    if (!ownsPublication) {
        return null;
    }
    const targets = Array.from(source.querySelectorAll('a[href]')).flatMap((link) => {
        if (!isPublicationAuthorLink(link, publication)) {
            return [];
        }
        const row = link.parentElement;
        if (!row || row.children.length !== 2 || row.firstElementChild !== link) {
            return [];
        }
        const date = row.lastElementChild;
        if (!date || !isHtmlElement(date) || date.localName !== 'span') {
            return [];
        }
        const target = findSimpleTextTarget(date);
        return target ? [target] : [];
    });
    return targets.length === 1 ? targets[0] ?? null : null;
}

/**
 * Creates an in-place TikTok presentation while retaining its author separator.
 *
 * @param target - Exact simple page-owned timestamp text.
 *
 * @returns - Presentation with an optional retained leading bullet segment.
 */
function createDirectPresentation(target: Text): TimestampPresentation {
    const textPrefix = target.data.match(/^\s*·\s*/u)?.[0] ?? '';
    return {
        kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
        target,
        ...(textPrefix === '' ? {} : { textPrefix }),
    };
}

/**
 * Checks whether one changed subtree contains the exact hydration script.
 *
 * @param node - Added or removed page-authored node.
 *
 * @returns - Whether the subtree can replace TikTok hydration evidence.
 */
function containsHydrationScript(node: Node): boolean {
    if (node.nodeType !== 1) {
        return false;
    }
    const element = node as Element;
    return isTikTokHydrationScript(element)
        || element.querySelector(TIKTOK_HYDRATION_SELECTOR) !== null;
}

/**
 * Checks whether a child-list mutation replaced supported hydration evidence.
 *
 * @param element - Element whose direct children changed.
 * @param addedNodes - Nodes added by the mutation.
 * @param removedNodes - Nodes removed by the mutation.
 *
 * @returns - Whether current TikTok sources need bounded evidence reconciliation.
 */
function changesHydration(
    element: Element,
    addedNodes: readonly Node[],
    removedNodes: readonly Node[],
): boolean {
    const changed = isTikTokHydrationScript(element)
        || addedNodes.some(containsHydrationScript)
        || removedNodes.some(containsHydrationScript);
    if (changed) {
        invalidateTikTokHydrationCache(element.ownerDocument);
    }
    return changed;
}

/**
 * Discovers a bounded source prefix after one hydration replacement.
 *
 * @param document - TikTok document containing current source elements.
 * @param selector - Exact surface-specific source selector.
 * @param predicate - Source-shape predicate for the surface.
 *
 * @returns - Bounded source prefix requiring evidence reconciliation.
 */
function discoverHydrationSources(
    document: Document,
    selector: string,
    predicate: (element: Element) => boolean,
): readonly Element[] {
    const sources: Element[] = [];
    const walker = document.createTreeWalker(document, NodeFilter.SHOW_ELEMENT);
    let visited = 0;
    let node = walker.nextNode();
    while (node && visited < MAXIMUM_HYDRATION_RECONCILIATION_VISITS) {
        visited += 1;
        const element = node as Element;
        node = walker.nextNode();
        if (!element.matches(selector)) {
            continue;
        }
        if (predicate(element)) {
            sources.push(element);
            if (sources.length === MAXIMUM_HYDRATION_RECONCILIATION_SOURCES) {
                break;
            }
        }
    }
    return sources;
}

/**
 * Creates one validated TikTok timestamp candidate from trusted publication evidence.
 *
 * @param ruleId - Surface-specific source rule identifier.
 * @param source - Page-owned timestamp source.
 * @param publication - Publication identity used for hydration and ID evidence.
 * @param presentation - Surface-specific output presentation.
 *
 * @returns - Trusted candidate, or null when timestamp evidence is invalid.
 */
function createCandidate(
    ruleId: string,
    source: Element,
    publication: TikTokPublication,
    presentation: TimestampPresentation,
) {
    const rawDatetime = resolveTikTokPublicationDatetime(
        source.ownerDocument,
        publication.id,
    );
    if (!rawDatetime) {
        return null;
    }
    return {
        ruleId,
        source,
        sourceKind: TIMESTAMP_SOURCE_KIND.TIKTOK_PUBLICATION,
        rawDatetime,
        presentation,
        validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
        visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
    } as const;
}

/**
 * Maps legacy metadata marker changes to the affected source.
 *
 * @param element - Element whose adapter-declared attribute changed.
 * @param attributeName - Changed attribute.
 * @param oldValue - Previous serialized value.
 *
 * @returns - Exact legacy source requiring reconciliation.
 */
function getLegacyMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute | undefined,
    oldValue: string | null,
): readonly Element[] {
    if (attributeName !== TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E) {
        return [];
    }
    const currentValue = element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E);
    return currentValue === LEGACY_DIRECT_MARKER || oldValue === LEGACY_DIRECT_MARKER
        ? [element]
        : [];
}

/**
 * Maps feed metadata changes to their containing article.
 *
 * @param element - Element whose adapter-declared attribute changed.
 * @param attributeName - Changed attribute.
 * @param oldValue - Previous serialized value.
 *
 * @returns - Exact feed article requiring reconciliation.
 */
function getDirectFeedMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute | undefined,
    oldValue: string | null,
): readonly Element[] {
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.HREF) {
        const source = element.closest(DIRECT_FEED_SOURCE_SELECTOR);
        return source && (
            isProfileHref(element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF))
            || isProfileHref(oldValue)
        )
            ? [source]
            : [];
    }
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.ID) {
        if (
            getDirectFeedPostId(element.id) !== null
            || (oldValue !== null && getDirectFeedPostId(oldValue) !== null)
        ) {
            const source = element.closest(DIRECT_FEED_SOURCE_SELECTOR);
            return source ? [source] : [];
        }
        return [];
    }
    if (attributeName !== TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E) {
        return [];
    }
    const currentValue = element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E);
    return isHtmlElement(element)
        && element.localName === 'article'
        && (currentValue === DIRECT_FEED_MARKER || oldValue === DIRECT_FEED_MARKER)
        ? [element]
        : [];
}

/**
 * Creates bounded hydration invalidation for one surface-specific selector.
 *
 * @param selector - Exact source selector for the rule.
 * @param predicate - Source-shape predicate for the rule.
 *
 * @returns - Child-list mutation mapper for that source surface.
 */
function hydrationMutationSources(
    selector: string,
    predicate: (element: Element) => boolean,
): NonNullable<TimestampSourceRule['getChildMutationSources']> {
    return (element, addedNodes, removedNodes) => (changesHydration(
        element,
        addedNodes,
        removedNodes,
    )
        ? discoverHydrationSources(
            element.ownerDocument,
            selector,
            predicate,
        )
        : []);
}

/**
 * Legacy TikTok direct-page timestamp source.
 */
export const tiktokLegacyDirectAdapter: TimestampSourceRule = {
    id: TIKTOK_LEGACY_DIRECT_ADAPTER_ID,
    mutationAttributes: [TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E],
    getMutationSources: getLegacyMutationSources,
    getChildMutationSources: hydrationMutationSources(
        LEGACY_DIRECT_SOURCE_SELECTOR,
        isLegacyDirectSource,
    ),
    matches: (url) => parsePublication(url) !== null,
    matchesElement: isLegacyDirectSource,
    discover: (root) => discoverElements(
        root,
        LEGACY_DIRECT_SOURCE_SELECTOR,
        isLegacyDirectSource,
    ),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
    ]),
    extract: (element, context) => {
        const publication = parsePublication(context.url);
        const target = isLegacyDirectSource(element)
            ? findLegacyDirectDateTarget(element)
            : null;
        if (!publication || !target) {
            return null;
        }
        return createCandidate(
            TIKTOK_LEGACY_DIRECT_ADAPTER_ID,
            element,
            publication,
            createDirectPresentation(target),
        );
    },
};

/**
 * Current TikTok direct-feed timestamp source.
 */
export const tiktokDirectFeedAdapter: TimestampSourceRule = {
    id: TIKTOK_DIRECT_FEED_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E,
        TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
        TIMESTAMP_SOURCE_ATTRIBUTE.ID,
    ],
    getMutationSources: getDirectFeedMutationSources,
    getChildMutationSources: hydrationMutationSources(
        DIRECT_FEED_SOURCE_SELECTOR,
        isDirectFeedSource,
    ),
    matches: (url) => parsePublication(url) !== null,
    matchesElement: isDirectFeedSource,
    discover: (root) => discoverElements(
        root,
        DIRECT_FEED_SOURCE_SELECTOR,
        isDirectFeedSource,
    ),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
    ]),
    extract: (element, context) => {
        const publication = parsePublication(context.url);
        const target = publication && isDirectFeedSource(element)
            ? findDirectFeedDateTarget(element, publication)
            : null;
        if (!publication || !target) {
            return null;
        }
        return createCandidate(
            TIKTOK_DIRECT_FEED_ADAPTER_ID,
            element,
            publication,
            createDirectPresentation(target),
        );
    },
};

/**
 * Ordered TikTok source rules registered before the generic fallback.
 */
export const tiktokAdapters = [
    tiktokLegacyDirectAdapter,
    tiktokDirectFeedAdapter,
] as const;
