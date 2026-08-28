/**
 * @file Chrome API wiring for the background application and runtime messages.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-condition */
/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */
/* eslint-disable @typescript-eslint/no-confusing-void-expression */
import * as v from "valibot";
import { BackgroundApplication } from "./application";
import {
    CLEAR_DIAGNOSTICS_MESSAGE,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_DISPLAY_STATE_MESSAGE,
    GET_DOCUMENT_STATE_MESSAGE,
    GET_POPUP_STATE_MESSAGE,
    GET_SITES_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    backgroundMessageSchema,
} from "../shared/messaging/contracts";
import { isDiagnosticEventMessage } from "../shared/messaging/document-messages";
import {
    POPUP_STATUS,
    SETTINGS_STATE_FAILURE,
    SITE_SETTINGS_SURFACE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import { SettingsService, type SettingsStorage } from "./settings/service";
import { DiagnosticJournal, type DiagnosticStorage } from "./diagnostics/journal";
import type { DiagnosticBrowserFamily } from "../shared/diagnostics/events";
import { DocumentActivationCoordinator } from "./runtime/document-activation";
import type { ScriptingRuntime } from "./runtime/scripting";
import type { TabsRuntime } from "./runtime/tabs";
import { OPTIONS_PAGE_FILE } from "../shared/extension-files";
import { LIFECYCLE_REASON } from "./application/contracts";
import { DIAGNOSTIC_BROWSER_FAMILY } from "../shared/diagnostics/contracts";
import { parseHttpUrl } from "../shared/url/http";

/**
 * Constructs the background application from available Chrome APIs, or returns undefined for
 * incomplete shims.
 *
 * @returns - Configured application, or undefined when required Chrome APIs are unavailable.
 */
function installApplication(): BackgroundApplication | undefined {
    const candidate = chrome as unknown as {
        readonly storage?: {
            readonly local?: SettingsStorage & {
                readonly remove?: (keys: string | readonly string[]) => Promise<void>;
            };
        };
        readonly tabs?: {
            readonly query?: TabsRuntime["query"];
            readonly sendMessage?: TabsRuntime["sendMessage"];
        };
        readonly webNavigation?: {
            readonly getAllFrames?: typeof chrome.webNavigation.getAllFrames;
        };
        readonly scripting?: {
            readonly getRegisteredContentScripts?:
                typeof chrome.scripting.getRegisteredContentScripts;
            readonly registerContentScripts?: typeof chrome.scripting.registerContentScripts;
            readonly updateContentScripts?: typeof chrome.scripting.updateContentScripts;
            readonly unregisterContentScripts?: typeof chrome.scripting.unregisterContentScripts;
            readonly executeScript?: typeof chrome.scripting.executeScript;
        };
    };
    if (
        !candidate.storage?.local ||
        !candidate.tabs?.query ||
        !candidate.tabs.sendMessage ||
        !candidate.webNavigation?.getAllFrames ||
        !candidate.scripting?.getRegisteredContentScripts ||
        !candidate.scripting.registerContentScripts ||
        !candidate.scripting.updateContentScripts ||
        !candidate.scripting.unregisterContentScripts ||
        !candidate.scripting.executeScript
    ) {
        return undefined;
    }

    const storage: SettingsStorage & DiagnosticStorage = {
        get: (keys) => candidate.storage?.local?.get(keys) as Promise<Record<string, unknown>>,
        set: (items) => candidate.storage?.local?.set(items) as Promise<void>,
        remove: (keys) => candidate.storage?.local?.remove?.(keys) ?? Promise.resolve(),
    };
    const scripting: ScriptingRuntime = {
        getRegisteredContentScripts: (filter) =>
            candidate.scripting
                ?.getRegisteredContentScripts?.(filter as { ids: string[] })
                .then((scripts) =>
                    scripts.map((script) => ({
                        id: script.id,
                        matches: script.matches,
                        js: script.js,
                        runAt: script.runAt,
                        allFrames: script.allFrames,
                        persistAcrossSessions: script.persistAcrossSessions,
                    })),
                ) ?? Promise.reject(new Error("Scripting is unavailable")),
        registerContentScripts: (scripts) =>
            candidate.scripting?.registerContentScripts?.(scripts) ??
            Promise.reject(new Error("Scripting is unavailable")),
        updateContentScripts: (scripts) =>
            candidate.scripting?.updateContentScripts?.(scripts) ??
            Promise.reject(new Error("Scripting is unavailable")),
        unregisterContentScripts: (filter) =>
            candidate.scripting?.unregisterContentScripts?.(filter) ??
            Promise.reject(new Error("Scripting is unavailable")),
        executeScript: (input) =>
            candidate.scripting?.executeScript?.(
                input as unknown as Parameters<typeof chrome.scripting.executeScript>[0],
            ).then((results) => results.map((result) => ({
                frameId: result.frameId,
                result: result.result,
            }))) ?? Promise.reject(new Error("Scripting is unavailable")),
    };
    const tabs: TabsRuntime = {
        query: async (query) => {
            const result = await candidate.tabs?.query?.(query);
            return (result ?? []).flatMap((tab) =>
                tab.id === undefined
                    ? []
                    : [typeof tab.url === "string" ? { id: tab.id, url: tab.url } : { id: tab.id }],
            );
        },
        sendMessage: (tabId, message, options) =>
            candidate.tabs?.sendMessage?.(tabId, message, options) as Promise<unknown>,
        getAllFrames: async (tabId) => {
            const frames = await candidate.webNavigation?.getAllFrames?.({ tabId });
            return (frames ?? []).flatMap(({ frameId, url }) =>
                parseHttpUrl(url) ? [{ frameId }] : []);
        },
    };
    const coordinator = new DocumentActivationCoordinator({ scripting, tabs });
    const userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent;
    const browserFamily: DiagnosticBrowserFamily = /Firefox|FxiOS/iu.test(userAgent)
        ? DIAGNOSTIC_BROWSER_FAMILY.FIREFOX
        : /Chrome|Chromium|Edg|OPR/iu.test(userAgent)
            ? DIAGNOSTIC_BROWSER_FAMILY.CHROMIUM
            : DIAGNOSTIC_BROWSER_FAMILY.OTHER;
    let extensionVersion: unknown;
    try {
        extensionVersion = chrome.runtime?.getManifest?.().version;
    } catch {
        /* incomplete browser shims expose no manifest */
    }
    const diagnosticEnvironment = {
        browserFamily,
        ...(typeof extensionVersion === "string" ? { extensionVersion } : {}),
    };
    return new BackgroundApplication({
        settings: new SettingsService(storage),
        coordinator,
        tabs,
        journal: new DiagnosticJournal(storage),
        diagnosticEnvironment,
    });
}

const application = installApplication();

/**
 * Accepts only messages sent from this extension's options page.
 *
 * @param sender - Untrusted runtime message sender metadata.
 * @returns - Whether the sender is this extension's options page.
 */
function isTrustedOptionsSender(sender: unknown): boolean {
    if (typeof sender !== "object" || sender === null || !Object.hasOwn(sender, "url")) {
        return false;
    }
    let optionsUrl: unknown;
    let extensionId: unknown;
    try {
        optionsUrl = chrome.runtime?.getURL?.(OPTIONS_PAGE_FILE);
        extensionId = chrome.runtime?.id;
    } catch {
        return false;
    }
    const values = sender as Record<string, unknown>;
    if (typeof optionsUrl !== "string" || values.url !== optionsUrl) {
        return false;
    }
    return (
        typeof extensionId !== "string" ||
        (Object.hasOwn(values, "id") && values.id === extensionId)
    );
}

if (application && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((message: unknown, sender, sendResponse) => {
        let responseSent = false;
        const sendOnce = (value: unknown): void => {
            if (responseSent) {
                return;
            }
            responseSent = true;
            sendResponse(value);
        };
        if (isDiagnosticEventMessage(message)) {
            void application.recordDocumentEvent(message.event, sender).then(
                (accepted) => sendOnce({ ok: accepted }),
                () => sendOnce({ ok: false }),
            );
            return true;
        }
        const parsed = v.safeParse(backgroundMessageSchema, message);
        if (!parsed.success) {
            return false;
        }
        const request = parsed.output;
        if (request.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE) {
            if (!isTrustedOptionsSender(sender)) {
                return false;
            }
            void application
                .getDiagnosticsSnapshot()
                .then(sendOnce, () => sendOnce({ ok: false, error: "unavailable" }));
            return true;
        }
        if (request.type === CLEAR_DIAGNOSTICS_MESSAGE) {
            if (!isTrustedOptionsSender(sender)) {
                return false;
            }
            void application
                .clearDiagnostics()
                .then(sendOnce, () => sendOnce({ ok: false, error: "unavailable" }));
            return true;
        }
        if (request.type === GET_POPUP_STATE_MESSAGE) {
            void application
                .getPopupState()
                .then(sendOnce, () =>
                    sendOnce({
                        availability: STATE_AVAILABILITY.UNAVAILABLE,
                        revision: null,
                        globalEnabled: null,
                        hostname: null,
                        siteEnabled: null,
                        status: POPUP_STATUS.SETTINGS_UNAVAILABLE,
                        failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                    }),
                );
            return true;
        }
        if (request.type === GET_DOCUMENT_STATE_MESSAGE) {
            void application
                .getDocumentState(sender)
                .then(sendOnce, () => sendOnce({
                    availability: STATE_AVAILABILITY.UNAVAILABLE,
                    revision: null,
                    enabled: false,
                    display: null,
                    debugEnabled: false,
                    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                }));
            return true;
        }
        if (request.type === GET_DISPLAY_STATE_MESSAGE) {
            void application
                .getDisplayState()
                .then(sendOnce, () =>
                    sendOnce({
                        availability: STATE_AVAILABILITY.UNAVAILABLE,
                        revision: null,
                        display: null,
                        failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                    }),
                );
            return true;
        }
        if (request.type === GET_DEBUG_STATE_MESSAGE) {
            void application
                .getDebugState()
                .then(sendOnce, () =>
                    sendOnce({
                        availability: STATE_AVAILABILITY.UNAVAILABLE,
                        revision: null,
                        enabled: null,
                        failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                    }),
                );
            return true;
        }
        if (request.type === SET_DEBUG_ENABLED_MESSAGE) {
            void application
                .setDebugEnabled(request.enabled)
                .then(sendOnce, () =>
                    sendOnce({
                        ok: false,
                        error: "settings-unavailable",
                        state: {
                            availability: STATE_AVAILABILITY.UNAVAILABLE,
                            revision: null,
                            enabled: null,
                            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                        },
                    }),
                );
            return true;
        }
        if (request.type === SET_DISPLAY_SETTINGS_MESSAGE) {
            void application
                .setDisplaySettings(request.display)
                .then(sendOnce, () =>
                    sendOnce({
                        ok: false,
                        error: "settings-unavailable",
                        state: {
                            availability: STATE_AVAILABILITY.UNAVAILABLE,
                            revision: null,
                            display: null,
                            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                        },
                    }),
                );
            return true;
        }
        if (request.type === SET_GLOBAL_ENABLED_MESSAGE) {
            void application
                .setGlobalEnabled(request.enabled)
                .then(sendOnce, () =>
                    sendOnce({
                        ok: false,
                        error: "settings-unavailable",
                        state: {
                            availability: STATE_AVAILABILITY.UNAVAILABLE,
                            revision: null,
                            globalEnabled: null,
                            hostname: null,
                            siteEnabled: null,
                            status: POPUP_STATUS.SETTINGS_UNAVAILABLE,
                            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                        },
                    }),
                );
            return true;
        }
        if (request.type === GET_SITES_STATE_MESSAGE) {
            void application
                .getSitesState()
                .then(sendOnce, () =>
                    sendOnce({
                        availability: STATE_AVAILABILITY.UNAVAILABLE,
                        revision: null,
                        globalEnabled: null,
                        sites: [],
                        failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                    }),
                );
            return true;
        }
        if (request.type === RESET_ALL_SETTINGS_MESSAGE) {
            void application
                .resetAllSettings()
                .then(sendOnce, () =>
                    sendOnce({
                        ok: false,
                        error: "settings-unavailable",
                        state: {
                            availability: STATE_AVAILABILITY.UNAVAILABLE,
                            revision: null,
                            globalEnabled: null,
                            sites: [],
                            failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                        },
                    }),
                );
            return true;
        }
        if (request.type === SET_SITE_ENABLED_MESSAGE) {
            void application
                .setSiteEnabled(request.hostname, request.enabled, request.surface)
                .then(sendOnce, () =>
                    sendOnce({
                        ok: false,
                        error: "settings-unavailable",
                        surface: request.surface,
                        state:
                            request.surface === SITE_SETTINGS_SURFACE.POPUP
                                ? {
                                    availability: STATE_AVAILABILITY.UNAVAILABLE,
                                    revision: null,
                                    globalEnabled: null,
                                    hostname: null,
                                    siteEnabled: null,
                                    status: POPUP_STATUS.SETTINGS_UNAVAILABLE,
                                    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                                }
                                : {
                                    availability: STATE_AVAILABILITY.UNAVAILABLE,
                                    revision: null,
                                    globalEnabled: null,
                                    sites: [],
                                    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
                                },
                    }),
                );
            return true;
        }
        return false;
    });
    chrome.runtime.onStartup?.addListener(() => {
        void application.requestLifecycle(LIFECYCLE_REASON.STARTUP);
    });
    chrome.runtime.onInstalled?.addListener(() => {
        void application.requestLifecycle(LIFECYCLE_REASON.INSTALLED);
    });
    void application.ensureReady(LIFECYCLE_REASON.COLD_WORKER).catch((error: unknown) => {
        console.error("Background initialization failed", error);
    });
}
