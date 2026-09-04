/**
 * @file Header control that applies the appearance choice immediately.
 */

import { NativeSelect, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { t } from "../shared/i18n/translator";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { APPEARANCE, APPEARANCES } from "../shared/settings/snapshot";
import type { DisplayController } from "./display-controller";

/**
 * Properties for the appearance control.
 */
export interface AppearanceControlProps {
    /**
     * Controller that persists the appearance.
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
            <NativeSelect
                id="appearance-select"
                label={t("appearance_label")}
                aria-label={t("appearance_label")}
                aria-busy={controller.appearanceSaving}
                className="options-select options-appearance-select"
                classNames={{ label: "nma-eyebrow" }}
                size="xs"
                value={state.appearance}
                data={[
                    { value: APPEARANCE.SYSTEM, label: t("appearance_system") },
                    { value: APPEARANCE.LIGHT, label: t("appearance_light") },
                    { value: APPEARANCE.DARK, label: t("appearance_dark") },
                ]}
                onChange={(event) => {
                    const value = event.currentTarget.value;
                    const appearance = APPEARANCES.find((option) => option === value);
                    if (appearance) {
                        void controller.changeAppearance(appearance);
                    }
                }}
            />
            {controller.appearanceFailed ? (
                <Text role="alert" size="xs" c="red">
                    {t("appearance_save_failed")}
                </Text>
            ) : null}
        </div>
    );
}
