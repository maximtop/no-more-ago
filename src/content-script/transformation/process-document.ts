/**
 * @file Transforms eligible timestamps while preserving ownership and diagnostics boundaries.
 */

import { AdapterRegistry, defaultRegistry } from "../adapters/registry";
import { formatCalendarDate } from "../../shared/date/format-calendar-date";
import { formatDateWithPresentation } from "../../shared/date/format-default-date";
import { INVALID_DATE_FORMAT_ERROR } from "../../shared/date/presentation-errors";
import {
    releaseSourceHiddenForReconciliation,
} from "./render-exact-time";
import type { OwnedDomMutationSink } from "./owned-dom-mutations";
import {
    getOwnedTimestampSourceEntries,
    readPageOwnedText,
    renderTimestampPresentation,
    restoreTimestampPresentation,
    type TimestampRenderResult,
} from "./render-timestamp-presentation";
import {
    RESOLVED_TIMESTAMP_KIND,
    resolveTrustedTimestamp,
    type ResolvedTimestamp,
} from "./resolve-trusted-timestamp";
import { isSourceSuppressed } from "./source-visibility";
import {
    TIMESTAMP_VISIBILITY_POLICY,
    TIMESTAMP_PRESENTATION_KIND,
    TIMESTAMP_SOURCE_KIND,
    TIMESTAMP_VALIDATION_RULE,
    type TimestampCandidate,
    type TimestampExtractionContext,
    type TimestampSourceRule,
} from "../adapters/types";
import type { DisplaySettings } from "../../shared/settings/snapshot";
import {
    safeDiagnosticSourceTimestamp,
    type DiagnosticEventInput,
} from "../../shared/diagnostics/events";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../shared/diagnostics/contracts";
import type { TimestampExtractionPolicy } from "./route-handoff";

/**
 * Receives bounded processing facts after page-derived data has been sanitized.
 */
export type DocumentDiagnosticSink = (event: DiagnosticEventInput) => void;

/**
 * Emits one bounded skip event for a candidate that cannot be rendered.
 *
 * @param diagnosticSink - Optional diagnostic event sink.
 */
function emitCandidateSkipped(diagnosticSink: DocumentDiagnosticSink | undefined): void {
    diagnosticSink?.({
        category: DIAGNOSTIC_CATEGORY.SKIP,
        reason: DIAGNOSTIC_REASON.CANDIDATE_SKIPPED,
        count: 1,
    });
}

/**
 * Returns failure-only source evidence for the explicit Telegram Unix-seconds contract.
 *
 * @param candidates - Rejected candidates emitted for one source.
 * @returns - Bounded numeric evidence, or undefined for every other source contract.
 */
function getFailureSourceTimestamp(
    candidates: readonly TimestampCandidate[],
): string | undefined {
    const telegramCandidate = candidates.find(
        (candidate) =>
            candidate.sourceKind === TIMESTAMP_SOURCE_KIND.TELEGRAM_WEB_K_MESSAGE
            && candidate.validationRule === TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS,
    );
    if (
        !telegramCandidate
        || telegramCandidate.validationRule !== TIMESTAMP_VALIDATION_RULE.UNIX_SECONDS
    ) {
        return undefined;
    }
    return safeDiagnosticSourceTimestamp(telegramCandidate.rawDatetime);
}

/**
 * Applies presentation and reversible rendering to one already validated timestamp.
 *
 * @param resolved - Validated trusted timestamp.
 * @param locales - Current preferred locale tags.
 * @param display - Current validated presentation settings.
 * @param diagnosticSink - Optional bounded diagnostic sink.
 * @param ownedDomMutations - Optional renderer mutation sink.
 * @returns - Render result, or null when presentation or ownership is unavailable.
 */
function renderResolvedTimestamp(
    resolved: ResolvedTimestamp,
    locales: readonly string[],
    display: DisplaySettings | undefined,
    diagnosticSink: DocumentDiagnosticSink | undefined,
    ownedDomMutations: OwnedDomMutationSink | undefined,
): TimestampRenderResult | null {
    const source = resolved.source;
    if (resolved.visibilityPolicy === TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION) {
        ownedDomMutations?.trackSource?.(source, true);
        releaseSourceHiddenForReconciliation(source, ownedDomMutations);
        if (isSourceSuppressed(source)) {
            restoreTimestampPresentation(source, ownedDomMutations);
            emitCandidateSkipped(diagnosticSink);
            return null;
        }
    } else {
        ownedDomMutations?.trackSource?.(source, false);
    }
    const presentation = resolved.kind === RESOLVED_TIMESTAMP_KIND.CALENDAR_DATE
        ? { text: formatCalendarDate(resolved.calendarDate, locales, display) }
        : formatDateWithPresentation(resolved.instant, locales, display);
    if (presentation.text.length === 0) {
        restoreTimestampPresentation(source, ownedDomMutations);
        if (diagnosticSink && presentation.error === INVALID_DATE_FORMAT_ERROR) {
            diagnosticSink({
                category: DIAGNOSTIC_CATEGORY.ERROR,
                reason: DIAGNOSTIC_REASON.PROCESSING_FAILED,
                count: 1,
            });
        }
        emitCandidateSkipped(diagnosticSink);
        return null;
    }
    if (presentation.error === INVALID_DATE_FORMAT_ERROR) {
        restoreTimestampPresentation(source, ownedDomMutations);
        emitCandidateSkipped(diagnosticSink);
        return null;
    }
    return renderTimestampPresentation(
        resolved.source,
        resolved.sourceDatetime,
        resolved.presentation,
        presentation.text,
        ownedDomMutations,
    );
}

/**
 * Dependencies for a full document pass, including snapshots that may be refreshed through
 * providers.
 */
export interface ProcessInput {
    /**
     * Trusted sender URL used to derive diagnostic context.
     */
    readonly url: URL;

    /**
     * Document subtree whose eligible timestamp sources are processed.
     */
    readonly root: Document;

    /**
     * A snapshot of locales for legacy callers. Prefer localesProvider.
     */
    readonly locales?: readonly string[];

    /**
     * Lazily supplies current locales when a caller cannot pass a stable snapshot.
     */
    readonly localesProvider?: () => readonly string[];

    /**
     * Persisted presentation choices applied to rendered timestamps.
     */
    readonly display?: DisplaySettings;

    /**
     * Lazily supplies current display settings for a document pass.
     */
    readonly displayProvider?: () => DisplaySettings;

    /**
     * Optional adapter registry override for tests or site-specific activation.
     */
    readonly registry?: AdapterRegistry;

    /**
     * Optional sink for bounded document-processing diagnostics.
     */
    readonly diagnosticSink?: DocumentDiagnosticSink;

    /**
     * Sink for renderer-authored DOM mutations during an initial document pass.
     */
    readonly ownedDomMutations?: OwnedDomMutationSink;

    /**
     * Optional route provenance policy restricting extraction.
     */
    readonly extractionPolicy?: TimestampExtractionPolicy;
}

/**
 * Dependencies for a targeted reformat pass after settings or DOM changes.
 */
export interface ReconcileInput {
    /**
     * Trusted sender URL used to derive diagnostic context.
     */
    readonly url: URL;

    /**
     * Document subtree whose eligible timestamp sources are processed.
     */
    readonly root: ParentNode;

    /**
     * Locale snapshot used when no lazy locale provider is present.
     */
    readonly locales?: readonly string[];

    /**
     * Source of current locales for a targeted reformat pass.
     */
    readonly localesProvider?: () => readonly string[];

    /**
     * Persisted presentation choices applied to rendered timestamps.
     */
    readonly display?: DisplaySettings;

    /**
     * Source of current display choices for a targeted reformat pass.
     */
    readonly displayProvider?: () => DisplaySettings;

    /**
     * Adapter registry used to verify that the page remains supported.
     */
    readonly registry?: AdapterRegistry;

    /**
     * Sink that records reversible changes to extension-owned output nodes.
     */
    readonly ownedDomMutations?: OwnedDomMutationSink;

    /**
     * Optional sink for bounded document-processing diagnostics.
     */
    readonly diagnosticSink?: DocumentDiagnosticSink;

    /**
     * Optional route provenance policy restricting extraction.
     */
    readonly extractionPolicy?: TimestampExtractionPolicy;
}

/**
 * Dependencies for a batched reconciliation of exact timestamp sources.
 */
export interface ReconcileSourcesInput extends Omit<ReconcileInput, "root"> {
    /**
     * Document that owns every supplied source.
     */
    readonly root: Document;

    /**
     * Exact source elements to re-evaluate without scanning their surrounding regions.
     */
    readonly sources: readonly Element[];
}

/**
 * Candidate collections produced by either regional discovery or exact-source selection.
 */
interface CandidateCollection {
    /**
     * Ordered candidates grouped by their page source.
     */
    readonly candidatesBySource: ReadonlyMap<Element, readonly TimestampCandidate[]>;

    /**
     * First valid candidate per source, resolved once during precedence selection.
     */
    readonly resolvedBySource: ReadonlyMap<Element, ResolvedTimestamp>;

    /**
     * Ordered sources that must be rendered or restored.
     */
    readonly discoveredSources: readonly Element[];

    /**
     * Sources withheld from extraction by the active route provenance policy.
     */
    readonly blockedSources: ReadonlySet<Element>;

    /**
     * Sources whose trusted candidate lacked a recognized relative presentation.
     */
    readonly presentationRejectedSources: ReadonlySet<Element>;

    /**
     * Sources whose current page labels require bounded text observation.
     */
    readonly textObservedSources: ReadonlySet<Element>;
}

/**
 * Selects active rules and reports an unsupported URL through the bounded diagnostic contract.
 *
 * @param input - Processing dependencies carrying URL, registry, and diagnostics.
 * @param url - Current URL snapshot used for this pass.
 * @returns - Matching rules in source precedence order.
 */
function getMatchingRules(
    input: ProcessInput | ReconcileInput | ReconcileSourcesInput,
    url: URL,
): readonly TimestampSourceRule[] {
    const rules = (input.registry ?? defaultRegistry).matching(url);
    if (rules.length === 0) {
        input.diagnosticSink?.({
            category: DIAGNOSTIC_CATEGORY.SKIP,
            reason: DIAGNOSTIC_REASON.ADAPTER_MISSING,
            count: 1,
        });
    }
    return rules;
}

/**
 * Adds one candidate while preserving adapter precedence for its source.
 *
 * @param candidatesBySource - Mutable candidate collection keyed by page source.
 * @param candidate - Candidate emitted by one matching adapter.
 */
function addCandidate(
    candidatesBySource: Map<Element, TimestampCandidate[]>,
    candidate: TimestampCandidate,
): void {
    const candidates = candidatesBySource.get(candidate.source) ?? [];
    candidates.push(candidate);
    candidatesBySource.set(candidate.source, candidates);
}

/**
 * Creates the read-only adapter context for one processing pass.
 *
 * @param input - Processing input carrying static or live locale preferences.
 * @param url - Current route URL for route-specific value provenance.
 * @returns - Context exposing current route, locales, and retained page text.
 */
function createExtractionContext(
    input: ProcessInput | ReconcileInput | ReconcileSourcesInput,
    url: URL,
): TimestampExtractionContext {
    return {
        url,
        locales: input.localesProvider?.() ?? input.locales ?? [],
        readPageText: readPageOwnedText,
    };
}

/**
 * Renders or restores one already-discovered candidate collection.
 *
 * @param input - Presentation, ownership, and diagnostic dependencies.
 * @param collection - Ordered sources and their adapter candidates.
 * @param locales - Locale snapshot shared with presentation classification.
 * @param started - Optional start time captured before discovery.
 * @returns - Generated adjacent time outputs from the processed sources.
 */
function processCandidateCollection(
    input: ProcessInput | ReconcileInput | ReconcileSourcesInput,
    collection: CandidateCollection,
    locales: readonly string[],
    started: number | undefined,
): readonly HTMLTimeElement[] {
    const display = input.displayProvider?.() ?? input.display;
    const ownedDomMutations = input.ownedDomMutations;
    const diagnosticSink = input.diagnosticSink;
    const {
        candidatesBySource,
        resolvedBySource,
        discoveredSources,
        blockedSources,
        presentationRejectedSources,
        textObservedSources,
    } = collection;

    if (diagnosticSink && discoveredSources.length > 0) {
        diagnosticSink({
            category: DIAGNOSTIC_CATEGORY.ADAPTER,
            reason: DIAGNOSTIC_REASON.ADAPTER_MATCHED,
            count: 1,
        });
    }

    const outputs: HTMLTimeElement[] = [];
    let renderedCount = 0;
    for (const source of discoveredSources) {
        const candidates = candidatesBySource.get(source) ?? [];
        const resolved = resolvedBySource.get(source);
        const observesPageText = textObservedSources.has(source)
            && (resolved !== undefined || presentationRejectedSources.has(source));
        if (observesPageText) {
            ownedDomMutations?.trackPageTextSource?.(source);
        } else {
            ownedDomMutations?.untrackPageTextSource?.(source);
        }
        if (!resolved) {
            if (observesPageText) {
                ownedDomMutations?.trackSource?.(source, false);
            } else {
                ownedDomMutations?.untrackSource?.(source);
            }
            restoreTimestampPresentation(source, ownedDomMutations);
            if (blockedSources.has(source)) {
                continue;
            }
            if (candidates.length === 0 && presentationRejectedSources.has(source)) {
                emitCandidateSkipped(diagnosticSink);
                continue;
            }
            const sourceTimestamp = getFailureSourceTimestamp(candidates);
            diagnosticSink?.({
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                count: 1,
                ...(sourceTimestamp === undefined ? {} : { sourceTimestamp }),
            });
            continue;
        }
        const result = renderResolvedTimestamp(
            resolved,
            locales,
            display,
            diagnosticSink,
            ownedDomMutations,
        );
        if (result) {
            renderedCount += 1;
            if (result.kind !== TIMESTAMP_PRESENTATION_KIND.IN_PLACE_TEXT) {
                outputs.push(result.output);
            }
        }
    }
    if (diagnosticSink && started !== undefined && discoveredSources.length > 0) {
        diagnosticSink({
            category: DIAGNOSTIC_CATEGORY.TIMING,
            count: renderedCount,
            durationMs: Math.max(0, performance.now() - started),
        });
    }
    return outputs;
}

/**
 * Replaces eligible relative timestamps in one root while recording every reversible ownership
 * change.
 *
 * @param input - Document region, page URL, presentation, and adapter dependencies.
 * @returns - Extension-owned time elements generated in the region.
 */
function processRegion(input: ProcessInput | ReconcileInput): readonly HTMLTimeElement[] {
    const { root } = input;
    const url = input.url;
    const rules = getMatchingRules(input, url);
    if (rules.length === 0) {
        return [];
    }
    const started = input.diagnosticSink ? performance.now() : undefined;
    const nowMilliseconds = Date.now();
    const candidatesBySource = new Map<Element, TimestampCandidate[]>();
    const resolvedBySource = new Map<Element, ResolvedTimestamp>();
    const discoveredSources: Element[] = [];
    const discovered = new Set<Element>();
    const blockedSources = new Set<Element>();
    const presentationRejectedSources = new Set<Element>();
    const textObservedSources = new Set<Element>();
    const extractionContext = createExtractionContext(input, url);
    for (const rule of rules) {
        for (const element of rule.discover(root, extractionContext)) {
            if (!discovered.has(element)) {
                discovered.add(element);
                discoveredSources.push(element);
            }
            if (input.extractionPolicy && !input.extractionPolicy.allowsRule(rule.id, element)) {
                blockedSources.add(element);
                continue;
            }
            if (resolvedBySource.has(element)) {
                continue;
            }
            const candidate = rule.extract(element, extractionContext);
            if (candidate?.source === element) {
                if (rule.observesCharacterData === true) {
                    textObservedSources.add(element);
                }
                if (!rule.isRelativePresentation(candidate, extractionContext)) {
                    presentationRejectedSources.add(element);
                    continue;
                }
                addCandidate(candidatesBySource, candidate);
                const resolved = resolveTrustedTimestamp(candidate, nowMilliseconds);
                if (resolved) {
                    resolvedBySource.set(element, resolved);
                }
            }
        }
    }

    const rootNode = root as Node;
    const ownerDocument = rootNode.nodeType === 9
        ? rootNode as Document
        : rootNode.ownerDocument;
    if (ownerDocument) {
        for (const { source } of getOwnedTimestampSourceEntries(ownerDocument)) {
            if (
                !discovered.has(source)
                && (
                    rootNode.nodeType === 9
                    || source === rootNode
                    || rootNode.contains(source)
                )
            ) {
                discovered.add(source);
                discoveredSources.push(source);
            }
        }
    }

    return processCandidateCollection(
        input,
        {
            candidatesBySource,
            resolvedBySource,
            discoveredSources,
            blockedSources,
            presentationRejectedSources,
            textObservedSources,
        },
        extractionContext.locales,
        started,
    );
}

/**
 * Re-evaluates exact sources in one pass without enumerating document-wide ownership records.
 *
 * @param input - Exact sources plus page, presentation, and ownership dependencies.
 * @returns - Generated adjacent time outputs from the supplied sources.
 */
export function reconcileDocumentSources(
    input: ReconcileSourcesInput,
): readonly HTMLTimeElement[] {
    const url = input.url;
    const rules = getMatchingRules(input, url);
    if (rules.length === 0) {
        return [];
    }
    const started = input.diagnosticSink ? performance.now() : undefined;
    const nowMilliseconds = Date.now();
    const candidatesBySource = new Map<Element, TimestampCandidate[]>();
    const resolvedBySource = new Map<Element, ResolvedTimestamp>();
    const discoveredSources: Element[] = [];
    const discovered = new Set<Element>();
    const blockedSources = new Set<Element>();
    const presentationRejectedSources = new Set<Element>();
    const textObservedSources = new Set<Element>();
    const extractionContext = createExtractionContext(input, url);
    for (const source of input.sources) {
        if (
            discovered.has(source)
            || source.ownerDocument !== input.root
            || !source.isConnected
        ) {
            continue;
        }
        discovered.add(source);
        discoveredSources.push(source);
        for (const rule of rules) {
            if (input.extractionPolicy && !input.extractionPolicy.allowsRule(rule.id, source)) {
                blockedSources.add(source);
                continue;
            }
            if (resolvedBySource.has(source)) {
                continue;
            }
            const candidate = rule.extract(source, extractionContext);
            if (candidate?.source === source) {
                if (rule.observesCharacterData === true) {
                    textObservedSources.add(source);
                }
                if (!rule.isRelativePresentation(candidate, extractionContext)) {
                    presentationRejectedSources.add(source);
                    continue;
                }
                addCandidate(candidatesBySource, candidate);
                const resolved = resolveTrustedTimestamp(candidate, nowMilliseconds);
                if (resolved) {
                    resolvedBySource.set(source, resolved);
                }
            }
        }
    }
    return processCandidateCollection(
        input,
        {
            candidatesBySource,
            resolvedBySource,
            discoveredSources,
            blockedSources,
            presentationRejectedSources,
            textObservedSources,
        },
        extractionContext.locales,
        started,
    );
}

/**
 * Runs a full trusted-adapter pass over the document and returns only generated outputs whose
 * timestamps and presentation settings were both accepted.
 *
 * @param input - Full-document processing inputs.
 * @param input.url - Current page URL used to select an adapter.
 * @param input.root - Document to discover and transform.
 * @param input.locales - Static preferred locale tags.
 * @param input.localesProvider - Dynamic source of preferred locale tags.
 * @param input.display - Static validated display settings.
 * @param input.displayProvider - Dynamic source of display settings.
 * @param input.diagnosticSink - Optional bounded processing event sink.
 * @param input.ownedDomMutations - Optional renderer mutation sink.
 * @param input.extractionPolicy - Optional route provenance policy.
 * @param input.registry - Trusted adapter registry.
 * @returns - Extension-owned time elements generated by the pass.
 */
export function processDocument({
    url,
    root,
    locales,
    localesProvider,
    display,
    displayProvider,
    diagnosticSink,
    ownedDomMutations,
    extractionPolicy,
    registry = defaultRegistry,
}: ProcessInput): readonly HTMLTimeElement[] {
    return processRegion({
        url,
        root,
        registry,
        ...(locales === undefined ? {} : { locales }),
        ...(localesProvider === undefined ? {} : { localesProvider }),
        ...(display === undefined ? {} : { display }),
        ...(displayProvider === undefined ? {} : { displayProvider }),
        ...(diagnosticSink === undefined ? {} : { diagnosticSink }),
        ...(ownedDomMutations === undefined ? {} : { ownedDomMutations }),
        ...(extractionPolicy === undefined ? {} : { extractionPolicy }),
    });
}

/**
 * Reprocesses only the supplied region after settings or DOM changes.
 *
 * @param input - Region, page, presentation, and restoration dependencies.
 * @returns - Extension-owned time elements generated in the region.
 */
export function reconcileDocumentRegion(input: ReconcileInput): readonly HTMLTimeElement[] {
    return processRegion(input);
}
