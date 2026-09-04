/**
 * @file Settings recovery view shown when settings cannot be read.
 */

import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import type { SettingsStateFailure } from "../shared/messaging/view-state-values";
import { isDiagnosticsSuccessNotice } from "../shared/diagnostics/download";
import { unavailableSettingsKeys } from "../shared/ui/copy";
import { t, type MessageKey } from "../shared/i18n/translator";
import type { DiagnosticsController } from "./diagnostics-controller";
import { ResetConfirmation } from "../shared/ui/reset-confirmation";
import type { ResetController } from "./reset-controller";

/**
 * Controllers backing the recovery actions.
 */
export interface OptionsUnavailablePanelProps {
    /**
     * Failure carried by the unavailable projection.
     */
    readonly failure: SettingsStateFailure;

    /**
     * Diagnostics controller providing the report and archive actions.
     */
    readonly diagnostics: DiagnosticsController;

    /**
     * Reset coordinator providing the recovery action.
     */
    readonly reset: ResetController;

    /**
     * Failure guidance produced by the latest reset attempt, when any.
     */
    readonly resetNotice: MessageKey | undefined;
}

/**
 * Renders the failure explanation and its recovery actions.
 *
 * @param props - Component properties.
 * @param props.failure - Failure carried by the unavailable projection.
 * @param props.diagnostics - Diagnostics controller.
 * @param props.reset - Reset coordinator.
 * @param props.resetNotice - Key of the failure guidance from the latest reset attempt.
 * @returns - The settings recovery view.
 */
export function OptionsUnavailablePanel({
    failure,
    diagnostics,
    reset,
    resetNotice,
}: OptionsUnavailablePanelProps): ReactElement {
    const keys = unavailableSettingsKeys(failure);
    const { diagnosticsNotice } = diagnostics;
    return (
        <Stack gap="md" className="options-content options-unavailable" component="section">
            <Title order={2}>{t("popup_status_unavailable")}</Title>
            <Text role="status">{t(keys.status)}</Text>
            <Text size="sm" c="dimmed">
                {t(keys.consequence)} {t("unavailable_recovery_hint_options")}
            </Text>
            <Group>
                <Button
                    type="button"
                    variant="default"
                    loading={diagnostics.reporting}
                    disabled={diagnostics.reporting}
                    onClick={() => {
                        void diagnostics.openGitHubIssue();
                    }}
                >
                    {t("diagnostics_open_issue")}
                </Button>
                <Button
                    type="button"
                    variant="default"
                    loading={diagnostics.diagnosticsBusy}
                    disabled={diagnostics.diagnosticsBusy}
                    onClick={() => {
                        void diagnostics.downloadDiagnostics();
                    }}
                >
                    {t("diagnostics_download")}
                </Button>
            </Group>
            <ResetConfirmation
                resetting={reset.resetting}
                onConfirm={() => {
                    void reset.reset();
                }}
            />
            {diagnosticsNotice ? (
                <Alert
                    role="status"
                    color={isDiagnosticsSuccessNotice(diagnosticsNotice) ? "signal" : "red"}
                >
                    {t(diagnosticsNotice)}
                </Alert>
            ) : null}
            {diagnostics.reportNotice ? (
                <Alert role="alert" color="red">
                    {t(diagnostics.reportNotice)}
                </Alert>
            ) : null}
            {resetNotice ? (
                <Alert role="alert" color="red">
                    {t(resetNotice)}
                </Alert>
            ) : null}
        </Stack>
    );
}
