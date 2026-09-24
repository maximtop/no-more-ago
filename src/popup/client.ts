/**
 * Provides the popup with typed background-message requests.
 *
 * @file Typed client for popup requests and ambiguous-response recovery.
 */

import { CLIENT_RESULT_KIND, runMutation, type MutationResult } from '../shared/client-result';
import {
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    GET_POPUP_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    DIAGNOSTICS_ERROR,
    type GetDiagnosticsSnapshotResponse,
    type BackgroundMessage,
} from '../shared/messaging/contracts';
import { SITE_SETTINGS_SURFACE } from '../shared/messaging/view-state-values';

import type { DiagnosticsSnapshotResult } from '../shared/diagnostics/download';
import type {
    ResetAllSettingsResponse,
    SetGlobalEnabledResponse,
    SetSiteEnabledResponse,
} from '../shared/messaging/responses';
import type { PopupState } from '../shared/messaging/view-state';
import type { SiteScopeMode } from '../shared/settings/site-scope';

/**
 * Sends a popup request to the extension runtime.
 */
export interface PopupTransport {
    /**
     * Sends one popup request and resolves with the background response.
     */
    sendMessage(message: BackgroundMessage): Promise<unknown>;
}

/**
 * Response of a command projected for the popup surface.
 */
type PopupSurfaceResponse<TResponse> = Extract<
    TResponse,
    {
        /**
         * Selects responses projected for the popup surface.
         */
        readonly surface: typeof SITE_SETTINGS_SURFACE.POPUP;
    }
>;

/**
 * Result of changing the global enabled setting.
 */
export type PopupSetResult = MutationResult<
    PopupSurfaceResponse<SetGlobalEnabledResponse>,
    PopupState
>;

/**
 * Result of changing the current site's enabled setting.
 */
export type PopupSiteSetResult = MutationResult<
    PopupSurfaceResponse<SetSiteEnabledResponse>,
    PopupState
>;

/**
 * Wraps popup messages and validates their background responses.
 */
export class PopupClient {
    /**
     * Transport used for all popup background requests.
     */
    private readonly transport: PopupTransport;

    /**
     * Creates a client using the supplied extension-message transport.
     *
     * @param transport - Runtime transport used to send popup requests.
     */
    public constructor(transport: PopupTransport) {
        this.transport = transport;
    }

    /**
     * Retrieves the popup state for the active tab.
     *
     * @returns - The validated popup state from the background service.
     */
    public async getState(): Promise<PopupState> {
        const response = await this.transport.sendMessage({ type: GET_POPUP_STATE_MESSAGE });
        const state = response as PopupState | undefined;
        if (!state) {
            throw new Error('Missing popup state response');
        }
        return state;
    }

    /**
     * Changes the global enabled setting.
     *
     * @param enabled - Whether the extension should process supported pages.
     *
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setGlobalEnabled(enabled: boolean): Promise<PopupSetResult> {
        return runMutation(
            () => this.transport.sendMessage({
                type: SET_GLOBAL_ENABLED_MESSAGE,
                enabled,
                surface: SITE_SETTINGS_SURFACE.POPUP,
            }),
            () => this.getState(),
            (response: SetGlobalEnabledResponse):
                response is PopupSurfaceResponse<SetGlobalEnabledResponse> => response.surface === SITE_SETTINGS_SURFACE.POPUP,
        );
    }

    /**
     * Changes whether processing is enabled for the current hostname.
     *
     * @param hostname - Exact hostname whose setting should change.
     * @param enabled - Whether processing should be enabled for the hostname.
     * @param mode - Scope mode rendered when the decision was made.
     *
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setSiteEnabled(
        hostname: string,
        enabled: boolean,
        mode: SiteScopeMode,
    ): Promise<PopupSiteSetResult> {
        return runMutation(
            () => this.transport.sendMessage({
                type: SET_SITE_ENABLED_MESSAGE,
                hostname,
                enabled,
                mode,
                surface: SITE_SETTINGS_SURFACE.POPUP,
            }),
            () => this.getState(),
            (response: SetSiteEnabledResponse):
                response is PopupSurfaceResponse<SetSiteEnabledResponse> => response.surface === SITE_SETTINGS_SURFACE.POPUP,
        );
    }

    /**
     * Restores every setting to its default. The command is dispatched once,
     * because a lost response may follow a committed write.
     *
     * @returns - Whether the background confirmed the reset.
     */
    public async resetAllSettings(): Promise<boolean> {
        try {
            const response = await this.transport.sendMessage({
                type: RESET_ALL_SETTINGS_MESSAGE,
            });
            return (response as ResetAllSettingsResponse | undefined)?.ok === true;
        } catch {
            return false;
        }
    }

    /**
     * Retrieves retained diagnostics for the recovery view without throwing.
     *
     * @returns - A snapshot, or the service error that prevented reading it.
     */
    public async getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshotResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({
                type: GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
            });
        } catch {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: DIAGNOSTICS_ERROR.UNAVAILABLE };
        }
        const result = response as GetDiagnosticsSnapshotResponse | undefined;
        if (!result) {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: DIAGNOSTICS_ERROR.UNAVAILABLE };
        }
        return result.ok
            ? { kind: CLIENT_RESULT_KIND.RESPONSE, snapshot: result.snapshot }
            : { kind: CLIENT_RESULT_KIND.ERROR, error: result.error };
    }
}

/**
 * Creates a popup client using an injected transport or the extension runtime.
 *
 * @param transport - Optional transport for tests or embedded callers.
 *
 * @returns - A client whose default transport rejects when the extension runtime is unavailable.
 */
export function createPopupClient(transport?: PopupTransport): PopupClient {
    if (transport) {
        return new PopupClient(transport);
    }
    if (typeof chrome !== 'undefined') {
        return new PopupClient(chrome.runtime);
    }
    return new PopupClient({
        sendMessage: () => Promise.reject(new Error('Extension runtime is unavailable')),
    });
}
