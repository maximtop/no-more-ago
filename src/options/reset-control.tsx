/**
 * @file Renders the full settings reset action and its failure guidance.
 */

import { Alert, Box, Stack, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import { t, type MessageKey } from "../shared/i18n/translator";
import { STATE_AVAILABILITY } from "../shared/messaging/view-state-values";
import { ResetConfirmation } from "../shared/ui/reset-confirmation";
import {
    RESET_NOTICE,
    type ResetController,
    type ResetNotice,
    type ResetOrigin,
} from "./reset-controller";

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
 * Maps a reset outcome and its starting availability to a message key.
 *
 * @param notice - Outcome reported after resetting settings.
 * @param origin - Availability state before the reset was requested.
 * @returns - Message key, or undefined when there is no notice to show.
 */
export function resetNoticeKey(notice: ResetNotice, origin: ResetOrigin): MessageKey | undefined {
    if (origin === STATE_AVAILABILITY.READY && notice === RESET_NOTICE.SAVE_FAILED) {
        return "reset_error_failed";
    }
    if (origin === STATE_AVAILABILITY.READY && notice === RESET_NOTICE.AMBIGUOUS) {
        return "reset_error_unknown";
    }
    if (notice === RESET_NOTICE.SAVE_FAILED) {
        return "reset_error_failed_disabled";
    }
    if (notice === RESET_NOTICE.AMBIGUOUS) {
        return "reset_error_unknown_disabled";
    }
    return undefined;
}

/**
 * Renders the action that restores every setting to its default.
 *
 * @param props - Component properties.
 * @param props.controller - State and command for resetting settings.
 * @returns - The reset action and any current failure guidance.
 */
export function ResetControl({ controller }: ResetControlProps): ReactElement {
    const noticeKey = resetNoticeKey(controller.notice, controller.origin);
    return (
        <Stack gap="lg" component="section" aria-labelledby="reset-heading">
            <Box>
                <Title order={2} id="reset-heading">
                    {t("reset_heading")}
                </Title>
                <Text size="sm" c="dimmed">
                    {t("reset_intro")}
                </Text>
            </Box>
            <ResetConfirmation
                resetting={controller.resetting}
                onConfirm={() => {
                    void controller.reset();
                }}
            />
            {noticeKey ? (
                <Alert role="alert" color="red">
                    {t(noticeKey)}
                </Alert>
            ) : null}
        </Stack>
    );
}
