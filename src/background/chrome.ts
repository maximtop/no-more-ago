/**
 * @file Chrome API wiring for the background application and runtime messages.
 */

/* eslint-disable @typescript-eslint/no-unnecessary-type-assertion */

import { DIAGNOSTIC_BROWSER_FAMILY } from '../shared/diagnostics/contracts';
import { OPTIONS_PAGE_FILE, POPUP_PAGE_FILE } from '../shared/extension-files';
import {
    CLEAR_DIAGNOSTICS_MESSAGE,
    DIAGNOSTICS_ERROR,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_DISPLAY_STATE_MESSAGE,
    GET_DOCUMENT_STATE_MESSAGE,
    GET_POPUP_STATE_MESSAGE,
    GET_SITES_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_APPEARANCE_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_SITE_SCOPE_MODE_MESSAGE,
    type BackgroundMessage,
} from '../shared/messaging/contracts';
import {
    DIAGNOSTIC_EVENT_MESSAGE,
    type DiagnosticEventMessage,
} from '../shared/messaging/document-messages';
import { createUnavailableDocumentState } from '../shared/messaging/document-state';
import { SETTINGS_CHANGED_MESSAGE } from '../shared/messaging/settings-notifications';
import {
    createUnavailableDebugState,
    createUnavailableDisplayState,
    createUnavailablePopupState,
    createUnavailableSitesState,
} from '../shared/messaging/view-state';
import {
    SETTINGS_PERSISTENCE_ERROR,
    SITE_SETTINGS_SURFACE,
    type SiteSettingsSurface,
} from '../shared/messaging/view-state-values';
import { parseHttpUrl } from '../shared/url/http';

import { BackgroundApplication } from './application';
import { LIFECYCLE_REASON, type SettingsBroadcast } from './application/contracts';
import { DiagnosticJournal, type DiagnosticStorage } from './diagnostics/journal';
import { DocumentActivationCoordinator } from './runtime/document-activation';
import {
    installDocumentRouteUpdates,
    type HistoryStateUpdateSource,
} from './runtime/document-route-updates';
import { SettingsService, type SettingsStorage } from './settings/service';

import type { ScriptingRuntime } from './runtime/scripting';
import type { TabsRuntime } from './runtime/tabs';
import type { DiagnosticBrowserFamily } from '../shared/diagnostics/events';
import type {
    UnavailablePopupState,
    UnavailableSitesState,
} from '../shared/messaging/view-state';
import type { DisplaySettings } from '../shared/settings/snapshot';

/**
 * Announces committed settings revisions to open extension pages.
 *
 * Delivery rejects when no popup or options page is open, which is normal, so
 * the rejection is contained here rather than failing a settings command.
 */
const settingsBroadcast: SettingsBroadcast = {
    settingsChanged: (revision) => {
        try {
            void Promise.resolve(
                chrome.runtime.sendMessage({ type: SETTINGS_CHANGED_MESSAGE, revision }),
            ).catch(() => undefined);
        } catch {
            /* the runtime is unavailable in incomplete browser shims */
        }
    },
};

/**
 * Constructs the background application from available Chrome APIs, or returns undefined for
 * incomplete shims.
 *
 * @returns - Configured application, or undefined when required Chrome APIs are unavailable.
 */
function installApplication(): BackgroundApplication | undefined {
    const candidate = chrome as unknown as {
        readonly storage?: {
            readonly local?: Pick<DiagnosticStorage, 'get' | 'set'> & {
                readonly remove?: (keys: string | readonly string[]) => Promise<void>;
            };
        };
        readonly tabs?: {
            readonly query?: TabsRuntime['query'];
            readonly sendMessage?: TabsRuntime['sendMessage'];
        };
        readonly webNavigation?: {
            readonly getAllFrames?: typeof chrome.webNavigation.getAllFrames;
            readonly onHistoryStateUpdated?: HistoryStateUpdateSource;
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
        !candidate.storage?.local
        || !candidate.tabs?.query
        || !candidate.tabs.sendMessage
        || !candidate.webNavigation?.getAllFrames
        || !candidate.scripting?.getRegisteredContentScripts
        || !candidate.scripting.registerContentScripts
        || !candidate.scripting.updateContentScripts
        || !candidate.scripting.unregisterContentScripts
        || !candidate.scripting.executeScript
    ) {
        return undefined;
    }

    const storage: SettingsStorage & DiagnosticStorage = {
        get: (keys) => candidate.storage?.local?.get(keys) as Promise<
            Readonly<Record<string, unknown>>
        >,
        set: (items: Record<string, unknown>) => candidate.storage?.local?.set(items) as Promise<void>,
        remove: (keys) => candidate.storage?.local?.remove?.(keys) ?? Promise.resolve(),
    };
    const scripting: ScriptingRuntime = {
        getRegisteredContentScripts: (filter) => candidate.scripting
            ?.getRegisteredContentScripts?.(filter as { ids: string[] })
            .then((scripts) => scripts.map((script) => ({
                id: script.id,
                matches: script.matches,
                js: script.js,
                runAt: script.runAt,
                allFrames: script.allFrames,
                persistAcrossSessions: script.persistAcrossSessions,
                world: script.world,
            }))) ?? Promise.reject(new Error('Scripting is unavailable')),
        registerContentScripts: (scripts) => candidate.scripting?.registerContentScripts?.(scripts)
            ?? Promise.reject(new Error('Scripting is unavailable')),
        updateContentScripts: (scripts) => candidate.scripting?.updateContentScripts?.(scripts)
            ?? Promise.reject(new Error('Scripting is unavailable')),
        unregisterContentScripts: (filter) => candidate.scripting?.unregisterContentScripts?.(filter)
            ?? Promise.reject(new Error('Scripting is unavailable')),
        executeScript: (input) => candidate.scripting?.executeScript?.(
            input as unknown as Parameters<typeof chrome.scripting.executeScript>[0],
        ).then((results) => results.map((result) => ({
            frameId: result.frameId,
            result: result.result,
        }))) ?? Promise.reject(new Error('Scripting is unavailable')),
    };
    const tabs: TabsRuntime = {
        query: async (query) => {
            const result = await candidate.tabs?.query?.(query);
            return (result ?? []).flatMap((tab) => (tab.id === undefined
                ? []
                : [tab.url === undefined ? { id: tab.id } : { id: tab.id, url: tab.url }]));
        },
        sendMessage: (tabId, message, options) => candidate.tabs?.sendMessage?.(tabId, message, options) as Promise<unknown>,
        getAllFrames: async (tabId) => {
            const frames = await candidate.webNavigation?.getAllFrames?.({ tabId });
            return (frames ?? []).flatMap(({ frameId, url }) => (parseHttpUrl(url) ? [{ frameId, url }] : []));
        },
    };
    const coordinator = new DocumentActivationCoordinator({ scripting, tabs });
    if (candidate.webNavigation.onHistoryStateUpdated) {
        installDocumentRouteUpdates({
            updates: candidate.webNavigation.onHistoryStateUpdated,
            tabs,
        });
    }
    const userAgent = typeof navigator === 'undefined' ? '' : navigator.userAgent;
    const browserFamily: DiagnosticBrowserFamily = /Firefox|FxiOS/iu.test(userAgent)
        ? DIAGNOSTIC_BROWSER_FAMILY.FIREFOX
        : /Chrome|Chromium|Edg|OPR/iu.test(userAgent)
            ? DIAGNOSTIC_BROWSER_FAMILY.CHROMIUM
            : DIAGNOSTIC_BROWSER_FAMILY.OTHER;
    let extensionVersion: string | undefined;
    try {
        extensionVersion = chrome.runtime?.getManifest?.().version;
    } catch {
        /* incomplete browser shims expose no manifest */
    }
    const diagnosticEnvironment = {
        browserFamily,
        ...(extensionVersion === undefined ? {} : { extensionVersion }),
    };
    return new BackgroundApplication({
        settings: new SettingsService(storage),
        coordinator,
        tabs,
        journal: new DiagnosticJournal(storage),
        diagnosticEnvironment,
        broadcast: settingsBroadcast,
    });
}

const application = installApplication();

/**
 * Accepts only messages sent from this extension's own options page or popup.
 *
 * @param sender - Runtime message sender metadata.
 *
 * @returns - Whether the sender is one of this extension's settings surfaces.
 */
function isTrustedSurfaceSender(sender: chrome.runtime.MessageSender): boolean {
    try {
        return (
            sender.id === chrome.runtime.id
            && (sender.url === chrome.runtime.getURL(OPTIONS_PAGE_FILE)
                || sender.url === chrome.runtime.getURL(POPUP_PAGE_FILE))
        );
    } catch {
        return false;
    }
}

/**
 * Builds the fail-closed response returned when a settings command itself rejects.
 *
 * @param state - Unavailable projection for the command's surface.
 *
 * @returns - Failed command response carrying the projection.
 */
function unavailableCommand<TState>(state: TState): {
    readonly ok: false;
    readonly error: typeof SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE;
    readonly state: TState;
} {
    return { ok: false, error: SETTINGS_PERSISTENCE_ERROR.SETTINGS_UNAVAILABLE, state };
}

/**
 * Selects the unavailable projection for a popup or sites request.
 *
 * @param surface - Surface that issued the request.
 *
 * @returns - Unavailable popup or sites projection.
 */
function unavailableSurfaceState(
    surface: SiteSettingsSurface,
): UnavailablePopupState | UnavailableSitesState {
    return surface === SITE_SETTINGS_SURFACE.POPUP
        ? createUnavailablePopupState()
        : createUnavailableSitesState();
}

if (application && chrome.runtime?.onMessage?.addListener) {
    chrome.runtime.onMessage.addListener((value: unknown, sender, sendResponse) => {
        const message = value as BackgroundMessage | DiagnosticEventMessage | undefined;
        let responseSent = false;

        /**
         * Sends the response once; a later attempt from the same handler is ignored.
         *
         * @param value - Response payload.
         */
        const sendOnce = (value: unknown): void => {
            if (responseSent) {
                return;
            }
            responseSent = true;
            sendResponse(value);
        };
        if (message?.type === DIAGNOSTIC_EVENT_MESSAGE) {
            void application.recordDocumentEvent(message.event, sender).then(
                (accepted) => sendOnce({ ok: accepted }),
                () => sendOnce({ ok: false }),
            );
            return true;
        }
        if (!message) {
            return false;
        }
        const request = message;
        if (request.type === GET_DIAGNOSTICS_SNAPSHOT_MESSAGE) {
            if (!isTrustedSurfaceSender(sender)) {
                return false;
            }
            void application
                .getDiagnosticsSnapshot()
                .then(
                    sendOnce,
                    () => sendOnce({ ok: false, error: DIAGNOSTICS_ERROR.UNAVAILABLE }),
                );
            return true;
        }
        if (request.type === CLEAR_DIAGNOSTICS_MESSAGE) {
            if (!isTrustedSurfaceSender(sender)) {
                return false;
            }
            void application
                .clearDiagnostics()
                .then(
                    sendOnce,
                    () => sendOnce({ ok: false, error: DIAGNOSTICS_ERROR.UNAVAILABLE }),
                );
            return true;
        }
        if (request.type === GET_POPUP_STATE_MESSAGE) {
            void application
                .getPopupState()
                .then(sendOnce, () => sendOnce(createUnavailablePopupState()));
            return true;
        }
        if (request.type === GET_DOCUMENT_STATE_MESSAGE) {
            void application
                .getDocumentState(sender)
                .then(sendOnce, () => sendOnce(createUnavailableDocumentState()));
            return true;
        }
        if (request.type === GET_DISPLAY_STATE_MESSAGE) {
            void application
                .getDisplayState()
                .then(sendOnce, () => sendOnce(createUnavailableDisplayState()));
            return true;
        }
        if (request.type === GET_DEBUG_STATE_MESSAGE) {
            void application
                .getDebugState()
                .then(sendOnce, () => sendOnce(createUnavailableDebugState()));
            return true;
        }
        if (request.type === GET_SITES_STATE_MESSAGE) {
            void application
                .getSitesState()
                .then(sendOnce, () => sendOnce(createUnavailableSitesState()));
            return true;
        }
        // Every mutation below is issued only by this extension's own popup or
        // options page, so the sender gate is uniform with the diagnostics reads.
        if (!isTrustedSurfaceSender(sender)) {
            return false;
        }
        if (request.type === SET_DEBUG_ENABLED_MESSAGE) {
            void application
                .setDebugEnabled(request.enabled)
                .then(sendOnce, () => sendOnce(unavailableCommand(createUnavailableDebugState())));
            return true;
        }
        if (request.type === SET_DISPLAY_SETTINGS_MESSAGE) {
            void application
                .setDisplaySettings(request.display as DisplaySettings)
                .then(sendOnce, () => sendOnce(unavailableCommand(createUnavailableDisplayState())));
            return true;
        }
        if (request.type === SET_APPEARANCE_MESSAGE) {
            void application
                .setAppearance(request.appearance)
                .then(sendOnce, () => sendOnce(unavailableCommand(createUnavailableDisplayState())));
            return true;
        }
        if (request.type === SET_GLOBAL_ENABLED_MESSAGE) {
            void application
                .setGlobalEnabled(request.enabled, request.surface)
                .then(sendOnce, () => sendOnce({
                    ...unavailableCommand(unavailableSurfaceState(request.surface)),
                    surface: request.surface,
                }));
            return true;
        }
        if (request.type === RESET_ALL_SETTINGS_MESSAGE) {
            void application
                .resetAllSettings()
                .then(sendOnce, () => sendOnce(unavailableCommand(createUnavailableSitesState())));
            return true;
        }
        if (request.type === SET_SITE_SCOPE_MODE_MESSAGE) {
            void application
                .setSiteScopeMode(request.mode)
                .then(sendOnce, () => sendOnce(unavailableCommand(createUnavailableSitesState())));
            return true;
        }
        if (request.type === SET_SITE_ENABLED_MESSAGE) {
            void application
                .setSiteEnabled(request.hostname, request.enabled, request.mode, request.surface)
                .then(sendOnce, () => sendOnce({
                    ...unavailableCommand(unavailableSurfaceState(request.surface)),
                    surface: request.surface,
                }));
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
        console.error('Background initialization failed', error);
    });
}
