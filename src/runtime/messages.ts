/**
 * @file Defines the messages exchanged between background and document runtimes.
 */


import { isDisplaySettings, type DisplaySettings } from "../settings/snapshot";

/**
 * Requests that a document runtime stop and release its controller.
 */
export const TEARDOWN_DOCUMENT_MESSAGE = "no-more-ago:teardown";

/**
 * Requests the current lifecycle phase of a document runtime.
 */
export const DOCUMENT_STATUS_MESSAGE = "no-more-ago:status";

/**
 * Delivers new display settings to a document runtime.
 */
export const UPDATE_PRESENTATION_MESSAGE = "no-more-ago:update-presentation";

/**
 * Confirms that a presentation revision was accepted.
 */
export const PRESENTATION_UPDATED_MESSAGE = "no-more-ago:presentation-updated";

/**
 * Delivers the diagnostic-forwarding policy to a document runtime.
 */
export const UPDATE_DEBUG_POLICY_MESSAGE = "no-more-ago:update-debug-policy";

/**
 * Confirms that a diagnostic-policy revision was accepted.
 */
export const DEBUG_POLICY_UPDATED_MESSAGE = "no-more-ago:debug-policy-updated";

/**
 * Carries a content-runtime diagnostic event to the background context.
 */
export const DIAGNOSTIC_EVENT_MESSAGE = "no-more-ago:diagnostic-event";


/**
 * Command that stops a document runtime.
 */
export interface TeardownDocumentMessage {
    /**
     * Identifies this as the document-teardown command.
     */
    readonly type: typeof TEARDOWN_DOCUMENT_MESSAGE;
}

/**
 * Command that requests a document runtime's lifecycle state.
 */
export interface DocumentStatusMessage {
    /**
     * Identifies this as the document-status command.
     */
    readonly type: typeof DOCUMENT_STATUS_MESSAGE;
}

/**
 * Command that updates display settings in a document runtime.
 */
export interface PresentationUpdateMessage {
    /**
     * Identifies this as the presentation-update command.
     */
    readonly type: typeof UPDATE_PRESENTATION_MESSAGE;

    /**
     * Monotonic revision; updates older than the applied revision are ignored.
     */
    readonly revision: number;

    /**
     * Complete display settings to apply or use for subsequent startup.
     */
    readonly display: DisplaySettings;
}

/**
 * Reply confirming a presentation update was accepted.
 */
export interface PresentationUpdateAcknowledgement {
    /**
     * Identifies this as the presentation-update acknowledgement.
     */
    readonly type: typeof PRESENTATION_UPDATED_MESSAGE;

    /**
     * Echoes the accepted presentation revision.
     */
    readonly revision: number;
}

/**
 * Command that updates diagnostic forwarding in a document runtime.
 */
export interface DebugPolicyUpdateMessage {
    /**
     * Identifies this as the diagnostic-policy update command.
     */
    readonly type: typeof UPDATE_DEBUG_POLICY_MESSAGE;

    /**
     * Monotonic revision shared with presentation updates to reject stale policy changes.
     */
    readonly revision: number;

    /**
     * Enables or disables forwarding controller diagnostics to the background context.
     */
    readonly enabled: boolean;
}

/**
 * Reply confirming a diagnostic-policy update was accepted.
 */
export interface DebugPolicyUpdateAcknowledgement {
    /**
     * Identifies this as the diagnostic-policy update acknowledgement.
     */
    readonly type: typeof DEBUG_POLICY_UPDATED_MESSAGE;

    /**
     * Echoes the accepted diagnostic-policy revision.
     */
    readonly revision: number;
}

/**
 * Event sent by a document runtime when diagnostic forwarding is enabled.
 */
export interface DiagnosticEventMessage {
    /**
     * Identifies this as a diagnostic-event message.
     */
    readonly type: typeof DIAGNOSTIC_EVENT_MESSAGE;

    /**
     * Structured diagnostic payload restricted to the supported telemetry fields.
     */
    readonly event: Record<string, unknown>;
}

/**
 * Lifecycle state returned by a document runtime.
 */
export type DocumentPhase = "waiting" | "active" | "stopped" | "failed";

/**
 * Reply to a document-status command.
 */
export interface DocumentStatusResponse {
    /**
     * Identifies this as the document-status reply.
     */
    readonly type: typeof DOCUMENT_STATUS_MESSAGE;

    /**
     * Runtime state at the time the command was handled.
     */
    readonly phase: DocumentPhase;
}

/**
 * Recognizes an object containing only the document-teardown command.
 */
export function isTeardownDocumentMessage(value: unknown): value is TeardownDocumentMessage {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 1 && record.type === TEARDOWN_DOCUMENT_MESSAGE;
}

/**
 * Recognizes an object containing only the document-status command.
 */
export function isDocumentStatusMessage(value: unknown): value is DocumentStatusMessage {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 1 && record.type === DOCUMENT_STATUS_MESSAGE;
}

/**
 * Recognizes a document-status reply with a supported lifecycle phase.
 */
export function isDocumentStatusResponse(value: unknown): value is DocumentStatusResponse {
    if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
    const record = value as Record<string, unknown>;
    return Object.keys(record).length === 2
    && record.type === DOCUMENT_STATUS_MESSAGE
    && ["waiting", "active", "stopped", "failed"].includes(String(record.phase));
}

/**
 * Recognizes non-array object values used as message records.
 */
function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Recognizes non-negative safe-integer message revisions.
 */
function isSafeRevision(value: unknown): value is number {
    return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/**
 * Recognizes display settings accepted by the settings snapshot validator.
 */
export function isPresentationDisplay(value: unknown): value is DisplaySettings {
    return isDisplaySettings(value);
}

/**
 * Recognizes a complete presentation-update command with valid settings and revision.
 */
export function isPresentationUpdateMessage(value: unknown): value is PresentationUpdateMessage {
    return isRecord(value)
    && Object.keys(value).length === 3
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "revision")
    && Object.hasOwn(value, "display")
    && value.type === UPDATE_PRESENTATION_MESSAGE
    && isSafeRevision(value.revision)
    && isPresentationDisplay(value.display);
}

/**
 * Recognizes a presentation acknowledgement, optionally for one expected revision.
 */
export function isPresentationUpdateAcknowledgement(
    value: unknown,
    expectedRevision?: number
): value is PresentationUpdateAcknowledgement {
    if (!isRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "type")
    || !Object.hasOwn(value, "revision")
    || value.type !== PRESENTATION_UPDATED_MESSAGE
    || !isSafeRevision(value.revision)) return false;
    return expectedRevision === undefined || value.revision === expectedRevision;
}

/**
 * Recognizes a complete diagnostic-policy update command with a boolean enabled flag.
 */
export function isDebugPolicyUpdateMessage(value: unknown): value is DebugPolicyUpdateMessage {
    return isRecord(value)
    && Object.keys(value).length === 3
    && Object.hasOwn(value, "type")
    && Object.hasOwn(value, "revision")
    && Object.hasOwn(value, "enabled")
    && value.type === UPDATE_DEBUG_POLICY_MESSAGE
    && isSafeRevision(value.revision)
    && typeof value.enabled === "boolean";
}

/**
 * Recognizes a diagnostic-policy acknowledgement, optionally for one expected revision.
 */
export function isDebugPolicyUpdateAcknowledgement(
    value: unknown,
    expectedRevision?: number
): value is DebugPolicyUpdateAcknowledgement {
    if (!isRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "type")
    || !Object.hasOwn(value, "revision")
    || value.type !== DEBUG_POLICY_UPDATED_MESSAGE
    || !isSafeRevision(value.revision)) return false;
    return expectedRevision === undefined || value.revision === expectedRevision;
}

/**
 * Recognizes a diagnostic event with an allowed category and telemetry-field names.
 */
export function isDiagnosticEventMessage(value: unknown): value is DiagnosticEventMessage {
    if (!isRecord(value)
    || Object.keys(value).length !== 2
    || !Object.hasOwn(value, "type")
    || !Object.hasOwn(value, "event")
    || value.type !== DIAGNOSTIC_EVENT_MESSAGE
    || !isRecord(value.event)) return false;
    const event = value.event;
    const allowed = new Set(["category", "count", "durationMs", "reason", "adapterVersion", "extensionVersion", "browserFamily", "stack"]);
    if (Object.keys(event).some((key) => !allowed.has(key))) return false;
    if ([...allowed].some((key) => key in event && !Object.hasOwn(event, key))) return false;
    return Object.keys(event).every((key) => allowed.has(key))
    && Object.hasOwn(event, "category")
    && ["lifecycle", "adapter", "mutation", "timing", "settings", "skip", "error"].includes(String(event.category));
}
