/**
 * @file LinkedIn adapter for best-effort timestamps derived from local IDs.
 */

import { findSimpleTextTarget } from "./simple-text-target";
import {
    LINKEDIN_ID_KIND,
    decodeLinkedInIdMilliseconds,
    parseLinkedInIds,
    type LinkedInLogicalId,
} from "./linkedin-id";
import {
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_ATTRIBUTE,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    TIMESTAMP_VISIBILITY_POLICY,
    type TimestampExtractionContext,
    type TimestampSourceRule,
} from "./types";

const HTML_NAMESPACE = "http://www.w3.org/1999/xhtml" as const;
const LINKEDIN_ROOT_HOSTNAME = "linkedin.com" as const;
const MAX_ASSOCIATION_DEPTH = 8;
const LABEL_SELECTOR = [
    "p[componentkey] > span",
    ".update-components-actor__sub-description span[aria-hidden='true']",
    "time.comments-comment-meta__data:not([datetime])",
].join(", ");
const EVIDENCE_SELECTOR = [
    "[componentkey]",
    "[data-sdui-anchor-id]",
    "[data-id]",
    "[data-urn]",
    "a[href]",
].join(", ");
const RELATIVE_PRESENTATION_PATTERN = new RegExp(
    "^(?<prefix>\\s*)(?:\\d+\\s*(?:mo|yr|s|m|h|d|w|y)|just now)"
        + "(?<suffix>\\s*(?:•[\\s\\S]*)?)$",
    "iu",
);
const EVIDENCE_ATTRIBUTES = [
    TIMESTAMP_SOURCE_ATTRIBUTE.COMPONENT_KEY,
    TIMESTAMP_SOURCE_ATTRIBUTE.SDUI_ANCHOR_ID,
    TIMESTAMP_SOURCE_ATTRIBUTE.DATA_ID,
    TIMESTAMP_SOURCE_ATTRIBUTE.DATA_URN,
    TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
] as const;

/**
 * Stable identifier for the LinkedIn source rule.
 */
export const LINKEDIN_ADAPTER_ID = "linkedin" as const;

/**
 * Page-owned label and exact preserved text delimiters.
 */
interface LinkedInPresentation {
    /**
     * Structurally recognized timestamp label element.
     */
    readonly label: Element;

    /**
     * Existing page-owned timestamp Text node.
     */
    readonly target: Text;

    /**
     * Page-authored content before the replaceable timestamp segment.
     */
    readonly textPrefix: string;

    /**
     * Page-authored content after the replaceable timestamp segment.
     */
    readonly textSuffix: string;
}

/**
 * Unambiguous local relationship between one label and one target ID.
 */
interface LinkedInAssociation extends LinkedInPresentation {
    /**
     * Smallest accepted local source boundary.
     */
    readonly source: Element;

    /**
     * One nearest unambiguous logical target ID.
     */
    readonly id: LinkedInLogicalId;
}

/**
 * Supported target IDs carried by one approved DOM evidence element.
 */
interface LinkedInEvidence {
    /**
     * Target IDs parsed from that element's approved attributes.
     */
    readonly ids: readonly LinkedInLogicalId[];
}

/**
 * Checks whether a URL belongs to LinkedIn over HTTP(S).
 *
 * @param url - URL considered for adapter selection.
 * @returns - Whether the URL has the root LinkedIn host or a true subdomain.
 */
export function matchesLinkedInUrl(url: URL): boolean {
    return (url.protocol === "http:" || url.protocol === "https:")
        && (
            url.hostname === LINKEDIN_ROOT_HOSTNAME
            || url.hostname.endsWith(`.${LINKEDIN_ROOT_HOSTNAME}`)
        );
}

/**
 * Returns matching elements from a Document or Element, including the root.
 *
 * @param root - DOM region to inspect.
 * @param selector - Selector limited to adapter-owned shapes.
 * @returns - Matching elements in document order.
 */
function selectElements(root: ParentNode, selector: string): readonly Element[] {
    const elements = Array.from(root.querySelectorAll(selector));
    const rootNode = root as Node;
    if (rootNode.nodeType === 1) {
        const rootElement = rootNode as Element;
        if (rootElement.matches(selector)) {
            elements.unshift(rootElement);
        }
    }
    return elements;
}

/**
 * Resolves the page-authored relative segment and exact preserved delimiters.
 *
 * @param label - Structurally accepted LinkedIn label element.
 * @param context - Optional processing context with retained page text.
 * @returns - Existing target and delimiters, or null for an unsupported shape.
 */
function resolvePresentation(
    label: Element,
    context?: TimestampExtractionContext,
): LinkedInPresentation | null {
    if (label.namespaceURI !== HTML_NAMESPACE) {
        return null;
    }
    const target = findSimpleTextTarget(label);
    if (!target) {
        return null;
    }
    const pageText = context?.readPageText(target) ?? target.data;
    const match = pageText.match(RELATIVE_PRESENTATION_PATTERN);
    const prefix = match?.groups?.prefix;
    const suffix = match?.groups?.suffix;
    return prefix === undefined || suffix === undefined
        ? null
        : {
            label,
            target,
            textPrefix: prefix,
            textSuffix: suffix,
        };
}

/**
 * Removes a composite comment's parent thread from target-ID consideration.
 *
 * @param value - One adapter-approved evidence attribute.
 * @returns - Explicit comment IDs, or post IDs when the value has no comment.
 */
function parseTargetIds(value: string): readonly LinkedInLogicalId[] {
    const ids = parseLinkedInIds(value);
    const comments = ids.filter((id) => id.kind === LINKEDIN_ID_KIND.COMMENT);
    return comments.length > 0 ? comments : ids;
}

/**
 * Collects supported target evidence only from approved attributes.
 *
 * @param scope - Candidate local association boundary.
 * @returns - Evidence elements with deduplicated target IDs.
 */
function collectEvidence(scope: Element): readonly LinkedInEvidence[] {
    return selectElements(scope, EVIDENCE_SELECTOR).flatMap((element) => {
        const ids = new Map<string, LinkedInLogicalId>();
        for (const attribute of EVIDENCE_ATTRIBUTES) {
            const value = element.getAttribute(attribute);
            if (value === null) {
                continue;
            }
            for (const id of parseTargetIds(value)) {
                ids.set(`${id.kind}:${id.decimal}`, id);
            }
        }
        return ids.size > 0 ? [{ ids: [...ids.values()] }] : [];
    });
}

/**
 * Selects one logical target and rejects every distinct local competitor.
 *
 * @param evidence - Approved evidence inside the local boundary.
 * @returns - One deduplicated logical target, or null when absent or ambiguous.
 */
function selectLogicalId(evidence: readonly LinkedInEvidence[]): LinkedInLogicalId | null {
    const ids = new Map<string, LinkedInLogicalId>();
    for (const entry of evidence) {
        for (const id of entry.ids) {
            ids.set(`${id.kind}:${id.decimal}`, id);
        }
    }
    return ids.size === 1 ? ids.values().next().value ?? null : null;
}

/**
 * Rejects document-scale containers as local timestamp association sources.
 *
 * @param element - Candidate association boundary.
 * @returns - Whether the element is too broad for one local timestamp source.
 */
function isBroadAssociationBoundary(element: Element): boolean {
    return element === element.ownerDocument.documentElement
        || element === element.ownerDocument.body
        || element.localName === "main";
}

/**
 * Checks whether one changed attribute can introduce LinkedIn timestamp input.
 *
 * @param element - Element carrying the observed mutation.
 * @param attributeName - Changed adapter-owned attribute.
 * @returns - Whether local source lookup is necessary.
 */
function hasRelevantAttributeMutation(
    element: Element,
    attributeName: string,
): boolean {
    if (
        attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.COMPONENT_KEY
        && element.localName === "p"
        && Array.from(element.children).some((child) => child.localName === "span")
    ) {
        return true;
    }
    if (!EVIDENCE_ATTRIBUTES.some((attribute) => attribute === attributeName)) {
        return false;
    }
    const value = element.getAttribute(attributeName);
    return value !== null && parseTargetIds(value).length > 0;
}

/**
 * Finds eligible label presentations inside one candidate scope.
 *
 * @param scope - Candidate local association boundary.
 * @param context - Processing context.
 * @returns - Eligible page-owned presentations.
 */
function collectPresentations(
    scope: ParentNode,
    context?: TimestampExtractionContext,
): readonly LinkedInPresentation[] {
    return selectElements(scope, LABEL_SELECTOR)
        .map((label) => resolvePresentation(label, context))
        .filter((value): value is LinkedInPresentation => value !== null);
}

/**
 * Finds the smallest ancestor containing one label and one logical target ID.
 *
 * @param presentation - Eligible label presentation.
 * @param context - Processing context.
 * @returns - Accepted source boundary, or null when local association fails.
 */
function findAssociationSource(
    presentation: LinkedInPresentation,
    context?: TimestampExtractionContext,
): Element | null {
    let scope: Element | null = presentation.label.parentElement;
    for (let depth = 0; scope && depth < MAX_ASSOCIATION_DEPTH; depth += 1) {
        if (isBroadAssociationBoundary(scope)) {
            return null;
        }
        const presentations = collectPresentations(scope, context);
        if (presentations.length > 1) {
            return null;
        }
        if (
            presentations.length === 1
            && selectLogicalId(collectEvidence(scope)) !== null
        ) {
            return scope;
        }
        scope = scope.parentElement;
    }
    return null;
}

/**
 * Reconstructs one complete association for exact-source reconciliation.
 *
 * @param source - Candidate source boundary.
 * @param context - Processing context.
 * @returns - One unambiguous association, or null.
 */
function resolveAssociation(
    source: Element,
    context?: TimestampExtractionContext,
): LinkedInAssociation | null {
    if (isBroadAssociationBoundary(source)) {
        return null;
    }
    const presentations = collectPresentations(source, context).filter(
        (presentation) => findAssociationSource(presentation, context) === source,
    );
    const presentation = presentations[0];
    if (presentations.length !== 1 || !presentation) {
        return null;
    }
    const id = selectLogicalId(collectEvidence(source));
    return id ? { ...presentation, source, id } : null;
}

/**
 * Specialized LinkedIn source using only accepted local ID evidence.
 */
export const linkedinAdapter: TimestampSourceRule = {
    id: LINKEDIN_ADAPTER_ID,
    mutationAttributes: EVIDENCE_ATTRIBUTES,
    matches: matchesLinkedInUrl,
    shouldInspectMutation: (element, attributeName) => attributeName === undefined
        ? !isBroadAssociationBoundary(element)
        : hasRelevantAttributeMutation(element, attributeName),
    matchesElement: (element, context) => resolveAssociation(element, context) !== null,
    discover: (root, context) => {
        const sources = new Set<Element>();
        for (const presentation of collectPresentations(root, context)) {
            const source = findAssociationSource(presentation, context);
            if (source) {
                sources.add(source);
            }
        }
        return [...sources];
    },
    extract: (element, context) => {
        const association = resolveAssociation(element, context);
        if (!association) {
            return null;
        }
        const epochMilliseconds = decodeLinkedInIdMilliseconds(association.id);
        if (epochMilliseconds === null) {
            return null;
        }
        return {
            ruleId: LINKEDIN_ADAPTER_ID,
            source: association.source,
            sourceKind: TIMESTAMP_SOURCE_KIND.LINKEDIN_TIMESTAMP,
            epochMilliseconds,
            presentation: {
                kind: TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT,
                target: association.target,
                textPrefix: association.textPrefix,
                textSuffix: association.textSuffix,
            },
            validationRule: TIMESTAMP_VALIDATION_RULE.DERIVED_UNIX_MILLISECONDS,
            visibilityPolicy: TIMESTAMP_VISIBILITY_POLICY.IGNORE_PAGE_SUPPRESSION,
        };
    },
};
