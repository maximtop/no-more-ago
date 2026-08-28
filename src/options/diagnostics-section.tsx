/**
 * @file Renders diagnostic logging, archive, and GitHub report controls.
 */

import { Alert, Box, Button, Stack, Switch, Text } from "@mantine/core";
import type { ReactElement } from "react";
import { STATE_AVAILABILITY } from "../shared/messages";
import {
    DIAGNOSTICS_CLEARED_NOTICE,
    type DiagnosticsController,
} from "./diagnostics-controller";

/**
 * Properties for the diagnostics section.
 */
export interface DiagnosticsSectionProps {
    /**
     * State and commands owned by the diagnostics controller.
     */
    readonly controller: DiagnosticsController;
}

/**
 * Renders opt-in diagnostic logging, archive management, and site reporting.
 *
 * @param props Component properties.
 * @param props.controller State and commands for diagnostics and reporting.
 * @returns The diagnostics section.
 */
export function DiagnosticsSection({ controller }: DiagnosticsSectionProps): ReactElement {
    return (
        <Box component="section" aria-labelledby="debug-heading">
            <Text id="debug-heading" size="lg" fw={600}>
                Diagnostics
            </Text>
            <Button
                type="button"
                onClick={() => {
                    void controller.openGitHubIssue();
                }}
                loading={controller.reporting}
                disabled={controller.reporting}
            >
                Open GitHub issue
            </Button>
            {controller.reportNotice ? (
                <Alert role="alert" color="red">
                    {controller.reportNotice}
                </Alert>
            ) : null}
            {controller.loading ? <Text role="status">Loading debug settings…</Text> : null}
            {!controller.loading
                && controller.state?.availability === STATE_AVAILABILITY.UNAVAILABLE ? (
                    <Text role="status">
                        Debug logs are unavailable. Processing remains unchanged.
                    </Text>
                ) : null}
            {!controller.loading && controller.state?.availability === STATE_AVAILABILITY.READY ? (
                <Stack gap="xs" mt="xs">
                    <Switch
                        label="Debug logs"
                        aria-label="Debug logs"
                        checked={controller.state.enabled}
                        disabled={controller.saving}
                        onChange={(event) => {
                            void controller.changeDebug(event.currentTarget.checked);
                        }}
                    />
                    <Stack gap="xs" style={{ flexDirection: "row" }}>
                        <Button
                            type="button"
                            onClick={() => {
                                void controller.downloadDiagnostics();
                            }}
                            loading={controller.diagnosticsBusy}
                            disabled={!controller.state.enabled || controller.diagnosticsBusy}
                        >
                            Download logs
                        </Button>
                        <Button
                            type="button"
                            variant="default"
                            onClick={() => {
                                void controller.clearDiagnostics();
                            }}
                            loading={controller.diagnosticsBusy}
                            disabled={!controller.state.enabled || controller.diagnosticsBusy}
                        >
                            Clear logs
                        </Button>
                    </Stack>
                    {controller.diagnosticsNotice ? (
                        <Alert
                            role="status"
                            color={
                                controller.diagnosticsNotice === DIAGNOSTICS_CLEARED_NOTICE
                                    ? "green"
                                    : "red"
                            }
                        >
                            {controller.diagnosticsNotice}
                        </Alert>
                    ) : null}
                </Stack>
            ) : null}
        </Box>
    );
}
