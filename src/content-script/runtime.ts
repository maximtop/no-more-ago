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
 * Per-document singleton retained on the Document while its content runtime exists.
 */
interface RuntimeSlot {
    /**
     * Document transformation controller.
     */
    controller: DocumentTransformationController;

    /**
     * Stable public handle returned by every installation for this document.
     */
    handle: ContentRuntimeHandle;

    /**
     * Document whose lifecycle gates controller startup.
     */
    document: Document;

    /**
     * Runtime event source used to receive teardown and update commands.
     */
    messages: ContentMessageRuntime;

    /**
     * Current startup, active, stopped, or failed state reported to callers.
     */
    phase: DocumentPhase;

    /**
     * Incremented on each activation or teardown to invalidate prior async callbacks.
     */
    generation: number;

    /**
     * Persisted-state request retained until it settles or the runtime is stopped.
     */
    hydration: Promise<void> | undefined;

    /**
     * Most recent settings accepted for controller startup or reformatting.
     */
    presentation: DisplaySettings | undefined;

    /**
     * Revision of the settings currently stored in presentation.
     */
    presentationRevision: number | undefined;

    /**
     * Current diagnostic-forwarding policy.
     */
    debugEnabled: boolean;

    /**
     * Revision of the diagnostic-forwarding policy.
     */
    debugRevision: number | undefined;

    /**
     * Effective activation policy applied by the latest revisioned command or hydration.
     */
    policyEnabled: boolean | undefined;

    /**
     * Latest persisted settings revision accepted for activation policy.
     */
    policyRevision: number | undefined;

    /**
     * Background reporter used only while diagnostic forwarding is enabled.
     */
    reportDiagnostic: ((event: Record<string, unknown>) => Promise<unknown>) | undefined;

    /**
     * Current background state loader used by policy-refresh messages.
     */
    loadDocumentState: (() => Promise<unknown>) | undefined;

    /**
     * Lazily samples the content document's current URL.
     */
    urlProvider: () => URL;

    /**
     * Optional site-composition listener synchronized with controller activity.
     */
    onActivityChanged: ((active: boolean) => void) | undefined;

    /**
     * Last activity state delivered through onActivityChanged.
     */
    activityActive: boolean;
}

/**
 * Delivers a changed controller activity state without allowing site integration failures to
 * interfere with shared timestamp processing.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param active - Whether the controller generation may process the document.
 */
function notifyActivity(slot: RuntimeSlot, active: boolean): void {
    if (slot.activityActive === active) {
        return;
    }
    slot.activityActive = active;
    try {
        slot.onActivityChanged?.(active);
    } catch {
        /* optional site composition fails independently from shared processing */
    }
}

/**
 * Synchronizes a replacement listener to the current activity state.
 *
 * @param slot - Singleton runtime state with the replacement listener installed.
 */
function synchronizeActivity(slot: RuntimeSlot): void {
    try {
        slot.onActivityChanged?.(slot.activityActive);
    } catch {
        /* optional site composition fails independently from shared processing */
    }
}

/**
 * Stores an accepted presentation revision and exposes its display settings to the controller.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param display - Validated presentation settings to expose.
 * @param revision - Accepted settings revision.
 *
 * @returns - Whether label expansion was enabled and previously skipped sources need discovery.
 */
function applyPresentation(slot: RuntimeSlot, display: DisplaySettings, revision: number): boolean {
    const discoverAbsolute = display.precisionPolicy?.absoluteLabels === true
        && slot.presentation?.precisionPolicy?.absoluteLabels !== true;
    slot.presentation = display;
    slot.presentationRevision = revision;
    return discoverAbsolute;
}

/**
 * Updates diagnostic forwarding and installs or removes the controller's sink.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param enabled - Whether document diagnostics should be forwarded.
 * @param revision - Accepted diagnostic-policy revision.
 */
function applyDebugPolicy(slot: RuntimeSlot, enabled: boolean, revision: number): void {
    slot.debugEnabled = enabled;
    slot.debugRevision = revision;
    if (!enabled || !slot.reportDiagnostic) {
        slot.controller.setDiagnosticSink(undefined);
        return;
    }
    const report = slot.reportDiagnostic;

    /**
     * Forwards a document diagnostic while debug logging is enabled, containing report failures.
     *
     * @param event - Diagnostic event emitted by document processing.
     */
    const sink: DocumentDiagnosticSink = (event) => {
        if (!slot.debugEnabled) {
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
    slot.controller.setDiagnosticSink(sink);
}

/**
 * Samples and reconciles the current route without trusting message payload data.
 *
 * @param slot - Singleton runtime state for the current document.
 *
 * @returns - Whether reconciliation succeeded and activation may proceed.
 */
function reconcileCurrentRoute(slot: RuntimeSlot): boolean {
    try {
        const currentUrl = slot.urlProvider();
        slot.controller.reconcileRoute(new URL(currentUrl.href));
        return true;
    } catch {
        teardown(slot);
        slot.phase = DOCUMENT_PHASE.FAILED;
        return false;
    }
}

/**
 * Starts the controller once state hydration succeeds.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param generation - Activation generation allowed to start the controller.
 */
function maybeStart(slot: RuntimeSlot, generation: number): void {
    if (
        slot.phase !== DOCUMENT_PHASE.WAITING
        || slot.generation !== generation
        || slot.presentation === undefined
        || slot.policyEnabled === false
    ) {
        return;
    }
    notifyActivity(slot, true);
    try {
        slot.controller.start();
        slot.phase = DOCUMENT_PHASE.ACTIVE;
    } catch (error) {
        notifyActivity(slot, false);
        try {
            slot.controller.teardown();
        } finally {
            slot.phase = DOCUMENT_PHASE.FAILED;
        }
        throw error;
    }
}

/**
 * Loads persisted state, applies its revisions, then advances document startup.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param generation - Activation generation being hydrated.
 * @param loader - Optional persisted-state loader.
 * @param failurePhase - Phase used when hydration fails.
 */
function beginHydration(
    slot: RuntimeSlot,
    generation: number,
    loader: (() => Promise<unknown>) | undefined,
    failurePhase: Extract<
        DocumentPhase,
        typeof DOCUMENT_PHASE.FAILED | typeof DOCUMENT_PHASE.STOPPED
    >
        = DOCUMENT_PHASE.FAILED,
): void {
    if (!loader) {
        slot.policyEnabled = true;
        slot.policyRevision ??= 0;
        applyPresentation(slot, DEFAULT_DISPLAY_SETTINGS, 0);
        applyDebugPolicy(slot, false, 0);
        maybeStart(slot, generation);
        return;
    }
    let request: Promise<unknown>;
    try {
        request = loader();
    } catch {
        failHydration(slot, generation, failurePhase);
        return;
    }
    slot.hydration = Promise.resolve(request)
        .then(
            (value) => {
                if (
                    (slot.phase !== DOCUMENT_PHASE.WAITING
                        && slot.phase !== DOCUMENT_PHASE.ACTIVE)
                    || slot.generation !== generation
                ) {
                    return;
                }
                const response = value as DocumentState | undefined;
                if (response?.availability !== STATE_AVAILABILITY.READY) {
                    failHydration(slot, generation, failurePhase);
                    return;
                }
                if (
                    slot.policyRevision !== undefined
                    && response.revision < slot.policyRevision
                ) {
                    failHydration(slot, generation, failurePhase);
                    return;
                }
                slot.policyRevision = response.revision;
                slot.policyEnabled = response.enabled;
                const previousRevision = Math.max(
                    slot.presentationRevision ?? -1,
                    slot.debugRevision ?? -1,
                );
                const previousPresentationRevision = slot.presentationRevision ?? -1;
                let discoverAbsolute = false;
                if (
                    slot.presentationRevision === undefined
                    || response.revision >= slot.presentationRevision
                ) {
                    discoverAbsolute = applyPresentation(slot, response.display, response.revision);
                }
                if (
                    slot.phase === DOCUMENT_PHASE.ACTIVE
                    && response.revision > previousPresentationRevision
                ) {
                    slot.controller.reformatOwned(discoverAbsolute);
                }
                if (response.revision >= previousRevision) {
                    applyDebugPolicy(slot, response.debugEnabled, response.revision);
                }
                if (!response.enabled) {
                    teardown(slot);
                    return;
                }
                maybeStart(slot, generation);
            },
            () => {
                failHydration(slot, generation, failurePhase);
            },
        )
        .finally(() => {
            if (slot.generation === generation) {
                slot.hydration = undefined;
            }
        });
}

/**
 * Restores page-owned content when the current hydration generation cannot be trusted.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param generation - Hydration generation that failed.
 * @param failurePhase - Stable phase exposed after fail-closed teardown.
 */
function failHydration(
    slot: RuntimeSlot,
    generation: number,
    failurePhase: Extract<
        DocumentPhase,
        typeof DOCUMENT_PHASE.FAILED | typeof DOCUMENT_PHASE.STOPPED
    >,
): void {
    if (
        slot.generation !== generation
        || (slot.phase !== DOCUMENT_PHASE.WAITING && slot.phase !== DOCUMENT_PHASE.ACTIVE)
    ) {
        return;
    }
    teardown(slot);
    slot.phase = failurePhase;
}

/**
 * Resets a stopped runtime and begins a new state-hydration generation.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param loader - Optional persisted-state loader.
 * @param failurePhase - Phase used when hydration fails.
 */
function activate(
    slot: RuntimeSlot,
    loader: (() => Promise<unknown>) | undefined,
    failurePhase: Extract<
        DocumentPhase,
        typeof DOCUMENT_PHASE.FAILED | typeof DOCUMENT_PHASE.STOPPED
    >
        = DOCUMENT_PHASE.FAILED,
): void {
    if (slot.phase === DOCUMENT_PHASE.WAITING || slot.phase === DOCUMENT_PHASE.ACTIVE) {
        return;
    }
    if (!reconcileCurrentRoute(slot)) {
        return;
    }
    slot.generation += 1;
    const { generation } = slot;
    slot.phase = DOCUMENT_PHASE.WAITING;
    slot.presentation = undefined;
    slot.presentationRevision = undefined;
    slot.debugEnabled = false;
    slot.debugRevision = undefined;
    slot.controller.setDiagnosticSink(undefined);
    slot.hydration = undefined;
    slot.loadDocumentState = loader;
    beginHydration(slot, generation, loader, failurePhase);
}

/**
 * Starts a policy hydration generation without disrupting an active controller.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param failurePhase - Phase used when the refreshed state cannot be loaded.
 */
function refreshPolicy(
    slot: RuntimeSlot,
    failurePhase: Extract<
        DocumentPhase,
        typeof DOCUMENT_PHASE.FAILED | typeof DOCUMENT_PHASE.STOPPED
    > = DOCUMENT_PHASE.FAILED,
): void {
    if (slot.phase !== DOCUMENT_PHASE.ACTIVE && slot.phase !== DOCUMENT_PHASE.WAITING) {
        activate(slot, slot.loadDocumentState, failurePhase);
        return;
    }
    slot.generation += 1;
    beginHydration(slot, slot.generation, slot.loadDocumentState, failurePhase);
}

/**
 * Stops the controller and clears state retained by the current runtime generation.
 *
 * @param slot - Singleton runtime state to stop and clear.
 */
function teardown(slot: RuntimeSlot): void {
    slot.generation += 1;
    notifyActivity(slot, false);
    slot.controller.teardown();
    slot.phase = DOCUMENT_PHASE.STOPPED;
    slot.presentation = undefined;
    slot.presentationRevision = undefined;
    slot.debugEnabled = false;
    slot.debugRevision = undefined;
    slot.controller.setDiagnosticSink(undefined);
    slot.hydration = undefined;
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
 * Applies one revisioned effective policy without allowing older commands to win later.
 *
 * Unversioned fail-closed commands synchronously restore page ownership before they reload
 * current background state. Authoritative hydration may replace a provisional same-revision
 * command, allowing reinjection after a cross-document navigation to converge on the new host.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param revision - Persisted settings revision, or null while settings are unavailable.
 * @param enabled - Effective top-level activation policy carried by the command.
 *
 * @returns - Revision retained for acknowledgement.
 */
function reconcilePolicy(
    slot: RuntimeSlot,
    revision: number | null,
    enabled: boolean,
): number | null {
    if (revision === null) {
        slot.policyEnabled = false;
        if (slot.phase !== DOCUMENT_PHASE.STOPPED) {
            teardown(slot);
        }
        if (slot.loadDocumentState) {
            activate(slot, slot.loadDocumentState, DOCUMENT_PHASE.STOPPED);
        }
        return null;
    }
    if (slot.policyRevision !== undefined && revision < slot.policyRevision) {
        return slot.policyRevision;
    }
    if (
        slot.policyRevision === revision
        && slot.policyEnabled !== undefined
        && slot.policyEnabled !== enabled
    ) {
        slot.policyEnabled = enabled;
        if (!enabled && slot.phase !== DOCUMENT_PHASE.STOPPED) {
            teardown(slot);
        }
        refreshPolicy(slot);
        return revision;
    }
    const repeated = slot.policyRevision === revision && slot.policyEnabled === enabled;
    slot.policyRevision = revision;
    slot.policyEnabled = enabled;
    if (!enabled) {
        if (slot.phase !== DOCUMENT_PHASE.STOPPED) {
            teardown(slot);
        }
        return revision;
    }
    if (slot.phase !== DOCUMENT_PHASE.ACTIVE && slot.phase !== DOCUMENT_PHASE.WAITING) {
        activate(slot, slot.loadDocumentState);
    } else if (!repeated) {
        refreshPolicy(slot);
    }
    return revision;
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
    const existing = runtimeDocument[DOCUMENT_RUNTIME_SLOT];
    if (existing) {
        existing.onActivityChanged = input.onActivityChanged;
        synchronizeActivity(existing);
        if (input.reportDiagnostic) {
            existing.reportDiagnostic = input.reportDiagnostic;
        }
        existing.urlProvider = input.urlProvider ?? (() => new URL(input.url.href));
        existing.loadDocumentState = input.loadDocumentState;
        refreshPolicy(existing);
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
    const slot = {} as RuntimeSlot;
    const processInput: DocumentTransformationControllerInput = {
        url: input.url,
        root: input.document,
        locales: input.locales,
        displayProvider: () => slot.presentation ?? DEFAULT_DISPLAY_SETTINGS,
        urlProvider: () => slot.urlProvider(),
        ...(input.localesProvider === undefined ? {} : { localesProvider: input.localesProvider }),
        ...(input.registry === undefined ? {} : { registry: input.registry }),
        ...(participantFactory === undefined ? {} : { participantFactory }),
        ...(input.routeHandoffClassifier === undefined
            ? {}
            : { routeHandoffClassifier: input.routeHandoffClassifier }),
    };
    slot.document = input.document;
    slot.messages = input.messages;
    slot.controller = new DocumentTransformationController(processInput);
    slot.phase = DOCUMENT_PHASE.STOPPED;
    slot.generation = 0;
    slot.hydration = undefined;
    slot.presentation = undefined;
    slot.presentationRevision = undefined;
    slot.debugEnabled = false;
    slot.debugRevision = undefined;
    slot.policyEnabled = undefined;
    slot.policyRevision = undefined;
    slot.reportDiagnostic = input.reportDiagnostic;
    slot.loadDocumentState = input.loadDocumentState;
    slot.urlProvider = input.urlProvider ?? (() => new URL(input.url.href));
    slot.onActivityChanged = input.onActivityChanged;
    slot.activityActive = false;
    slot.handle = {
        teardown: () => {
            teardown(slot);
        },
        reconcileSources: (sources) => {
            slot.controller.reconcileSources(sources);
        },
    };
    slot.messages.onMessage.addListener((value, _sender, sendResponse) => {
        const message = value as DocumentCommand | undefined;
        if (message?.type === RECONCILE_DOCUMENT_POLICY_MESSAGE) {
            const retainedRevision = reconcilePolicy(
                slot,
                message.revision,
                message.enabled,
            );
            const response = policyAcknowledgement(retainedRevision);
            sendResponse?.(response);
            return response;
        }
        if (message?.type === RECONCILE_DOCUMENT_ROUTE_MESSAGE) {
            reconcileCurrentRoute(slot);
            return undefined;
        }
        if (message?.type === DOCUMENT_STATUS_MESSAGE) {
            const response = { type: DOCUMENT_STATUS_MESSAGE, phase: slot.phase };
            sendResponse?.(response);
            return response;
        }
        if (message?.type === UPDATE_PRESENTATION_MESSAGE) {
            if (slot.phase !== DOCUMENT_PHASE.WAITING && slot.phase !== DOCUMENT_PHASE.ACTIVE) {
                return undefined;
            }
            if (
                slot.presentationRevision !== undefined
                && message.revision < slot.presentationRevision
            ) {
                return undefined;
            }
            if (
                slot.presentationRevision !== undefined
                && message.revision === slot.presentationRevision
            ) {
                const response = presentationAcknowledgement(message.revision);
                sendResponse?.(response);
                return response;
            }
            const discoverAbsolute = applyPresentation(slot, message.display, message.revision);
            if (slot.phase === DOCUMENT_PHASE.ACTIVE) {
                slot.controller.reformatOwned(discoverAbsolute);
            }
            const response = presentationAcknowledgement(message.revision);
            sendResponse?.(response);
            return response;
        }
        if (message?.type === UPDATE_DEBUG_POLICY_MESSAGE) {
            if (slot.phase !== DOCUMENT_PHASE.WAITING && slot.phase !== DOCUMENT_PHASE.ACTIVE) {
                return undefined;
            }
            const latestRevision = Math.max(
                slot.presentationRevision ?? -1,
                slot.debugRevision ?? -1,
            );
            if (message.revision < latestRevision) {
                return undefined;
            }
            if (slot.debugRevision === message.revision && slot.debugEnabled !== message.enabled) {
                return undefined;
            }
            if (slot.debugRevision !== message.revision) {
                applyDebugPolicy(slot, message.enabled, message.revision);
            }
            const response = debugAcknowledgement(message.revision);
            sendResponse?.(response);
            return response;
        }
        return undefined;
    });
    try {
        input.routeEvents?.addListener(() => {
            reconcileCurrentRoute(slot);
        });
    } catch {
        /* exact-frame route messages remain available when popstate setup is unavailable */
    }
    runtimeDocument[DOCUMENT_RUNTIME_SLOT] = slot;
    activate(slot, input.loadDocumentState);
    return slot.handle;
}
