/**
 * @file Coordinates the document controller with persisted settings and runtime messages.
 */

import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    RECONCILE_DOCUMENT_POLICY_MESSAGE,
    RECONCILE_DOCUMENT_ROUTE_MESSAGE,
    UPDATE_DEBUG_POLICY_MESSAGE,
    UPDATE_PRESENTATION_MESSAGE,
    type DocumentCommand,
    PRESENTATION_UPDATED_MESSAGE,
    type DocumentPolicyReconciledMessage,
    type DebugPolicyUpdateAcknowledgement,
    type DocumentPhase,
    type PresentationUpdateAcknowledgement,
} from '../shared/messaging/document-messages';
import { STATE_AVAILABILITY } from '../shared/messaging/view-state-values';
import {
    DEFAULT_DISPLAY_SETTINGS,
    type DisplaySettings,
} from '../shared/settings/snapshot';

import { matchesBlueskyUrl } from './adapters/bluesky';
import {
    createBlueskyAppView,
    type BlueskyAppView,
} from './adapters/bluesky-appview';
import { createBlueskyCoordinator } from './adapters/bluesky-coordinator';
import {
    DocumentTransformationController,
    type DocumentTransformationControllerInput,
} from './transformation/document-transformation-controller';

import type { AdapterRegistry } from './adapters/registry';
import type { DocumentDiagnosticSink } from './diagnostics';
import type {
    DocumentTransformationParticipantFactory,
} from './transformation/document-transformation-participant';
import type { DocumentRouteHandoffClassifier } from './transformation/route-handoff';
import type { DocumentState } from '../shared/messaging/document-state';

/**
 * Global symbol used to retain the single content-runtime instance for a document.
 */
export const DOCUMENT_RUNTIME_SLOT = Symbol.for('no-more-ago.document-runtime');

/**
 * Subset of the extension runtime API used to receive content-script commands.
 */
export interface ContentMessageRuntime {
    /**
     * Event source for messages sent from extension contexts.
     */
    readonly onMessage: {
        /**
         * Registers a handler that may synchronously return a response.
         */
        addListener(
            listener: (
                message: unknown,
                sender?: unknown,
                sendResponse?: (response: unknown) => void,
            ) => unknown,
        ): void;
    };
}

/**
 * Handle for stopping an installed content runtime.
 */
export interface ContentRuntimeHandle {
    /**
     * Stops processing, cancels pending startup, and clears diagnostic forwarding.
     */
    teardown(): void;

    /**
     * Reconciles exact sources whose trusted out-of-band data changed.
     *
     * @param sources - Connected page-owned timestamp sources to re-evaluate.
     */
    reconcileSources(sources: readonly Element[]): void;
}

/**
 * Same-document route event source such as the content window's popstate event.
 */
export interface ContentRouteEventSource {
    /**
     * Registers one route-change listener retained for the document lifetime.
     *
     * @param listener - Listener that samples the current route when invoked.
     */
    addListener(listener: () => void): void;
}

/**
 * Creates an acknowledgement for the policy revision retained by the runtime.
 *
 * @param revision - Retained settings revision, or null for an unversioned fail-closed refresh.
 *
 * @returns - Policy reconciliation acknowledgement.
 */
function policyAcknowledgement(
    revision: number | null,
): DocumentPolicyReconciledMessage {
    return { type: DOCUMENT_POLICY_RECONCILED_MESSAGE, revision };
}

/**
 * Creates the acknowledgement for an applied presentation revision.
 *
 * @param revision - Presentation revision successfully applied.
 *
 * @returns - Runtime acknowledgement for that presentation revision.
 */
function presentationAcknowledgement(revision: number): PresentationUpdateAcknowledgement {
    return { type: PRESENTATION_UPDATED_MESSAGE, revision };
}

/**
 * Creates the acknowledgement for an applied diagnostic-policy revision.
 *
 * @param revision - Diagnostic-policy revision successfully applied.
 *
 * @returns - Runtime acknowledgement for that diagnostic-policy revision.
 */
function debugAcknowledgement(revision: number): DebugPolicyUpdateAcknowledgement {
    return { type: DEBUG_POLICY_UPDATED_MESSAGE, revision };
}

/**
 * Phase exposed after a fail-closed teardown caused by an untrusted hydration.
 */
type FailurePhase = Extract<
    DocumentPhase,
    typeof DOCUMENT_PHASE.FAILED | typeof DOCUMENT_PHASE.STOPPED
>;

/**
 * Inputs the runtime slot receives when it is first created for a document.
 */
interface RuntimeSlotOptions {
    /**
     * Static controller inputs; the slot supplies the live presentation and URL providers.
     */
    readonly controllerInput: Omit<
        DocumentTransformationControllerInput,
        'displayProvider' | 'urlProvider'
    >;

    /**
     * Runtime event source used to receive teardown and update commands.
     */
    readonly messages: ContentMessageRuntime;

    /**
     * Background reporter used only while diagnostic forwarding is enabled.
     */
    readonly reportDiagnostic: ((event: Record<string, unknown>) => Promise<unknown>) | undefined;

    /**
     * Current background state loader used by policy-refresh messages.
     */
    readonly loadDocumentState: (() => Promise<unknown>) | undefined;

    /**
     * Lazily samples the content document's current URL.
     */
    readonly urlProvider: () => URL;

    /**
     * Optional site-composition listener synchronized with controller activity.
     */
    readonly onActivityChanged: ((active: boolean) => void) | undefined;
}

/**
 * Per-document singleton retained on the Document while its content runtime exists.
 */
class RuntimeSlot {
    /**
     * Stable public handle returned by every installation for this document.
     */
    readonly handle: ContentRuntimeHandle;

    /**
     * Document transformation controller.
     */
    private readonly controller: DocumentTransformationController;

    /**
     * Runtime event source used to receive teardown and update commands.
     */
    private readonly messages: ContentMessageRuntime;

    /**
     * Current startup, active, stopped, or failed state reported to callers.
     */
    private phase: DocumentPhase = DOCUMENT_PHASE.STOPPED;

    /**
     * Incremented on each activation or teardown to invalidate prior async callbacks.
     */
    private generation = 0;

    /**
     * Persisted-state request retained until it settles or the runtime is stopped.
     */
    private hydration: Promise<void> | undefined;

    /**
     * Most recent settings accepted for controller startup or reformatting.
     */
    private presentation: DisplaySettings | undefined;

    /**
     * Revision of the settings currently stored in presentation.
     */
    private presentationRevision: number | undefined;

    /**
     * Current diagnostic-forwarding policy.
     */
    private debugEnabled = false;

    /**
     * Revision of the diagnostic-forwarding policy.
     */
    private debugRevision: number | undefined;

    /**
     * Effective activation policy applied by the latest revisioned command or hydration.
     */
    private policyEnabled: boolean | undefined;

    /**
     * Latest persisted settings revision accepted for activation policy.
     */
    private policyRevision: number | undefined;

    /**
     * Background reporter used only while diagnostic forwarding is enabled.
     */
    private reportDiagnostic: ((event: Record<string, unknown>) => Promise<unknown>) | undefined;

    /**
     * Current background state loader used by policy-refresh messages.
     */
    private loadDocumentState: (() => Promise<unknown>) | undefined;

    /**
     * Lazily samples the content document's current URL.
     */
    private urlProvider: () => URL;

    /**
     * Optional site-composition listener synchronized with controller activity.
     */
    private onActivityChanged: ((active: boolean) => void) | undefined;

    /**
     * Last activity state delivered through onActivityChanged.
     */
    private activityActive = false;

    /**
     * Creates the stopped runtime for one document.
     *
     * @param options - Static inputs of the runtime.
     */
    constructor(options: RuntimeSlotOptions) {
        this.messages = options.messages;
        this.reportDiagnostic = options.reportDiagnostic;
        this.loadDocumentState = options.loadDocumentState;
        this.urlProvider = options.urlProvider;
        this.onActivityChanged = options.onActivityChanged;
        this.controller = new DocumentTransformationController({
            ...options.controllerInput,
            displayProvider: () => this.presentation ?? DEFAULT_DISPLAY_SETTINGS,
            urlProvider: () => this.urlProvider(),
        });
        this.handle = {
            teardown: () => {
                this.teardown();
            },
            reconcileSources: (sources) => {
                this.controller.reconcileSources(sources);
            },
        };
    }

    /**
     * Registers the message and route listeners.
     *
     * @param routeEvents - Optional same-document route event source.
     */
    attach(routeEvents: ContentRouteEventSource | undefined): void {
        this.messages.onMessage.addListener(
            (value, _sender, sendResponse) => this.handleMessage(value, sendResponse),
        );
        try {
            routeEvents?.addListener(() => {
                this.reconcileCurrentRoute();
            });
        } catch {
            /* exact-frame route messages remain available when popstate setup is unavailable */
        }
    }

    /**
     * Begins the first state-hydration generation of the runtime.
     */
    start(): void {
        this.activate(this.loadDocumentState);
    }

    /**
     * Replaces the site integration and state loader of an installed runtime, then refreshes it.
     *
     * @param input - Site lifecycle listener, diagnostic reporter, URL source, and state loader.
     * @param input.onActivityChanged - Optional site lifecycle listener.
     * @param input.reportDiagnostic - Background diagnostic event reporter.
     * @param input.urlProvider - Lazy current page URL source.
     * @param input.loadDocumentState - Background document-state loader.
     */
    reuse(input: {
        readonly onActivityChanged: ((active: boolean) => void) | undefined;
        readonly reportDiagnostic: ((event: Record<string, unknown>) => Promise<unknown>) | undefined;
        readonly urlProvider: () => URL;
        readonly loadDocumentState: (() => Promise<unknown>) | undefined;
    }): void {
        this.onActivityChanged = input.onActivityChanged;
        this.synchronizeActivity();
        if (input.reportDiagnostic) {
            this.reportDiagnostic = input.reportDiagnostic;
        }
        this.urlProvider = input.urlProvider;
        this.loadDocumentState = input.loadDocumentState;
        this.refreshPolicy();
    }

    /**
     * Delivers a changed controller activity state without allowing site integration failures to
     * interfere with shared timestamp processing.
     *
     * @param active - Whether the controller generation may process the document.
     */
    private notifyActivity(active: boolean): void {
        if (this.activityActive === active) {
            return;
        }
        this.activityActive = active;
        try {
            this.onActivityChanged?.(active);
        } catch {
            /* optional site composition fails independently from shared processing */
        }
    }

    /**
     * Synchronizes a replacement listener to the current activity state.
     */
    private synchronizeActivity(): void {
        try {
            this.onActivityChanged?.(this.activityActive);
        } catch {
            /* optional site composition fails independently from shared processing */
        }
    }

    /**
     * Stores an accepted presentation revision and exposes its display settings to the controller.
     *
     * @param display - Validated presentation settings to expose.
     * @param revision - Accepted settings revision.
     *
     * @returns - Whether label expansion was enabled and previously skipped sources need discovery.
     */
    private applyPresentation(display: DisplaySettings, revision: number): boolean {
        const discoverAbsolute = display.precisionPolicy?.absoluteLabels === true
            && this.presentation?.precisionPolicy?.absoluteLabels !== true;
        this.presentation = display;
        this.presentationRevision = revision;
        return discoverAbsolute;
    }

    /**
     * Updates diagnostic forwarding and installs or removes the controller's sink.
     *
     * @param enabled - Whether document diagnostics should be forwarded.
     * @param revision - Accepted diagnostic-policy revision.
     */
    private applyDebugPolicy(enabled: boolean, revision: number): void {
        this.debugEnabled = enabled;
        this.debugRevision = revision;
        if (!enabled || !this.reportDiagnostic) {
            this.controller.setDiagnosticSink(undefined);
            return;
        }
        const report = this.reportDiagnostic;

        /**
         * Forwards a document diagnostic while debug logging is enabled, containing report failures.
         *
         * @param event - Diagnostic event emitted by document processing.
         */
        const sink: DocumentDiagnosticSink = (event) => {
            if (!this.debugEnabled) {
                return;
            }
            try {
                void Promise.resolve(report(event)).catch(
                    () => undefined,
                );
            } catch {
                /* diagnostics never interfere with page processing */
            }
        };
        this.controller.setDiagnosticSink(sink);
    }

    /**
     * Stops the controller and clears state retained by the current runtime generation.
     */
    private teardown(): void {
        this.generation += 1;
        this.notifyActivity(false);
        this.controller.teardown();
        this.phase = DOCUMENT_PHASE.STOPPED;
        this.presentation = undefined;
        this.presentationRevision = undefined;
        this.debugEnabled = false;
        this.debugRevision = undefined;
        this.controller.setDiagnosticSink(undefined);
        this.hydration = undefined;
    }

    /**
     * Samples and reconciles the current route without trusting message payload data.
     *
     * @returns - Whether reconciliation succeeded and activation may proceed.
     */
    private reconcileCurrentRoute(): boolean {
        try {
            const currentUrl = this.urlProvider();
            this.controller.reconcileRoute(new URL(currentUrl.href));
            return true;
        } catch {
            this.teardown();
            this.phase = DOCUMENT_PHASE.FAILED;
            return false;
        }
    }

    /**
     * Starts the controller once state hydration succeeds.
     *
     * @param generation - Activation generation allowed to start the controller.
     *
     * @throws The controller start error, after activity is reported stopped and the controller is torn down.
     */
    private maybeStart(generation: number): void {
        if (
            this.phase !== DOCUMENT_PHASE.WAITING
            || this.generation !== generation
            || this.presentation === undefined
            || this.policyEnabled === false
        ) {
            return;
        }
        this.notifyActivity(true);
        try {
            this.controller.start();
            this.phase = DOCUMENT_PHASE.ACTIVE;
        } catch (error) {
            this.notifyActivity(false);
            try {
                this.controller.teardown();
            } finally {
                this.phase = DOCUMENT_PHASE.FAILED;
            }
            throw error;
        }
    }

    /**
     * Restores page-owned content when the current hydration generation cannot be trusted.
     *
     * @param generation - Hydration generation that failed.
     * @param failurePhase - Stable phase exposed after fail-closed teardown.
     */
    private failHydration(generation: number, failurePhase: FailurePhase): void {
        if (
            this.generation !== generation
            || (this.phase !== DOCUMENT_PHASE.WAITING && this.phase !== DOCUMENT_PHASE.ACTIVE)
        ) {
            return;
        }
        this.teardown();
        this.phase = failurePhase;
    }

    /**
     * Loads persisted state, applies its revisions, then advances document startup.
     *
     * @param generation - Activation generation being hydrated.
     * @param loader - Optional persisted-state loader.
     * @param failurePhase - Phase used when hydration fails.
     */
    private beginHydration(
        generation: number,
        loader: (() => Promise<unknown>) | undefined,
        failurePhase: FailurePhase = DOCUMENT_PHASE.FAILED,
    ): void {
        if (!loader) {
            this.policyEnabled = true;
            this.policyRevision ??= 0;
            this.applyPresentation(DEFAULT_DISPLAY_SETTINGS, 0);
            this.applyDebugPolicy(false, 0);
            this.maybeStart(generation);
            return;
        }
        let request: Promise<unknown>;
        try {
            request = loader();
        } catch {
            this.failHydration(generation, failurePhase);
            return;
        }
        this.hydration = Promise.resolve(request)
            .then(
                (value) => {
                    if (
                        (this.phase !== DOCUMENT_PHASE.WAITING
                            && this.phase !== DOCUMENT_PHASE.ACTIVE)
                        || this.generation !== generation
                    ) {
                        return;
                    }
                    const response = value as DocumentState | undefined;
                    if (response?.availability !== STATE_AVAILABILITY.READY) {
                        this.failHydration(generation, failurePhase);
                        return;
                    }
                    if (
                        this.policyRevision !== undefined
                        && response.revision < this.policyRevision
                    ) {
                        this.failHydration(generation, failurePhase);
                        return;
                    }
                    this.policyRevision = response.revision;
                    this.policyEnabled = response.enabled;
                    const previousRevision = Math.max(
                        this.presentationRevision ?? -1,
                        this.debugRevision ?? -1,
                    );
                    const previousPresentationRevision = this.presentationRevision ?? -1;
                    let discoverAbsolute = false;
                    if (
                        this.presentationRevision === undefined
                        || response.revision >= this.presentationRevision
                    ) {
                        discoverAbsolute = this.applyPresentation(
                            response.display,
                            response.revision,
                        );
                    }
                    if (
                        this.phase === DOCUMENT_PHASE.ACTIVE
                        && response.revision > previousPresentationRevision
                    ) {
                        this.controller.reformatOwned(discoverAbsolute);
                    }
                    if (response.revision >= previousRevision) {
                        this.applyDebugPolicy(response.debugEnabled, response.revision);
                    }
                    if (!response.enabled) {
                        this.teardown();
                        return;
                    }
                    this.maybeStart(generation);
                },
                () => {
                    this.failHydration(generation, failurePhase);
                },
            )
            .finally(() => {
                if (this.generation === generation) {
                    this.hydration = undefined;
                }
            });
    }

    /**
     * Resets a stopped runtime and begins a new state-hydration generation.
     *
     * @param loader - Optional persisted-state loader.
     * @param failurePhase - Phase used when hydration fails.
     */
    private activate(
        loader: (() => Promise<unknown>) | undefined,
        failurePhase: FailurePhase = DOCUMENT_PHASE.FAILED,
    ): void {
        if (this.phase === DOCUMENT_PHASE.WAITING || this.phase === DOCUMENT_PHASE.ACTIVE) {
            return;
        }
        if (!this.reconcileCurrentRoute()) {
            return;
        }
        this.generation += 1;
        const { generation } = this;
        this.phase = DOCUMENT_PHASE.WAITING;
        this.presentation = undefined;
        this.presentationRevision = undefined;
        this.debugEnabled = false;
        this.debugRevision = undefined;
        this.controller.setDiagnosticSink(undefined);
        this.hydration = undefined;
        this.loadDocumentState = loader;
        this.beginHydration(generation, loader, failurePhase);
    }

    /**
     * Starts a policy hydration generation without disrupting an active controller.
     *
     * @param failurePhase - Phase used when the refreshed state cannot be loaded.
     */
    private refreshPolicy(failurePhase: FailurePhase = DOCUMENT_PHASE.FAILED): void {
        if (this.phase !== DOCUMENT_PHASE.ACTIVE && this.phase !== DOCUMENT_PHASE.WAITING) {
            this.activate(this.loadDocumentState, failurePhase);
            return;
        }
        this.generation += 1;
        this.beginHydration(this.generation, this.loadDocumentState, failurePhase);
    }

    /**
     * Applies one revisioned effective policy without allowing older commands to win later.
     *
     * Unversioned fail-closed commands synchronously restore page ownership before they reload
     * current background state. Authoritative hydration may replace a provisional same-revision
     * command, allowing reinjection after a cross-document navigation to converge on the new host.
     *
     * @param revision - Persisted settings revision, or null while settings are unavailable.
     * @param enabled - Effective top-level activation policy carried by the command.
     *
     * @returns - Revision retained for acknowledgement.
     */
    private reconcilePolicy(revision: number | null, enabled: boolean): number | null {
        if (revision === null) {
            this.policyEnabled = false;
            if (this.phase !== DOCUMENT_PHASE.STOPPED) {
                this.teardown();
            }
            if (this.loadDocumentState) {
                this.activate(this.loadDocumentState, DOCUMENT_PHASE.STOPPED);
            }
            return null;
        }
        if (this.policyRevision !== undefined && revision < this.policyRevision) {
            return this.policyRevision;
        }
        if (
            this.policyRevision === revision
            && this.policyEnabled !== undefined
            && this.policyEnabled !== enabled
        ) {
            this.policyEnabled = enabled;
            if (!enabled && this.phase !== DOCUMENT_PHASE.STOPPED) {
                this.teardown();
            }
            this.refreshPolicy();
            return revision;
        }
        const repeated = this.policyRevision === revision && this.policyEnabled === enabled;
        this.policyRevision = revision;
        this.policyEnabled = enabled;
        if (!enabled) {
            if (this.phase !== DOCUMENT_PHASE.STOPPED) {
                this.teardown();
            }
            return revision;
        }
        if (this.phase !== DOCUMENT_PHASE.ACTIVE && this.phase !== DOCUMENT_PHASE.WAITING) {
            this.activate(this.loadDocumentState);
        } else if (!repeated) {
            this.refreshPolicy();
        }
        return revision;
    }

    /**
     * Answers one runtime command from an extension context.
     *
     * @param value - Message delivered by the extension runtime.
     * @param sendResponse - Optional reply channel of the message sender.
     *
     * @returns - The response returned to the sender, or undefined when the message is ignored.
     */
    private handleMessage(
        value: unknown,
        sendResponse: ((response: unknown) => void) | undefined,
    ): unknown {
        const message = value as DocumentCommand | undefined;
        if (message?.type === RECONCILE_DOCUMENT_POLICY_MESSAGE) {
            const retainedRevision = this.reconcilePolicy(message.revision, message.enabled);
            const response = policyAcknowledgement(retainedRevision);
            sendResponse?.(response);
            return response;
        }
        if (message?.type === RECONCILE_DOCUMENT_ROUTE_MESSAGE) {
            this.reconcileCurrentRoute();
            return undefined;
        }
        if (message?.type === DOCUMENT_STATUS_MESSAGE) {
            const response = { type: DOCUMENT_STATUS_MESSAGE, phase: this.phase };
            sendResponse?.(response);
            return response;
        }
        if (message?.type === UPDATE_PRESENTATION_MESSAGE) {
            if (this.phase !== DOCUMENT_PHASE.WAITING && this.phase !== DOCUMENT_PHASE.ACTIVE) {
                return undefined;
            }
            if (
                this.presentationRevision !== undefined
                && message.revision < this.presentationRevision
            ) {
                return undefined;
            }
            if (
                this.presentationRevision !== undefined
                && message.revision === this.presentationRevision
            ) {
                const response = presentationAcknowledgement(message.revision);
                sendResponse?.(response);
                return response;
            }
            const discoverAbsolute = this.applyPresentation(message.display, message.revision);
            if (this.phase === DOCUMENT_PHASE.ACTIVE) {
                this.controller.reformatOwned(discoverAbsolute);
            }
            const response = presentationAcknowledgement(message.revision);
            sendResponse?.(response);
            return response;
        }
        if (message?.type === UPDATE_DEBUG_POLICY_MESSAGE) {
            if (this.phase !== DOCUMENT_PHASE.WAITING && this.phase !== DOCUMENT_PHASE.ACTIVE) {
                return undefined;
            }
            const latestRevision = Math.max(
                this.presentationRevision ?? -1,
                this.debugRevision ?? -1,
            );
            if (message.revision < latestRevision) {
                return undefined;
            }
            if (this.debugRevision === message.revision && this.debugEnabled !== message.enabled) {
                return undefined;
            }
            if (this.debugRevision !== message.revision) {
                this.applyDebugPolicy(message.enabled, message.revision);
            }
            const response = debugAcknowledgement(message.revision);
            sendResponse?.(response);
            return response;
        }
        return undefined;
    }
}

/**
 * Installs or reactivates the document's singleton content runtime.
 *
 * @param input - Document, presentation, and messaging dependencies.
 * @param input.document - Page document owned by this runtime.
 * @param input.url - Current page URL used for adapter selection.
 * @param input.urlProvider - Lazy current page URL source used for route signals.
 * @param input.routeEvents - Optional same-document route event source.
 * @param input.routeHandoffClassifier - Optional total retained-policy classifier.
 * @param input.locales - Static preferred locale tags.
 * @param input.localesProvider - Dynamic source of preferred locale tags.
 * @param input.registry - Trusted adapter registry override.
 * @param input.blueskyAppView - Optional deterministic AppView replacement for tests.
 * @param input.loadDocumentState - Background document-state loader.
 * @param input.reportDiagnostic - Background diagnostic event reporter.
 * @param input.onActivityChanged - Optional site lifecycle listener.
 * @param input.messages - Runtime message event source.
 *
 * @returns - Installed singleton runtime handle.
 */
export function installContentRuntime(input: {
    readonly document: Document;
    readonly url: URL;
    readonly urlProvider?: () => URL;
    readonly routeEvents?: ContentRouteEventSource;
    readonly routeHandoffClassifier?: DocumentRouteHandoffClassifier;
    readonly locales: readonly string[];
    readonly localesProvider?: () => readonly string[];
    readonly registry?: AdapterRegistry;
    readonly blueskyAppView?: BlueskyAppView;
    readonly loadDocumentState?: () => Promise<unknown>;
    readonly reportDiagnostic?: (event: Record<string, unknown>) => Promise<unknown>;
    readonly onActivityChanged?: (active: boolean) => void;
    readonly messages: ContentMessageRuntime;
}): ContentRuntimeHandle {
    const runtimeDocument = input.document as Document & Record<symbol, RuntimeSlot | undefined>;
    const urlProvider = input.urlProvider ?? (() => new URL(input.url.href));
    const existing = runtimeDocument[DOCUMENT_RUNTIME_SLOT];
    if (existing) {
        existing.reuse({
            onActivityChanged: input.onActivityChanged,
            reportDiagnostic: input.reportDiagnostic,
            urlProvider,
            loadDocumentState: input.loadDocumentState,
        });
        return existing.handle;
    }
    const participantFactory: DocumentTransformationParticipantFactory | undefined = matchesBlueskyUrl(input.url)
        ? (host) => createBlueskyCoordinator({
            document: input.document,
            url: input.url,
            appView: input.blueskyAppView ?? createBlueskyAppView(),
            getDiagnosticSink: host.getDiagnosticSink,
            onSourcesChanged: host.onSourcesChanged,
        })
        : undefined;
    const slot = new RuntimeSlot({
        controllerInput: {
            url: input.url,
            root: input.document,
            locales: input.locales,
            ...(input.localesProvider === undefined ? {} : { localesProvider: input.localesProvider }),
            ...(input.registry === undefined ? {} : { registry: input.registry }),
            ...(participantFactory === undefined ? {} : { participantFactory }),
            ...(input.routeHandoffClassifier === undefined
                ? {}
                : { routeHandoffClassifier: input.routeHandoffClassifier }),
        },
        messages: input.messages,
        reportDiagnostic: input.reportDiagnostic,
        loadDocumentState: input.loadDocumentState,
        urlProvider,
        onActivityChanged: input.onActivityChanged,
    });
    slot.attach(input.routeEvents);
    runtimeDocument[DOCUMENT_RUNTIME_SLOT] = slot;
    slot.start();
    return slot.handle;
}
