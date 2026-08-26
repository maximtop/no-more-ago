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

export interface SitesTransport {
  sendMessage(message: unknown): Promise<unknown>;
}

export type DisplaySetResult =
  | { readonly kind: "response"; readonly response: SetDisplaySettingsResponse }
  | { readonly kind: "ambiguous"; readonly state?: DisplayState };

export type SitesSetResult =
  | { readonly kind: "response"; readonly response: Extract<SetSiteEnabledResponse, { readonly surface: "sites" }> }
  | { readonly kind: "ambiguous"; readonly state?: SitesState };

export type SitesResetResult =
  | { readonly kind: "response"; readonly response: ResetAllSettingsResponse }
  | { readonly kind: "ambiguous" };

export type DebugSetResult =
  | { readonly kind: "response"; readonly response: SetDebugEnabledResponse }
  | { readonly kind: "ambiguous"; readonly state?: DebugState };

export type DiagnosticsSnapshotResult =
  | { readonly kind: "response"; readonly snapshot: DiagnosticsSnapshot }
  | { readonly kind: "error"; readonly error: "disabled" | "unavailable" | "empty" | "invalid-journal" | "storage-failed" };

export type DiagnosticsClearResult =
  | { readonly kind: "response" }
  | { readonly kind: "error"; readonly error: "disabled" | "unavailable" | "storage-failed" };

export class SitesClient {
  private readonly transport: SitesTransport;

  public constructor(transport: SitesTransport) {
    this.transport = transport;
  }

  public async getState(): Promise<SitesState> {
    const response = await this.transport.sendMessage({ type: GET_SITES_STATE_MESSAGE });
    if (!isSitesState(response)) throw new Error("Invalid Sites state response");
    return response;
  }

  /**
   * Recovery is deliberately a single-dispatch operation.  A lost or
   * malformed response may follow a committed storage write, so retrying the
   * mutation here could apply it twice.
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

  public async getDisplayState(): Promise<DisplayState> {
    const response = await this.transport.sendMessage({ type: GET_DISPLAY_STATE_MESSAGE });
    if (!isDisplayState(response)) throw new Error("Invalid Display state response");
    return response;
  }

  public async getDebugState(): Promise<DebugState> {
    const response = await this.transport.sendMessage({ type: GET_DEBUG_STATE_MESSAGE });
    if (!isDebugState(response)) throw new Error("Invalid Debug state response");
    return response;
  }

  /** Toggle is dispatched once; a lost response is surfaced with an authoritative reread. */
  public async setDebugEnabled(enabled: boolean): Promise<DebugSetResult> {
    let response: unknown;
    try {
      response = await this.transport.sendMessage({ type: SET_DEBUG_ENABLED_MESSAGE, enabled });
    } catch {
      return this.rereadDebugAfterAmbiguousResponse();
    }
    if (isSetDebugEnabledResponse(response)) return { kind: "response", response };
    return this.rereadDebugAfterAmbiguousResponse();
  }

  public async getDiagnosticsSnapshot(): Promise<DiagnosticsSnapshotResult> {
    let response: unknown;
    try { response = await this.transport.sendMessage({ type: GET_DIAGNOSTICS_SNAPSHOT_MESSAGE }); }
    catch { return { kind: "error", error: "unavailable" }; }
    if (!isGetDiagnosticsSnapshotResponse(response)) return { kind: "error", error: "unavailable" };
    return response.ok ? { kind: "response", snapshot: response.snapshot } : { kind: "error", error: response.error };
  }

  public async clearDiagnostics(): Promise<DiagnosticsClearResult> {
    let response: unknown;
    try { response = await this.transport.sendMessage({ type: CLEAR_DIAGNOSTICS_MESSAGE }); }
    catch { return { kind: "error", error: "unavailable" }; }
    if (!isClearDiagnosticsResponse(response)) return { kind: "error", error: "unavailable" };
    return response.ok ? { kind: "response" } : { kind: "error", error: response.error };
  }

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
    if (isSetDisplaySettingsResponse(response)) return { kind: "response", response };
    return this.rereadDisplayAfterAmbiguousResponse();
  }

  private async rereadAfterAmbiguousResponse(): Promise<SitesSetResult> {
    try {
      const state = await this.getState();
      return { kind: "ambiguous", state };
    } catch {
      return { kind: "ambiguous" };
    }
  }

  private async rereadDisplayAfterAmbiguousResponse(): Promise<DisplaySetResult> {
    try {
      const state = await this.getDisplayState();
      return { kind: "ambiguous", state };
    } catch {
      return { kind: "ambiguous" };
    }
  }

  private async rereadDebugAfterAmbiguousResponse(): Promise<DebugSetResult> {
    try { return { kind: "ambiguous", state: await this.getDebugState() }; }
    catch { return { kind: "ambiguous" }; }
  }
}

export function createSitesClient(transport?: SitesTransport): SitesClient {
  if (transport) return new SitesClient(transport);
  if (typeof chrome !== "undefined") return new SitesClient(chrome.runtime);
  return new SitesClient({ sendMessage: () => Promise.reject(new Error("Extension runtime is unavailable")) });
}
