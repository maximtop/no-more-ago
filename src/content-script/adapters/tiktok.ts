/**
 * @file Discovers trusted TikTok profile-card and direct-publication timestamps.
 */

import { discoverElements } from "./discover-elements";
import { findSimpleTextTarget } from "./simple-text-target";
import { resolveTikTokPublicationDatetime } from "./tiktok-timestamp";
import {
    APPENDED_TIME_PRESENTATION,
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampPresentation,
    type TimestampSourceAttribute,
    type TimestampSourceRule,
} from "./types";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;
const PROFILE_ITEM_SELECTOR = '[data-e2e="user-post-item"]' as const;
const PROFILE_LINK_SELECTOR = '[data-e2e="user-post-item"] a[href]' as const;
const LEGACY_DIRECT_SOURCE_SELECTOR = '[data-e2e="browser-nickname"]' as const;
const DIRECT_FEED_SOURCE_SELECTOR =
    'article[data-e2e="recommend-list-item-container"]' as const;
const SOURCE_SELECTOR = `${PROFILE_LINK_SELECTOR}, ${LEGACY_DIRECT_SOURCE_SELECTOR}, `
    + DIRECT_FEED_SOURCE_SELECTOR;
const PROFILE_PATH = /^\/@[^/]+\/?$/u;
const PUBLICATION_PATH = /^\/(@[^/]+)\/(video|photo)\/([1-9]\d{18})\/?$/u;
const DIRECT_FEED_WRAPPER_ID = /^xgwrapper-\d+-([1-9]\d{18})$/u;

/**
 * Stable identifier for the TikTok timestamp source rule.
 */
export const TIKTOK_ADAPTER_ID = "tiktok" as const;

/**
 * Canonical hostname handled by the TikTok adapter.
 */
export const TIKTOK_HOSTNAME = "www.tiktok.com" as const;

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

    /**
     * Publication path kind.
     */
    readonly kind: "video" | "photo";
}

/**
 * Checks the exact supported TikTok origin.
 *
 * @param url - URL considered by the adapter.
 * @returns - Whether the URL is HTTPS on the canonical hostname.
 */
function hasTikTokOrigin(url: URL): boolean {
    return url.protocol === "https:" && url.hostname === TIKTOK_HOSTNAME;
}

/**
 * Parses one supported direct publication URL.
 *
 * @param url - Candidate TikTok URL.
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
    return author && (kind === "video" || kind === "photo") && id
        ? { authorPath: `/${author}`, id, kind }
        : null;
}

/**
 * Checks whether a URL is one exact supported profile grid.
 *
 * @param url - Candidate TikTok URL.
 * @returns - Whether the URL has the exact user-profile path shape.
 */
function isProfileUrl(url: URL): boolean {
    return hasTikTokOrigin(url) && PROFILE_PATH.test(url.pathname);
}

/**
 * Checks one serialized link destination against the exact TikTok profile shape.
 *
 * @param href - Current or prior serialized link destination.
 * @returns - Whether the destination is an exact canonical TikTok profile.
 */
function isProfileHref(href: string | null): boolean {
    if (href === null) {
        return false;
    }
    try {
        const url = new URL(href, `https://${TIKTOK_HOSTNAME}/`);
        return hasTikTokOrigin(url) && PROFILE_PATH.test(url.pathname);
    } catch {
        return false;
    }
}

/**
 * Checks whether a URL belongs to any confirmed TikTok surface.
 *
 * @param url - URL considered for adapter selection.
 * @returns - Whether the URL is a profile, video, or photo surface.
 */
export function matchesTikTokUrl(url: URL): boolean {
    return isProfileUrl(url) || parsePublication(url) !== null;
}

/**
 * Parses a profile link against the exact TikTok origin.
 *
 * @param element - Candidate HTML anchor.
 * @param href - Current or prior serialized href.
 * @returns - Publication identity, or null for another destination.
 */
function parseLinkPublication(
    element: Element,
    href: string | null = element.getAttribute("href"),
): TikTokPublication | null {
    if (href === null) {
        return null;
    }
    try {
        return parsePublication(new URL(href, `https://${TIKTOK_HOSTNAME}/`));
    } catch {
        return null;
    }
}

/**
 * Checks whether one link is the only publication link owned by its card.
 *
 * @param element - Candidate profile-card source.
 * @returns - Whether the link has an unambiguous supported card owner.
 */
function isProfileCardLink(element: Element): boolean {
    if (
        element.namespaceURI !== HTML_NAMESPACE
        || element.localName !== "a"
        || parseLinkPublication(element) === null
    ) {
        return false;
    }
    const owner = element.closest(PROFILE_ITEM_SELECTOR);
    if (!owner) {
        return false;
    }
    const links = Array.from(owner.querySelectorAll("a[href]")).filter(
        (link) => link.closest(PROFILE_ITEM_SELECTOR) === owner
            && parseLinkPublication(link) !== null,
    );
    return links.length === 1 && links[0] === element;
}

/**
 * Checks the observed direct-page metadata source shape.
 *
 * @param element - Candidate direct publication source.
 * @returns - Whether the element owns the observed metadata marker.
 */
function isLegacyDirectSource(element: Element): boolean {
    return element.namespaceURI === HTML_NAMESPACE
        && element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E)
            === "browser-nickname";
}

/**
 * Checks the observed direct feed-article source shape.
 *
 * @param element - Candidate direct publication source.
 * @returns - Whether the element is one TikTok feed article.
 */
function isDirectFeedSource(element: Element): boolean {
    return element.namespaceURI === HTML_NAMESPACE
        && element.localName === "article"
        && element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E)
            === "recommend-list-item-container";
}

/**
 * Checks either retained direct-page source shape.
 *
 * @param element - Candidate direct publication source.
 * @returns - Whether the element is eligible for direct-page extraction.
 */
function isDirectSource(element: Element): boolean {
    return isLegacyDirectSource(element) || isDirectFeedSource(element);
}

/**
 * Checks either supported TikTok source shape independent of current surface.
 *
 * @param element - Candidate source element.
 * @returns - Whether the element can be reconciled by this adapter.
 */
function isTikTokSource(element: Element): boolean {
    return isProfileCardLink(element) || isDirectSource(element);
}

/**
 * Selects the last simple direct span as the page-owned publication date.
 *
 * @param source - Observed direct metadata source.
 * @returns - Simple date text node, or null for ambiguous markup.
 */
function findLegacyDirectDateTarget(source: Element): Text | null {
    const spans = Array.from(source.children).filter(
        (child) => child.namespaceURI === HTML_NAMESPACE && child.localName === "span",
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
 * @returns - Whether the link owns the expected exact profile path.
 */
function isPublicationAuthorLink(link: Element, publication: TikTokPublication): boolean {
    const href = link.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF);
    if (link.localName !== "a" || href === null) {
        return false;
    }
    try {
        const url = new URL(href, `https://${TIKTOK_HOSTNAME}/`);
        return hasTikTokOrigin(url)
            && url.pathname.replace(/\/$/u, "") === publication.authorPath;
    } catch {
        return false;
    }
}

/**
 * Finds one unambiguous simple date beside the current feed publication's author link.
 *
 * @param source - Candidate direct feed article.
 * @param publication - Current direct publication identity.
 * @returns - Exact page-owned date text, or null for another or ambiguous article.
 */
function findDirectFeedDateTarget(
    source: Element,
    publication: TikTokPublication,
): Text | null {
    const ownsPublication = Array.from(source.querySelectorAll("[id]")).some((element) =>
        element.id.match(DIRECT_FEED_WRAPPER_ID)?.[1] === publication.id
    );
    if (!ownsPublication) {
        return null;
    }
    const targets = Array.from(source.querySelectorAll("a[href]")).flatMap((link) => {
        if (!isPublicationAuthorLink(link, publication)) {
            return [];
        }
        const row = link.parentElement;
        if (
            !row
            || row.children.length !== 2
            || row.firstElementChild !== link
        ) {
            return [];
        }
        const date = row.lastElementChild;
        if (!date || date.localName !== "span") {
            return [];
        }
        const target = findSimpleTextTarget(date);
        return target ? [target] : [];
    });
    return targets.length === 1 ? targets[0] ?? null : null;
}

/**
 * Selects the exact direct-page date target for the recognized markup shape.
 *
 * @param source - Candidate direct publication source.
 * @param publication - Current direct publication identity.
 * @returns - Exact page-owned date text, or null for an unsupported shape.
 */
function findDirectDateTarget(
    source: Element,
    publication: TikTokPublication,
): Text | null {
    return isLegacyDirectSource(source)
        ? findLegacyDirectDateTarget(source)
        : findDirectFeedDateTarget(source, publication);
}

/**
 * Maps href and data-e2e changes to affected TikTok sources.
 *
 * @param element - Element whose adapter-declared attribute changed.
 * @param attributeName - Changed attribute.
 * @param oldValue - Previous serialized value.
 * @returns - Exact sources requiring reconciliation.
 */
function getMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute,
    oldValue: string | null,
): readonly Element[] {
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.HREF) {
        if (
            element.localName === "a"
            && (isProfileCardLink(element) || parseLinkPublication(element, oldValue) !== null)
        ) {
            return [element];
        }
        const feedSource = element.closest(DIRECT_FEED_SOURCE_SELECTOR);
        return feedSource && (
            isProfileHref(element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF))
            || isProfileHref(oldValue)
        )
            ? [feedSource]
            : [];
    }
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.ID) {
        if (
            DIRECT_FEED_WRAPPER_ID.test(element.id)
            || (oldValue !== null && DIRECT_FEED_WRAPPER_ID.test(oldValue))
        ) {
            const feedSource = element.closest(DIRECT_FEED_SOURCE_SELECTOR);
            return feedSource ? [feedSource] : [];
        }
        return [];
    }
    if (attributeName !== TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E) {
        return [];
    }
    const currentValue = element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E);
    if (currentValue === "browser-nickname" || oldValue === "browser-nickname") {
        return [element];
    }
    if (
        element.localName === "article"
        && (
            currentValue === "recommend-list-item-container"
            || oldValue === "recommend-list-item-container"
        )
    ) {
        return [element];
    }
    if (currentValue !== "user-post-item" && oldValue !== "user-post-item") {
        return [];
    }
    return Array.from(element.querySelectorAll("a[href]")).filter(
        (link) => parseLinkPublication(link) !== null,
    );
}

/**
 * Specialized TikTok source using matching hydration or decoded post IDs.
 */
export const tiktokAdapter: TimestampSourceRule = {
    id: TIKTOK_ADAPTER_ID,
    mutationAttributes: [
        TIMESTAMP_SOURCE_ATTRIBUTE.DATA_E2E,
        TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
        TIMESTAMP_SOURCE_ATTRIBUTE.ID,
    ],
    getMutationSources,
    matches: matchesTikTokUrl,
    matchesElement: isTikTokSource,
    discover: (root) => discoverElements(root, SOURCE_SELECTOR, isTikTokSource),
    extract: (element, context) => {
        const url = context?.url;
        if (!url || !matchesTikTokUrl(url)) {
            return null;
        }
        let publication: TikTokPublication | null;
        let presentation: TimestampPresentation;
        if (isProfileUrl(url) && isProfileCardLink(element)) {
            publication = parseLinkPublication(element);
            presentation = APPENDED_TIME_PRESENTATION;
        } else if (isDirectSource(element)) {
            publication = parsePublication(url);
            const target = publication ? findDirectDateTarget(element, publication) : null;
            if (!publication || !target) {
                return null;
            }
            presentation = {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target,
            } as const;
        } else {
            return null;
        }
        if (!publication) {
            return null;
        }
        const rawDatetime = resolveTikTokPublicationDatetime(
            element.ownerDocument,
            publication.id,
        );
        if (!rawDatetime) {
            return null;
        }
        return {
            ruleId: TIKTOK_ADAPTER_ID,
            source: element,
            sourceKind: TIMESTAMP_SOURCE_KIND.TIKTOK_PUBLICATION,
            rawDatetime,
            presentation,
            validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION,
        };
    },
};
