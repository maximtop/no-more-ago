/**
 * @file LinkedIn adapter for best-effort timestamps derived from local IDs.
 */

import { discoverElements } from './discover-elements';
import { isHtmlElement } from './html-element';
import {
    decodeLinkedInIdMilliseconds,
    parseLinkedInPostUrn,
    parseLinkedInTargetIds,
    type LinkedInLogicalId,
} from './linkedin-id';
import {
    MAX_PRESENTATION_TEXT_LENGTH,
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
    type TimestampExtractionContext,
    type TimestampMutationSourceResult,
    type TimestampSourceAttribute,
    type TimestampSourceRule,
} from './types';

const LINKEDIN_ROOT_HOSTNAME = 'linkedin.com' as const;
const LINKEDIN_URL_BASE = 'https://www.linkedin.com' as const;
const MAX_ASSOCIATION_DEPTH = 8;
const MAX_MUTATION_SCAN_ELEMENTS = 128;
const LABEL_SELECTOR = [
    'p[componentkey] > span',
    ".update-components-actor__sub-description span[aria-hidden='true']",
    'time.comments-comment-meta__data:not([datetime])',
].join(', ');
const EVIDENCE_SELECTOR = [
    '[componentkey]',
    '[data-sdui-anchor-id]',
    '[data-id]',
    '[data-urn]',
    'a[href]',
].join(', ');
const LINKEDIN_PERMALINK_PATTERN = /^\/feed\/update\/([^/]+)\/?$/u;
const EVIDENCE_ATTRIBUTES = [
    TIMESTAMP_SOURCE_ATTRIBUTE.COMPONENT_KEY,
    TIMESTAMP_SOURCE_ATTRIBUTE.SDUI_ANCHOR_ID,
    TIMESTAMP_SOURCE_ATTRIBUTE.DATA_ID,
    TIMESTAMP_SOURCE_ATTRIBUTE.DATA_URN,
    TIMESTAMP_SOURCE_ATTRIBUTE.HREF,
] as const;
const MUTATION_ATTRIBUTES = [
    ...EVIDENCE_ATTRIBUTES,
    TIMESTAMP_SOURCE_ATTRIBUTE.CLASS,
    TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_HIDDEN,
    TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME,
] as const;

/**
 * Stable identifier for the LinkedIn source rule.
 */
export const LINKEDIN_ADAPTER_ID = 'linkedin' as const;

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
 * One logical ID and its number of distinct local evidence occurrences.
 */
interface CountedLinkedInId {
    /**
     * Parsed logical ID.
     */
    readonly id: LinkedInLogicalId;

    /**
     * Number of evidence elements contributing the ID.
     */
    count: number;
}

/**
 * Scope-local logical IDs keyed by kind and decimal value.
 */
type LinkedInIdCounts = Map<string, CountedLinkedInId>;

/**
 * Indexes candidate scopes, parsed evidence, and unresolved labels for one pass.
 */
interface LinkedInAssociationIndex {
    /**
     * Root whose descendants may participate in this pass.
     */
    readonly root: ParentNode;

    /**
     * Bounded local scopes considered for each presentation.
     */
    readonly scopesByPresentation: ReadonlyMap<
        LinkedInPresentation,
        readonly Element[]
    >;

    /**
     * All candidate scopes used to avoid indexing unrelated ancestors.
     */
    readonly candidateScopes: ReadonlySet<Element>;

    /**
     * Parsed evidence counts aggregated once for each candidate scope.
     */
    readonly evidenceByScope: ReadonlyMap<Element, LinkedInIdCounts>;

    /**
     * Evidence already owned by independently associated descendant sources.
     */
    readonly excludedByScope: Map<Element, LinkedInIdCounts>;

    /**
     * Presentations that still compete inside each candidate scope.
     */
    readonly pendingByScope: Map<Element, Set<LinkedInPresentation>>;
}

const cachedAssociationsByContext = new WeakMap<
    TimestampExtractionContext,
    Map<Element, LinkedInAssociation>
>();

/**
 * Checks whether a URL belongs to LinkedIn over HTTP(S).
 *
 * @param url - URL considered for adapter selection.
 *
 * @returns - Whether the URL has the root LinkedIn host or a true subdomain.
 */
export function matchesLinkedInUrl(url: URL): boolean {
    return (url.protocol === 'http:' || url.protocol === 'https:')
        && (
            url.hostname === LINKEDIN_ROOT_HOSTNAME
            || url.hostname.endsWith(`.${LINKEDIN_ROOT_HOSTNAME}`)
        );
}

/**
 * Resolves the page-authored timestamp segment and exact preserved delimiters.
 *
 * @param label - Structurally accepted LinkedIn label element.
 * @param context - Processing context with retained page text.
 *
 * @returns - Existing target and delimiters, or null for an unsupported shape.
 */
function resolvePresentation(
    label: Element,
    context: TimestampExtractionContext,
): LinkedInPresentation | null {
    if (!isHtmlElement(label)) {
        return null;
    }
    const target = findSimpleTextTarget(label);
    if (!target) {
        return null;
    }
    const text = context.readPageText(target);
    if (text.length > MAX_PRESENTATION_TEXT_LENGTH) {
        return null;
    }
    const withoutPrefix = text.trimStart();
    if (withoutPrefix.length === 0) {
        return {
            label,
            target,
            textPrefix: '',
            textSuffix: '',
        };
    }
    const prefixLength = text.length - withoutPrefix.length;
    const bulletIndex = withoutPrefix.indexOf('•');
    const timestampRegion = bulletIndex === -1
        ? withoutPrefix
        : withoutPrefix.slice(0, bulletIndex);
    const timestamp = timestampRegion.trimEnd();
    if (timestamp.length === 0) {
        return null;
    }
    const suffixStart = prefixLength + timestamp.length;
    return {
        label,
        target,
        textPrefix: text.slice(0, prefixLength),
        textSuffix: text.slice(suffixStart),
    };
}

/**
 * Parses IDs only from a direct LinkedIn feed permalink path.
 *
 * @param value - Raw href attribute value.
 *
 * @returns - The permalink's supported target ID, or an empty collection.
 */
function parseLinkedInPermalinkIds(value: string): readonly LinkedInLogicalId[] {
    let url: URL;
    try {
        url = new URL(value, LINKEDIN_URL_BASE);
    } catch {
        return [];
    }
    if (!matchesLinkedInUrl(url) || url.search.length > 0 || url.hash.length > 0) {
        return [];
    }
    let pathname: string;
    try {
        pathname = decodeURIComponent(url.pathname);
    } catch {
        return [];
    }
    const urn = pathname.match(LINKEDIN_PERMALINK_PATTERN)?.[1];
    const id = urn ? parseLinkedInPostUrn(urn) : null;
    return id ? [id] : [];
}

/**
 * Collects deduplicated target IDs from one approved evidence element.
 *
 * @param element - Evidence element carrying adapter-approved attributes.
 *
 * @returns - Supported target IDs in attribute order.
 */
function collectElementIds(element: Element): readonly LinkedInLogicalId[] {
    const ids = new Map<string, LinkedInLogicalId>();
    for (const attribute of EVIDENCE_ATTRIBUTES) {
        const value = element.getAttribute(attribute);
        if (value !== null) {
            const parsed = attribute === TIMESTAMP_SOURCE_ATTRIBUTE.HREF
                ? parseLinkedInPermalinkIds(value)
                : parseLinkedInTargetIds(value);
            for (const id of parsed) {
                ids.set(`${id.kind}:${id.decimal}`, id);
            }
        }
    }
    return [...ids.values()];
}

/**
 * Finds structurally supported label presentations inside one candidate root.
 *
 * @param root - Candidate local association root.
 * @param context - Processing context.
 *
 * @returns - Structural page-owned presentation candidates in document order.
 */
function collectPresentations(
    root: ParentNode,
    context: TimestampExtractionContext,
): readonly LinkedInPresentation[] {
    return discoverElements(
        root,
        LABEL_SELECTOR,
        (element) => isHtmlElement(element) && element.matches(LABEL_SELECTOR),
    )
        .map((label) => resolvePresentation(label, context))
        .filter((value): value is LinkedInPresentation => value !== null);
}

/**
 * Finds adapter-approved evidence elements inside one candidate root.
 *
 * @param root - Candidate local association root.
 *
 * @returns - Evidence elements in document order.
 */
function collectEvidenceElements(root: ParentNode): readonly Element[] {
    return discoverElements(
        root,
        EVIDENCE_SELECTOR,
        (element) => isHtmlElement(element) && element.matches(EVIDENCE_SELECTOR),
    );
}

/**
 * Rejects document-scale containers as local timestamp association sources.
 *
 * @param element - Candidate association boundary.
 *
 * @returns - Whether the element is too broad for one local timestamp source.
 */
function isBroadAssociationBoundary(element: Element): boolean {
    return element === element.ownerDocument.documentElement
        || element === element.ownerDocument.body
        || element.localName === 'main';
}

/**
 * Returns the nearest content item that evidence must not escape.
 *
 * @param element - Label, evidence, or candidate scope.
 *
 * @returns - Nearest article boundary, or null when the shape has none.
 */
function findContentItemBoundary(element: Element): Element | null {
    return element.closest('article');
}

/**
 * Checks whether one element remains inside an inspected root.
 *
 * @param element - Candidate descendant or element root.
 * @param root - Document or element root for this pass.
 *
 * @returns - Whether the element belongs to the root.
 */
function belongsToRoot(element: Element, root: ParentNode): boolean {
    const rootNode = root as Node;
    return rootNode.nodeType === Node.DOCUMENT_NODE
        || element === rootNode
        || rootNode.contains(element);
}

/**
 * Collects one label's bounded ancestor scopes without crossing its content item.
 *
 * @param presentation - Structurally supported page-owned label.
 * @param root - Document or exact source root.
 *
 * @returns - Candidate scopes from nearest to broadest.
 */
function collectAssociationScopes(
    presentation: LinkedInPresentation,
    root: ParentNode,
): readonly Element[] {
    const scopes: Element[] = [];
    const contentBoundary = findContentItemBoundary(presentation.label);
    let scope: Element | null = presentation.label.parentElement;
    for (let depth = 0; scope && depth < MAX_ASSOCIATION_DEPTH; depth += 1) {
        if (isBroadAssociationBoundary(scope) || !belongsToRoot(scope, root)) {
            break;
        }
        scopes.push(scope);
        if (scope === contentBoundary || scope === root) {
            break;
        }
        scope = scope.parentElement;
    }
    return scopes;
}

/**
 * Adds logical IDs to a mutable counted collection.
 *
 * @param target - Counted collection to update.
 * @param ids - Logical IDs contributed by one evidence element.
 */
function addLogicalIds(
    target: LinkedInIdCounts,
    ids: readonly LinkedInLogicalId[],
): void {
    for (const id of ids) {
        const key = `${id.kind}:${id.decimal}`;
        const existing = target.get(key);
        if (existing) {
            existing.count += 1;
        } else {
            target.set(key, { id, count: 1 });
        }
    }
}

/**
 * Adds counted logical IDs to another mutable collection.
 *
 * @param target - Counted collection to update.
 * @param source - Counted IDs to merge.
 */
function addLogicalIdCounts(target: LinkedInIdCounts, source: LinkedInIdCounts): void {
    for (const [key, entry] of source) {
        const existing = target.get(key);
        if (existing) {
            existing.count += entry.count;
        } else {
            target.set(key, { id: entry.id, count: entry.count });
        }
    }
}

/**
 * Builds one pass-local index instead of rescanning all evidence for every label.
 *
 * @param root - Document or exact source subtree to inspect.
 * @param presentations - Structural label candidates inside the root.
 *
 * @returns - Candidate-scope, evidence, and pending-presentation indexes.
 */
function createAssociationIndex(
    root: ParentNode,
    presentations: readonly LinkedInPresentation[],
): LinkedInAssociationIndex {
    const scopesByPresentation = new Map<LinkedInPresentation, readonly Element[]>();
    const candidateScopes = new Set<Element>();
    const pendingByScope = new Map<Element, Set<LinkedInPresentation>>();
    for (const presentation of presentations) {
        const scopes = collectAssociationScopes(presentation, root);
        scopesByPresentation.set(presentation, scopes);
        for (const scope of scopes) {
            candidateScopes.add(scope);
            const pending = pendingByScope.get(scope) ?? new Set<LinkedInPresentation>();
            pending.add(presentation);
            pendingByScope.set(scope, pending);
        }
    }
    const evidenceByScope = new Map<Element, LinkedInIdCounts>();
    for (const evidence of collectEvidenceElements(root)) {
        const ids = collectElementIds(evidence);
        if (ids.length > 0) {
            const contentBoundary = findContentItemBoundary(evidence);
            let scope: Element | null = evidence;
            while (scope && belongsToRoot(scope, root)) {
                if (
                    candidateScopes.has(scope)
                    && findContentItemBoundary(scope) === contentBoundary
                ) {
                    const counts = evidenceByScope.get(scope)
                        ?? new Map<string, CountedLinkedInId>();
                    addLogicalIds(counts, ids);
                    evidenceByScope.set(scope, counts);
                }
                if (
                    scope === contentBoundary
                    || scope === root
                    || isBroadAssociationBoundary(scope)
                ) {
                    break;
                }
                scope = scope.parentElement;
            }
        }
    }
    return {
        root,
        scopesByPresentation,
        candidateScopes,
        evidenceByScope,
        excludedByScope: new Map(),
        pendingByScope,
    };
}

/**
 * Returns evidence remaining after independently associated descendants are excluded.
 *
 * @param index - Pass-local association index.
 * @param scope - Candidate source boundary.
 *
 * @returns - Effective scope-local evidence counts.
 */
function getEffectiveEvidence(
    index: LinkedInAssociationIndex,
    scope: Element,
): LinkedInIdCounts {
    const effective: LinkedInIdCounts = new Map();
    const excluded = index.excludedByScope.get(scope);
    for (const [key, entry] of index.evidenceByScope.get(scope) ?? []) {
        const count = entry.count - (excluded?.get(key)?.count ?? 0);
        if (count > 0) {
            effective.set(key, { id: entry.id, count });
        }
    }
    return effective;
}

/**
 * Finds one presentation's smallest currently unambiguous local association.
 *
 * @param presentation - Structural label presentation candidate.
 * @param index - Pass-local association index.
 *
 * @returns - Accepted association, or null while local evidence is unsuitable.
 */
function findAssociation(
    presentation: LinkedInPresentation,
    index: LinkedInAssociationIndex,
): LinkedInAssociation | null {
    for (const scope of index.scopesByPresentation.get(presentation) ?? []) {
        if ((index.pendingByScope.get(scope)?.size ?? 0) <= 1) {
            const evidence = getEffectiveEvidence(index, scope);
            const id = evidence.size === 1 ? evidence.values().next().value?.id : undefined;
            if (id) {
                return { ...presentation, source: scope, id };
            }
        }
    }
    return null;
}

/**
 * Excludes one accepted source's effective evidence from broader local scopes.
 *
 * @param association - Newly accepted local association.
 * @param index - Mutable pass-local association index.
 */
function excludeAssociationEvidence(
    association: LinkedInAssociation,
    index: LinkedInAssociationIndex,
): void {
    const evidence = getEffectiveEvidence(index, association.source);
    const contentBoundary = findContentItemBoundary(association.source);
    if (association.source === contentBoundary) {
        return;
    }
    let scope = association.source.parentElement;
    while (scope && belongsToRoot(scope, index.root)) {
        if (
            index.candidateScopes.has(scope)
            && findContentItemBoundary(scope) === contentBoundary
        ) {
            const excluded = index.excludedByScope.get(scope)
                ?? new Map<string, CountedLinkedInId>();
            addLogicalIdCounts(excluded, evidence);
            index.excludedByScope.set(scope, excluded);
        }
        if (
            scope === contentBoundary
            || scope === index.root
            || isBroadAssociationBoundary(scope)
        ) {
            break;
        }
        scope = scope.parentElement;
    }
}

/**
 * Resolves all independent associations under one root using pass-local indexes.
 *
 * @param root - Document or exact source subtree to inspect.
 * @param context - Processing context.
 *
 * @returns - Unambiguous associations in presentation document order.
 */
function resolveAssociations(
    root: ParentNode,
    context: TimestampExtractionContext,
): readonly LinkedInAssociation[] {
    const presentations = collectPresentations(root, context);
    const index = createAssociationIndex(root, presentations);
    const associationsByPresentation = new Map<LinkedInPresentation, LinkedInAssociation>();
    const associationsBySource = new Map<Element, LinkedInAssociation | null>();
    const queue = [...presentations].reverse();
    const queued = new Set(queue);
    for (let cursor = 0; cursor < queue.length; cursor += 1) {
        const presentation = queue[cursor];
        if (presentation && !associationsByPresentation.has(presentation)) {
            queued.delete(presentation);
            const association = findAssociation(presentation, index);
            if (association) {
                associationsByPresentation.set(presentation, association);
                if (associationsBySource.has(association.source)) {
                    associationsBySource.set(association.source, null);
                } else {
                    associationsBySource.set(association.source, association);
                    excludeAssociationEvidence(association, index);
                }
                for (const scope of index.scopesByPresentation.get(presentation) ?? []) {
                    const pending = index.pendingByScope.get(scope);
                    pending?.delete(presentation);
                    if (pending?.size === 1) {
                        const remaining = pending.values().next().value;
                        if (
                            remaining
                            && !queued.has(remaining)
                            && !associationsByPresentation.has(remaining)
                        ) {
                            queued.add(remaining);
                            queue.push(remaining);
                        }
                    }
                }
            }
        }
    }
    const ordered: LinkedInAssociation[] = [];
    const seen = new Set<Element>();
    for (const presentation of presentations) {
        const association = associationsByPresentation.get(presentation);
        if (
            association
            && associationsBySource.get(association.source) === association
            && !seen.has(association.source)
        ) {
            seen.add(association.source);
            ordered.push(association);
        }
    }
    return ordered;
}

/**
 * Reconstructs one complete association for exact-source reconciliation.
 *
 * @param source - Candidate source boundary.
 * @param context - Processing context.
 *
 * @returns - One unambiguous association, or null.
 */
function resolveAssociation(
    source: Element,
    context: TimestampExtractionContext,
): LinkedInAssociation | null {
    if (isBroadAssociationBoundary(source)) {
        return null;
    }
    return resolveAssociations(source, context).find(
        (association) => association.source === source,
    ) ?? null;
}

/**
 * Retains one discovery pass so extraction does not rebuild the same association index.
 *
 * @param associations - Associations resolved together in one regional pass.
 * @param context - Extraction context shared by discovery and extraction.
 *
 * @returns - Source elements in association order.
 */
function cacheAssociations(
    associations: readonly LinkedInAssociation[],
    context: TimestampExtractionContext,
): readonly Element[] {
    cachedAssociationsByContext.set(
        context,
        new Map(associations.map((association) => [association.source, association])),
    );
    return associations.map(({ source }) => source);
}

/**
 * Consumes a discovery result or reconstructs one exact source outside discovery.
 *
 * @param source - Candidate source boundary.
 * @param context - Current extraction context.
 *
 * @returns - One unambiguous association, or null.
 */
function takeAssociation(
    source: Element,
    context: TimestampExtractionContext,
): LinkedInAssociation | null {
    const cached = cachedAssociationsByContext.get(context);
    const association = cached?.get(source);
    if (!association) {
        return resolveAssociation(source, context);
    }
    cached?.delete(source);
    if (cached?.size === 0) {
        cachedAssociationsByContext.delete(context);
    }
    return association;
}

/**
 * Traverses at most a fixed number of local elements for mutation-source lookup.
 *
 * @param root - Local ancestor being inspected.
 * @param visit - Predicate that stops traversal once both source inputs are found.
 *
 * @returns - Whether the predicate stopped traversal before the element budget was exhausted.
 */
function visitBoundedElements(root: Element, visit: (element: Element) => boolean): boolean {
    if (visit(root)) {
        return true;
    }
    const contentBoundary = findContentItemBoundary(root);
    const walker = root.ownerDocument.createTreeWalker(
        root,
        NodeFilter.SHOW_ELEMENT,
        {
            acceptNode: (node) => {
                const element = node as Element;
                const candidateBoundary = findContentItemBoundary(element);
                return candidateBoundary && candidateBoundary !== contentBoundary
                    ? NodeFilter.FILTER_REJECT
                    : NodeFilter.FILTER_ACCEPT;
            },
        },
    );
    for (let visited = 1; visited < MAX_MUTATION_SCAN_ELEMENTS; visited += 1) {
        const element = walker.nextNode();
        if (!element) {
            return false;
        }
        if (visit(element as Element)) {
            return true;
        }
    }
    return false;
}

/**
 * Finds one bounded local source that has both a live label and target evidence.
 *
 * @param element - Mutated element or child-list container.
 * @param context - Processing context.
 *
 * @returns - Smallest candidate source, or null when none is found within the bounds.
 */
function findPotentialAssociationSource(
    element: Element,
    context: TimestampExtractionContext,
): Element | null {
    const contentBoundary = findContentItemBoundary(element);
    let scope: Element | null = element;
    for (let depth = 0; scope && depth < MAX_ASSOCIATION_DEPTH; depth += 1) {
        if (isBroadAssociationBoundary(scope)) {
            return null;
        }
        let hasPresentation = false;
        let hasEvidence = false;
        const found = visitBoundedElements(scope, (candidate) => {
            if (
                !hasPresentation
                && candidate.matches(LABEL_SELECTOR)
                && resolvePresentation(candidate, context)
            ) {
                hasPresentation = true;
            }
            if (
                !hasEvidence
                && candidate.matches(EVIDENCE_SELECTOR)
                && collectElementIds(candidate).length > 0
            ) {
                hasEvidence = true;
            }
            return hasPresentation && hasEvidence;
        });
        if (found) {
            return scope;
        }
        if (scope === contentBoundary) {
            return null;
        }
        scope = scope.parentElement;
    }
    return null;
}

/**
 * Checks whether one adapter-observed attribute can change LinkedIn eligibility.
 *
 * @param element - Element whose attribute changed.
 * @param attributeName - Changed adapter attribute.
 * @param oldValue - Attribute value before the change.
 *
 * @returns - Whether bounded local source lookup is needed.
 */
function isRelevantAttributeMutation(
    element: Element,
    attributeName: TimestampSourceAttribute,
    oldValue: string | null,
): boolean {
    if (EVIDENCE_ATTRIBUTES.some((attribute) => attribute === attributeName)) {
        return true;
    }
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.CLASS) {
        return element.classList.contains('update-components-actor__sub-description')
            || oldValue?.split(/\s+/u)
                .includes('update-components-actor__sub-description') === true;
    }
    if (attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.ARIA_HIDDEN) {
        return element.localName === 'span'
            && (element.getAttribute(attributeName) === 'true' || oldValue === 'true');
    }
    return attributeName === TIMESTAMP_SOURCE_ATTRIBUTE.DATETIME
        && element.localName === 'time'
        && element.classList.contains('comments-comment-meta__data');
}

/**
 * Maps an adapter-observed mutation to one bounded candidate source.
 *
 * @param element - Mutated element or child-list container.
 * @param attributeName - Changed adapter attribute, when applicable.
 * @param oldValue - Attribute value before the mutation.
 * @param context - Processing context.
 *
 * @returns - Exact candidate source requiring reconciliation.
 */
function getMutationSources(
    element: Element,
    attributeName: TimestampSourceAttribute | undefined,
    oldValue: string | null,
    context: TimestampExtractionContext,
): TimestampMutationSourceResult {
    if (
        attributeName
        && !isRelevantAttributeMutation(element, attributeName, oldValue)
    ) {
        return { handled: true, sources: [] };
    }
    const source = findPotentialAssociationSource(element, context);
    return { handled: true, sources: source ? [source] : [] };
}

/**
 * Specialized LinkedIn source using only accepted local ID evidence.
 */
export const linkedinAdapter = {
    id: LINKEDIN_ADAPTER_ID,
    mutationAttributes: MUTATION_ATTRIBUTES,
    getMutationSources,
    matches: matchesLinkedInUrl,
    matchesElement: (element: Element, context: TimestampExtractionContext) => (
        resolveAssociation(element, context) !== null
    ),
    discover: (root: ParentNode, context: TimestampExtractionContext) => cacheAssociations(
        resolveAssociations(root, context),
        context,
    ),
    isRelativePresentation: createRelativePresentationClassifier([
        RELATIVE_PRESENTATION_PROFILE.DIRECTIONAL,
        RELATIVE_PRESENTATION_PROFILE.COMPACT_AGE,
    ], ['just now', '1mo', '1 mo', '1yr', '1 yr']),
    extract: (element: Element, context: TimestampExtractionContext) => {
        const association = takeAssociation(element, context);
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
} satisfies TimestampSourceRule;
