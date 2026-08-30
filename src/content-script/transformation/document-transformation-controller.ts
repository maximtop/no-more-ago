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
    applyTimestampCandidate,
    type DocumentDiagnosticSink,
    type ProcessInput,
    type ReconcileInput,
} from "./process-document";
import {
    capturePageOwnedTextChange,
    getOwnedSourceForOutput,
    getOwnedTimestampSourceEntries,
    restoreTimestampPresentations,
} from "./render-timestamp-presentation";
import {
    getOwnedSourceEntries as getOwnedTimeSourceEntries,
} from "./render-exact-time";
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
import type { DeferredTimestampResolver } from "./deferred-timestamp-resolution";
import type {
    TimestampCandidate,
    TimestampSourceAttribute,
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
     * Optional delayed resolver supplied only by deterministic tests.
     */
    readonly deferredResolver?: DeferredTimestampResolver;
}

/**
 * Exact current request retained for one unresolved source.
 */
interface PendingDeferredResolution {
    /**
     * Exact source offered to the resolver.
     */
    readonly source: Element;

    /**
     * Opaque source identity captured before resolution.
     */
    readonly identity: string;

    /**
     * Exact route href captured before resolution.
     */
    readonly href: string;

    /**
     * Controller generation captured before resolution.
     */
    readonly generation: number;

    /**
     * Exact request token preventing superseded completion.
     */
    readonly token: object;
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
     * Optional test-injected delayed resolver; production supplies none.
     */
    private readonly deferredResolver: DeferredTimestampResolver | undefined;

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
     * Current or terminal request per source for this exact route generation.
     */
    private pendingDeferred = new WeakMap<Element, PendingDeferredResolution>();

    /**
     * Captures processing and route dependencies before activation.
     *
     * @param input - Document, adapter, presentation, observer, and route dependencies.
     */
    constructor(input: DocumentTransformationControllerInput) {
        const { routeHandoffClassifier, deferredResolver, ...processInput } = input;
        this.input = processInput;
        this.currentUrl = new URL(input.url.href);
        this.routeHandoffClassifier = routeHandoffClassifier ?? clearDocumentRouteHandoff;
        this.deferredResolver = deferredResolver;
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
        const nextUrl = new URL(url.href);
        if (nextUrl.href === this.currentUrl.href) {
            return this.outputs;
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

        const generation = this.advanceRouteGeneration();
        this.handoffSession?.dispose();
        this.handoffSession = undefined;
        if (this.phase !== "active") {
            this.currentUrl = nextUrl;
            this.applyRouteTransition(transition);
            return this.outputs;
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
            return this.outputs;
        } catch (error) {
            this.failClosed();
            throw error;
        }
    }

    /**
     * Advances the route lifecycle token and invalidates work from the previous generation.
     *
     * @returns - New current route generation.
     */
    private advanceRouteGeneration(): number {
        this.routeGeneration += 1;
        this.pendingDeferred = new WeakMap<Element, PendingDeferredResolution>();
        return this.routeGeneration;
    }

    /**
     * Applies one total retained-policy transition without an undefined semantic path.
     *
     * @param transition - Classified transition for the changed route.
     */
    private applyRouteTransition(transition: DocumentRouteHandoffTransition): void {
        switch (transition.kind) {
            case DOCUMENT_ROUTE_HANDOFF_TRANSITION.PRESERVE:
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
            this.outputs = processDocument(this.fullProcessInput(scheduler));
        } catch {
            this.failClosed();
        }
    }

    /**
     * Starts or reuses one exact current deferred request for an unresolved source.
     *
     * @param source - Exact unresolved source.
     * @param url - Current route URL supplied by the processing pass.
     * @returns - Whether the source has a current or terminal request.
     */
    private scheduleDeferredResolution(source: Element, url: URL): boolean {
        const resolver = this.deferredResolver;
        if (
            !resolver
            || source.ownerDocument !== this.input.root
            || !source.isConnected
            || url.href !== this.currentUrl.href
        ) {
            return false;
        }
        let identity: string | null;
        try {
            identity = resolver.identify(source, new URL(url.href));
        } catch {
            return false;
        }
        if (identity === null) {
            return false;
        }
        const previous = this.pendingDeferred.get(source);
        if (
            previous
            && previous.identity === identity
            && previous.href === url.href
            && previous.generation === this.routeGeneration
        ) {
            return true;
        }
        const pending: PendingDeferredResolution = {
            source,
            identity,
            href: url.href,
            generation: this.routeGeneration,
            token: {},
        };
        this.pendingDeferred.set(source, pending);
        let request: Promise<TimestampCandidate | null>;
        try {
            request = resolver.resolve(source, new URL(url.href), identity);
        } catch {
            return true;
        }
        void Promise.resolve(request).then(
            (candidate) => {
                this.applyDeferredCompletion(pending, candidate);
            },
            () => undefined,
        );
        return true;
    }

    /**
     * Applies one delayed candidate only after every current-context guard passes.
     *
     * @param pending - Exact request record captured before resolution.
     * @param candidate - Candidate or terminal no-op returned by the resolver.
     */
    private applyDeferredCompletion(
        pending: PendingDeferredResolution,
        candidate: TimestampCandidate | null,
    ): void {
        const source = pending.source;
        const scheduler = this.scheduler;
        if (
            candidate === null
            || this.phase !== "active"
            || !scheduler
            || this.pendingDeferred.get(source)?.token !== pending.token
            || this.routeGeneration !== pending.generation
            || this.currentUrl.href !== pending.href
            || source.ownerDocument !== this.input.root
            || !source.isConnected
            || candidate.source !== source
        ) {
            return;
        }
        try {
            if (
                this.handoffPolicy
                && !this.handoffPolicy.allowsDeferred(source)
            ) {
                return;
            }
            const identity = this.deferredResolver?.identify(
                source,
                new URL(this.currentUrl.href),
            );
            if (identity !== pending.identity) {
                return;
            }
            const locales = this.input.localesProvider?.() ?? this.input.locales ?? [];
            const display = this.input.displayProvider?.() ?? this.input.display;
            const output = applyTimestampCandidate(
                candidate,
                source,
                locales,
                display,
                this.diagnosticSink,
                scheduler,
            );
            if (output) {
                this.outputs = getOwnedTimeSourceEntries(this.input.root)
                    .map((entry) => entry.output);
            }
        } catch {
            /* delayed resolution failures are terminal no-ops */
        }
    }

    /**
     * Invalidates pending records owned by one detached bounded subtree.
     *
     * @param root - Detached mutation root.
     */
    private invalidateDeferredRoot(root: Node): void {
        if (root.nodeType !== 1) {
            return;
        }
        const element = root as Element;
        this.pendingDeferred.delete(element);
        for (const descendant of element.querySelectorAll("*")) {
            this.pendingDeferred.delete(descendant);
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
            unresolvedTimestampScheduler?: ProcessInput["unresolvedTimestampScheduler"];
        };
        if (this.handoffPolicy) {
            mutable.extractionPolicy = this.handoffPolicy;
        } else {
            Reflect.deleteProperty(mutable, "extractionPolicy");
        }
        if (this.deferredResolver) {
            mutable.unresolvedTimestampScheduler = (source, url) =>
                this.scheduleDeferredResolution(source, url);
        } else {
            Reflect.deleteProperty(mutable, "unresolvedTimestampScheduler");
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
            unresolvedTimestampScheduler?: ReconcileInput["unresolvedTimestampScheduler"];
        };
        if (this.handoffPolicy) {
            mutable.extractionPolicy = this.handoffPolicy;
        } else {
            Reflect.deleteProperty(mutable, "extractionPolicy");
        }
        if (this.deferredResolver) {
            mutable.unresolvedTimestampScheduler = (source, url) =>
                this.scheduleDeferredResolution(source, url);
        } else {
            Reflect.deleteProperty(mutable, "unresolvedTimestampScheduler");
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
        for (const root of batch.removedRoots) {
            this.invalidateDeferredRoot(root);
        }
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
