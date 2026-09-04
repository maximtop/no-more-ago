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
 * Message mapping for every supported outcome.
 */
const RESET_NOTICE_KEYS = {
    [RESET_NOTICE.SAVE_FAILED]: {
        [STATE_AVAILABILITY.READY]: "reset_error_failed",
        [STATE_AVAILABILITY.UNAVAILABLE]: "reset_error_failed_disabled",
    },
    [RESET_NOTICE.AMBIGUOUS]: {
        [STATE_AVAILABILITY.READY]: "reset_error_unknown",
        [STATE_AVAILABILITY.UNAVAILABLE]: "reset_error_unknown_disabled",
    },
} as const satisfies Record<Exclude<ResetNotice, undefined>, Record<ResetOrigin, MessageKey>>;

/**
 * Maps a reset outcome and its starting availability to a message key.
 *
 * @param notice - Outcome reported after resetting settings.
 * @param origin - Availability state before the reset was requested.
 * @returns - Message key, or undefined when there is no notice to show.
 */
export function resetNoticeKey(notice: ResetNotice, origin: ResetOrigin): MessageKey | undefined {
    return notice === undefined ? undefined : RESET_NOTICE_KEYS[notice][origin];
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
