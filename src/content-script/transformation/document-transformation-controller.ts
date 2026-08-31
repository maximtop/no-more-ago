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
    type DocumentDiagnosticSink,
    type ProcessInput,
} from "./process-document";
import {
    capturePageOwnedTextChange,
    getOwnedSourceForOutput,
    getOwnedTimestampSourceEntries,
    restoreTimestampPresentations,
} from "./render-timestamp-presentation";
import { DIAGNOSTIC_CATEGORY } from "../../shared/diagnostics/contracts";
import { defaultRegistry } from "../adapters/registry";
import type { TimestampSourceAttribute } from "../adapters/types";
import {
    createBlueskyCoordinator,
    type BlueskyCoordinator,
} from "../adapters/bluesky-coordinator";
import {
    createBlueskyAppView,
    type BlueskyAppView,
} from "../adapters/bluesky-appview";
import { matchesBlueskyUrl } from "../adapters/bluesky";

/**
 * Document-processing dependencies plus an optional offline-test AppView capability.
 */
export interface DocumentTransformationControllerInput extends ProcessInput {
    /**
     * Optional AppView replacement used by deterministic controller and runtime tests.
     */
    readonly blueskyAppView?: BlueskyAppView;
}

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
    private readonly input: ProcessInput;

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
     * Optional document-local remote enrichment coordinator for exact bsky.app pages.
     */
    private readonly blueskyCoordinator: BlueskyCoordinator | undefined;

    /**
     * Captures document-processing dependencies and seeds the current diagnostic sink before
     * activation.
     *
     * @param input - Document, adapter, presentation, and observer dependencies.
     */
    constructor(input: DocumentTransformationControllerInput) {
        this.diagnosticSink = input.diagnosticSink;
        const blueskyAppView = input.blueskyAppView;
        const mutableInput = input as DocumentTransformationControllerInput & {
            registry?: typeof input.registry;
        };
        Reflect.deleteProperty(mutableInput, "blueskyAppView");
        this.input = mutableInput;
        if (!matchesBlueskyUrl(input.url)) {
            this.blueskyCoordinator = undefined;
            return;
        }
        const coordinator = createBlueskyCoordinator({
            document: input.root,
            url: input.url,
            appView: blueskyAppView ?? createBlueskyAppView(),
            getDiagnosticSink: () => this.diagnosticSink,
            onSourcesChanged: (sources) => {
                this.reconcileBlueskySources(sources);
            },
        });
        this.blueskyCoordinator = coordinator;
        mutableInput.registry = (input.registry ?? defaultRegistry)
            .withSpecialized(coordinator.rule);
    }

    /**
     * Replaces the optional diagnostic sink used by later processing and reconciliation passes.
     *
     * @param sink - Diagnostic event sink, or undefined to stop forwarding.
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
                let current: Element | null = element;
                while (current && current.ownerDocument === this.input.root) {
                    const candidate = current;
                    if (applicableRules.some((rule) => rule.matchesElement(candidate))) {
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
            this.blueskyCoordinator?.start();
            this.blueskyCoordinator?.inspect(this.input.root);
            this.outputs = processDocument({ ...this.input, ownedDomMutations: scheduler });
            this.phase = "active";
            return this.outputs;
        } catch (error) {
            this.blueskyCoordinator?.stop();
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
        this.blueskyCoordinator?.stop();
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
            this.blueskyCoordinator?.release(root);
        }
        if (removedRoots.length > 0) {
            restoreTimestampPresentations(removedRoots, scheduler);
        }

        for (const root of batch.addedRoots) {
            if (isConnectedToDocument(root, this.input.root)) {
                this.blueskyCoordinator?.inspect(root);
                reconcileDocumentRegion({ ...this.input, root, ownedDomMutations: scheduler });
            }
        }

        this.blueskyCoordinator?.inspectSources([
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
     * Reconciles exact Bluesky sources after their document-local resolutions change.
     *
     * @param sources - Sources whose synchronous rule extraction result changed.
     */
    private reconcileBlueskySources(sources: readonly Element[]): void {
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
