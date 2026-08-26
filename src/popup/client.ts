/**
 * Provides the popup with typed background-message requests.
 *
 * @file Typed client for popup requests and ambiguous-response recovery.
 */

import {
    GET_POPUP_STATE_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    isSetSiteEnabledResponse,
    isPopupState,
    isSetGlobalEnabledResponse
} from "../background/messages";
import type { PopupState, SetGlobalEnabledResponse, SetSiteEnabledResponse } from "../background/application";

/**
 * Sends a popup request to the extension runtime.
 */
export interface PopupTransport {
    /**
     * Sends one popup request and resolves with the background response.
     */
    sendMessage(message: unknown): Promise<unknown>;
}

/**
 * Result of changing the global enabled setting.
 */
export type PopupSetResult =
  | { readonly kind: "response"; readonly response: SetGlobalEnabledResponse }
  | { readonly kind: "ambiguous"; readonly state?: PopupState };

/**
 * Result of changing the current site's enabled setting.
 */
export type PopupSiteSetResult =
  | { readonly kind: "response"; readonly response: Extract<SetSiteEnabledResponse, { readonly surface: "popup" }> }
  | { readonly kind: "ambiguous"; readonly state?: PopupState };

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
     * @param transport Runtime transport used to send popup requests.
     */
    public constructor(transport: PopupTransport) {
        this.transport = transport;
    }

    /**
     * Retrieves the popup state for the active tab.
     *
     * @returns The validated popup state from the background service.
     */
    public async getState(): Promise<PopupState> {
        const response = await this.transport.sendMessage({ type: GET_POPUP_STATE_MESSAGE });
        if (!isPopupState(response)) {
            throw new Error("Invalid popup state response");
        }
        return response;
    }

    /**
     * Changes the global enabled setting once, then rereads state if the response is ambiguous.
     *
     * @param enabled Whether the extension should process supported pages.
     * @returns The confirmed response, or a state reread after an ambiguous response.
     */
    public async setGlobalEnabled(enabled: boolean): Promise<PopupSetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: SET_GLOBAL_ENABLED_MESSAGE, enabled });
        } catch {
            return this.rereadAfterAmbiguousResponse();
        }
        if (isSetGlobalEnabledResponse(response)) {
            return { kind: "response", response };
        }
        return this.rereadAfterAmbiguousResponse();
    }

    /**
     * Changes whether processing is enabled for the current hostname.
     *
     * @param hostname Exact hostname whose setting should change.
     * @param enabled Whether processing should be enabled for the hostname.
     * @returns The confirmed response, or a state reread after an ambiguous response.
     */
    public async setSiteEnabled(hostname: string, enabled: boolean): Promise<PopupSiteSetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({
                type: SET_SITE_ENABLED_MESSAGE,
                hostname,
                enabled,
                surface: "popup"
            });
        } catch {
            return this.rereadAfterAmbiguousSiteResponse();
        }
        if (isSetSiteEnabledResponse(response) && response.surface === "popup") {
            return { kind: "response", response };
        }
        return this.rereadAfterAmbiguousSiteResponse();
    }

    /**
     * Reads popup state after a global-setting response is lost or malformed.
     *
     * @returns An ambiguous result with current state when the reread succeeds.
     */
    private async rereadAfterAmbiguousResponse(): Promise<PopupSetResult> {
        try {
            const state = await this.getState();
            return { kind: "ambiguous", state };
        } catch {
            return { kind: "ambiguous" };
        }
    }

    /**
     * Reads popup state after a site-setting response is lost or malformed.
     *
     * @returns An ambiguous result with current state when the reread succeeds.
     */
    private async rereadAfterAmbiguousSiteResponse(): Promise<PopupSiteSetResult> {
        try {
            const state = await this.getState();
            return { kind: "ambiguous", state };
        } catch {
            return { kind: "ambiguous" };
        }
    }
}

/**
 * Creates a popup client using an injected transport or the extension runtime.
 *
 * @param transport Optional transport for tests or embedded callers.
 * @returns A client whose default transport rejects when the extension runtime is unavailable.
 */
export function createPopupClient(transport?: PopupTransport): PopupClient {
    if (transport) {
        return new PopupClient(transport);
    }
    if (typeof chrome !== "undefined") {
        return new PopupClient(chrome.runtime);
    }
    return new PopupClient({ sendMessage: () => Promise.reject(new Error("Extension runtime is unavailable")) });
}
