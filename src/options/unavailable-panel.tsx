/**
 * @file Settings recovery view shown when settings cannot be read.
 */

import { Alert, Button, Group, Stack, Text, Title } from "@mantine/core";
import type { ReactElement } from "react";
import type { DiagnosticsController } from "./diagnostics-controller";
import { ResetConfirmation } from "./reset-confirmation";
import type { ResetController } from "./reset-controller";

/**
 * Controllers backing the recovery actions.
 */
export interface OptionsUnavailablePanelProps {
    /**
     * Explanation of why no setting can be shown.
     */
    readonly message: string;

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
 * @param props.message - Explanation of the failure.
 * @param props.diagnostics - Diagnostics controller.
 * @param props.reset - Reset coordinator.
 * @param props.resetNotice - Failure guidance from the latest reset attempt.
 * @returns - The settings recovery view.
 */
export function OptionsUnavailablePanel({
    message,
    diagnostics,
    reset,
    resetNotice,
}: OptionsUnavailablePanelProps): ReactElement {
    return (
        <Stack gap="md" className="settings-content settings-unavailable" component="section">
            <Title order={2}>Settings are unavailable</Title>
            <Text role="status">{message}</Text>
            <Text size="sm" c="dimmed">
                No page is being changed. Report the problem, download any retained logs, or
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
            {diagnostics.diagnosticsNotice ? (
                <Alert role="status" color="gray">
                    {diagnostics.diagnosticsNotice}
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
