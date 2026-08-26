/**
 * @file Coordinates adapter processing and mutation scheduling across a document's lifecycle.
 */

import { DocumentMutationScheduler, type AffectedMutationBatch } from "./document-mutation-scheduler";
import {
    reconcileDocumentRegion,
    processDocument,
    type DocumentDiagnosticSink,
    type ProcessInput
} from "./process-document";
import { getOwnedSourceEntries, getOwnedSourceForOutput, restoreExactTimes } from "./render-exact-time";

/**
 * Confirms that an element still belongs to the controller's document before it is reformatted.
 */
function isConnectedToDocument(element: Element, document: Document): boolean {
    return element.ownerDocument === document && element.isConnected;
}

/**
 * Suppresses a duplicate root when a broader root already covers the same candidate element.
 */
function coveredBy(roots: readonly Element[], element: Element): boolean {
    return roots.some((root) => root.contains(element));
}

/**
 * Owns the active document pass, mutation scheduler, and restoration lifecycle for one page.
 *
 */
export class DocumentTransformationController {
    /**
     * Distinguishes an inactive controller from one that currently owns document transformations.
     */
    private phase: "idle" | "active" = "idle";

    /**
     * Generated time nodes from the latest full pass, retained for targeted reconciliation.
     */
    private outputs: readonly HTMLTimeElement[] = [];

    /**
     * Mutation observer coordinator created on start and disposed during teardown.
     */
    private scheduler: DocumentMutationScheduler | undefined;

    /**
     * Current bounded diagnostic reporter, which callers may replace without restarting the controller.
     */
    private diagnosticSink: DocumentDiagnosticSink | undefined;

    /**
     * Captures document-processing dependencies and seeds the current diagnostic sink before activation.
     */
    constructor(private readonly input: ProcessInput) {
        this.diagnosticSink = input.diagnosticSink;
    }

    /**
     * Replaces the optional diagnostic sink used by later processing and reconciliation passes.
     */
    setDiagnosticSink(sink: DocumentDiagnosticSink | undefined): void {
        this.diagnosticSink = sink;
        const mutableInput = this.input as { diagnosticSink?: DocumentDiagnosticSink };
        if (sink) {
            mutableInput.diagnosticSink = sink;
        } else {
            Reflect.deleteProperty(mutableInput, "diagnosticSink");
        }
    }

    /**
     * Starts mutation scheduling and performs the initial document pass.
     */
    start(): readonly HTMLTimeElement[] {
        if (this.phase === "active") {
            return this.outputs;
        }

        const scheduler = new DocumentMutationScheduler({
            document: this.input.root,
            getOwnedSourceForOutput,
            onBatch: (batch) => {
                if (this.diagnosticSink) {
                    this.diagnosticSink({
                        category: "mutation",
                        count: batch.addedRoots.length + batch.removedRoots.length + batch.datetimeTargets.length + batch.displacedOutputSources.length
                    });
                }
                this.reconcile(batch, scheduler);
            }
        });
        this.scheduler = scheduler;
        try {
            scheduler.start();
            this.outputs = processDocument(this.input);
            this.phase = "active";
            return this.outputs;
        } catch (error) {
            scheduler.stop();
            restoreExactTimes(this.input.root);
            this.outputs = [];
            this.scheduler = undefined;
            this.phase = "idle";
            throw error;
        }
    }

    /**
     * Stops observation and restores the document to its pre-rendered state.
     */
    teardown(): void {
        this.scheduler?.stop();
        this.scheduler = undefined;
        restoreExactTimes(this.input.root);
        this.outputs = [];
        this.phase = "idle";
    }

    /**
     * Reformat only already owned, connected sources after a presentation save.
     *
     * @returns The time elements updated during the reformat operation.
     */
    reformatOwned(): readonly HTMLTimeElement[] {
        if (this.phase !== "active") {
            return this.outputs;
        }
        const scheduler = this.scheduler;
        if (!scheduler) {
            return this.outputs;
        }
        const outputs: HTMLTimeElement[] = [];
        for (const { source } of getOwnedSourceEntries(this.input.root)) {
            if (!isConnectedToDocument(source, this.input.root)) {
                continue;
            }
            outputs.push(...reconcileDocumentRegion({ ...this.input, root: source, ownedOutputMutations: scheduler }));
        }
        this.outputs = outputs;
        return outputs;
    }

    /**
     * Applies a settings change only to affected connected source elements.
     */
    private reconcile(batch: AffectedMutationBatch, scheduler: DocumentMutationScheduler): void {
        for (const root of batch.removedRoots) {
            if (!isConnectedToDocument(root, this.input.root)) {
                restoreExactTimes(root, scheduler);
            }
        }

        for (const root of batch.addedRoots) {
            if (isConnectedToDocument(root, this.input.root)) {
                reconcileDocumentRegion({ ...this.input, root, ownedOutputMutations: scheduler });
            }
        }

        for (const target of batch.datetimeTargets) {
            if (isConnectedToDocument(target, this.input.root) && !coveredBy(batch.addedRoots, target)) {
                reconcileDocumentRegion({ ...this.input, root: target, ownedOutputMutations: scheduler });
            }
        }

        for (const source of batch.displacedOutputSources) {
            if (
                isConnectedToDocument(source, this.input.root) &&
        !coveredBy(batch.addedRoots, source) &&
        !batch.datetimeTargets.includes(source)
            ) {
                reconcileDocumentRegion({ ...this.input, root: source, ownedOutputMutations: scheduler });
            }
        }
    }
}
