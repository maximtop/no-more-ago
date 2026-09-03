/**
 * @file Settings recovery view shown when settings cannot be read.
 */

import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import type { SettingsStateFailure } from "../shared/messaging/view-state-values";
import { isDiagnosticsSuccessNotice } from "../shared/diagnostics/download";
import { unavailableSettingsCopy } from "../shared/ui/copy";
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
    readonly resetNotice: string | undefined;
}

/**
 * Renders the failure explanation and its recovery actions.
 *
 * @param props - Component properties.
 * @param props.failure - Failure carried by the unavailable projection.
 * @param props.diagnostics - Diagnostics controller.
 * @param props.reset - Reset coordinator.
 * @param props.resetNotice - Failure guidance from the latest reset attempt.
 * @returns - The settings recovery view.
 */
export function OptionsUnavailablePanel({
    failure,
    diagnostics,
    reset,
    resetNotice,
}: OptionsUnavailablePanelProps): ReactElement {
    const copy = unavailableSettingsCopy(failure);
    const { diagnosticsNotice } = diagnostics;
    return (
        <Stack gap="md" className="options-content options-unavailable" component="section">
            <Title order={2}>Settings are unavailable</Title>
            <Text role="status">{copy.status}</Text>
            <Text size="sm" c="dimmed">
                {copy.consequence} Report the problem, download any retained logs, or
                restore the default settings.
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
                    Open GitHub issue
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
                    Download logs
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
                    {diagnosticsNotice}
                </Alert>
            ) : null}
            {diagnostics.reportNotice ? (
                <Alert role="alert" color="red">
                    {diagnostics.reportNotice}
                </Alert>
            ) : null}
            {resetNotice ? (
                <Alert role="alert" color="red">
                    {resetNotice}
                </Alert>
            ) : null}
        </Stack>
    );
}
