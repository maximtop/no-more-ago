/**
 * @file Defines the messages exchanged between background and document runtimes.
 */

import * as v from "valibot";
import { diagnosticEventInputSchema } from "../diagnostics/events";
import type { DisplaySettings } from "../settings/snapshot";
import { nonNegativeSafeIntegerSchema } from "./view-state-schemas";

/**
 * Requests that a document runtime stop and release its controller.
 */
export const TEARDOWN_DOCUMENT_MESSAGE = "no-more-ago:teardown";

/**
 * Requests a document runtime to refresh its top-level policy.
 */
export const REFRESH_DOCUMENT_POLICY_MESSAGE = "no-more-ago:refresh-document-policy";

/**
 * Requests a document runtime to synchronously suspend before refreshing policy.
 */
export const SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE =
    "no-more-ago:suspend-and-refresh-document-policy";

/**
 * Acknowledges delivery of a document policy refresh command.
 */
export const DOCUMENT_POLICY_REFRESHED_MESSAGE = "no-more-ago:document-policy-refreshed";

/**
 * Acknowledges synchronous restoration and teardown of a document runtime.
 */
export const DOCUMENT_TORN_DOWN_MESSAGE = "no-more-ago:document-torn-down";

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
 * Lifecycle phases returned by a content document runtime.
 */
export const DOCUMENT_PHASE = {
    WAITING: "waiting",
    ACTIVE: "active",
    STOPPED: "stopped",
    FAILED: "failed",
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

const presentationDisplaySchema = v.pipe(
    v.unknown(),
    v.transform<unknown, DisplaySettings>((value) => value as DisplaySettings),
);

/**
 * Schema for a command that stops a document runtime.
 */
const teardownDocumentMessageSchema = v.strictObject({
    type: v.literal(TEARDOWN_DOCUMENT_MESSAGE),
});

/**
 * Schema for a command that refreshes the document policy.
 */
const refreshDocumentPolicyMessageSchema = v.strictObject({
    type: v.literal(REFRESH_DOCUMENT_POLICY_MESSAGE),
});

/**
 * Schema for a command that suspends and refreshes the document policy.
 */
const suspendAndRefreshDocumentPolicyMessageSchema = v.strictObject({
    type: v.literal(SUSPEND_AND_REFRESH_DOCUMENT_POLICY_MESSAGE),
});

/**
 * Schema for a command requesting document runtime status.
 */
const documentStatusMessageSchema = v.strictObject({
    type: v.literal(DOCUMENT_STATUS_MESSAGE),
});

/**
 * Schema for the lifecycle phase returned by a document runtime.
 */
const documentPhaseSchema = v.picklist(DOCUMENT_PHASES);

/**
 * Schema for a document status response.
 */
const documentStatusResponseSchema = v.strictObject({
    type: v.literal(DOCUMENT_STATUS_MESSAGE),
    phase: documentPhaseSchema,
});

/**
 * Schema for a display-settings update command.
 */
const presentationUpdateMessageSchema = v.strictObject({
    type: v.literal(UPDATE_PRESENTATION_MESSAGE),
    revision: nonNegativeSafeIntegerSchema,
    display: presentationDisplaySchema,
});

/**
 * Schema for a presentation update acknowledgement.
 */
const presentationUpdateAcknowledgementSchema = v.strictObject({
    type: v.literal(PRESENTATION_UPDATED_MESSAGE),
    revision: nonNegativeSafeIntegerSchema,
});

/**
 * Schema for a diagnostic-policy update command.
 */
const debugPolicyUpdateMessageSchema = v.strictObject({
    type: v.literal(UPDATE_DEBUG_POLICY_MESSAGE),
    revision: nonNegativeSafeIntegerSchema,
    enabled: v.boolean(),
});

/**
 * Schema for a diagnostic-policy update acknowledgement.
 */
const debugPolicyUpdateAcknowledgementSchema = v.strictObject({
    type: v.literal(DEBUG_POLICY_UPDATED_MESSAGE),
    revision: nonNegativeSafeIntegerSchema,
});

/**
 * Schema for a diagnostic event sent by a document runtime.
 */
const diagnosticEventMessageSchema = v.strictObject({
    type: v.literal(DIAGNOSTIC_EVENT_MESSAGE),
    event: diagnosticEventInputSchema,
});

/**
 * Command that stops a document runtime.
 */
type TeardownDocumentMessage = v.InferOutput<typeof teardownDocumentMessageSchema>;

/**
 * Command that refreshes the document's effective top-level policy.
 */
type RefreshDocumentPolicyMessage = v.InferOutput<typeof refreshDocumentPolicyMessageSchema>;

/**
 * Command that suspends the document before refreshing its effective policy.
 */
type SuspendAndRefreshDocumentPolicyMessage = v.InferOutput<
    typeof suspendAndRefreshDocumentPolicyMessageSchema
>;

/**
 * Command that requests a document runtime's lifecycle state.
 */
type DocumentStatusMessage = v.InferOutput<typeof documentStatusMessageSchema>;

/**
 * Command that updates display settings in a document runtime.
 */
export type PresentationUpdateMessage = v.InferOutput<typeof presentationUpdateMessageSchema>;

/**
 * Reply confirming a presentation update was accepted.
 */
export type PresentationUpdateAcknowledgement = v.InferOutput<
    typeof presentationUpdateAcknowledgementSchema
>;

/**
 * Command that updates diagnostic forwarding in a document runtime.
 */
export type DebugPolicyUpdateMessage = v.InferOutput<typeof debugPolicyUpdateMessageSchema>;

/**
 * Reply confirming a diagnostic-policy update was accepted.
 */
export type DebugPolicyUpdateAcknowledgement = v.InferOutput<
    typeof debugPolicyUpdateAcknowledgementSchema
>;

/**
 * Event sent by a document runtime when diagnostic forwarding is enabled.
 */
type DiagnosticEventMessage = v.InferOutput<typeof diagnosticEventMessageSchema>;

/**
 * Lifecycle state returned by a document runtime.
 */
export type DocumentPhase = v.InferOutput<typeof documentPhaseSchema>;

/**
 * Reply to a document-status command.
 */
type DocumentStatusResponse = v.InferOutput<typeof documentStatusResponseSchema>;

/**
 * Recognizes an object containing only the document-teardown command.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is an exact teardown command.
 */
export function isTeardownDocumentMessage(value: unknown): value is TeardownDocumentMessage {
    return v.safeParse(teardownDocumentMessageSchema, value).success;
}

/**
 * Recognizes an exact policy-refresh command.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is a policy-refresh command.
 */
export function isRefreshDocumentPolicyMessage(
    value: unknown,
): value is RefreshDocumentPolicyMessage {
    return v.safeParse(refreshDocumentPolicyMessageSchema, value).success;
}

/**
 * Recognizes an exact suspend-and-refresh command.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is a suspend-and-refresh command.
 */
export function isSuspendAndRefreshDocumentPolicyMessage(
    value: unknown,
): value is SuspendAndRefreshDocumentPolicyMessage {
    return v.safeParse(suspendAndRefreshDocumentPolicyMessageSchema, value).success;
}

/**
 * Recognizes an object containing only the document-status command.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is an exact status command.
 */
export function isDocumentStatusMessage(value: unknown): value is DocumentStatusMessage {
    return v.safeParse(documentStatusMessageSchema, value).success;
}

/**
 * Recognizes a document-status reply with a supported lifecycle phase.
 *
 * @param value - Runtime response.
 * @returns - Whether the value is a valid document status response.
 */
export function isDocumentStatusResponse(value: unknown): value is DocumentStatusResponse {
    return v.safeParse(documentStatusResponseSchema, value).success;
}

/**
 * Recognizes a presentation-update command and its bounded revision.
 *
 * @param value - Runtime message.
 * @returns - Whether the value matches the presentation-update routing contract.
 */
export function isPresentationUpdateMessage(value: unknown): value is PresentationUpdateMessage {
    return v.safeParse(presentationUpdateMessageSchema, value).success;
}

/**
 * Recognizes a presentation acknowledgement, optionally for one expected revision.
 *
 * @param value - Runtime response.
 * @param expectedRevision - Revision the acknowledgement must match, when supplied.
 * @returns - Whether the value is a valid presentation acknowledgement.
 */
export function isPresentationUpdateAcknowledgement(
    value: unknown,
    expectedRevision?: number,
): value is PresentationUpdateAcknowledgement {
    const parsed = v.safeParse(presentationUpdateAcknowledgementSchema, value);
    return parsed.success
        && (expectedRevision === undefined || parsed.output.revision === expectedRevision);
}

/**
 * Recognizes a complete diagnostic-policy update command with a boolean enabled flag.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is a valid diagnostic-policy update command.
 */
export function isDebugPolicyUpdateMessage(value: unknown): value is DebugPolicyUpdateMessage {
    return v.safeParse(debugPolicyUpdateMessageSchema, value).success;
}

/**
 * Recognizes a diagnostic-policy acknowledgement, optionally for one expected revision.
 *
 * @param value - Runtime response.
 * @param expectedRevision - Revision the acknowledgement must match, when supplied.
 * @returns - Whether the value is a valid diagnostic-policy acknowledgement.
 */
export function isDebugPolicyUpdateAcknowledgement(
    value: unknown,
    expectedRevision?: number,
): value is DebugPolicyUpdateAcknowledgement {
    const parsed = v.safeParse(debugPolicyUpdateAcknowledgementSchema, value);
    return parsed.success
        && (expectedRevision === undefined || parsed.output.revision === expectedRevision);
}

/**
 * Recognizes a diagnostic event with an allowed category and telemetry-field names.
 *
 * @param value - Runtime message.
 * @returns - Whether the value is a valid bounded diagnostic event message.
 */
export function isDiagnosticEventMessage(value: unknown): value is DiagnosticEventMessage {
    return v.safeParse(diagnosticEventMessageSchema, value).success;
}
