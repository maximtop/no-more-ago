/**
 * Provides the options page with typed background-message requests.
 *
 * @file Typed client for options-page requests and background responses.
 */

import * as v from "valibot";
import {
    GET_DISPLAY_STATE_MESSAGE,
    GET_DEBUG_STATE_MESSAGE,
    GET_DIAGNOSTICS_SNAPSHOT_MESSAGE,
    CLEAR_DIAGNOSTICS_MESSAGE,
    GET_SITES_STATE_MESSAGE,
    RESET_ALL_SETTINGS_MESSAGE,
    SET_APPEARANCE_MESSAGE,
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_SITE_SCOPE_MODE_MESSAGE,
    clearDiagnosticsResponseSchema,
    getDiagnosticsSnapshotResponseSchema,
    DIAGNOSTICS_ERROR,
    type DiagnosticsClearError,
    type BackgroundMessage,
} from "../shared/messaging/contracts";
import {
    debugStateSchema,
    displayStateSchema,
    sitesStateSchema,
    type DebugState,
    type DisplayState,
    type SitesState,
} from "../shared/messaging/view-state-schemas";
import {
    resetAllSettingsResponseSchema,
    setAppearanceResponseSchema,
    setDebugEnabledResponseSchema,
    setDisplaySettingsResponseSchema,
    setGlobalEnabledResponseSchema,
    setSiteEnabledResponseSchema,
    setSiteScopeModeResponseSchema,
    type ResetAllSettingsResponse,
    type SetAppearanceResponse,
    type SetDebugEnabledResponse,
    type SetDisplaySettingsResponse,
    type SetGlobalEnabledResponse,
    type SetSiteEnabledResponse,
    type SetSiteScopeModeResponse,
} from "../shared/messaging/response-schemas";
import { SITE_SETTINGS_SURFACE } from "../shared/messaging/view-state-values";
import type { Appearance, DisplaySettings } from "../shared/settings/snapshot";
import type { SiteScopeMode } from "../shared/settings/site-scope";
import { CLIENT_RESULT_KIND, runMutation, type MutationResult } from "../shared/client-result";
import type { DiagnosticsSnapshotResult } from "../shared/diagnostics/download";

/**
 * Sends an options-page request to the extension runtime.
 */
export interface SitesTransport {
    /**
     * Sends one options-page request and resolves with the background response.
     */
    sendMessage(message: BackgroundMessage): Promise<unknown>;
}

/**
 * Response of a command projected for the options-page sites surface.
 */
type SitesSurfaceResponse<TResponse> = Extract<
    TResponse,
    {
        /**
         * Selects responses projected for the options-page sites surface.
         */
        readonly surface: typeof SITE_SETTINGS_SURFACE.SITES;
    }
>;

/**
 * Result of saving display settings.
 */
export type DisplaySetResult = MutationResult<SetDisplaySettingsResponse, DisplayState>;

/**
 * Result of changing the appearance.
 */
export type AppearanceSetResult = MutationResult<SetAppearanceResponse, DisplayState>;

/**
 * Result of changing a site's enabled setting.
 */
export type SitesSetResult = MutationResult<
    SitesSurfaceResponse<SetSiteEnabledResponse>,
    SitesState
>;

/**
 * Result of changing global activation from the sites surface.
 */
export type SitesGlobalSetResult = MutationResult<
    SitesSurfaceResponse<SetGlobalEnabledResponse>,
    SitesState
>;

/**
 * Result of changing the active scope mode.
 */
export type SitesScopeSetResult = MutationResult<SetSiteScopeModeResponse, SitesState>;

/**
 * Result of changing whether diagnostic logging is enabled.
 */
export type DebugSetResult = MutationResult<SetDebugEnabledResponse, DebugState>;

/**
 * Result of resetting all persisted settings.
 */
export type SitesResetResult =
    | {
        /**
         * Indicates that the background returned a validated reset response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated result of resetting all settings.
         */
        readonly response: ResetAllSettingsResponse;
    }
    | {
        /**
         * Indicates that reset completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;
    };

/**
 * Result of removing stored diagnostic entries.
 */
export type DiagnosticsClearResult =
    | {
        /**
         * Indicates that diagnostics were cleared successfully.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;
    }
    | {
        /**
         * Indicates that diagnostics could not be cleared.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.ERROR;

        /**
         * Stable reason the clear request failed.
         */
        readonly error: DiagnosticsClearError;
    };

/**
 * Wraps options-page messages and validates their background responses.
 */
export class SitesClient {
    /**
     * Transport used for all options-page background requests.
     */
    private readonly transport: SitesTransport;

    /**
     * Creates a client using the supplied extension-message transport.
     *
     * @param transport - Runtime transport used to send options-page requests.
     */
    public constructor(transport: SitesTransport) {
        this.transport = transport;
    }

    /**
     * Retrieves the scope mode, both hostname lists, and global activation.
     *
     * @returns - The validated sites state from the background service.
     */
    public async getState(): Promise<SitesState> {
        const response = await this.transport.sendMessage({ type: GET_SITES_STATE_MESSAGE });
        if (!v.is(sitesStateSchema, response)) {
            throw new Error("Invalid Sites state response");
        }
        return response;
    }

    /**
     * Retrieves the saved display-format settings and appearance.
     *
     * @returns - The validated display state from the background service.
     */
    public async getDisplayState(): Promise<DisplayState> {
        const response = await this.transport.sendMessage({ type: GET_DISPLAY_STATE_MESSAGE });
        const parsed = v.safeParse(displayStateSchema, response);
        if (!parsed.success) {
            throw new Error("Invalid Display state response");
        }
        return parsed.output;
    }

    /**
     * Retrieves whether diagnostic logging is enabled.
     *
     * @returns - The validated debug state from the background service.
     */
    public async getDebugState(): Promise<DebugState> {
        const response = await this.transport.sendMessage({ type: GET_DEBUG_STATE_MESSAGE });
        if (!v.is(debugStateSchema, response)) {
            throw new Error("Invalid Debug state response");
        }
        return response;
    }

    /**
     * Recovery is deliberately a single-dispatch operation. A lost or malformed
     * response may follow a committed storage write, so retrying the mutation
     * here could apply it twice.
     *
     * @returns - A confirmed reset response, or an ambiguous outcome after a lost response.
     */
    public async resetAllSettings(): Promise<SitesResetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: RESET_ALL_SETTINGS_MESSAGE });
        } catch {
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
        }
        return v.is(resetAllSettingsResponseSchema, response)
            ? { kind: CLIENT_RESULT_KIND.RESPONSE, response }
            : { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
    }

    /**
     * Changes whether processing is enabled for one hostname.
     *
     * @param hostname - Exact hostname whose setting should change.
     * @param enabled - Whether processing should be enabled for the hostname.
     * @param mode - Scope mode rendered when the decision was made.
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setSiteEnabled(
        hostname: string,
        enabled: boolean,
        mode: SiteScopeMode,
    ): Promise<SitesSetResult> {
        return runMutation(
            () => this.transport.sendMessage({
                type: SET_SITE_ENABLED_MESSAGE,
                hostname,
                enabled,
                mode,
                surface: SITE_SETTINGS_SURFACE.SITES,
            }),
            setSiteEnabledResponseSchema,
            () => this.getState(),
            (response): response is SitesSurfaceResponse<SetSiteEnabledResponse> =>
                response.surface === SITE_SETTINGS_SURFACE.SITES,
        );
    }

    /**
     * Changes the active scope mode.
     *
     * @param mode - Requested scope mode.
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setSiteScopeMode(mode: SiteScopeMode): Promise<SitesScopeSetResult> {
        return runMutation(
            () => this.transport.sendMessage({ type: SET_SITE_SCOPE_MODE_MESSAGE, mode }),
            setSiteScopeModeResponseSchema,
            () => this.getState(),
        );
    }

    /**
     * Changes global activation and receives this surface's projection back.
     *
     * @param enabled - Requested global activation state.
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setGlobalEnabled(enabled: boolean): Promise<SitesGlobalSetResult> {
        return runMutation(
            () => this.transport.sendMessage({
                type: SET_GLOBAL_ENABLED_MESSAGE,
                enabled,
                surface: SITE_SETTINGS_SURFACE.SITES,
            }),
            setGlobalEnabledResponseSchema,
            () => this.getState(),
            (response): response is SitesSurfaceResponse<SetGlobalEnabledResponse> =>
                response.surface === SITE_SETTINGS_SURFACE.SITES,
        );
    }

    /**
     * Changes whether diagnostic logging is enabled.
     *
     * @param enabled - Whether diagnostic logging should be enabled.
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setDebugEnabled(enabled: boolean): Promise<DebugSetResult> {
        return runMutation(
            () => this.transport.sendMessage({ type: SET_DEBUG_ENABLED_MESSAGE, enabled }),
            setDebugEnabledResponseSchema,
            () => this.getDebugState(),
        );
    }

    /**
     * Saves display-format settings.
     *
     * @param display - Display settings to persist.
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setDisplaySettings(display: DisplaySettings): Promise<DisplaySetResult> {
        return runMutation(
            () => this.transport.sendMessage({ type: SET_DISPLAY_SETTINGS_MESSAGE, display }),
            setDisplaySettingsResponseSchema,
            () => this.getDisplayState(),
        );
    }

    /**
     * Saves the appearance applied to both surfaces.
     *
     * @param appearance - Appearance to persist.
     * @returns - The confirmed response, or a state reread after an ambiguous response.
     */
    public setAppearance(appearance: Appearance): Promise<AppearanceSetResult> {
        return runMutation(
            () => this.transport.sendMessage({ type: SET_APPEARANCE_MESSAGE, appearance }),
            setAppearanceResponseSchema,
            () => this.getDisplayState(),
        );
    }

    /**
     * Retrieves diagnostics without throwing for expected service failures.
     *
     * @returns - A snapshot, or the service error that prevented it from being read.
     */
    public async getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshotResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: GET_DIAGNOSTICS_SNAPSHOT_MESSAGE });
        } catch {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: DIAGNOSTICS_ERROR.UNAVAILABLE };
        }
        if (!v.is(getDiagnosticsSnapshotResponseSchema, response)) {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: DIAGNOSTICS_ERROR.UNAVAILABLE };
        }
        return response.ok
            ? { kind: CLIENT_RESULT_KIND.RESPONSE, snapshot: response.snapshot }
            : { kind: CLIENT_RESULT_KIND.ERROR, error: response.error };
    }

    /**
     * Clears stored diagnostics without throwing for expected service failures.
     *
     * @returns - A success marker, or the service error that prevented clearing.
     */
    public async clearDiagnostics(): Promise<DiagnosticsClearResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: CLEAR_DIAGNOSTICS_MESSAGE });
        } catch {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: DIAGNOSTICS_ERROR.UNAVAILABLE };
        }
        if (!v.is(clearDiagnosticsResponseSchema, response)) {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: DIAGNOSTICS_ERROR.UNAVAILABLE };
        }
        return response.ok
            ? { kind: CLIENT_RESULT_KIND.RESPONSE }
            : { kind: CLIENT_RESULT_KIND.ERROR, error: response.error };
    }
}

/**
 * Creates an options client using an injected transport or the extension runtime.
 *
 * @param transport - Optional transport for tests or embedded callers.
 * @returns - A client whose default transport rejects when the extension runtime is unavailable.
 */
export function createSitesClient(transport?: SitesTransport): SitesClient {
    if (transport) {
        return new SitesClient(transport);
    }
    if (typeof chrome !== "undefined") {
        return new SitesClient(chrome.runtime);
    }
    return new SitesClient({
        sendMessage: () => Promise.reject(new Error("Extension runtime is unavailable")),
    });
}
