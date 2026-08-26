/**
 * @file Owns loading and mutation state for the options-page site settings.
 */

import { useEffect, useState } from "react";
import type { SitesState } from "../background/application";
import type { SitesClient } from "./client";
import type { OptionsNotice } from "./options-notice";

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
     * Hostname currently being saved, when a mutation is in flight.
     */
    readonly savingHostname: string | undefined;

    /**
     * Changes whether processing is enabled for one exact hostname.
     *
     * @param hostname Exact hostname whose setting should change.
     * @param enabled Whether processing should be enabled for the hostname.
     * @returns A promise that settles after the command outcome has been applied.
     */
    changeSite(hostname: string, enabled: boolean): Promise<void>;

    /**
     * Applies authoritative site settings returned by a cross-feature command.
     *
     * @param state Validated site settings to render.
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
}

const UNAVAILABLE_SITES_STATE: SitesState = {
    availability: "unavailable",
    revision: null,
    globalEnabled: null,
    sites: [],
    failure: "settings-load",
};

/**
 * Creates the site-settings controller for the options page.
 *
 * @param options Controller dependencies and optional preloaded state.
 * @returns Current site settings together with mutation and reset commands.
 */
export function useSitesController(options: SitesControllerOptions): SitesController {
    const { client, initialState, onNoticeChange } = options;
    const [state, setState] = useState<SitesState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [savingHostname, setSavingHostname] = useState<string>();

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

    const changeSite = async (hostname: string, enabled: boolean): Promise<void> => {
        if (!state || state.availability !== "ready" || savingHostname !== undefined) {
            return;
        }
        setSavingHostname(hostname);
        onNoticeChange(undefined);
        const result = await client.setSiteEnabled(hostname, enabled);
        if (result.kind === "response") {
            const responseState = result.response.state;
            if (
                responseState.availability !== "ready" ||
                responseState.revision >= state.revision
            ) {
                setState(responseState);
            }
            if (!result.response.ok) {
                onNoticeChange(
                    result.response.error === "save-failed"
                        ? "save-failed"
                        : result.response.error === "invalid-hostname"
                            ? "invalid-hostname"
                            : "unknown",
                );
            }
        } else if (result.state) {
            if (result.state.availability !== "ready" || result.state.revision >= state.revision) {
                setState(result.state);
            }
            onNoticeChange("interrupted");
        } else {
            setState(UNAVAILABLE_SITES_STATE);
            onNoticeChange("unknown");
        }
        setSavingHostname(undefined);
    };

    return {
        state,
        loading,
        savingHostname,
        changeSite,
        applyState: setState,
        clearNotice: () => {
            onNoticeChange(undefined);
        },
        markUnavailable: () => {
            setState(UNAVAILABLE_SITES_STATE);
        },
    };
}
