/**
 * @file Defines the messages exchanged between background and document runtimes.
 */

import type { DisplaySettings } from '../settings/snapshot';

/**
 * Reconciles a document runtime with one effective, revisioned activation policy.
 */
export const RECONCILE_DOCUMENT_POLICY_MESSAGE = 'no-more-ago:reconcile-document-policy';

/**
 * Acknowledges the policy revision retained by a document runtime.
 */
export const DOCUMENT_POLICY_RECONCILED_MESSAGE = 'no-more-ago:document-policy-reconciled';

/**
 * Requests that a document runtime sample and reconcile its current route.
 */
export const RECONCILE_DOCUMENT_ROUTE_MESSAGE = 'no-more-ago:reconcile-document-route';

/**
 * Requests the current lifecycle phase of a document runtime.
 */
export const DOCUMENT_STATUS_MESSAGE = 'no-more-ago:status';

/**
 * Delivers new display settings to a document runtime.
 */
export const UPDATE_PRESENTATION_MESSAGE = 'no-more-ago:update-presentation';

/**
 * Confirms that a presentation revision was accepted.
 */
export const PRESENTATION_UPDATED_MESSAGE = 'no-more-ago:presentation-updated';

/**
 * Delivers the diagnostic-forwarding policy to a document runtime.
 */
export const UPDATE_DEBUG_POLICY_MESSAGE = 'no-more-ago:update-debug-policy';

/**
 * Confirms that a diagnostic-policy revision was accepted.
 */
export const DEBUG_POLICY_UPDATED_MESSAGE = 'no-more-ago:debug-policy-updated';

/**
 * Carries a content-runtime diagnostic event to the background context.
 */
export const DIAGNOSTIC_EVENT_MESSAGE = 'no-more-ago:diagnostic-event';

/**
 * Lifecycle phases returned by a content document runtime.
 */
export const DOCUMENT_PHASE = {
    WAITING: 'waiting',
    ACTIVE: 'active',
    STOPPED: 'stopped',
    FAILED: 'failed',
} as const;

/**
 * Complete set of document runtime lifecycle phases.
 */
export const DOCUMENT_PHASES = [
    DOCUMENT_PHASE.WAITING,
    DOCUMENT_PHASE.ACTIVE,
    DOCUMENT_PHASE.STOPPED,
    DOCUMENT_PHASE.FAILED,
] as const;

/**
 * Lifecycle state returned by a document runtime.
 */
export type DocumentPhase = (typeof DOCUMENT_PHASES)[number];

/**
 * Command that reconciles the document's effective top-level policy.
 */
export interface ReconcileDocumentPolicyMessage {
    /**
     * Policy-reconciliation discriminant.
     */
    readonly type: typeof RECONCILE_DOCUMENT_POLICY_MESSAGE;

    /**
     * Settings revision carried by the command, or null while unavailable.
     */
    readonly revision: number | null;

    /**
     * Whether the document may process timestamps.
     */
    readonly enabled: boolean;
}

/**
 * Command that asks a document runtime to sample and reconcile its current route.
 */
export interface ReconcileDocumentRouteMessage {
    /**
     * Route-reconciliation discriminant.
     */
    readonly type: typeof RECONCILE_DOCUMENT_ROUTE_MESSAGE;
}

/**
 * Command that requests a document runtime's lifecycle state.
 */
export interface DocumentStatusMessage {
    /**
     * Status-request discriminant.
     */
    readonly type: typeof DOCUMENT_STATUS_MESSAGE;
}

/**
 * Command that updates display settings in a document runtime.
 */
export interface PresentationUpdateMessage {
    /**
     * Presentation-update discriminant.
     */
    readonly type: typeof UPDATE_PRESENTATION_MESSAGE;

    /**
     * Settings revision carried by the command.
     */
    readonly revision: number;

    /**
     * Display settings committed by the background.
     */
    readonly display: DisplaySettings;
}

/**
 * Command that updates diagnostic forwarding in a document runtime.
 */
export interface DebugPolicyUpdateMessage {
    /**
     * Diagnostic-policy discriminant.
     */
    readonly type: typeof UPDATE_DEBUG_POLICY_MESSAGE;

    /**
     * Settings revision carried by the command.
     */
    readonly revision: number;

    /**
     * Whether the document may forward diagnostic events.
     */
    readonly enabled: boolean;
}

/**
 * Every command a document runtime receives from the background context.
 */
export type DocumentCommand = | ReconcileDocumentPolicyMessage
    | ReconcileDocumentRouteMessage
    | DocumentStatusMessage
    | PresentationUpdateMessage
    | DebugPolicyUpdateMessage;

/**
 * Reply confirming the document-policy revision retained by the runtime.
 */
export interface DocumentPolicyReconciledMessage {
    /**
     * Policy-acknowledgement discriminant.
     */
    readonly type: typeof DOCUMENT_POLICY_RECONCILED_MESSAGE;

    /**
     * Revision retained by the document runtime.
     */
    readonly revision: number | null;
}

/**
 * Reply to a document-status command.
 */
export interface DocumentStatusResponse {
    /**
     * Status-response discriminant.
     */
    readonly type: typeof DOCUMENT_STATUS_MESSAGE;

    /**
     * Current document runtime lifecycle phase.
     */
    readonly phase: DocumentPhase;
}

/**
 * Reply confirming a presentation update was accepted.
 */
export interface PresentationUpdateAcknowledgement {
    /**
     * Presentation-acknowledgement discriminant.
     */
    readonly type: typeof PRESENTATION_UPDATED_MESSAGE;

    /**
     * Revision retained by the document runtime.
     */
    readonly revision: number;
}

/**
 * Reply confirming a diagnostic-policy update was accepted.
 */
export interface DebugPolicyUpdateAcknowledgement {
    /**
     * Diagnostic-acknowledgement discriminant.
     */
    readonly type: typeof DEBUG_POLICY_UPDATED_MESSAGE;

    /**
     * Revision retained by the document runtime.
     */
    readonly revision: number;
}

/**
 * Event sent by a document runtime when diagnostic forwarding is enabled.
 */
export interface DiagnosticEventMessage {
    /**
     * Diagnostic-event discriminant.
     */
    readonly type: typeof DIAGNOSTIC_EVENT_MESSAGE;

    /**
     * Page-derived diagnostic fields, sanitized by the background boundary.
     */
    readonly event: unknown;
}

/**
 * Every reply a document runtime returns to the background context.
 */
type DocumentReply = | DocumentPolicyReconciledMessage
    | DocumentStatusResponse
    | PresentationUpdateAcknowledgement
    | DebugPolicyUpdateAcknowledgement;

/**
 * Reads the reply of a frame that may hold no document runtime at all.
 *
 * A frame without a runtime resolves with no reply, so replies are optional
 * rather than untrusted: their fields are produced by this extension.
 *
 * @param response - Reply returned by the messaged frame.
 *
 * @returns - Typed reply, or undefined when the frame did not answer.
 */
function documentReply(response: unknown): DocumentReply | undefined {
    return response as DocumentReply | undefined;
}

/**
 * Reports whether a frame retained the exact document policy revision sent to it.
 *
 * @param response - Reply returned by the messaged frame.
 * @param revision - Revision the acknowledgement must retain.
 *
 * @returns - Whether a document runtime acknowledged the exact revision.
 */
export function isDocumentPolicyAcknowledgement(
    response: unknown,
    revision: number | null,
): boolean {
    const reply = documentReply(response);
    return reply?.type === DOCUMENT_POLICY_RECONCILED_MESSAGE && reply.revision === revision;
}

/**
 * Reports whether a frame accepted the exact presentation revision sent to it.
 *
 * @param response - Reply returned by the messaged frame.
 * @param revision - Revision the acknowledgement must match.
 *
 * @returns - Whether a document runtime acknowledged the exact revision.
 */
export function isPresentationAcknowledgement(response: unknown, revision: number): boolean {
    const reply = documentReply(response);
    return reply?.type === PRESENTATION_UPDATED_MESSAGE && reply.revision === revision;
}

/**
 * Reports whether a frame accepted the exact diagnostic-policy revision sent to it.
 *
 * @param response - Reply returned by the messaged frame.
 * @param revision - Revision the acknowledgement must match.
 *
 * @returns - Whether a document runtime acknowledged the exact revision.
 */
export function isDebugPolicyAcknowledgement(response: unknown, revision: number): boolean {
    const reply = documentReply(response);
    return reply?.type === DEBUG_POLICY_UPDATED_MESSAGE && reply.revision === revision;
}

/**
 * Reads the lifecycle phase reported by a messaged frame.
 *
 * @param response - Reply returned by the messaged frame.
 *
 * @returns - Reported phase, or undefined when the frame did not answer.
 */
export function readDocumentStatusPhase(response: unknown): DocumentPhase | undefined {
    const reply = documentReply(response);
    return reply?.type === DOCUMENT_STATUS_MESSAGE ? reply.phase : undefined;
}
