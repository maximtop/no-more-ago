/**
 * Provides the options page with typed background-message requests.
 *
 * @file Typed client for options-page requests and background responses.
 */

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
    isDisplayState,
    isDebugState,
    isSetDebugEnabledResponse,
    isGetDiagnosticsSnapshotResponse,
    isClearDiagnosticsResponse,
    isSetDisplaySettingsResponse,
    isSetSiteEnabledResponse,
    isSitesState,
    isResetAllSettingsResponse
} from "../background/messages";
import type { DebugState, DisplaySettings, DisplayState, ResetAllSettingsResponse, SetDebugEnabledResponse, SetDisplaySettingsResponse, SetSiteEnabledResponse, SitesState } from "../background/application";
import type { DiagnosticsSnapshot } from "../background/messages";

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
  | { readonly kind: "response"; readonly response: SetDisplaySettingsResponse }
  | { readonly kind: "ambiguous"; readonly state?: DisplayState };

/**
 * Result of changing a site's enabled setting.
 */
export type SitesSetResult =
  | { readonly kind: "response"; readonly response: Extract<SetSiteEnabledResponse, { readonly surface: "sites" }> }
  | { readonly kind: "ambiguous"; readonly state?: SitesState };

/**
 * Result of resetting all persisted settings.
 */
export type SitesResetResult =
  | { readonly kind: "response"; readonly response: ResetAllSettingsResponse }
  | { readonly kind: "ambiguous" };

/**
 * Result of changing whether diagnostic logging is enabled.
 */
export type DebugSetResult =
  | { readonly kind: "response"; readonly response: SetDebugEnabledResponse }
  | { readonly kind: "ambiguous"; readonly state?: DebugState };

/**
 * Diagnostics snapshot or the reason it could not be read.
 */
export type DiagnosticsSnapshotResult =
  | { readonly kind: "response"; readonly snapshot: DiagnosticsSnapshot }
  | { readonly kind: "error"; readonly error: "disabled" | "unavailable" | "empty" | "invalid-journal" | "storage-failed" };

/**
 * Result of removing stored diagnostic entries.
 */
export type DiagnosticsClearResult =
  | { readonly kind: "response" }
  | { readonly kind: "error"; readonly error: "disabled" | "unavailable" | "storage-failed" };

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
        if (!isSitesState(response)) {
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
            return { kind: "ambiguous" };
        }
        return isResetAllSettingsResponse(response)
            ? { kind: "response", response }
            : { kind: "ambiguous" };
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
                surface: "sites"
            });
        } catch {
            return this.rereadAfterAmbiguousResponse();
        }
        if (isSetSiteEnabledResponse(response) && response.surface === "sites") {
            return { kind: "response", response };
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
        if (!isDisplayState(response)) {
            throw new Error("Invalid Display state response");
        }
        return response;
    }

    /**
     * Retrieves whether diagnostic logging is enabled.
     *
     * @returns The validated debug state from the background service.
     */
    public async getDebugState(): Promise<DebugState> {
        const response = await this.transport.sendMessage({ type: GET_DEBUG_STATE_MESSAGE });
        if (!isDebugState(response)) {
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
            response = await this.transport.sendMessage({ type: SET_DEBUG_ENABLED_MESSAGE, enabled });
        } catch {
            return this.rereadDebugAfterAmbiguousResponse();
        }
        if (isSetDebugEnabledResponse(response)) {
            return { kind: "response", response };
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
            return { kind: "error", error: "unavailable" };
        }
        if (!isGetDiagnosticsSnapshotResponse(response)) {
            return { kind: "error", error: "unavailable" };
        }
        return response.ok ? { kind: "response", snapshot: response.snapshot } : { kind: "error", error: response.error };
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
            return { kind: "error", error: "unavailable" };
        }
        if (!isClearDiagnosticsResponse(response)) {
            return { kind: "error", error: "unavailable" };
        }
        return response.ok ? { kind: "response" } : { kind: "error", error: response.error };
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
                display
            });
        } catch {
            return this.rereadDisplayAfterAmbiguousResponse();
        }
        if (isSetDisplaySettingsResponse(response)) {
            return { kind: "response", response };
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
            return { kind: "ambiguous", state };
        } catch {
            return { kind: "ambiguous" };
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
            return { kind: "ambiguous", state };
        } catch {
            return { kind: "ambiguous" };
        }
    }

    /**
     * Reads debug state after a save response is lost or malformed.
     *
     * @returns An ambiguous result with current state when the reread succeeds.
     */
    private async rereadDebugAfterAmbiguousResponse(): Promise<DebugSetResult> {
        try {
            return { kind: "ambiguous", state: await this.getDebugState() };
        } catch {
            return { kind: "ambiguous" };
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
    return new SitesClient({ sendMessage: () => Promise.reject(new Error("Extension runtime is unavailable")) });
}
