/**
 * @file Owns loading and mutation state for the options-page site settings.
 */

import { useCallback, useEffect, useState } from "react";
import {
    SETTINGS_STATE_FAILURE,
    STATE_AVAILABILITY,
} from "../shared/messaging/view-state-values";
import type { SitesState } from "../shared/messaging/view-state-schemas";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import { SITE_SCOPE_MODE, type SiteScopeMode } from "../shared/settings/site-scope";
import type { SitesClient } from "./client";
import type { OptionsNotice } from "./options-notice";

/**
 * Busy marker used while the scope mode is being saved. It can never collide with
 * a hostname because a canonical hostname contains no `#`.
 */
export const SCOPE_BUSY_KEY = "#scope-mode" as const;

/**
 * Busy marker used while global activation is being saved.
 */
export const GLOBAL_BUSY_KEY = "#global" as const;

/**
 * Dependencies and optional initial state for site settings.
 */
export interface SitesControllerOptions {
    /**
     * Client used to load and mutate site settings.
     */
    readonly client: SitesClient;

    /**
     * Preloaded site settings that avoid the initial request.
     */
    readonly initialState: SitesState | undefined;

    /**
     * Replaces the shared site or Debug logs mutation notice.
     */
    readonly onNoticeChange: (notice: OptionsNotice) => void;
}

/**
 * Site-settings state and commands consumed by the options view and reset coordinator.
 */
export interface SitesController {
    /**
     * Current validated site settings, once loading has completed.
     */
    readonly state: SitesState | undefined;

    /**
     * Whether the first site-settings read is still pending.
     */
    readonly loading: boolean;

    /**
     * Hostname, scope, or global marker currently being saved, when a mutation is in flight.
     */
    readonly busy: string | undefined;

    /**
     * Hostnames in the list the active scope mode owns.
     */
    readonly activeHostnames: readonly string[];

    /**
     * Changes global activation and rereads this surface's projection.
     *
     * @param enabled - Requested global activation state.
     * @returns - A promise that settles after the outcome has been applied.
     */
    changeGlobal(enabled: boolean): Promise<void>;

    /**
     * Changes the active scope mode without touching either hostname list.
     *
     * @param mode - Requested scope mode.
     * @returns - A promise that settles after the outcome has been applied.
     */
    changeScopeMode(mode: SiteScopeMode): Promise<void>;

    /**
     * Changes whether processing applies to one exact hostname under the active mode.
     *
     * @param hostname - Canonical hostname whose processing state changes.
     * @param enabled - Whether processing should apply to the hostname.
     * @returns - A promise that settles after the outcome has been applied.
     */
    changeSiteProcessing(hostname: string, enabled: boolean): Promise<void>;

    /**
     * Applies authoritative site settings returned by a cross-feature command.
     *
     * @param state - Validated site settings to render.
     */
    applyState(state: SitesState): void;

    /**
     * Removes any site-settings notice after another command resolves it.
     */
    clearNotice(): void;

    /**
     * Replaces site controls with the fail-closed unavailable projection.
     */
    markUnavailable(): void;

    /**
     * Rereads the authoritative projection after another surface changed settings.
     *
     * @returns - A promise that settles after the fresh projection has been applied.
     */
    reload(): Promise<void>;
}

const UNAVAILABLE_SITES_STATE: SitesState = {
    availability: STATE_AVAILABILITY.UNAVAILABLE,
    revision: null,
    globalEnabled: null,
    scopeMode: null,
    excludedSites: [],
    allowedSites: [],
    failure: SETTINGS_STATE_FAILURE.SETTINGS_LOAD,
};

/**
 * Selects the hostname list the active scope mode owns.
 *
 * @param state - Current sites projection.
 * @returns - Active hostnames, or an empty list while settings are unavailable.
 */
function activeHostnamesOf(state: SitesState | undefined): readonly string[] {
    if (!state || state.availability !== STATE_AVAILABILITY.READY) {
        return [];
    }
    return state.scopeMode === SITE_SCOPE_MODE.SELECTED_ONLY
        ? state.allowedSites
        : state.excludedSites;
}

/**
 * Creates the site-settings controller for the options page.
 *
 * @param options - Controller dependencies and optional preloaded state.
 * @returns - Current site settings together with mutation and reset commands.
 */
export function useSitesController(options: SitesControllerOptions): SitesController {
    const { client, initialState, onNoticeChange } = options;
    const [state, setState] = useState<SitesState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [busy, setBusy] = useState<string>();

    useEffect(() => {
        if (initialState) {
            return;
        }
        let mounted = true;
        void client
            .getState()
            .then((next) => {
                if (!mounted) {
                    return;
                }
                setState(next);
                setLoading(false);
            })
            .catch(() => {
                if (!mounted) {
                    return;
                }
                setState(UNAVAILABLE_SITES_STATE);
                setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [client, initialState]);

    const reload = useCallback(async (): Promise<void> => {
        try {
            setState(await client.getState());
        } catch {
            setState(UNAVAILABLE_SITES_STATE);
        }
    }, [client]);

    const applySites = (next: SitesState, outcome: OptionsNotice): void => {
        if (
            next.availability !== STATE_AVAILABILITY.READY
            || state?.availability !== STATE_AVAILABILITY.READY
            || next.revision >= state.revision
        ) {
            setState(next);
        }
        onNoticeChange(outcome);
    };

    const changeSiteProcessing = async (hostname: string, enabled: boolean): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || busy !== undefined) {
            return;
        }
        setBusy(hostname);
        onNoticeChange(undefined);
        const result = await client.setSiteEnabled(hostname, enabled);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            applySites(
                result.response.state,
                result.response.ok
                    ? undefined
                    : result.response.error === "save-failed"
                        ? "save-failed"
                        : result.response.error === "invalid-hostname"
                            ? "invalid-hostname"
                            : "unknown",
            );
        } else if (result.state) {
            applySites(result.state, "interrupted");
        } else {
            setState(UNAVAILABLE_SITES_STATE);
            onNoticeChange("unknown");
        }
        setBusy(undefined);
    };

    const changeScopeMode = async (mode: SiteScopeMode): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || busy !== undefined) {
            return;
        }
        setBusy(SCOPE_BUSY_KEY);
        onNoticeChange(undefined);
        const result = await client.setSiteScopeMode(mode);
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            applySites(
                result.response.state,
                result.response.ok
                    ? undefined
                    : result.response.error === "save-failed" ? "save-failed" : "unknown",
            );
        } else if (result.state) {
            applySites(result.state, "interrupted");
        } else {
            setState(UNAVAILABLE_SITES_STATE);
            onNoticeChange("unknown");
        }
        setBusy(undefined);
    };

    const changeGlobal = async (enabled: boolean): Promise<void> => {
        if (!state || state.availability !== STATE_AVAILABILITY.READY || busy !== undefined) {
            return;
        }
        setBusy(GLOBAL_BUSY_KEY);
        onNoticeChange(undefined);
        const accepted = await client.setGlobalEnabled(enabled);
        await reload();
        if (!accepted) {
            onNoticeChange("save-failed");
        }
        setBusy(undefined);
    };

    return {
        state,
        loading,
        busy,
        activeHostnames: activeHostnamesOf(state),
        changeGlobal,
        changeScopeMode,
        changeSiteProcessing,
        applyState: setState,
        clearNotice: () => {
            onNoticeChange(undefined);
        },
        markUnavailable: () => {
            setState(UNAVAILABLE_SITES_STATE);
        },
        reload,
    };
}
