/**
 * @file Header control that applies the appearance choice immediately.
 */

import { Text } from "@mantine/core";
import type { ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { APPEARANCE, APPEARANCES } from "../shared/settings/snapshot";
import type { DisplayController } from "./display-controller";

/**
 * Properties for the appearance control.
 */
export interface AppearanceControlProps {
    /**
     * Controller that persists the appearance beside the display settings.
     */
    readonly controller: DisplayController;
}

/**
 * Renders the System, Light, and Dark choice that both surfaces follow.
 *
 * @param props - Component properties.
 * @param props.controller - Display controller owning the persisted appearance.
 * @returns - The appearance control, or nothing while settings are unavailable.
 */
export function AppearanceControl({ controller }: AppearanceControlProps): ReactElement | null {
    const { state } = controller;
    if (!state || state.availability !== STATE_AVAILABILITY.READY) {
        return null;
    }
    return (
        <div className="options-appearance">
            <label className="nma-eyebrow" htmlFor="appearance-select">
                Appearance
            </label>
            <select
                id="appearance-select"
                className="options-appearance-select"
                aria-label="Appearance"
                aria-busy={controller.appearanceSaving}
                value={state.appearance}
                onChange={(event) => {
                    const value = event.currentTarget.value;
                    const appearance = APPEARANCES.find((option) => option === value);
                    if (appearance) {
                        void controller.changeAppearance(appearance);
                    }
                }}
            >
                <option value={APPEARANCE.SYSTEM}>System</option>
                <option value={APPEARANCE.LIGHT}>Light</option>
                <option value={APPEARANCE.DARK}>Dark</option>
            </select>
            {controller.appearanceFailed ? (
                <Text role="alert" size="xs" c="red">
                    Could not save the appearance. Try again.
                </Text>
            ) : null}
        </div>
    );
}
