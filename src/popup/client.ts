/**
 * Provides the popup with typed background-message requests.
 *
 * @file Typed client for popup requests and ambiguous-response recovery.
 */

import * as v from "valibot";
import {
    GET_POPUP_STATE_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    popupStateSchema,
    setGlobalEnabledResponseSchema,
    setSiteEnabledResponseSchema,
} from "../background/messages";
import type {
    PopupState,
    SetGlobalEnabledResponse,
    SetSiteEnabledResponse,
} from "../background/application";
import { CLIENT_RESULT_KIND } from "../core/client-result";
import { SITE_SETTINGS_SURFACE } from "../background/view-state-values";

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
    | {
        /**
         * Indicates that the background returned a validated command response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated result of changing global activation.
         */
        readonly response: SetGlobalEnabledResponse;
    }
    | {
        /**
         * Indicates that command completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;

        /**
         * Popup state reread after the ambiguous command, when available.
         */
        readonly state?: PopupState;
    };

/**
 * Result of changing the current site's enabled setting.
 */
export type PopupSiteSetResult =
    | {
        /**
         * Indicates that the background returned a validated command response.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.RESPONSE;

        /**
         * Validated popup-surface result of the per-site command.
         */
        readonly response: Extract<
            SetSiteEnabledResponse,
            {
                /**
                 * Selects responses projected for the popup surface.
                 */
                readonly surface: typeof SITE_SETTINGS_SURFACE.POPUP;
            }
        >;
    }
    | {
        /**
         * Indicates that command completion could not be determined directly.
         */
        readonly kind: typeof CLIENT_RESULT_KIND.AMBIGUOUS;

        /**
         * Popup state reread after the ambiguous command, when available.
         */
        readonly state?: PopupState;
    };

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
        if (!v.is(popupStateSchema, response)) {
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
            response = await this.transport.sendMessage({
                type: SET_GLOBAL_ENABLED_MESSAGE,
                enabled,
            });
        } catch {
            return this.rereadAfterAmbiguousResponse();
        }
        if (v.is(setGlobalEnabledResponseSchema, response)) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response };
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
                surface: SITE_SETTINGS_SURFACE.POPUP,
            });
        } catch {
            return this.rereadAfterAmbiguousSiteResponse();
        }
        if (
            v.is(setSiteEnabledResponseSchema, response)
            && response.surface === SITE_SETTINGS_SURFACE.POPUP
        ) {
            return { kind: CLIENT_RESULT_KIND.RESPONSE, response };
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
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS, state };
        } catch {
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
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
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS, state };
        } catch {
            return { kind: CLIENT_RESULT_KIND.AMBIGUOUS };
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
    return new PopupClient({
        sendMessage: () => Promise.reject(new Error("Extension runtime is unavailable")),
    });
}
