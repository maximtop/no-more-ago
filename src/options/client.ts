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
    SET_DISPLAY_SETTINGS_MESSAGE,
    SET_DEBUG_ENABLED_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    clearDiagnosticsResponseSchema,
    getDiagnosticsSnapshotResponseSchema,
} from "../shared/messaging/contracts";
import {
    debugStateSchema,
    displayStateSchema,
    sitesStateSchema,
} from "../shared/messaging/view-state";
import {
    resetAllSettingsResponseSchema,
    setDebugEnabledResponseSchema,
    setDisplaySettingsResponseSchema,
    setSiteEnabledResponseSchema,
} from "../shared/messaging/responses";
import { SITE_SETTINGS_SURFACE } from "../shared/messaging/view-state-values";
import type {
    DebugState,
    DisplayState,
    SitesState,
} from "../shared/messaging/view-state";
import type {
    ResetAllSettingsResponse,
    SetDebugEnabledResponse,
    SetDisplaySettingsResponse,
    SetSiteEnabledResponse,
} from "../shared/messaging/responses";
import type { DisplaySettings } from "../shared/settings/snapshot";
import type {
    DiagnosticsClearError,
    DiagnosticsSnapshot,
    DiagnosticsSnapshotError,
} from "../shared/messaging/contracts";
import { CLIENT_RESULT_KIND } from "../shared/client-result";

/**
 * Sends an options-page request to the extension runtime.
 */
export interface SitesTransport {
    /**
     * Sends one options-page request and resolves with the background response.
     */
    sendMessage(message: unknown): Promise<unknown>;
}

/**
 * Result of saving display settings, including any state reread after an ambiguous response.
 */
export type DisplaySetResult =
    | {
        /**
         * Indicates that the background returned a validated command response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated result of the display-settings command.
         */
        readonly response: SetDisplaySettingsResponse;
    }
    | {
        /**
         * Indicates that command completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;

        /**
         * Display state reread after the ambiguous command, when available.
         */
        readonly state?: DisplayState;
    };

/**
 * Result of changing a site's enabled setting.
 */
export type SitesSetResult =
    | {
        /**
         * Indicates that the background returned a validated command response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated sites-surface result of the per-site command.
         */
        readonly response: Extract<
            SetSiteEnabledResponse,
            {
                /**
                 * Selects responses projected for the options-page sites surface.
                 */
                readonly surface: typeof SITE_SETTINGS_SURFACE.SITES;
            }
        >;
    }
    | {
        /**
         * Indicates that command completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;

        /**
         * Sites state reread after the ambiguous command, when available.
         */
        readonly state?: SitesState;
    };

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
 * Result of changing whether diagnostic logging is enabled.
 */
export type DebugSetResult =
    | {
        /**
         * Indicates that the background returned a validated command response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated result of changing diagnostic logging.
         */
        readonly response: SetDebugEnabledResponse;
    }
    | {
        /**
         * Indicates that command completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;

        /**
         * Debug state reread after the ambiguous command, when available.
         */
        readonly state?: DebugState;
    };

/**
 * Diagnostics snapshot or the reason it could not be read.
 */
export type DiagnosticsSnapshotResult =
    | {
        /**
         * Indicates that a validated diagnostic snapshot was returned.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated diagnostic snapshot ready for export.
         */
        readonly snapshot: DiagnosticsSnapshot;
    }
    | {
        /**
         * Indicates that no diagnostic snapshot could be returned.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.ERROR;

        /**
         * Stable reason the snapshot request failed.
         */
        readonly error: DiagnosticsSnapshotError;
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
     * @param transport Runtime transport used to send options-page requests.
     */
    public constructor(transport: SitesTransport) {
        this.transport = transport;
    }

    /**
     * Retrieves the global and per-site settings state.
     *
     * @returns The validated sites state from the background service.
     */
    public async getState(): Promise<SitesState> {
        const response = await this.transport.sendMessage({ type: GET_SITES_STATE_MESSAGE });
        if (!v.is(sitesStateSchema, response)) {
            throw new Error("Invalid Sites state response");
        }
        return response;
    }

    /**
     * Recovery is deliberately a single-dispatch operation.  A lost or
     * malformed response may follow a committed storage write, so retrying the
     * mutation here could apply it twice.
     *
     * @returns A confirmed reset response, or an ambiguous outcome after a lost response.
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
     * @param hostname Exact hostname whose setting should change.
     * @param enabled Whether processing should be enabled for the hostname.
     * @returns The confirmed response, or a state reread after an ambiguous response.
     */
    public async setSiteEnabled(hostname: string, enabled: boolean): Promise<SitesSetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({
                type: SET_SITE_ENABLED_MESSAGE,
                hostname,
                enabled,
                surface: SITE_SETTINGS_SURFACE.SITES,
            });
        } catch {
            return this.rereadAfterAmbiguousResponse();
        }
        if (
            v.is(setSiteEnabledResponseSchema, response)
            && response.surface === SITE_SETTINGS_SURFACE.SITES
        ) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response };
        }
        return this.rereadAfterAmbiguousResponse();
    }

    /**
     * Retrieves the saved display-format settings.
     *
     * @returns The validated display state from the background service.
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
     * @returns The validated debug state from the background service.
     */
    public async getDebugState(): Promise<DebugState> {
        const response = await this.transport.sendMessage({ type: GET_DEBUG_STATE_MESSAGE });
        if (!v.is(debugStateSchema, response)) {
            throw new Error("Invalid Debug state response");
        }
        return response;
    }

    /**
     * Toggle is dispatched once; a lost response is surfaced with an authoritative reread.
     *
     * @param enabled Whether diagnostic logging should be enabled.
     * @returns The confirmed response, or a state reread after an ambiguous response.
     */
    public async setDebugEnabled(enabled: boolean): Promise<DebugSetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({
                type: SET_DEBUG_ENABLED_MESSAGE,
                enabled,
            });
        } catch {
            return this.rereadDebugAfterAmbiguousResponse();
        }
        if (v.is(setDebugEnabledResponseSchema, response)) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response };
        }
        return this.rereadDebugAfterAmbiguousResponse();
    }

    /**
     * Retrieves diagnostics without throwing for expected service failures.
     *
     * @returns A snapshot, or the service error that prevented it from being read.
     */
    public async getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshotResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: GET_DIAGNOSTICS_SNAPSHOT_MESSAGE });
        } catch {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: "unavailable" };
        }
        if (!v.is(getDiagnosticsSnapshotResponseSchema, response)) {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: "unavailable" };
        }
        return response.ok
            ? { kind: CLIENT_RESULT_KIND.RESPONSE, snapshot: response.snapshot }
            : { kind: CLIENT_RESULT_KIND.ERROR, error: response.error };
    }

    /**
     * Clears stored diagnostics without throwing for expected service failures.
     *
     * @returns A success marker, or the service error that prevented clearing.
     */
    public async clearDiagnostics(): Promise<DiagnosticsClearResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: CLEAR_DIAGNOSTICS_MESSAGE });
        } catch {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: "unavailable" };
        }
        if (!v.is(clearDiagnosticsResponseSchema, response)) {
            return { kind: CLIENT_RESULT_KIND.ERROR, error: "unavailable" };
        }
        return response.ok
            ? { kind: CLIENT_RESULT_KIND.RESPONSE }
            : { kind: CLIENT_RESULT_KIND.ERROR, error: response.error };
    }

    /**
     * Saves display-format settings and rereads state if the response is ambiguous.
     *
     * @param display Display settings to persist.
     * @returns The confirmed response, or a state reread after an ambiguous response.
     */
    public async setDisplaySettings(display: DisplaySettings): Promise<DisplaySetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({
                type: SET_DISPLAY_SETTINGS_MESSAGE,
                display,
            });
        } catch {
            return this.rereadDisplayAfterAmbiguousResponse();
        }
        const parsed = v.safeParse(setDisplaySettingsResponseSchema, response);
        if (parsed.success) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response: parsed.output };
        }
        return this.rereadDisplayAfterAmbiguousResponse();
    }

    /**
     * Reads sites state after a mutation response is lost or malformed.
     *
     * @returns An ambiguous result with current state when the reread succeeds.
     */
    private async rereadAfterAmbiguousResponse(): Promise<SitesSetResult> {
        try {
            const state = await this.getState();
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS, state };
        } catch {
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
        }
    }

    /**
     * Reads display state after a save response is lost or malformed.
     *
     * @returns An ambiguous result with current state when the reread succeeds.
     */
    private async rereadDisplayAfterAmbiguousResponse(): Promise<DisplaySetResult> {
        try {
            const state = await this.getDisplayState();
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS, state };
        } catch {
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
        }
    }

    /**
     * Reads debug state after a save response is lost or malformed.
     *
     * @returns An ambiguous result with current state when the reread succeeds.
     */
    private async rereadDebugAfterAmbiguousResponse(): Promise<DebugSetResult> {
        try {
            return {
                kind: CLIENT_RESULT_KIND.AMBIGUOUS,
                state: await this.getDebugState(),
            };
        } catch {
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
        }
    }
}

/**
 * Creates an options client using an injected transport or the extension runtime.
 *
 * @param transport Optional transport for tests or embedded callers.
 * @returns A client whose default transport rejects when the extension runtime is unavailable.
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
