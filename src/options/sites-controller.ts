/**
 * @file Owns loading and mutation state for the options-page site settings.
 */

import { useCallback, useEffect, useState } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import {
    createUnavailableSitesState,
    type SitesState,
} from "../shared/messaging/view-state-schemas";
import { SITE_SCOPE_MODE, type SiteScopeMode } from "../shared/settings/site-scope";
import { settleMutation, type MutationNotice } from "../shared/ui/persistence-notice";
import type { SitesClient } from "./client";

/**
 * Named mutations the Sites section can have in flight.
 */
export const SITES_BUSY_KIND = {
    SITE: "site",
    SCOPE: "scope",
    GLOBAL: "global",
} as const;

/**
 * Mutation currently in flight on the Sites section.
 */
export type SitesBusy =
    | {
        /**
         * One hostname's processing state is being saved.
         */
        readonly kind: typeof SITES_BUSY_KIND.SITE;

        /**
         * Hostname being saved.
         */
        readonly hostname: string;
    }
    | {
        /**
         * The scope mode is being saved.
         */
        readonly kind: typeof SITES_BUSY_KIND.SCOPE;
    }
    | {
        /**
         * Global activation is being saved.
         */
        readonly kind: typeof SITES_BUSY_KIND.GLOBAL;
    }
    | undefined;

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
     * Mutation currently being saved, when one is in flight.
     */
    readonly busy: SitesBusy;

    /**
     * Latest site mutation outcome that needs user guidance.
     */
    readonly notice: MutationNotice;

    /**
     * Hostnames in the list the active scope mode owns.
     */
    readonly activeHostnames: readonly string[];

    /**
     * Changes global activation.
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
     * @returns - Whether the background confirmed the change.
     */
    changeSiteProcessing(hostname: string, enabled: boolean): Promise<boolean>;

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
    readonly reload: () => Promise<void>;
}

/**
 * Reports whether a reread projection may replace the rendered one.
 *
 * @param current - Rendered projection.
 * @param next - Reread projection.
 * @returns - Whether the reread is at least as new as the rendered projection.
 */
function isNewer(current: SitesState | undefined, next: SitesState): boolean {
    return next.availability !== STATE_AVAILABILITY.READY
        || current?.availability !== STATE_AVAILABILITY.READY
        || next.revision >= current.revision;
}

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
    const { client, initialState } = options;
    const [state, setState] = useState<SitesState | undefined>(initialState);
    const [loading, setLoading] = useState(initialState === undefined);
    const [busy, setBusy] = useState<SitesBusy>();
    const [notice, setNotice] = useState<MutationNotice>();

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
                setState(createUnavailableSitesState());
                setLoading(false);
            });
        return () => {
            mounted = false;
        };
    }, [client, initialState]);

    // A failed live reread keeps the last READY projection: one lost message
    // does not mean processing stopped, and the next announcement retries. A
    // reread older than the rendered projection is dropped for the same reason.
    const reload = useCallback(async (): Promise<void> => {
        try {
            const next = await client.getState();
            setState((current) => (isNewer(current, next) ? next : current));
        } catch {
            /* keep the current projection */
        }
    }, [client]);

    const apply = (next: SitesState | undefined, outcome: MutationNotice): void => {
        if (next === undefined) {
            setState(createUnavailableSitesState());
        } else if (isNewer(state, next)) {
            setState(next);
        }
        setNotice(outcome);
    };

    const ready = state?.availability === STATE_AVAILABILITY.READY && busy === undefined;

    const changeSiteProcessing = async (hostname: string, enabled: boolean): Promise<boolean> => {
        if (!ready) {
            return false;
        }
        setBusy({ kind: SITES_BUSY_KIND.SITE, hostname });
        setNotice(undefined);
        const settled = settleMutation(await client.setSiteEnabled(hostname, enabled));
        apply(settled.state, settled.notice);
        setBusy(undefined);
        return settled.notice === undefined;
    };

    const changeScopeMode = async (mode: SiteScopeMode): Promise<void> => {
        if (!ready) {
            return;
        }
        setBusy({ kind: SITES_BUSY_KIND.SCOPE });
        setNotice(undefined);
        const settled = settleMutation(await client.setSiteScopeMode(mode));
        apply(settled.state, settled.notice);
        setBusy(undefined);
    };

    const changeGlobal = async (enabled: boolean): Promise<void> => {
        if (!ready) {
            return;
        }
        setBusy({ kind: SITES_BUSY_KIND.GLOBAL });
        setNotice(undefined);
        const settled = settleMutation(await client.setGlobalEnabled(enabled));
        apply(settled.state, settled.notice);
        setBusy(undefined);
    };

    return {
        state,
        loading,
        busy,
        notice,
        activeHostnames: activeHostnamesOf(state),
        changeGlobal,
        changeScopeMode,
        changeSiteProcessing,
        applyState: setState,
        clearNotice: () => {
            setNotice(undefined);
        },
        markUnavailable: () => {
            setState(createUnavailableSitesState());
        },
        reload,
    };
}
