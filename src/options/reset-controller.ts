/**
 * @file Coordinates the one cross-feature action that restores every option to defaults.
 */

import { useRef, useState } from "react";
import { CLIENT_RESULT_KIND } from "../shared/client-result";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import type { StateAvailability } from "../shared/messaging/view-state-values";
import type { SitesClient } from "./client";
import type { DiagnosticsController } from "./diagnostics-controller";
import type { DisplayController } from "./display-controller";
import type { SitesController } from "./sites-controller";

/**
 * User-visible outcome of resetting all settings.
 */
export type ResetNotice = "save-failed" | "ambiguous" | undefined;

/**
 * Availability state from which a reset was initiated.
 */
export type ResetOrigin = StateAvailability;

/**
 * Controllers and client used by the reset coordinator.
 */
export interface ResetControllerOptions {
    /**
     * Client used to dispatch the single reset command.
     */
    readonly client: SitesClient;

    /**
     * Site-settings controller receiving the reset projection.
     */
    readonly sites: SitesController;

    /**
     * Display-settings controller rehydrated after a successful reset.
     */
    readonly display: DisplayController;

    /**
     * Diagnostics controller rehydrated after a successful reset.
     */
    readonly diagnostics: DiagnosticsController;
}

/**
 * Reset state and command consumed by the options page.
 */
export interface ResetController {
    /**
     * Whether the reset and its follow-up reads are still in flight.
     */
    readonly resetting: boolean;

    /**
     * Latest reset failure that needs user guidance.
     */
    readonly notice: ResetNotice;

    /**
     * Availability state from which the latest reset was initiated.
     */
    readonly origin: ResetOrigin;

    /**
     * Restores all persisted settings to their defaults with one mutation dispatch.
     *
     * @returns A promise that settles after reset projections have been rehydrated.
     */
    reset(): Promise<void>;
}

/**
 * Creates the reset coordinator for all options-page feature controllers.
 *
 * @param options Client and feature controllers affected by a full reset.
 * @returns Current reset state together with the reset command.
 */
export function useResetController(options: ResetControllerOptions): ResetController {
    const { client, sites, display, diagnostics } = options;
    const [resetting, setResetting] = useState(false);
    const [notice, setNotice] = useState<ResetNotice>();
    const [origin, setOrigin] = useState<ResetOrigin>(
        sites.state?.availability ?? STATE_AVAILABILITY.UNAVAILABLE,
    );
    const inFlight = useRef(false);

    const reset = async (): Promise<void> => {
        if (!sites.state || resetting || inFlight.current) {
            return;
        }
        const nextOrigin = sites.state.availability;
        setOrigin(nextOrigin);
        inFlight.current = true;
        setResetting(true);
        setNotice(undefined);
        const result = await client.resetAllSettings();
        if (result.kind === CLIENT_RESULT_KIND.RESPONSE) {
            if (result.response.ok) {
                sites.applyState(result.response.state);
                sites.clearNotice();
                display.beginReset();
                diagnostics.beginReset();
                await display.reloadAfterReset();
                await diagnostics.reloadAfterReset();
            } else {
                if (nextOrigin === STATE_AVAILABILITY.UNAVAILABLE) {
                    sites.applyState(result.response.state);
                }
                setNotice(
                    result.response.error === "save-failed" ? "save-failed" : "ambiguous",
                );
            }
        } else {
            // Do not retry: the reset may already have been committed before the
            // response was lost or rejected by the guard.
            if (nextOrigin === STATE_AVAILABILITY.UNAVAILABLE) {
                sites.markUnavailable();
            }
            setNotice("ambiguous");
        }
        inFlight.current = false;
        setResetting(false);
    };

    return { resetting, notice, origin, reset };
}
