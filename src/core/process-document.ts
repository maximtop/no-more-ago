/**
 * @file Transforms eligible timestamp elements while preserving ownership and diagnostics boundaries.
 */

import { AdapterRegistry, defaultRegistry } from "../adapters/registry";
import { formatDateWithPresentation } from "./format-default-date";
import { renderExactTime, restoreExactTime, type OwnedOutputMutationSink } from "./render-exact-time";
import { resolveTrustedTimestamp } from "./resolve-trusted-timestamp";
import type { DisplaySettings } from "../settings/snapshot";
import type { DiagnosticEventInput } from "../diagnostics/events";

/**
 * Receives bounded processing facts after page-derived data has been sanitized.
 */
export type DocumentDiagnosticSink = (event: DiagnosticEventInput) => void;

/**
 * Dependencies for a full document pass, including snapshots that may be refreshed through providers.
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
    readonly ownedOutputMutations?: OwnedOutputMutationSink;

    /**
     * Optional sink for bounded document-processing diagnostics.
     */
    readonly diagnosticSink?: DocumentDiagnosticSink;
}

/**
 * Replaces eligible relative timestamps in one root while recording every reversible ownership change.
 */
function processRegion(input: ProcessInput | ReconcileInput): readonly HTMLTimeElement[] {
    const { url, root, registry = defaultRegistry } = input;
    const locales = input.localesProvider?.() ?? input.locales ?? [];
    const display = input.displayProvider?.() ?? input.display;
    const ownedOutputMutations = "ownedOutputMutations" in input
        ? input.ownedOutputMutations
        : undefined;
    const diagnosticSink = input.diagnosticSink;
    const adapter = registry.select(url);
    if (!adapter) {
        if (diagnosticSink) {
            diagnosticSink({ category: "skip", reason: "adapter-missing", count: 1 });
        }
        return [];
    }
    const started = diagnosticSink ? performance.now() : undefined;
    if (diagnosticSink) {
        diagnosticSink({ category: "adapter", reason: "adapter-matched", count: 1 });
    }

    const outputs: HTMLTimeElement[] = [];
    for (const element of adapter.discover(root)) {
        const candidate = adapter.extract(element);
        const resolved = candidate ? resolveTrustedTimestamp(candidate) : null;
        if (!resolved) {
            restoreExactTime(element, ownedOutputMutations);
            if (diagnosticSink) {
                diagnosticSink({ category: "skip", reason: "invalid-timestamp", count: 1 });
            }
            continue;
        }
        const presentation = formatDateWithPresentation(
            resolved.instant,
            locales,
            display
        );
        if (presentation.text.length === 0) {
            restoreExactTime(element, ownedOutputMutations);
            if (diagnosticSink && presentation.error === "invalid-format") {
                diagnosticSink({ category: "error", reason: "processing-failed", count: 1 });
            }
            if (diagnosticSink) {
                diagnosticSink({ category: "skip", reason: "candidate-skipped", count: 1 });
            }
            continue;
        }
        if (presentation.error === "invalid-format") {
            restoreExactTime(element, ownedOutputMutations);
            if (diagnosticSink) {
                diagnosticSink({ category: "skip", reason: "candidate-skipped", count: 1 });
            }
            continue;
        }
        const output = renderExactTime(
            resolved.source,
            resolved.sourceDatetime,
            presentation.text
        );
        if (output) {
            outputs.push(output);
        }
    }
    if (diagnosticSink && started !== undefined) {
        diagnosticSink({ category: "timing", count: outputs.length, durationMs: Math.max(0, performance.now() - started) });
    }
    return outputs;
}

/**
 * Runs a full trusted-adapter pass over the document and returns only generated outputs whose
 * timestamps and presentation settings were both accepted.
 */
export function processDocument({
    url,
    root,
    locales,
    localesProvider,
    display,
    displayProvider,
    diagnosticSink,
    registry = defaultRegistry
}: ProcessInput): readonly HTMLTimeElement[] {
    return processRegion({
        url,
        root,
        registry,
        ...(locales === undefined ? {} : { locales }),
        ...(localesProvider === undefined ? {} : { localesProvider }),
        ...(display === undefined ? {} : { display }),
        ...(displayProvider === undefined ? {} : { displayProvider }),
        ...(diagnosticSink === undefined ? {} : { diagnosticSink })
    });
}

/**
 * Reprocesses only the supplied region after settings or DOM changes.
 */
export function reconcileDocumentRegion(input: ReconcileInput): readonly HTMLTimeElement[] {
    return processRegion(input);
}
