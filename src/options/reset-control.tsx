/**
 * @file Renders the full settings reset action and its failure guidance.
 */

import { Alert, Button } from "@mantine/core";
import type { ReactElement } from "react";
import type { ResetController, ResetNotice, ResetOrigin } from "./reset-controller";

/**
 * Properties for the full settings reset control.
 */
export interface ResetControlProps {
    /**
     * State and command owned by the reset coordinator.
     */
    readonly controller: ResetController;
}

/**
 * Maps a reset outcome and its starting availability to an error message.
 *
 * @param notice Outcome reported after resetting settings.
 * @param origin Availability state before the reset was requested.
 * @returns An error message, or undefined when there is no notice to show.
 */
function resetNoticeText(notice: ResetNotice, origin: ResetOrigin): string | undefined {
    if (origin === "ready" && notice === "save-failed") {
        return "Could not reset settings. Your current settings remain active. Try again.";
    }
    if (origin === "ready" && notice === "ambiguous") {
        return "Could not confirm whether settings were reset. Reopen Settings to check their "
            + "current state.";
    }
    if (notice === "save-failed") {
        return "Could not reset settings. Processing remains disabled. Try again.";
    }
    if (notice === "ambiguous") {
        return "The reset response could not be confirmed. Processing remains disabled. Try again.";
    }
    return undefined;
}

/**
 * Renders the action that restores every setting to its default.
 *
 * @param props Component properties.
 * @param props.controller State and command for resetting settings.
 * @returns The reset action and any current failure guidance.
 */
export function ResetControl({ controller }: ResetControlProps): ReactElement {
    return (
        <>
            <Button
                type="button"
                onClick={() => {
                    void controller.reset();
                }}
                loading={controller.resetting}
                disabled={controller.resetting}
            >
                Reset all settings
            </Button>
            {controller.notice ? (
                <Alert role="alert" color="red">
                    {resetNoticeText(controller.notice, controller.origin)}
                </Alert>
            ) : null}
        </>
    );
}
