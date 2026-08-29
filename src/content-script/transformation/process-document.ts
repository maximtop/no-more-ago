/**
 * @file Transforms eligible timestamps while preserving ownership and diagnostics boundaries.
 */

import { AdapterRegistry, defaultRegistry } from "../adapters/registry";
import { formatDateWithPresentation } from "../../shared/date/format-default-date";
import { INVALID_DATE_FORMAT_ERROR } from "../../shared/date/presentation-errors";
import {
    releaseSourceHiddenForReconciliation,
} from "./render-exact-time";
import type { OwnedDomMutationSink } from "./owned-dom-mutations";
import {
    getOwnedTimestampSourceEntries,
    renderTimestampPresentation,
    restoreTimestampPresentation,
} from "./render-timestamp-presentation";
import { resolveTrustedTimestamp } from "./resolve-trusted-timestamp";
import { isSourceSuppressed } from "./source-visibility";
import {
    TIMESTAMP_VISIBILITY_POLICY,
    TIMESTAMP_PRESENTATION_KIND,
    type TimestampCandidate,
} from "../adapters/types";
import type { DisplaySettings } from "../../shared/settings/snapshot";
import type { DiagnosticEventInput } from "../../shared/diagnostics/events";
import {
    DIAGNOSTIC_CATEGORY,
    DIAGNOSTIC_REASON,
} from "../../shared/diagnostics/contracts";

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
}

/**
 * Replaces eligible relative timestamps in one root while recording every reversible ownership
 * change.
 *
 * @param input - Document region, page URL, presentation, and adapter dependencies.
 * @returns - Extension-owned time elements generated in the region.
 */
function processRegion(input: ProcessInput | ReconcileInput): readonly HTMLTimeElement[] {
    const { url, root, registry = defaultRegistry } = input;
    const locales = input.localesProvider?.() ?? input.locales ?? [];
    const display = input.displayProvider?.() ?? input.display;
    const ownedDomMutations =
        "ownedDomMutations" in input ? input.ownedDomMutations : undefined;
    const diagnosticSink = input.diagnosticSink;
    const rules = registry.matching(url);
    if (rules.length === 0) {
        if (diagnosticSink) {
            diagnosticSink({
                category: DIAGNOSTIC_CATEGORY.SKIP,
                reason: DIAGNOSTIC_REASON.ADAPTER_MISSING,
                count: 1,
            });
        }
        return [];
    }
    const started = diagnosticSink ? performance.now() : undefined;
    const candidatesBySource = new Map<Element, TimestampCandidate[]>();
    const discoveredSources: Element[] = [];
    const discovered = new Set<Element>();
    for (const rule of rules) {
        for (const element of rule.discover(root)) {
            const candidate = rule.extract(element);
            const source = candidate?.source ?? element;
            ownedDomMutations?.trackSource?.(source);
            if (!discovered.has(source)) {
                discovered.add(source);
                discoveredSources.push(source);
            }
            if (candidate) {
                const candidates = candidatesBySource.get(source) ?? [];
                candidates.push(candidate);
                candidatesBySource.set(source, candidates);
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
        const resolved = candidatesBySource
            .get(source)
            ?.map(resolveTrustedTimestamp)
            .find((candidate) => candidate !== null) ?? null;
        if (!resolved) {
            restoreTimestampPresentation(source, ownedDomMutations);
            if (diagnosticSink) {
                diagnosticSink({
                    category: DIAGNOSTIC_CATEGORY.SKIP,
                    reason: DIAGNOSTIC_REASON.INVALID_TIMESTAMP,
                    count: 1,
                });
            }
            continue;
        }
        if (resolved.visibilityPolicy === TIMESTAMP_VISIBILITY_POLICY.PRESERVE_PAGE_SUPPRESSION) {
            releaseSourceHiddenForReconciliation(source, ownedDomMutations);
            if (isSourceSuppressed(source)) {
                restoreTimestampPresentation(source, ownedDomMutations);
                emitCandidateSkipped(diagnosticSink);
                continue;
            }
        }
        const presentation = formatDateWithPresentation(resolved.instant, locales, display);
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
            continue;
        }
        if (presentation.error === INVALID_DATE_FORMAT_ERROR) {
            restoreTimestampPresentation(source, ownedDomMutations);
            emitCandidateSkipped(diagnosticSink);
            continue;
        }
        const result = renderTimestampPresentation(
            resolved.source,
            resolved.sourceDatetime,
            resolved.presentation,
            presentation.text,
            ownedDomMutations,
        );
        if (result) {
            renderedCount += 1;
            if (result.kind === TIMESTAMP_PRESENTATION_KIND.ADJACENT_TIME) {
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
