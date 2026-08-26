import { isDisplaySettings, type DisplaySettings } from "../settings/snapshot";

export const TEARDOWN_DOCUMENT_MESSAGE = "no-more-ago:teardown";
export const DOCUMENT_STATUS_MESSAGE = "no-more-ago:status";
export const UPDATE_PRESENTATION_MESSAGE = "no-more-ago:update-presentation";
export const PRESENTATION_UPDATED_MESSAGE = "no-more-ago:presentation-updated";
export const UPDATE_DEBUG_POLICY_MESSAGE = "no-more-ago:update-debug-policy";
export const DEBUG_POLICY_UPDATED_MESSAGE = "no-more-ago:debug-policy-updated";
export const DIAGNOSTIC_EVENT_MESSAGE = "no-more-ago:diagnostic-event";


export interface TeardownDocumentMessage {
  readonly type: typeof TEARDOWN_DOCUMENT_MESSAGE;
}

export interface DocumentStatusMessage {
  readonly type: typeof DOCUMENT_STATUS_MESSAGE;
}

export interface PresentationUpdateMessage {
  readonly type: typeof UPDATE_PRESENTATION_MESSAGE;
  readonly revision: number;
  readonly display: DisplaySettings;
}

export interface PresentationUpdateAcknowledgement {
  readonly type: typeof PRESENTATION_UPDATED_MESSAGE;
  readonly revision: number;
}

export interface DebugPolicyUpdateMessage {
  readonly type: typeof UPDATE_DEBUG_POLICY_MESSAGE;
  readonly revision: number;
  readonly enabled: boolean;
}

export interface DebugPolicyUpdateAcknowledgement {
  readonly type: typeof DEBUG_POLICY_UPDATED_MESSAGE;
  readonly revision: number;
}

export interface DiagnosticEventMessage {
  readonly type: typeof DIAGNOSTIC_EVENT_MESSAGE;
  readonly event: Record<string, unknown>;
}

export type DocumentPhase = "waiting" | "active" | "stopped" | "failed";

export interface DocumentStatusResponse {
  readonly type: typeof DOCUMENT_STATUS_MESSAGE;
  readonly phase: DocumentPhase;
}

export function isTeardownDocumentMessage(value: unknown): value is TeardownDocumentMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.type === TEARDOWN_DOCUMENT_MESSAGE;
}

export function isDocumentStatusMessage(value: unknown): value is DocumentStatusMessage {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 1 && record.type === DOCUMENT_STATUS_MESSAGE;
}

export function isDocumentStatusResponse(value: unknown): value is DocumentStatusResponse {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return Object.keys(record).length === 2
    && record.type === DOCUMENT_STATUS_MESSAGE
    && ["waiting", "active", "stopped", "failed"].includes(String(record.phase));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isSafeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

/** Structural V3 guard used at the document message boundary. */
export function isPresentationDisplay(value: unknown): value is DisplaySettings {
  return isDisplaySettings(value);
}

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
