/**
 * @file Bluesky URL, post identity, relative-target, and synchronous source contracts.
 */

import { isHttpUrl } from "../../shared/url/http";
import {
    isValidBlueskyRecordKey,
    normalizeBlueskyActor,
} from "./bluesky-identity";
import { discoverElements } from "./discover-elements";
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
const COMPACT_RELATIVE_LABEL_PATTERN = /^(?:now|\d+\s*(?:s|m|h|d|w|mo|y))$/iu;

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
 * Parses one supplied href as an exact public Bluesky post permalink.
 *
 * @param element - Anchor that owns the href and supplies its base URL.
 * @param href - Current or mutation-record href value.
 * @returns - Validated public post identity, or null for every unsupported shape.
 */
function parseBlueskyPostHref(
    element: Element,
    href: string | null,
): BlueskyPostIdentity | null {
    if (
        element.namespaceURI !== HTML_NAMESPACE
        || element.localName !== "a"
        || href === null
    ) {
        return null;
    }
    let url: URL;
    try {
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
 * Parses an exact public Bluesky post permalink without inspecting visible text.
 *
 * @param element - Potential permalink element.
 * @returns - Validated public post identity, or null for every unsupported shape.
 */
export function parseBlueskyPostPermalink(element: Element): BlueskyPostIdentity | null {
    return parseBlueskyPostHref(
        element,
        element.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF),
    );
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
 * Confirms that a page-owned label is still one of Bluesky's compact relative forms.
 *
 * The label is used only for eligibility; AppView remains the sole timestamp source.
 *
 * @param target - Unambiguous direct text node selected for presentation.
 * @returns - Whether the label is relative rather than an already exact calendar date.
 */
function isCompactRelativePresentation(target: Text): boolean {
    return COMPACT_RELATIVE_LABEL_PATTERN.test(target.data.trim());
}

/**
 * Discovers HTML elements matching one Bluesky metadata selector at and below a root.
 *
 * @param root - Bounded region to inspect.
 * @param selector - Confirmed Bluesky metadata selector.
 * @returns - Matching HTML elements in root-first document order.
 */
function discoverMetadataElements(root: ParentNode, selector: string): readonly Element[] {
    return discoverElements(root, selector, (element) => {
        return element.namespaceURI === HTML_NAMESPACE && element.matches(selector);
    });
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
 * Options used only while reconciling an already tracked source or mutation record.
 */
interface PostDescriptionOptions {
    /**
     * Accepts the extension-rendered exact label retained by a tracked source.
     */
    readonly allowExactLabel?: boolean;

    /**
     * Accepts a formerly tracked source after Bluesky removed metadata attributes.
     */
    readonly allowMissingMetadata?: boolean;

    /**
     * Uses a mutation record's previous href instead of the current attribute.
     */
    readonly href?: string | null;
}

/**
 * One unambiguous outer-post and quote association inside the smallest enclosing card.
 */
interface BlueskyCardAssociation {
    /**
     * Outer post descriptor supplying the AppView identity.
     */
    readonly outer: BlueskyRelativeTarget;

    /**
     * Single supported one-level quote label.
     */
    readonly quote: Element;
}

/**
 * Describes a confirmed ordinary relative metadata permalink.
 *
 * @param source - Potential Bluesky timestamp source.
 * @param options - Reconciliation-only allowances for retained or previous source state.
 * @returns - Current descriptor, or null when its structure is not eligible.
 */
function describePostTarget(
    source: Element,
    options: PostDescriptionOptions = {},
): BlueskyRelativeTarget | null {
    const hasMetadata = source.namespaceURI === HTML_NAMESPACE
        && source.localName === "a"
        && source.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_LABEL)
        && source.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TOOLTIP);
    if (!hasMetadata && !options.allowMissingMetadata) {
        return null;
    }
    const href = options.href === undefined
        ? source.getAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.HREF)
        : options.href;
    const outerIdentity = parseBlueskyPostHref(source, href);
    const target = findPresentationTarget(source);
    if (
        !outerIdentity
        || !target
        || (!options.allowExactLabel && !isCompactRelativePresentation(target))
    ) {
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
 * Selects one eligible quote presentation target.
 *
 * @param source - Potential non-anchor quote label.
 * @param allowExactLabel - Whether an already tracked rendered label remains eligible.
 * @returns - Existing page-owned label target, or null.
 */
function describeQuotePresentation(source: Element, allowExactLabel: boolean): Text | null {
    if (!source.matches(QUOTE_METADATA_SELECTOR)) {
        return null;
    }
    const target = findPresentationTarget(source);
    return target && (allowExactLabel || isCompactRelativePresentation(target))
        ? target
        : null;
}

/**
 * Finds the smallest unambiguous card shared by one outer post and one quote.
 *
 * @param source - Outer or quote source whose association is required.
 * @param allowExactLabels - Whether tracked rendered labels remain structurally eligible.
 * @param outerOverride - Previous or formerly tracked outer descriptor for mutation recovery.
 * @returns - Shared card association, or null when the card is absent or ambiguous.
 */
function findCardAssociation(
    source: Element,
    allowExactLabels: boolean,
    outerOverride?: BlueskyRelativeTarget,
): BlueskyCardAssociation | null {
    let card = source.parentElement;
    while (card && card.localName !== "body" && card.localName !== "html") {
        const quoteSources = discoverMetadataElements(card, QUOTE_METADATA_SELECTOR)
            .filter((candidate) => describeQuotePresentation(candidate, allowExactLabels));
        const postTargets = discoverMetadataElements(card, POST_METADATA_SELECTOR)
            .map((candidate) => describePostTarget(candidate, {
                allowExactLabel: allowExactLabels,
            }))
            .filter((target): target is BlueskyRelativeTarget => target !== null);
        if (outerOverride && card.contains(outerOverride.source)) {
            const currentIndex = postTargets.findIndex(
                ({ source: candidate }) => candidate === outerOverride.source,
            );
            if (currentIndex >= 0) {
                postTargets[currentIndex] = outerOverride;
            } else {
                postTargets.push(outerOverride);
            }
        }
        const outer = postTargets.length === 1 ? postTargets[0] : undefined;
        const quote = quoteSources.length === 1 ? quoteSources[0] : undefined;
        if (
            outer
            && quote
            && (source === outer.source || source === quote)
        ) {
            return { outer, quote };
        }
        card = card.parentElement;
    }
    return null;
}

/**
 * Describes one current Bluesky relative timestamp source without using the network.
 *
 * @param source - Potential outer-post or quote metadata source.
 * @param allowExactLabel - Whether an already tracked rendered label remains eligible.
 * @returns - Current structural descriptor, or null when unsupported or ambiguous.
 */
export function describeBlueskySource(
    source: Element,
    allowExactLabel = false,
): BlueskyRelativeTarget | null {
    const post = describePostTarget(source, { allowExactLabel });
    if (post) {
        return post;
    }
    const target = describeQuotePresentation(source, allowExactLabel);
    const association = target
        ? findCardAssociation(source, allowExactLabel)
        : null;
    if (!target || !association) {
        return null;
    }
    return {
        source,
        target,
        role: BLUESKY_TARGET_ROLE.QUOTE,
        outerIdentity: association.outer.outerIdentity,
        fingerprint: createFingerprint(
            BLUESKY_TARGET_ROLE.QUOTE,
            association.outer.outerIdentity,
        ),
    };
}

/**
 * Discovers supported targets while optionally retaining exact labels already owned by a rule.
 *
 * @param root - Bounded document region to inspect.
 * @param allowsExactLabel - Predicate for known tracked sources.
 * @returns - Unambiguous Bluesky target descriptors in document order.
 */
function discoverTargets(
    root: ParentNode,
    allowsExactLabel: (source: Element) => boolean,
): readonly BlueskyRelativeTarget[] {
    const sources = [
        ...discoverMetadataElements(root, POST_METADATA_SELECTOR),
        ...discoverMetadataElements(root, QUOTE_METADATA_SELECTOR),
    ];
    const seen = new Set<Element>();
    const targets: BlueskyRelativeTarget[] = [];
    for (const source of sources) {
        if (seen.has(source)) {
            continue;
        }
        seen.add(source);
        const target = describeBlueskySource(source, allowsExactLabel(source));
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
 * Discovers currently supported outer-post and one-level quote targets.
 *
 * @param root - Bounded document region to inspect.
 * @returns - Unambiguous Bluesky relative timestamp descriptors in document order.
 */
export function discoverBlueskyRelativeTargets(
    root: ParentNode,
): readonly BlueskyRelativeTarget[] {
    return discoverTargets(root, () => false);
}

/**
 * Maps one declared mutation to currently affected Bluesky source elements.
 *
 * @param element - Element whose attribute changed.
 * @param attributeName - Declared adapter attribute that changed.
 * @param oldValue - Previous attribute value retained for the source-rule contract.
 * @param wasTracked - Whether the element was rendered before this observer batch.
 * @returns - Exact current sources that require reconciliation.
 */
function getMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute,
    oldValue: string | null,
    wasTracked = false,
): readonly Element[] {
    const sources = new Set<Element>();
    const current = describeBlueskySource(element, wasTracked);
    if (current) {
        sources.add(element);
    }
    if (wasTracked) {
        sources.add(element);
    }
    if (element.namespaceURI !== HTML_NAMESPACE || element.localName !== "a") {
        return [...sources];
    }
    const hasMetadata = element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_LABEL)
        && element.hasAttribute(TIMESTAMP_SOURCE_ATTRIBUTE.DATA_TOOLTIP);
    const currentOuter = current?.role === BLUESKY_TARGET_ROLE.POST
        ? current
        : describePostTarget(element, {
            allowExactLabel: wasTracked,
            allowMissingMetadata: wasTracked,
        });
    const previousOuter = attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.HREF
        && oldValue !== null
        && (wasTracked || hasMetadata)
        ? describePostTarget(element, {
            allowExactLabel: true,
            allowMissingMetadata: wasTracked,
            href: oldValue,
        })
        : null;
    const outer = currentOuter ?? previousOuter;
    if (!outer) {
        return [...sources];
    }
    sources.add(element);
    const association = findCardAssociation(element, true, outer);
    if (association) {
        sources.add(association.quote);
    }
    return [...sources];
}

/**
 * Maps one changed child list to exact Bluesky sources in its smallest enclosing card.
 *
 * @param element - Connected container whose children changed.
 * @returns - Current or formerly associated sources that require re-evaluation.
 */
function getChildListMutationSources(element: Element): readonly Element[] {
    const sources = new Set<Element>();
    let current: Element | null = element;
    while (
        current
        && current.localName !== "main"
        && current.localName !== "body"
        && current.localName !== "html"
    ) {
        const candidates = [
            ...discoverMetadataElements(current, POST_METADATA_SELECTOR),
            ...discoverMetadataElements(current, QUOTE_METADATA_SELECTOR),
        ];
        for (const source of new Set(candidates)) {
            const descriptor = describeBlueskySource(source, true);
            if (descriptor) {
                sources.add(source);
                const association = findCardAssociation(
                    source,
                    true,
                    descriptor.role === BLUESKY_TARGET_ROLE.POST ? descriptor : undefined,
                );
                if (association) {
                    sources.add(association.outer.source);
                    sources.add(association.quote);
                }
            } else if (findPresentationTarget(source)) {
                sources.add(source);
            }
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
        const resolution = readResolution(source);
        const descriptor = describeBlueskySource(source, resolution !== undefined);
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
        getChildListMutationSources,
        matches: matchesBlueskyUrl,
        matchesElement: (element) => describeBlueskySource(
            element,
            readResolution(element) !== undefined,
        ) !== null,
        discover: (root) => discoverTargets(root, (source) => {
            return readResolution(source) !== undefined;
        })
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
