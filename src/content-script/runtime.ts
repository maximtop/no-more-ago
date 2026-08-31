/**
 * @file Coordinates the document controller with persisted settings and runtime messages.
 */

import type { AdapterRegistry } from "./adapters/registry";
import {
    createBlueskyAppView,
    type BlueskyAppView,
} from "./adapters/bluesky-appview";
import { createBlueskyCoordinator } from "./adapters/bluesky-coordinator";
import { matchesBlueskyUrl } from "./adapters/bluesky";
import {
    DocumentTransformationController,
    type DocumentTransformationControllerInput,
} from "./transformation/document-transformation-controller";
import type {
    DocumentTransformationParticipantFactory,
} from "./transformation/document-transformation-participant";
import type { DocumentDiagnosticSink } from "./transformation/process-document";
import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_POLICY_REFRESHED_MESSAGE,
    DOCUMENT_TORN_DOWN_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    isDebugPolicyUpdateMessage,
    isDocumentStatusMessage,
    isRefreshDocumentPolicyMessage,
    isSuspendAndRefreshDocumentPolicyMessage,
    isPresentationUpdateMessage,
    isTeardownDocumentMessage,
    PRESENTATION_UPDATED_MESSAGE,
    type DebugPolicyUpdateAcknowledgement,
    type DocumentPhase,
    type PresentationUpdateAcknowledgement,
} from "../shared/messaging/document-messages";
import { isDocumentState } from "../shared/messaging/document-state";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import {
    DEFAULT_DISPLAY_SETTINGS,
    type DisplaySettings,
} from "../shared/settings/snapshot";

/**
 * Global symbol used to retain the single content-runtime instance for a document.
 */
export const DOCUMENT_RUNTIME_SLOT = Symbol.for("no-more-ago.document-runtime");

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
     * Background reporter used only while diagnostic forwarding is enabled.
     */
    reportDiagnostic: ((event: Record<string, unknown>) => Promise<unknown>) | undefined;

    /**
     * Current background state loader used by policy-refresh messages.
     */
    loadDocumentState: (() => Promise<unknown>) | undefined;

}

/**
 * Stores an accepted presentation revision and exposes its display settings to the controller.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param display - Validated presentation settings to expose.
 * @param revision - Accepted settings revision.
 */
function applyPresentation(slot: RuntimeSlot, display: DisplaySettings, revision: number): void {
    slot.presentation = display;
    slot.presentationRevision = revision;
    slot.controller.setDisplay(display);
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
 * Re-renders already-owned timestamps after a presentation change.
 *
 * @param slot - Singleton runtime state for the current document.
 */
function reformatOwned(slot: RuntimeSlot): void {
    (
        slot.controller as DocumentTransformationController & { reformatOwned: () => void }
    ).reformatOwned();
}

/**
 * Starts the controller once state hydration succeeds.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param generation - Activation generation allowed to start the controller.
 */
function maybeStart(slot: RuntimeSlot, generation: number): void {
    if (
        slot.phase !== DOCUMENT_PHASE.WAITING ||
        slot.generation !== generation ||
        slot.presentation === undefined
    ) {
        return;
    }
    try {
        slot.controller.start();
        slot.phase = DOCUMENT_PHASE.ACTIVE;
    } catch (error) {
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
            (response) => {
                if (
                    (slot.phase !== DOCUMENT_PHASE.WAITING
                        && slot.phase !== DOCUMENT_PHASE.ACTIVE)
                    || slot.generation !== generation
                ) {
                    return;
                }
                if (
                    !isDocumentState(response)
                    || response.availability !== STATE_AVAILABILITY.READY
                ) {
                    failHydration(slot, generation, failurePhase);
                    return;
                }
                const previousRevision = Math.max(
                    slot.presentationRevision ?? -1,
                    slot.debugRevision ?? -1,
                );
                const previousPresentationRevision = slot.presentationRevision ?? -1;
                if (
                    slot.presentationRevision === undefined ||
                    response.revision >= slot.presentationRevision
                ) {
                    applyPresentation(slot, response.display, response.revision);
                }
                if (
                    slot.phase === DOCUMENT_PHASE.ACTIVE &&
                    response.revision > previousPresentationRevision
                ) {
                    reformatOwned(slot);
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
    slot.generation += 1;
    const generation = slot.generation;
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
 */
function refreshPolicy(slot: RuntimeSlot): void {
    if (slot.phase !== DOCUMENT_PHASE.ACTIVE && slot.phase !== DOCUMENT_PHASE.WAITING) {
        activate(slot, slot.loadDocumentState);
        return;
    }
    slot.generation += 1;
    beginHydration(slot, slot.generation, slot.loadDocumentState);
}

/**
 * Stops the controller and clears state retained by the current runtime generation.
 *
 * @param slot - Singleton runtime state to stop and clear.
 */
function teardown(slot: RuntimeSlot): void {
    slot.generation += 1;
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
 * Creates the acknowledgement for an applied presentation revision.
 *
 * @param revision - Presentation revision successfully applied.
 * @returns - Runtime acknowledgement for that presentation revision.
 */
function presentationAcknowledgement(revision: number): PresentationUpdateAcknowledgement {
    return { type: PRESENTATION_UPDATED_MESSAGE, revision };
}

/**
 * Creates the acknowledgement for an applied diagnostic-policy revision.
 *
 * @param revision - Diagnostic-policy revision successfully applied.
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
 * @param input.locales - Static preferred locale tags.
 * @param input.localesProvider - Dynamic source of preferred locale tags.
 * @param input.registry - Trusted adapter registry override.
 * @param input.blueskyAppView - Optional deterministic AppView replacement for tests.
 * @param input.loadDocumentState - Background document-state loader.
 * @param input.reportDiagnostic - Background diagnostic event reporter.
 * @param input.messages - Runtime message event source.
 * @returns - Installed singleton runtime handle.
 */
export function installContentRuntime(input: {
    readonly document: Document;
    readonly url: URL;
    readonly locales: readonly string[];
    readonly localesProvider?: () => readonly string[];
    readonly registry?: AdapterRegistry;
    readonly blueskyAppView?: BlueskyAppView;
    readonly loadDocumentState?: () => Promise<unknown>;
    readonly reportDiagnostic?: (event: Record<string, unknown>) => Promise<unknown>;
    readonly messages: ContentMessageRuntime;
}): ContentRuntimeHandle {
    const runtimeDocument = input.document as Document & Record<symbol, RuntimeSlot | undefined>;
    const existing = runtimeDocument[DOCUMENT_RUNTIME_SLOT];
    if (existing) {
        if (input.reportDiagnostic) {
            existing.reportDiagnostic = input.reportDiagnostic;
        }
        existing.loadDocumentState = input.loadDocumentState;
        refreshPolicy(existing);
        return existing.handle;
    }
    const participantFactory: DocumentTransformationParticipantFactory | undefined =
        matchesBlueskyUrl(input.url)
            ? (host) => createBlueskyCoordinator({
                document: input.document,
                url: input.url,
                appView: input.blueskyAppView ?? createBlueskyAppView(),
                getDiagnosticSink: host.getDiagnosticSink,
                onSourcesChanged: host.onSourcesChanged,
            })
            : undefined;
    const processInput: DocumentTransformationControllerInput = {
        url: input.url,
        root: input.document,
        locales: input.locales,
        ...(input.localesProvider === undefined ? {} : { localesProvider: input.localesProvider }),
        ...(input.registry === undefined ? {} : { registry: input.registry }),
        ...(participantFactory === undefined
            ? {}
            : { participantFactory }),
    };
    const slot = {} as RuntimeSlot;
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
    slot.reportDiagnostic = input.reportDiagnostic;
    slot.loadDocumentState = input.loadDocumentState;
    slot.handle = {
        teardown: () => {
            teardown(slot);
        },
    };
    slot.messages.onMessage.addListener((message, _sender, sendResponse) => {
        if (isTeardownDocumentMessage(message)) {
            teardown(slot);
            const response = { type: DOCUMENT_TORN_DOWN_MESSAGE };
            sendResponse?.(response);
            return response;
        }
        if (isRefreshDocumentPolicyMessage(message)) {
            refreshPolicy(slot);
            const response = { type: DOCUMENT_POLICY_REFRESHED_MESSAGE };
            sendResponse?.(response);
            return response;
        }
        if (isSuspendAndRefreshDocumentPolicyMessage(message)) {
            teardown(slot);
            activate(slot, slot.loadDocumentState, DOCUMENT_PHASE.STOPPED);
            const response = { type: DOCUMENT_POLICY_REFRESHED_MESSAGE };
            sendResponse?.(response);
            return response;
        }
        if (isDocumentStatusMessage(message)) {
            const response = { type: DOCUMENT_STATUS_MESSAGE, phase: slot.phase };
            sendResponse?.(response);
            return response;
        }
        if (isPresentationUpdateMessage(message)) {
            if (slot.phase !== DOCUMENT_PHASE.WAITING && slot.phase !== DOCUMENT_PHASE.ACTIVE) {
                return undefined;
            }
            if (
                slot.presentationRevision !== undefined &&
                message.revision < slot.presentationRevision
            ) {
                return undefined;
            }
            if (
                slot.presentationRevision !== undefined &&
                message.revision === slot.presentationRevision
            ) {
                const response = presentationAcknowledgement(message.revision);
                sendResponse?.(response);
                return response;
            }
            applyPresentation(slot, message.display, message.revision);
            if (slot.phase === DOCUMENT_PHASE.ACTIVE) {
                reformatOwned(slot);
            }
            const response = presentationAcknowledgement(message.revision);
            sendResponse?.(response);
            return response;
        }
        if (isDebugPolicyUpdateMessage(message)) {
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
    runtimeDocument[DOCUMENT_RUNTIME_SLOT] = slot;
    activate(slot, input.loadDocumentState);
    return slot.handle;
}
