/**
 * @file Generic lifecycle contract for document-scoped asynchronous timestamp sources.
 */

import type { TimestampSourceRule } from "../adapters/types";
import type { DocumentDiagnosticSink } from "../diagnostics";

/**
 * Host capabilities available to one document-scoped participant.
 */
export interface DocumentTransformationParticipantHost {
    /**
     * Reads the current optional diagnostic sink.
     */
    readonly getDiagnosticSink: () => DocumentDiagnosticSink | undefined;

    /**
     * Requests reconciliation after synchronous extraction results change.
     */
    readonly onSourcesChanged: (sources: readonly Element[]) => void;
}

/**
 * Site-owned enrichment lifecycle coordinated beside synchronous document processing.
 */
export interface DocumentTransformationParticipant {
    /**
     * Synchronous rule backed by the participant's current trusted state.
     */
    readonly rule: TimestampSourceRule;

    /**
     * Starts a fresh document lifecycle.
     */
    start(): void;

    /**
     * Inspects one initial or newly connected region.
     *
     * @param root - Bounded document region.
     */
    inspect(root: ParentNode): void;

    /**
     * Re-evaluates exact sources affected by mutations.
     *
     * @param sources - Potential participant source elements.
     */
    inspectSources(sources: readonly Element[]): void;

    /**
     * Releases state owned by a detached region.
     *
     * @param root - Detached document region.
     */
    release(root: ParentNode): void;

    /**
     * Stops asynchronous work and releases retained state.
     */
    stop(): void;
}

/**
 * Creates a document-scoped participant over generic controller host capabilities.
 */
export type DocumentTransformationParticipantFactory = (
    host: DocumentTransformationParticipantHost,
) => DocumentTransformationParticipant;
