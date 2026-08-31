/**
 * @file Coordinates adapter processing and mutation scheduling across a document's lifecycle.
 */

import {
    DocumentMutationScheduler,
    type AffectedMutationBatch,
} from "./document-mutation-scheduler";
import {
    reconcileDocumentRegion,
    reconcileDocumentSources,
    processDocument,
    type ProcessInput,
} from "./process-document";
import type { DocumentDiagnosticSink } from "../diagnostics";
import {
    capturePageOwnedTextChange,
    getOwnedSourceForOutput,
    getOwnedTimestampSourceEntries,
    restoreTimestampPresentations,
} from "./render-timestamp-presentation";
import { DIAGNOSTIC_CATEGORY } from "../../shared/diagnostics/contracts";
import type { DisplaySettings } from "../../shared/settings/snapshot";
import { defaultRegistry } from "../adapters/registry";
import type { TimestampSourceAttribute } from "../adapters/types";
import {
    type DocumentTransformationParticipant,
    type DocumentTransformationParticipantFactory,
} from "./document-transformation-participant";

/**
 * Document-processing dependencies plus an optional site-owned participant factory.
 */
export interface DocumentTransformationControllerInput extends ProcessInput {
    /**
     * Optional factory for a document-scoped asynchronous source lifecycle.
     */
    readonly participantFactory?: DocumentTransformationParticipantFactory;
}

/**
 * Controller-owned copy whose refreshed presentation fields may change between passes.
 */
type MutableProcessInput = {
    -readonly [Key in keyof ProcessInput]: ProcessInput[Key];
};

/**
 * Confirms that an element still belongs to the controller's document before it is reformatted.
 *
 * @param element - Candidate element retained from an earlier pass.
 * @param document - Document the controller currently owns.
 * @returns - Whether the element remains connected to that document.
 */
function isConnectedToDocument(element: Element, document: Document): boolean {
    return element.ownerDocument === document && element.isConnected;
}

/**
 * Suppresses a duplicate root when a broader root already covers the same candidate element.
 *
 * @param roots - Broader roots already selected for processing.
 * @param element - Candidate element to test for coverage.
 * @returns - Whether an existing root already contains the element.
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
     * Plain synchronous processing input carrying the effective document registry.
     */
    private readonly input: MutableProcessInput;

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
     * Current bounded diagnostic reporter, which callers may replace without restarting the
     * controller.
     */
    private diagnosticSink: DocumentDiagnosticSink | undefined;

    /**
     * Optional site-owned document participant composed by the runtime.
     */
    private readonly participant: DocumentTransformationParticipant | undefined;

    /**
     * Captures document-processing dependencies and seeds the current diagnostic sink before
     * activation.
     *
     * @param input - Document, adapter, presentation, and observer dependencies.
     */
    constructor(input: DocumentTransformationControllerInput) {
        const { participantFactory, ...processInput } = input;
        this.input = { ...processInput };
        this.diagnosticSink = processInput.diagnosticSink;
        this.participant = participantFactory?.({
            getDiagnosticSink: () => this.diagnosticSink,
            onSourcesChanged: (sources) => {
                this.reconcileParticipantSources(sources);
            },
        });
        if (this.participant) {
            this.input.registry = (processInput.registry ?? defaultRegistry)
                .withSpecialized(this.participant.rule);
        }
    }

    /**
     * Replaces the display settings used by later processing and reconciliation passes.
     *
     * @param display - Current persisted presentation settings.
     */
    setDisplay(display: DisplaySettings): void {
        this.input.display = display;
    }

    /**
     * Replaces the optional diagnostic sink used by later processing and reconciliation passes.
     *
     * @param sink - Diagnostic event sink, or undefined to stop forwarding.
     */
    setDiagnosticSink(sink: DocumentDiagnosticSink | undefined): void {
        this.diagnosticSink = sink;
        if (sink) {
            this.input.diagnosticSink = sink;
        } else {
            Reflect.deleteProperty(this.input, "diagnosticSink");
        }
    }

    /**
     * Starts mutation scheduling and performs the initial document pass.
     *
     * @returns - Outputs generated by the initial document pass.
     */
    start(): readonly HTMLTimeElement[] {
        if (this.phase === "active") {
            return this.outputs;
        }

        const rules = (this.input.registry ?? defaultRegistry).matching(this.input.url);
        const sourceAttributes = [
            ...new Set(rules.flatMap((rule) => rule.mutationAttributes)),
        ];
        const scheduler = new DocumentMutationScheduler({
            document: this.input.root,
            getOwnedSourceForOutput,
            capturePageOwnedTextChange,
            sourceAttributes,
            getSourceMutationRoots: (element, attributeName, oldValue, wasTracked) => {
                const applicableRules = attributeName
                    ? rules.filter((rule) =>
                        rule.mutationAttributes.some(
                            (attribute) => attribute === attributeName,
                        ))
                    : rules;
                if (attributeName) {
                    const sources: Element[] = [];
                    const seen = new Set<Element>();
                    for (const rule of applicableRules) {
                        const mutationSources = rule.getMutationSources?.(
                            element,
                            attributeName as TimestampSourceAttribute,
                            oldValue ?? null,
                            wasTracked,
                        ) ?? (rule.matchesElement(element) || wasTracked ? [element] : []);
                        for (const source of mutationSources) {
                            if (!seen.has(source)) {
                                seen.add(source);
                                sources.push(source);
                            }
                        }
                    }
                    return sources;
                }
                const roots: Element[] = [];
                const seen = new Set<Element>();
                for (const rule of applicableRules) {
                    for (const source of rule.getChildListMutationSources?.(element) ?? []) {
                        if (!seen.has(source)) {
                            seen.add(source);
                            roots.push(source);
                        }
                    }
                }
                let current: Element | null = element;
                while (current && current.ownerDocument === this.input.root) {
                    const candidate = current;
                    if (
                        !seen.has(candidate)
                        && applicableRules.some((rule) => rule.matchesElement(candidate))
                    ) {
                        seen.add(candidate);
                        roots.push(candidate);
                    }
                    current = current.parentElement;
                }
                return roots;
            },
            onBatch: (batch) => {
                if (
                    this.diagnosticSink
                    && (
                        batch.sourceTargets.length > 0
                        || batch.visibilityRoots.length > 0
                        || batch.displacedOutputSources.length > 0
                    )
                ) {
                    this.diagnosticSink({
                        category: DIAGNOSTIC_CATEGORY.MUTATION,
                        count:
                            batch.sourceTargets.length +
                            batch.visibilityRoots.length +
                            batch.displacedOutputSources.length,
                    });
                }
                this.reconcile(batch, scheduler);
            },
        });
        this.scheduler = scheduler;
        try {
            scheduler.start();
            this.participant?.start();
            this.participant?.inspect(this.input.root);
            this.outputs = processDocument({ ...this.input, ownedDomMutations: scheduler });
            this.phase = "active";
            return this.outputs;
        } catch (error) {
            this.participant?.stop();
            scheduler.stop();
            restoreTimestampPresentations(this.input.root);
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
        this.participant?.stop();
        this.scheduler?.stop();
        this.scheduler = undefined;
        restoreTimestampPresentations(this.input.root);
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
        const sources = getOwnedTimestampSourceEntries(this.input.root)
            .map(({ source }) => source)
            .filter((source) => isConnectedToDocument(source, this.input.root));
        this.outputs = reconcileDocumentSources({
            ...this.input,
            sources,
            ownedDomMutations: scheduler,
        });
        return this.outputs;
    }

    /**
     * Applies a settings change only to affected connected source elements.
     *
     * @param batch - Connected sources and display settings to reapply.
     * @param scheduler - Mutation scheduler coordinating owned DOM changes.
     */
    private reconcile(batch: AffectedMutationBatch, scheduler: DocumentMutationScheduler): void {
        const removedRoots = batch.removedRoots.filter(
            (root) => !isConnectedToDocument(root, this.input.root),
        );
        for (const root of removedRoots) {
            this.participant?.release(root);
        }
        if (removedRoots.length > 0) {
            restoreTimestampPresentations(removedRoots, scheduler);
        }

        for (const root of batch.addedRoots) {
            if (isConnectedToDocument(root, this.input.root)) {
                this.participant?.inspect(root);
                reconcileDocumentRegion({ ...this.input, root, ownedDomMutations: scheduler });
            }
        }

        this.participant?.inspectSources([
            ...batch.sourceTargets,
            ...batch.displacedOutputSources,
        ].filter((source) => isConnectedToDocument(source, this.input.root)));

        const sourceTargets = batch.sourceTargets.filter(
            (target) =>
                isConnectedToDocument(target, this.input.root)
                && !coveredBy(batch.addedRoots, target)
                && !coveredBy(batch.visibilityRoots, target),
        );
        if (sourceTargets.length > 0) {
            reconcileDocumentSources({
                ...this.input,
                sources: sourceTargets,
                ownedDomMutations: scheduler,
            });
        }

        for (const root of batch.visibilityRoots) {
            if (
                isConnectedToDocument(root, this.input.root) &&
                !coveredBy(batch.addedRoots, root)
            ) {
                reconcileDocumentRegion({
                    ...this.input,
                    root,
                    ownedDomMutations: scheduler,
                });
            }
        }

        for (const source of batch.displacedOutputSources) {
            if (
                isConnectedToDocument(source, this.input.root) &&
                !coveredBy(batch.addedRoots, source) &&
                !batch.sourceTargets.includes(source) &&
                !coveredBy(batch.visibilityRoots, source)
            ) {
                reconcileDocumentRegion({
                    ...this.input,
                    root: source,
                    ownedDomMutations: scheduler,
                });
            }
        }
    }

    /**
     * Reconciles exact participant sources after their document-local resolutions change.
     *
     * @param sources - Sources whose synchronous rule extraction result changed.
     */
    private reconcileParticipantSources(sources: readonly Element[]): void {
        const scheduler = this.scheduler;
        if (this.phase !== "active" || !scheduler) {
            return;
        }
        const connected = sources.filter(
            (source) => isConnectedToDocument(source, this.input.root),
        );
        if (connected.length > 0) {
            reconcileDocumentSources({
                ...this.input,
                sources: connected,
                ownedDomMutations: scheduler,
            });
        }
    }
}
