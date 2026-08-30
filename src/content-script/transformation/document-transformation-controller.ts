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
    type ReconcileInput,
} from "./process-document";
import {
    capturePageOwnedTextChange,
    getOwnedSourceForOutput,
    getOwnedTimestampSourceEntries,
    readPageOwnedText,
    restoreTimestampPresentations,
} from "./render-timestamp-presentation";
import { DIAGNOSTIC_CATEGORY } from "../../shared/diagnostics/contracts";
import { defaultRegistry } from "../adapters/registry";
import {
    DOCUMENT_ROUTE_HANDOFF_TRANSITION,
    clearDocumentRouteHandoff,
    type DocumentRouteHandoffClassifier,
    type DocumentRouteHandoffPolicy,
    type DocumentRouteHandoffSession,
    type DocumentRouteHandoffTransition,
} from "./route-handoff";
import {
    TIMESTAMP_MUTATION_KIND,
    type TimestampExtractionContext,
    type TimestampSourceAttribute,
} from "../adapters/types";

/**
 * Controller construction dependencies beyond one document processing pass.
 */
export interface DocumentTransformationControllerInput extends ProcessInput {
    /**
     * Total classifier applied to every non-duplicate changed route.
     */
    readonly routeHandoffClassifier?: DocumentRouteHandoffClassifier;

    /**
     * Optional live URL sampler used to close DOM-before-route-signal races.
     */
    readonly urlProvider?: () => URL;
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
 * Owns the active document pass, current route, mutation scheduler, and restoration lifecycle.
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
     * Current bounded diagnostic reporter, replaceable without restarting the controller.
     */
    private diagnosticSink: DocumentDiagnosticSink | undefined;

    /**
     * Stable processing dependencies excluding controller-owned route classification.
     */
    private readonly input: ProcessInput;

    /**
     * Total route transition classifier used after exact duplicate filtering.
     */
    private readonly routeHandoffClassifier: DocumentRouteHandoffClassifier;

    /**
     * Live route sampler used before every page-authored mutation batch.
     */
    private readonly urlProvider: (() => URL) | undefined;

    /**
     * Cloned current URL used by every processing pass.
     */
    private currentUrl: URL;

    /**
     * Optional provenance policy retained across active and idle phases.
     */
    private handoffPolicy: DocumentRouteHandoffPolicy | undefined;

    /**
     * Active exact-node route monitor for the current generation.
     */
    private handoffSession: DocumentRouteHandoffSession | undefined;

    /**
     * Monotonic route lifecycle token invalidating queued session work.
     */
    private routeGeneration = 0;

    /**
     * Captures processing and route dependencies before activation.
     *
     * @param input - Document, adapter, presentation, observer, and route dependencies.
     */
    constructor(input: DocumentTransformationControllerInput) {
        const { routeHandoffClassifier, urlProvider, ...processInput } = input;
        this.input = processInput;
        this.currentUrl = new URL(input.url.href);
        this.routeHandoffClassifier = routeHandoffClassifier ?? clearDocumentRouteHandoff;
        this.urlProvider = urlProvider;
        this.diagnosticSink = input.diagnosticSink;
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
     * Starts route-scoped observation and performs the initial current-route document pass.
     *
     * @returns - Outputs generated by the initial document pass.
     */
    start(): readonly HTMLTimeElement[] {
        if (this.phase === "active") {
            return this.outputs;
        }

        this.synchronizeCurrentRoute();
        const rules = (this.input.registry ?? defaultRegistry).matching(this.currentUrl);
        const sourceAttributes = [
            ...new Set(rules.flatMap((rule) => rule.mutationAttributes)),
        ];
        const generation = this.advanceRouteGeneration();
        const scheduler = new DocumentMutationScheduler({
            document: this.input.root,
            getOwnedSourceForOutput,
            capturePageOwnedTextChange,
            sourceAttributes,
            observeCharacterData: rules.some(
                (rule) => rule.observesCharacterData === true,
            ),
            getSourceMutationRoots: (
                element,
                attributeName,
                oldValue,
                trackedSources,
                mutationKind,
            ) => {
                const extractionContext: TimestampExtractionContext = {
                    url: new URL(this.currentUrl.href),
                    readPageText: readPageOwnedText,
                };
                const applicableRules = mutationKind
                    === TIMESTAMP_MUTATION_KIND.CHARACTER_DATA
                    ? rules.filter((rule) => rule.observesCharacterData === true)
                    : attributeName
                        ? rules.filter((rule) =>
                            rule.mutationAttributes.some(
                                (attribute) => attribute === attributeName,
                            ))
                        : rules;
                const sources: Element[] = [];
                const seen = new Set<Element>();
                const addSource = (source: Element): void => {
                    if (!seen.has(source)) {
                        seen.add(source);
                        sources.push(source);
                    }
                };

                if (mutationKind !== TIMESTAMP_MUTATION_KIND.CHARACTER_DATA) {
                    for (const trackedSource of trackedSources) {
                        addSource(trackedSource);
                    }
                }
                for (const rule of applicableRules) {
                    if (rule.getMutationSources) {
                        for (const source of rule.getMutationSources(
                            element,
                            attributeName as TimestampSourceAttribute | undefined,
                            oldValue ?? null,
                            extractionContext,
                            mutationKind,
                        )) {
                            addSource(source);
                        }
                        continue;
                    }
                    let current: Element | null = element;
                    while (current && current.ownerDocument === this.input.root) {
                        if (rule.matchesElement(current, extractionContext)) {
                            addSource(current);
                            break;
                        }
                        current = current.parentElement;
                    }
                }
                return sources;
            },
            onBatch: (batch) => {
                try {
                    if (this.synchronizeCurrentRoute()) {
                        return;
                    }
                } catch {
                    this.failClosed();
                    return;
                }
                this.handoffSession?.noteStructure({
                    addedRoots: batch.addedRoots,
                    removedRoots: batch.removedRoots,
                });
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
            this.activateHandoffSession(generation);
            this.outputs = processDocument(this.fullProcessInput(scheduler));
            this.phase = "active";
            return this.outputs;
        } catch (error) {
            this.advanceRouteGeneration();
            this.handoffSession?.dispose();
            this.handoffSession = undefined;
            scheduler.stop();
            restoreTimestampPresentations(this.input.root);
            this.outputs = [];
            this.scheduler = undefined;
            this.phase = "idle";
            throw error;
        }
    }

    /**
     * Stops observation, invalidates callbacks, and restores the document to page ownership.
     */
    teardown(): void {
        this.advanceRouteGeneration();
        this.handoffSession?.dispose();
        this.handoffSession = undefined;
        this.scheduler?.stop();
        this.scheduler = undefined;
        restoreTimestampPresentations(this.input.root);
        this.outputs = [];
        this.phase = "idle";
    }

    /**
     * Reformats only already owned, connected sources after a presentation save.
     *
     * @returns - Time elements updated during the reformat operation.
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
            ...this.regionProcessInput(this.input.root, scheduler),
            root: this.input.root,
            sources,
        });
        return this.outputs;
    }

    /**
     * Reconciles one sampled current URL through the retained route provenance contract.
     *
     * @param url - Current document URL sampled by the content runtime.
     * @returns - Outputs generated for the new current route.
     */
    reconcileRoute(url: URL): readonly HTMLTimeElement[] {
        this.applyRouteChange(url);
        return this.outputs;
    }

    /**
     * Applies one sampled route change and reports whether it ran a full active pass.
     *
     * @param url - Current document URL sampled by a trusted local capability.
     * @returns - Whether active output was restored and fully reprocessed.
     */
    private applyRouteChange(url: URL): boolean {
        const nextUrl = new URL(url.href);
        if (nextUrl.href === this.currentUrl.href) {
            return false;
        }

        let transition: DocumentRouteHandoffTransition;
        try {
            transition = this.routeHandoffClassifier({
                previousUrl: new URL(this.currentUrl.href),
                currentUrl: new URL(nextUrl.href),
            });
        } catch (error) {
            if (this.phase === "active") {
                this.failClosed();
            }
            throw error;
        }

        if (transition.kind === DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP) {
            this.currentUrl = nextUrl;
            return false;
        }

        const generation = this.advanceRouteGeneration();
        this.handoffSession?.dispose();
        this.handoffSession = undefined;
        if (this.phase !== "active") {
            this.currentUrl = nextUrl;
            this.applyRouteTransition(transition);
            return false;
        }

        const scheduler = this.scheduler;
        if (!scheduler) {
            this.failClosed();
            throw new Error("Active document controller has no mutation scheduler");
        }
        restoreTimestampPresentations(this.input.root, scheduler);
        this.outputs = [];
        this.currentUrl = nextUrl;
        this.applyRouteTransition(transition);
        try {
            this.activateHandoffSession(generation);
            this.outputs = processDocument(this.fullProcessInput(scheduler));
            return true;
        } catch (error) {
            this.failClosed();
            throw error;
        }
    }

    /**
     * Reconciles the lazily sampled live route before page-authored DOM work.
     *
     * @returns - Whether the sampled change already ran a full active pass.
     */
    private synchronizeCurrentRoute(): boolean {
        if (!this.urlProvider) {
            return false;
        }
        const sampledUrl = this.urlProvider();
        return this.applyRouteChange(new URL(sampledUrl.href));
    }

    /**
     * Advances the route lifecycle token and invalidates work from the previous generation.
     *
     * @returns - New current route generation.
     */
    private advanceRouteGeneration(): number {
        this.routeGeneration += 1;
        return this.routeGeneration;
    }

    /**
     * Applies one total retained-policy transition without an undefined semantic path.
     *
     * @param transition - Classified transition for the changed route.
     */
    private applyRouteTransition(transition: DocumentRouteHandoffTransition): void {
        switch (transition.kind) {
            case DOCUMENT_ROUTE_HANDOFF_TRANSITION.NOOP:
                break;
            case DOCUMENT_ROUTE_HANDOFF_TRANSITION.CLEAR:
                this.handoffPolicy = undefined;
                break;
            case DOCUMENT_ROUTE_HANDOFF_TRANSITION.REPLACE:
                this.handoffPolicy = transition.policy;
                break;
        }
    }

    /**
     * Activates the retained policy for one current active generation.
     *
     * @param generation - Exact route generation owning the new session.
     */
    private activateHandoffSession(generation: number): void {
        const policy = this.handoffPolicy;
        if (!policy) {
            return;
        }
        this.handoffSession = policy.activate({
            document: this.input.root,
            currentUrl: new URL(this.currentUrl.href),
            generation,
            requestReconciliation: () => {
                this.reconcileHandoffSession(generation);
            },
        });
    }

    /**
     * Runs one full current-context pass requested by the exact-node handoff session.
     *
     * @param generation - Session generation requesting reconciliation.
     */
    private reconcileHandoffSession(generation: number): void {
        const scheduler = this.scheduler;
        if (
            this.phase !== "active"
            || generation !== this.routeGeneration
            || !scheduler
            || !this.handoffSession
        ) {
            return;
        }
        try {
            if (this.synchronizeCurrentRoute()) {
                return;
            }
            this.outputs = processDocument(this.fullProcessInput(scheduler));
        } catch {
            this.failClosed();
        }
    }

    /**
     * Creates one full-document processing input from the retained current context.
     *
     * @param scheduler - Active renderer mutation sink.
     * @returns - Full processing input for the current route and policy.
     */
    private fullProcessInput(scheduler: DocumentMutationScheduler): ProcessInput {
        const result: ProcessInput = {
            ...this.input,
            url: new URL(this.currentUrl.href),
            root: this.input.root,
            ownedDomMutations: scheduler,
        };
        const mutable = result as unknown as {
            extractionPolicy?: DocumentRouteHandoffPolicy;
        };
        if (this.handoffPolicy) {
            mutable.extractionPolicy = this.handoffPolicy;
        } else {
            Reflect.deleteProperty(mutable, "extractionPolicy");
        }
        return result;
    }

    /**
     * Creates one bounded-region processing input from the retained current context.
     *
     * @param root - Bounded connected source or added root.
     * @param scheduler - Active renderer mutation sink.
     * @returns - Region processing input for the current route and policy.
     */
    private regionProcessInput(
        root: ParentNode,
        scheduler: DocumentMutationScheduler,
    ): ReconcileInput {
        const result: ReconcileInput = {
            ...this.input,
            url: new URL(this.currentUrl.href),
            root,
            ownedDomMutations: scheduler,
        };
        const mutable = result as unknown as {
            extractionPolicy?: DocumentRouteHandoffPolicy;
        };
        if (this.handoffPolicy) {
            mutable.extractionPolicy = this.handoffPolicy;
        } else {
            Reflect.deleteProperty(mutable, "extractionPolicy");
        }
        return result;
    }

    /**
     * Stops active observation, invalidates callbacks, and restores verified ownership.
     */
    private failClosed(): void {
        this.advanceRouteGeneration();
        this.handoffSession?.dispose();
        this.handoffSession = undefined;
        this.scheduler?.stop();
        this.scheduler = undefined;
        restoreTimestampPresentations(this.input.root);
        this.outputs = [];
        this.phase = "idle";
    }

    /**
     * Applies one coalesced mutation batch through current route policy and bounded roots.
     *
     * @param batch - Connected and detached roots selected by the scheduler.
     * @param scheduler - Mutation scheduler coordinating owned DOM changes.
     */
    private reconcile(batch: AffectedMutationBatch, scheduler: DocumentMutationScheduler): void {
        const removedRoots = batch.removedRoots.filter(
            (root) => !isConnectedToDocument(root, this.input.root),
        );
        if (removedRoots.length > 0) {
            restoreTimestampPresentations(removedRoots, scheduler);
        }

        for (const root of batch.addedRoots) {
            if (isConnectedToDocument(root, this.input.root)) {
                reconcileDocumentRegion(this.regionProcessInput(root, scheduler));
            }
        }

        const sourceTargets = batch.sourceTargets.filter(
            (target) =>
                isConnectedToDocument(target, this.input.root)
                && !coveredBy(batch.addedRoots, target)
                && !coveredBy(batch.visibilityRoots, target),
        );
        if (sourceTargets.length > 0) {
            reconcileDocumentSources({
                ...this.regionProcessInput(this.input.root, scheduler),
                root: this.input.root,
                sources: sourceTargets,
            });
        }

        for (const root of batch.visibilityRoots) {
            if (
                isConnectedToDocument(root, this.input.root)
                && !coveredBy(batch.addedRoots, root)
            ) {
                reconcileDocumentRegion(this.regionProcessInput(root, scheduler));
            }
        }

        for (const source of batch.displacedOutputSources) {
            if (
                isConnectedToDocument(source, this.input.root)
                && !coveredBy(batch.addedRoots, source)
                && !batch.sourceTargets.includes(source)
                && !coveredBy(batch.visibilityRoots, source)
            ) {
                reconcileDocumentRegion(this.regionProcessInput(source, scheduler));
            }
        }
    }
}
