/**
 * @file Coordinates the document controller with persisted settings and runtime messages.
 */

import type { AdapterRegistry } from "./adapters/registry";
import {
    DocumentTransformationController,
} from "./transformation/document-transformation-controller";
import type { DocumentDiagnosticSink, ProcessInput } from "./transformation/process-document";
import {
    DEBUG_POLICY_UPDATED_MESSAGE,
    DOCUMENT_PHASE,
    DOCUMENT_POLICY_RECONCILED_MESSAGE,
    DOCUMENT_STATUS_MESSAGE,
    isDebugPolicyUpdateMessage,
    isDocumentStatusMessage,
    isReconcileDocumentPolicyMessage,
    isPresentationUpdateMessage,
    PRESENTATION_UPDATED_MESSAGE,
    type DocumentPolicyReconciledMessage,
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
     * Controller input whose display field is populated after state hydration.
     */
    processInput: ProcessInput & Record<string, unknown>;
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
    (slot.processInput as unknown as Record<string, unknown>).display = display;
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
        slot.presentation === undefined ||
        slot.policyEnabled === false
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
                if (
                    slot.policyRevision !== undefined
                    && response.revision < slot.policyRevision
                ) {
                    failHydration(slot, generation, failurePhase);
                    return;
                }
                if (
                    slot.policyRevision === response.revision
                    && slot.policyEnabled !== undefined
                    && slot.policyEnabled !== response.enabled
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
 * Unversioned fail-closed commands always reload current background state. This makes a late
 * command converge on a recovered worker instead of blindly tearing down a newer enabled state.
 *
 * @param slot - Singleton runtime state for the current document.
 * @param revision - Persisted settings revision, or null while settings are unavailable.
 * @param enabled - Effective top-level activation policy carried by the command.
 * @returns - Revision retained for acknowledgement.
 */
function reconcilePolicy(
    slot: RuntimeSlot,
    revision: number | null,
    enabled: boolean,
): number | null {
    if (revision === null) {
        refreshPolicy(slot, DOCUMENT_PHASE.STOPPED);
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
 * @param input.urlProvider - Dynamic source of the current page URL.
 * @param input.locales - Static preferred locale tags.
 * @param input.localesProvider - Dynamic source of preferred locale tags.
 * @param input.registry - Trusted adapter registry override.
 * @param input.loadDocumentState - Background document-state loader.
 * @param input.reportDiagnostic - Background diagnostic event reporter.
 * @param input.messages - Runtime message event source.
 * @returns - Installed singleton runtime handle.
 */
export function installContentRuntime(input: {
    readonly document: Document;
    readonly url: URL;
    readonly urlProvider?: () => URL;
    readonly locales: readonly string[];
    readonly localesProvider?: () => readonly string[];
    readonly registry?: AdapterRegistry;
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
    const processInput = {
        url: input.url,
        ...(input.urlProvider === undefined ? {} : { urlProvider: input.urlProvider }),
        root: input.document,
        locales: input.locales,
        ...(input.localesProvider === undefined ? {} : { localesProvider: input.localesProvider }),
        ...(input.registry === undefined ? {} : { registry: input.registry }),
    } as ProcessInput & Record<string, unknown>;
    const slot = {} as RuntimeSlot;
    slot.document = input.document;
    slot.messages = input.messages;
    slot.processInput = processInput;
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
    slot.handle = {
        teardown: () => {
            teardown(slot);
        },
    };
    slot.messages.onMessage.addListener((message, _sender, sendResponse) => {
        if (isReconcileDocumentPolicyMessage(message)) {
            const retainedRevision = reconcilePolicy(
                slot,
                message.revision,
                message.enabled,
            );
            const response = policyAcknowledgement(retainedRevision);
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
