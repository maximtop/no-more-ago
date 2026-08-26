import {
    GET_POPUP_STATE_MESSAGE,
    SET_SITE_ENABLED_MESSAGE,
    SET_GLOBAL_ENABLED_MESSAGE,
    isSetSiteEnabledResponse,
    isPopupState,
    isSetGlobalEnabledResponse
} from "../background/messages";
import type { PopupState, SetGlobalEnabledResponse, SetSiteEnabledResponse } from "../background/application";

export interface PopupTransport {
    sendMessage(message: unknown): Promise<unknown>;
}

export type PopupSetResult =
  | { readonly kind: "response"; readonly response: SetGlobalEnabledResponse }
  | { readonly kind: "ambiguous"; readonly state?: PopupState };

export type PopupSiteSetResult =
  | { readonly kind: "response"; readonly response: Extract<SetSiteEnabledResponse, { readonly surface: "popup" }> }
  | { readonly kind: "ambiguous"; readonly state?: PopupState };

export class PopupClient {
    private readonly transport: PopupTransport;

    public constructor(transport: PopupTransport) {
        this.transport = transport;
    }

    public async getState(): Promise<PopupState> {
        const response = await this.transport.sendMessage({ type: GET_POPUP_STATE_MESSAGE });
        if (!isPopupState(response)) throw new Error("Invalid popup state response");
        return response;
    }

    public async setGlobalEnabled(enabled: boolean): Promise<PopupSetResult> {
        let response: unknown;
        try {
            response = await this.transport.sendMessage({ type: SET_GLOBAL_ENABLED_MESSAGE, enabled });
        } catch {
            return this.rereadAfterAmbiguousResponse();
        }
        if (isSetGlobalEnabledResponse(response)) return { kind: "response", response };
        return this.rereadAfterAmbiguousResponse();
    }

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

    private async rereadAfterAmbiguousResponse(): Promise<PopupSetResult> {
        try {
            const state = await this.getState();
            return { kind: "ambiguous", state };
        } catch {
            return { kind: "ambiguous" };
        }
    }

    private async rereadAfterAmbiguousSiteResponse(): Promise<PopupSiteSetResult> {
        try {
            const state = await this.getState();
            return { kind: "ambiguous", state };
        } catch {
            return { kind: "ambiguous" };
        }
    }
}

export function createPopupClient(transport?: PopupTransport): PopupClient {
    if (transport) return new PopupClient(transport);
    if (typeof chrome !== "undefined") return new PopupClient(chrome.runtime);
    return new PopupClient({ sendMessage: () => Promise.reject(new Error("Extension runtime is unavailable")) });
}
