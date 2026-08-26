import { DocumentMutationScheduler, type AffectedMutationBatch } from "./document-mutation-scheduler";
import {
    reconcileDocumentRegion,
    processDocument,
    type DocumentDiagnosticSink,
    type ProcessInput
} from "./process-document";
import { getOwnedSourceEntries, getOwnedSourceForOutput, restoreExactTimes } from "./render-exact-time";

function isConnectedToDocument(element: Element, document: Document): boolean {
    return element.ownerDocument === document && element.isConnected;
}

function coveredBy(roots: readonly Element[], element: Element): boolean {
    return roots.some((root) => root.contains(element));
}

export class DocumentTransformationController {
    private phase: "idle" | "active" = "idle";
    private outputs: readonly HTMLTimeElement[] = [];
    private scheduler: DocumentMutationScheduler | undefined;
    private diagnosticSink: DocumentDiagnosticSink | undefined;

    constructor(private readonly input: ProcessInput) {
        this.diagnosticSink = input.diagnosticSink;
    }

    setDiagnosticSink(sink: DocumentDiagnosticSink | undefined): void {
        this.diagnosticSink = sink;
        const mutableInput = this.input as { diagnosticSink?: DocumentDiagnosticSink };
        if (sink) mutableInput.diagnosticSink = sink;
        else Reflect.deleteProperty(mutableInput, "diagnosticSink");
    }

    start(): readonly HTMLTimeElement[] {
        if (this.phase === "active") return this.outputs;

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

    teardown(): void {
        this.scheduler?.stop();
        this.scheduler = undefined;
        restoreExactTimes(this.input.root);
        this.outputs = [];
        this.phase = "idle";
    }

    /** Reformat only already owned, connected sources after a presentation save. */
    reformatOwned(): readonly HTMLTimeElement[] {
        if (this.phase !== "active") return this.outputs;
        const scheduler = this.scheduler;
        if (!scheduler) return this.outputs;
        const outputs: HTMLTimeElement[] = [];
        for (const { source } of getOwnedSourceEntries(this.input.root)) {
            if (!isConnectedToDocument(source, this.input.root)) continue;
            outputs.push(...reconcileDocumentRegion({ ...this.input, root: source, ownedOutputMutations: scheduler }));
        }
        this.outputs = outputs;
        return outputs;
    }

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
