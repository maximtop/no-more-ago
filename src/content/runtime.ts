import type { AdapterRegistry } from "../adapters/registry";
import { DocumentTransformationController } from "../core/document-transformation-controller";
import type { DocumentDiagnosticSink, ProcessInput } from "../core/process-document";
import {
  DEBUG_POLICY_UPDATED_MESSAGE,
  DOCUMENT_STATUS_MESSAGE,
  isDebugPolicyUpdateMessage,
  isDocumentStatusMessage,
  isPresentationDisplay,
  isPresentationUpdateMessage,
  isTeardownDocumentMessage,
  PRESENTATION_UPDATED_MESSAGE,
  type DebugPolicyUpdateAcknowledgement,
  type DocumentPhase,
  type PresentationUpdateAcknowledgement
} from "../runtime/messages";
import type { DisplaySettings } from "../settings/snapshot";

const DOCUMENT_RUNTIME_SLOT = Symbol.for("no-more-ago.document-runtime");

export interface ContentMessageRuntime {
  readonly onMessage: {
    addListener(listener: (message: unknown, sender?: unknown, sendResponse?: (response: unknown) => void) => unknown): void;
  };
}

export interface ContentRuntimeHandle { teardown(): void; }

const DEFAULT_DISPLAY: DisplaySettings = Object.freeze({ formatMode: "system", timeZone: Object.freeze({ mode: "system" }) });

interface DisplayStateLike { readonly availability: "ready"; readonly revision: number; readonly display: DisplaySettings; readonly debugEnabled: boolean; }

function isSafeRevision(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}

function isDisplayState(value: unknown): value is DisplayStateLike {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  const keys = Object.keys(record);
  return (keys.length === 4 || keys.length === 5)
    && keys.every((key) => ["availability", "revision", "display", "debugEnabled", "error"].includes(key))
    && Object.hasOwn(record, "availability")
    && Object.hasOwn(record, "revision")
    && Object.hasOwn(record, "display")
    && record.availability === "ready"
    && isSafeRevision(record.revision)
    && isPresentationDisplay(record.display)
    && Object.hasOwn(record, "debugEnabled")
    && typeof record.debugEnabled === "boolean"
    && (!Object.hasOwn(record, "error") || record.error === "unavailable-time-zone");
}

interface RuntimeSlot {
  controller: DocumentTransformationController;
  handle: ContentRuntimeHandle;
  document: Document;
  messages: ContentMessageRuntime;
  phase: DocumentPhase;
  generation: number;
  pendingStart: EventListener | undefined;
  hydration: Promise<void> | undefined;
  presentation: DisplaySettings | undefined;
  presentationRevision: number | undefined;
  debugEnabled: boolean;
  debugRevision: number | undefined;
  reportDiagnostic: ((event: Record<string, unknown>) => Promise<unknown>) | undefined;
  documentReady: boolean;
  processInput: ProcessInput & Record<string, unknown>;
}

function applyPresentation(slot: RuntimeSlot, display: DisplaySettings, revision: number): void {
  slot.presentation = display;
  slot.presentationRevision = revision;
  (slot.processInput as unknown as Record<string, unknown>).display = display;
}

function applyDebugPolicy(slot: RuntimeSlot, enabled: boolean, revision: number): void {
  slot.debugEnabled = enabled;
  slot.debugRevision = revision;
  if (!enabled || !slot.reportDiagnostic) {
    slot.controller.setDiagnosticSink(undefined);
    return;
  }
  const report = slot.reportDiagnostic;
  const sink: DocumentDiagnosticSink = (event) => {
    if (!slot.debugEnabled) return;
    try { void Promise.resolve(report(event as unknown as Record<string, unknown>)).catch(() => undefined); }
    catch { /* diagnostics never interfere with page processing */ }
  };
  slot.controller.setDiagnosticSink(sink);
}

function maybeStart(slot: RuntimeSlot, generation: number): void {
  if (slot.phase !== "waiting" || slot.generation !== generation || !slot.documentReady || slot.presentation === undefined) return;
  try {
    slot.controller.start();
    slot.phase = "active";
  } catch (error) {
    if (slot.pendingStart) {
      slot.document.removeEventListener("DOMContentLoaded", slot.pendingStart);
      slot.pendingStart = undefined;
    }
    try { slot.controller.teardown(); } finally { slot.phase = "failed"; }
    throw error;
  }
}

function waitForDocument(slot: RuntimeSlot, generation: number): void {
  if (slot.document.readyState !== "loading") {
    slot.documentReady = true;
    maybeStart(slot, generation);
    return;
  }
  const callback: EventListener = () => {
    if (slot.pendingStart === callback) slot.pendingStart = undefined;
    if (slot.phase !== "waiting" || slot.generation !== generation) return;
    slot.documentReady = true;
    maybeStart(slot, generation);
  };
  slot.pendingStart = callback;
  slot.document.addEventListener("DOMContentLoaded", callback, { once: true });
}

function beginHydration(slot: RuntimeSlot, generation: number, loader: (() => Promise<unknown>) | undefined): void {
  if (!loader) {
    applyPresentation(slot, DEFAULT_DISPLAY, 0);
    applyDebugPolicy(slot, false, 0);
    waitForDocument(slot, generation);
    return;
  }
  let request: Promise<unknown>;
  try { request = loader(); } catch { slot.phase = "failed"; return; }
  slot.hydration = Promise.resolve(request).then((response) => {
    if (slot.phase !== "waiting" || slot.generation !== generation || !isDisplayState(response)) {
      if (slot.generation === generation && slot.phase === "waiting") slot.phase = "failed";
      return;
    }
    const previousRevision = Math.max(slot.presentationRevision ?? -1, slot.debugRevision ?? -1);
    if (slot.presentationRevision === undefined || response.revision >= slot.presentationRevision) applyPresentation(slot, response.display, response.revision);
    if (response.revision >= previousRevision) applyDebugPolicy(slot, response.debugEnabled, response.revision);
    try { waitForDocument(slot, generation); } catch {
      if (slot.generation === generation) slot.phase = "failed";
    }
  }, () => {
    if (slot.phase === "waiting" && slot.generation === generation) slot.phase = "failed";
  }).finally(() => {
    if (slot.generation === generation) slot.hydration = undefined;
  });
}

function activate(slot: RuntimeSlot, loader: (() => Promise<unknown>) | undefined): void {
  if (slot.phase === "waiting" || slot.phase === "active") return;
  slot.generation += 1;
  const generation = slot.generation;
  slot.phase = "waiting";
  slot.documentReady = false;
  slot.presentation = undefined;
  slot.presentationRevision = undefined;
  slot.debugEnabled = false;
  slot.debugRevision = undefined;
  slot.controller.setDiagnosticSink(undefined);
  slot.hydration = undefined;
  beginHydration(slot, generation, loader);
}

function teardown(slot: RuntimeSlot): void {
  slot.generation += 1;
  if (slot.pendingStart) {
    slot.document.removeEventListener("DOMContentLoaded", slot.pendingStart);
    slot.pendingStart = undefined;
  }
  slot.controller.teardown();
  slot.phase = "stopped";
  slot.documentReady = false;
  slot.presentation = undefined;
  slot.presentationRevision = undefined;
  slot.debugEnabled = false;
  slot.debugRevision = undefined;
  slot.controller.setDiagnosticSink(undefined);
  slot.hydration = undefined;
}

function presentationAcknowledgement(revision: number): PresentationUpdateAcknowledgement {
  return { type: PRESENTATION_UPDATED_MESSAGE, revision };
}

function debugAcknowledgement(revision: number): DebugPolicyUpdateAcknowledgement {
  return { type: DEBUG_POLICY_UPDATED_MESSAGE, revision };
}

export function installContentRuntime(input: {
  readonly document: Document;
  readonly url: URL;
  readonly locales: readonly string[];
  readonly localesProvider?: () => readonly string[];
  readonly registry?: AdapterRegistry;
  readonly loadDisplayState?: () => Promise<unknown>;
  readonly reportDiagnostic?: (event: Record<string, unknown>) => Promise<unknown>;
  readonly messages: ContentMessageRuntime;
}): ContentRuntimeHandle {
  const runtimeDocument = input.document as Document & Record<symbol, RuntimeSlot | undefined>;
  const existing = runtimeDocument[DOCUMENT_RUNTIME_SLOT];
  if (existing) {
    if (input.reportDiagnostic) existing.reportDiagnostic = input.reportDiagnostic;
    activate(existing, input.loadDisplayState);
    return existing.handle;
  }
  const processInput = { url: input.url, root: input.document, locales: input.locales,
    ...(input.localesProvider === undefined ? {} : { localesProvider: input.localesProvider }),
    ...(input.registry === undefined ? {} : { registry: input.registry }) } as ProcessInput & Record<string, unknown>;
  const slot = {} as RuntimeSlot;
  slot.document = input.document;
  slot.messages = input.messages;
  slot.processInput = processInput;
  slot.controller = new DocumentTransformationController(processInput);
  slot.phase = "stopped";
  slot.generation = 0;
  slot.pendingStart = undefined;
  slot.hydration = undefined;
  slot.presentation = undefined;
  slot.presentationRevision = undefined;
  slot.debugEnabled = false;
  slot.debugRevision = undefined;
  slot.reportDiagnostic = input.reportDiagnostic;
  slot.documentReady = false;
  slot.handle = { teardown: () => { teardown(slot); } };
  slot.messages.onMessage.addListener((message, _sender, sendResponse) => {
    if (isTeardownDocumentMessage(message)) { teardown(slot); return undefined; }
    if (isDocumentStatusMessage(message)) {
      const response = { type: DOCUMENT_STATUS_MESSAGE, phase: slot.phase };
      sendResponse?.(response);
      return response;
    }
    if (isPresentationUpdateMessage(message)) {
      if (slot.phase !== "waiting" && slot.phase !== "active") return undefined;
      if (slot.presentationRevision !== undefined && message.revision < slot.presentationRevision) return undefined;
      if (slot.presentationRevision !== undefined && message.revision === slot.presentationRevision) {
        const response = presentationAcknowledgement(message.revision);
        sendResponse?.(response);
        return response;
      }
      applyPresentation(slot, message.display, message.revision);
      if (slot.phase === "active") {
        (slot.controller as DocumentTransformationController & { reformatOwned: () => void }).reformatOwned();
      }
      const response = presentationAcknowledgement(message.revision);
      sendResponse?.(response);
      return response;
    }
    if (isDebugPolicyUpdateMessage(message)) {
      if (slot.phase !== "waiting" && slot.phase !== "active") return undefined;
      const latestRevision = Math.max(slot.presentationRevision ?? -1, slot.debugRevision ?? -1);
      if (message.revision < latestRevision) return undefined;
      if (slot.debugRevision === message.revision && slot.debugEnabled !== message.enabled) return undefined;
      if (slot.debugRevision !== message.revision) applyDebugPolicy(slot, message.enabled, message.revision);
      const response = debugAcknowledgement(message.revision);
      sendResponse?.(response);
      return response;
    }
    return undefined;
  });
  runtimeDocument[DOCUMENT_RUNTIME_SLOT] = slot;
  activate(slot, input.loadDisplayState);
  return slot.handle;
}
