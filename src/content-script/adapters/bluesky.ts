/**
 * @file Bluesky URL, post identity, relative-target, and synchronous source contracts.
 */

import { isHttpUrl } from "../../shared/url/http";
import {
    isValidBlueskyRecordKey,
    normalizeBlueskyActor,
} from "./bluesky-identity";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampSourceAttribute,
    type TimestampSourceRule,
} from "./types";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;
const POST_METADATA_SELECTOR = "a[href][aria-label][data-tooltip]" as const;
const QUOTE_METADATA_SELECTOR =
    "[aria-label][data-tooltip]:not(a):not(button):not(input)" as const;
const FINGERPRINT_SEPARATOR = "\u0000" as const;

/**
 * Stable identifier for the Bluesky source rule.
 */
export const BLUESKY_ADAPTER_ID = "bluesky" as const;

/**
 * Canonical public Bluesky application hostname.
 */
export const BLUESKY_HOSTNAME = "bsky.app" as const;

/**
 * Supported relative timestamp placements within a Bluesky post card.
 */
export const BLUESKY_TARGET_ROLE = {
    POST: "post",
    QUOTE: "quote",
} as const;

/**
 * Public Bluesky record identity parsed from a canonical post permalink.
 */
export interface BlueskyPostIdentity {
    /**
     * Public handle or DID used by the permalink.
     */
    readonly actor: string;

    /**
     * AT Protocol record key used by the permalink.
     */
    readonly recordKey: string;

    /**
     * Collision-free composite key used only for lookup coordination.
     */
    readonly key: string;
}

/**
 * Current page-owned location of one eligible Bluesky relative timestamp.
 */
export interface BlueskyRelativeTarget {
    /**
     * Element reconciled by the source rule.
     */
    readonly source: Element;

    /**
     * Existing page-owned text node that may receive the exact date.
     */
    readonly target: Text;

    /**
     * Whether the target belongs to the outer post or its one-level quote.
     */
    readonly role: (typeof BLUESKY_TARGET_ROLE)[keyof typeof BLUESKY_TARGET_ROLE];

    /**
     * Public identity of the outer post used for AppView hydration.
     */
    readonly outerIdentity: BlueskyPostIdentity;

    /**
     * Stable structural association independent of localized presentation text.
     */
    readonly fingerprint: string;
}

/**
 * Trusted AppView resolution retained for one current DOM target.
 */
export interface ResolvedBlueskyTarget {
    /**
     * Exact page-owned text node that was resolved.
     */
    readonly target: Text;

    /**
     * Structural fingerprint that was resolved.
     */
    readonly fingerprint: string;

    /**
     * Validated server-observed AppView timestamp.
     */
    readonly indexedAt: string;
}

/**
 * Checks whether a URL belongs to the exact public Bluesky application host.
 *
 * @param url - Page URL considered for Bluesky processing.
 * @returns - Whether the URL uses HTTP(S) and the exact canonical hostname.
 */
export function matchesBlueskyUrl(url: URL): boolean {
    return isHttpUrl(url) && url.hostname === BLUESKY_HOSTNAME;
}

/**
 * Decodes one permalink segment while rejecting ambiguous or unsafe values.
 *
 * @param value - Encoded path segment.
 * @returns - Decoded segment, or null when it is malformed or ambiguous.
 */
function decodeIdentitySegment(value: string): string | null {
    try {
        const decoded = decodeURIComponent(value);
        return decoded === "" || hasControlOrSlash(decoded) ? null : decoded;
    } catch {
        return null;
    }
}

/**
 * Detects slashes and ASCII or C1 controls forbidden in decoded identity segments.
 *
 * @param value - Decoded permalink segment.
 * @returns - Whether the value contains an unsafe character.
 */
function hasControlOrSlash(value: string): boolean {
    for (let index = 0; index < value.length; index += 1) {
        const code = value.charCodeAt(index);
        if (value[index] === "/" || code <= 31 || (code >= 127 && code <= 159)) {
            return true;
        }
    }
    return false;
}

/**
 * Parses an exact public Bluesky post permalink without inspecting visible text.
 *
 * @param element - Potential permalink element.
 * @returns - Validated public post identity, or null for every unsupported shape.
 */
export function parseBlueskyPostPermalink(element: Element): BlueskyPostIdentity | null {
    if (
        element.namespaceURI !== HTML_NAMESPACE
        || element.localName !== "a"
        || !element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF)
    ) {
        return null;
    }
    let url: URL;
    try {
        const href = element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF);
        if (href === null) {
            return null;
        }
        url = new URL(href, element.ownerDocument.baseURI);
    } catch {
        return null;
    }
    if (
        !matchesBlueskyUrl(url)
        || url.username !== ""
        || url.password !== ""
        || url.port !== ""
    ) {
        return null;
    }
    const segments = url.pathname.split("/").slice(1);
    if (
        segments.length !== 4
        || segments[0] !== "profile"
        || segments[2] !== "post"
    ) {
        return null;
    }
    const encodedActor = segments[1];
    const encodedRecordKey = segments[3];
    if (encodedActor === undefined || encodedRecordKey === undefined) {
        return null;
    }
    const actor = normalizeBlueskyActor(decodeIdentitySegment(encodedActor) ?? "");
    const recordKey = decodeIdentitySegment(encodedRecordKey);
    if (
        !actor
        || !recordKey
        || !isValidBlueskyRecordKey(recordKey)
    ) {
        return null;
    }
    return {
        actor,
        recordKey,
        key: `${actor}${FINGERPRINT_SEPARATOR}${recordKey}`,
    };
}

/**
 * Finds quote labels whose association depends on one outer post permalink.
 *
 * @param source - Current or formerly eligible outer permalink.
 * @returns - Quote sources from the smallest unambiguous enclosing card.
 */
function findDependentQuoteSources(source: Element): readonly Element[] {
    let current = source.parentElement;
    while (current && current.localName !== "body" && current.localName !== "html") {
        const postSources = new Set(discoverMatchingElements(current, POST_METADATA_SELECTOR));
        postSources.add(source);
        if (postSources.size > 1) {
            return [];
        }
        const quotes = discoverMatchingElements(current, QUOTE_METADATA_SELECTOR)
            .filter((candidate) => findPresentationTarget(candidate) !== null);
        if (quotes.length > 0) {
            return quotes;
        }
        current = current.parentElement;
    }
    return [];
}

/**
 * Returns all matching HTML elements in a bounded root, including that root.
 *
 * @param root - Bounded document region to inspect.
 * @param selector - Selector representing one confirmed Bluesky shape.
 * @returns - Matching HTML elements in document order.
 */
function discoverMatchingElements(root: ParentNode, selector: string): readonly Element[] {
    const matches: Element[] = [];
    if (root instanceof Element && root.matches(selector)) {
        matches.push(root);
    }
    for (const element of root.querySelectorAll(selector)) {
        if (element.namespaceURI === HTML_NAMESPACE) {
            matches.push(element);
        }
    }
    return matches;
}

/**
 * Finds one replaceable direct text node while preserving every element descendant.
 *
 * @param source - Page-owned metadata element.
 * @returns - One unambiguous meaningful direct text node, or null.
 */
function findPresentationTarget(source: Element): Text | null {
    if (source.namespaceURI !== HTML_NAMESPACE || !source.isConnected) {
        return null;
    }
    const targets = Array.from(source.childNodes).filter(
        (node): node is Text => {
            if (node.nodeType !== 3) {
                return false;
            }
            return (node as Text).data.trim() !== "";
        },
    );
    return targets.length === 1 ? targets[0] ?? null : null;
}

/**
 * Creates a structural fingerprint that excludes localized presentation values.
 *
 * @param role - Outer-post or quote role.
 * @param identity - Outer post identity.
 * @returns - Stable role and identity fingerprint.
 */
function createFingerprint(
    role: BlueskyRelativeTarget["role"],
    identity: BlueskyPostIdentity,
): string {
    return `${role}${FINGERPRINT_SEPARATOR}${identity.key}`;
}

/**
 * Describes a confirmed ordinary relative metadata permalink.
 *
 * @param source - Potential Bluesky timestamp source.
 * @returns - Current descriptor, or null when its structure is not eligible.
 */
function describePostTarget(source: Element): BlueskyRelativeTarget | null {
    if (
        !source.matches(POST_METADATA_SELECTOR)
        || !source.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_LABEL)
        || !source.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TOOLTIP)
    ) {
        return null;
    }
    const outerIdentity = parseBlueskyPostPermalink(source);
    const target = findPresentationTarget(source);
    if (!outerIdentity || !target) {
        return null;
    }
    return {
        source,
        target,
        role: BLUESKY_TARGET_ROLE.POST,
        outerIdentity,
        fingerprint: createFingerprint(BLUESKY_TARGET_ROLE.POST, outerIdentity),
    };
}

/**
 * Finds an unambiguous outer post descriptor for one plain quote label.
 *
 * @param source - Potential quote timestamp label.
 * @returns - Associated outer post descriptor, or null when ambiguous.
 */
function findQuoteOuterTarget(source: Element): BlueskyRelativeTarget | null {
    let card = source.parentElement;
    while (card && card.localName !== "body" && card.localName !== "html") {
        const quoteSources = discoverMatchingElements(card, QUOTE_METADATA_SELECTOR)
            .filter((candidate) => findPresentationTarget(candidate) !== null);
        const postTargets = discoverMatchingElements(card, POST_METADATA_SELECTOR)
            .map(describePostTarget)
            .filter((target): target is BlueskyRelativeTarget => target !== null);
        if (quoteSources.length === 1 && quoteSources[0] === source && postTargets.length === 1) {
            return postTargets[0] ?? null;
        }
        card = card.parentElement;
    }
    return null;
}

/**
 * Describes one current Bluesky relative timestamp source without using the network.
 *
 * @param source - Potential outer-post or quote metadata source.
 * @returns - Current structural descriptor, or null when unsupported or ambiguous.
 */
export function describeBlueskySource(source: Element): BlueskyRelativeTarget | null {
    const post = describePostTarget(source);
    if (post) {
        return post;
    }
    if (!source.matches(QUOTE_METADATA_SELECTOR)) {
        return null;
    }
    const target = findPresentationTarget(source);
    const outer = target ? findQuoteOuterTarget(source) : null;
    if (!target || !outer) {
        return null;
    }
    return {
        source,
        target,
        role: BLUESKY_TARGET_ROLE.QUOTE,
        outerIdentity: outer.outerIdentity,
        fingerprint: createFingerprint(BLUESKY_TARGET_ROLE.QUOTE, outer.outerIdentity),
    };
}

/**
 * Discovers currently supported outer-post and one-level quote targets.
 *
 * @param root - Bounded document region to inspect.
 * @returns - Unambiguous Bluesky relative timestamp descriptors in document order.
 */
export function discoverBlueskyRelativeTargets(
    root: ParentNode,
): readonly BlueskyRelativeTarget[] {
    const sources = [
        ...discoverMatchingElements(root, POST_METADATA_SELECTOR),
        ...discoverMatchingElements(root, QUOTE_METADATA_SELECTOR),
    ];
    const seen = new Set<Element>();
    const targets: BlueskyRelativeTarget[] = [];
    for (const source of sources) {
        if (seen.has(source)) {
            continue;
        }
        seen.add(source);
        const target = describeBlueskySource(source);
        if (target) {
            targets.push(target);
        }
    }
    return targets.sort((left, right) => {
        const position = left.source.compareDocumentPosition(right.source);
        return position & Node.DOCUMENT_POSITION_PRECEDING ? 1 : -1;
    });
}

/**
 * Maps one declared mutation to currently affected Bluesky source elements.
 *
 * @param element - Element whose attribute changed.
 * @param attributeName - Declared adapter attribute that changed.
 * @param oldValue - Previous attribute value retained for the source-rule contract.
 * @returns - Exact current sources that require reconciliation.
 */
function getMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute,
    oldValue: string | null,
): readonly Element[] {
    const sources = new Set<Element>();
    if (describeBlueskySource(element)) {
        sources.add(element);
    }
    const wasDirectSource = oldValue !== null
        && element.namespaceURI === HTML_NAMESPACE
        && (
            (
                attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.HREF
                && element.localName === "a"
            )
            || (
                (
                    attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_LABEL
                    || attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TOOLTIP
                )
                && (
                    element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF)
                    || element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_LABEL)
                    || element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TOOLTIP)
                )
            )
        );
    if (wasDirectSource) {
        sources.add(element);
    }
    if (
        element.localName === "a"
        && (
            element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF)
            || (
                attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.HREF
                && oldValue !== null
            )
        )
    ) {
        for (const quote of findDependentQuoteSources(element)) {
            sources.add(quote);
        }
    }
    const anchor = element.closest(POST_METADATA_SELECTOR);
    if (anchor && describeBlueskySource(anchor)) {
        sources.add(anchor);
    }
    let current = element.parentElement;
    while (current && current.localName !== "body" && current.localName !== "html") {
        for (const target of discoverBlueskyRelativeTargets(current)) {
            sources.add(target.source);
        }
        if (sources.size > 0) {
            break;
        }
        current = current.parentElement;
    }
    return [...sources];
}

/**
 * Creates a synchronous Bluesky source rule backed by trusted coordinator resolutions.
 *
 * @param readResolution - Returns a current AppView resolution for one source.
 * @returns - Document-scoped timestamp source rule with no network behavior.
 */
export function createBlueskyAdapter(
    readResolution: (source: Element) => ResolvedBlueskyTarget | undefined,
): TimestampSourceRule {
    const readCurrentResolution = (
        source: Element,
    ): { readonly descriptor: BlueskyRelativeTarget; readonly resolution: ResolvedBlueskyTarget }
        | null => {
        const descriptor = describeBlueskySource(source);
        const resolution = readResolution(source);
        return descriptor
            && resolution
            && descriptor.target === resolution.target
            && descriptor.fingerprint === resolution.fingerprint
            ? { descriptor, resolution }
            : null;
    };
    return {
        id: BLUESKY_ADAPTER_ID,
        mutationAttributes: [
            TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
            TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_LABEL,
            TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TOOLTIP,
        ],
        getMutationSources,
        matches: matchesBlueskyUrl,
        matchesElement: (element) => describeBlueskySource(element) !== null,
        discover: (root) => discoverBlueskyRelativeTargets(root)
            .filter(({ source }) => readCurrentResolution(source) !== null)
            .map(({ source }) => source),
        extract: (element) => {
            const current = readCurrentResolution(element);
            if (!current) {
                return null;
            }
            return {
                ruleId: BLUESKY_ADAPTER_ID,
                source: element,
                sourceKind: TIMESTAMP_SOURCE_KIND.BLUESKY_POST,
                rawDatetime: current.resolution.indexedAt,
                presentation: {
                    kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                    target: current.descriptor.target,
                },
                validationRule: TIMESTAMP_VALIDATION_RULE.EXPLICIT_ISO_ZONE,
                visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
            };
        },
    };
}
